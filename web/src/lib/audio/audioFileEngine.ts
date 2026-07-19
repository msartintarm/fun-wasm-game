import * as Tone from "tone";

import { audioAssetUrl } from "./assetUrl";
import { activeChordAt } from "./chordTimeline";
import { AUDIO_TRACKS } from "./data/audioTracks";
import { pickPickupNote } from "./noteSelection";
import type { MusicTrackId } from "./tracks";
import { assertNever, AudioCommandType, type AudioEngine } from "./audioEngine";

export function createEngine(): AudioEngine {
  const pickupSynth = new Tone.PolySynth(Tone.Synth, {
    envelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.2 },
  }).toDestination();

  // Same pattern as midiEngine.ts throughout — see its comments for the
  // reasoning (gesture-gated resume, pending-track replay, generation
  // counter guarding against a stale load resolving after a newer request).
  let contextStarted: Promise<void> | null = null;
  let pendingTrackId: MusicTrackId | undefined;
  let hasPendingTrackRequest = false;
  let currentPlayer: Tone.Player | null = null;
  let currentTrackId: MusicTrackId | undefined;
  let trackStartedAt = 0;
  let requestGeneration = 0;

  function stopCurrentPlayer() {
    currentPlayer?.dispose();
    currentPlayer = null;
    currentTrackId = undefined;
  }

  function reallyStartTrack(id: MusicTrackId) {
    const track = AUDIO_TRACKS[id];
    if (!track) return;

    const myGeneration = requestGeneration;
    const player = new Tone.Player({
      url: audioAssetUrl(track.assetPath),
      loop: true,
      onload: () => {
        // A newer startTrack/stopTrack call landed while this was in
        // flight — don't resurrect a stale track.
        if (myGeneration !== requestGeneration) {
          player.dispose();
          return;
        }
        player.start();
        currentPlayer = player;
        currentTrackId = id;
        trackStartedAt = performance.now();
      },
      onerror: (err) => {
        console.warn(`Failed to load audio track "${id}"; continuing without it.`, err);
      },
    }).toDestination();
  }

  function flushPendingTrack() {
    if (!hasPendingTrackRequest) return;
    hasPendingTrackRequest = false;
    if (pendingTrackId !== undefined) {
      reallyStartTrack(pendingTrackId);
    }
  }

  function resume() {
    if (contextStarted) return; // already resuming/resolved — idempotent
    contextStarted = Tone.start()
      .then(() => {
        flushPendingTrack();
      })
      .catch((err) => {
        console.warn("Failed to start audio context; continuing without sound.", err);
        contextStarted = null; // let a later real gesture retry
      });
  }

  function startTrack(id: MusicTrackId | undefined) {
    requestGeneration += 1;
    stopCurrentPlayer();
    pendingTrackId = id;
    hasPendingTrackRequest = id !== undefined;
    if (!hasPendingTrackRequest) return;
    contextStarted?.then(() => flushPendingTrack()).catch(() => {});
  }

  function stopTrack() {
    requestGeneration += 1;
    hasPendingTrackRequest = false;
    stopCurrentPlayer();
  }

  function triggerPickup() {
    if (!currentTrackId) return;
    const track = AUDIO_TRACKS[currentTrackId];
    if (!track) return;

    const elapsedMs = performance.now() - trackStartedAt;
    const chord = activeChordAt(track.timeline, elapsedMs);
    if (!chord) return;

    const midiNote = pickPickupNote(chord);
    const freq = Tone.Frequency(midiNote, "midi").toFrequency();
    pickupSynth.triggerAttackRelease(freq, "8n");
  }

  function setMuted(muted: boolean) {
    Tone.getDestination().mute = muted;
  }

  function setVolume(volume: number) {
    Tone.getDestination().volume.value = Tone.gainToDb(Math.max(0, Math.min(1, volume)));
  }

  return (command) => {
    switch (command.type) {
      case AudioCommandType.Resume:
        return resume();
      case AudioCommandType.StartTrack:
        return startTrack(command.id);
      case AudioCommandType.StopTrack:
        return stopTrack();
      case AudioCommandType.TriggerPickup:
        return triggerPickup();
      case AudioCommandType.SetMuted:
        return setMuted(command.muted);
      case AudioCommandType.SetVolume:
        return setVolume(command.volume);
      default:
        return assertNever(command);
    }
  };
}
