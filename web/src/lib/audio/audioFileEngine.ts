import * as Tone from "tone";

import { audioAssetUrl } from "./assetUrl";
import { activeChordAt } from "./chordTimeline";
import { AUDIO_TRACKS } from "./data/audioTracks";
import { MusicState, type TrackLayer } from "./data/tracks";
import { layerTargetGain } from "./layerLogic";
import { effectsBus, musicBus, setEffectsMuted, setEffectsVolume, setMusicMuted, setMusicVolume } from "./mixer";
import { pickDeathNote, pickPickupNote } from "./noteSelection";
import type { MusicTrackId } from "./tracks";
import { assertNever, AudioCommandType, type AudioEngine } from "./audioEngine";

// How long a layer takes to fade in/out when the player's boosted state
// changes — long enough to read as a musical swell, short enough to feel
// responsive to a boost that might only last a couple seconds.
const LAYER_FADE_SECONDS = 0.5;

interface ActiveLayer {
  layer: TrackLayer;
  player: Tone.Player;
}

export function createEngine(): AudioEngine {
  const pickupSynth = new Tone.PolySynth(Tone.Synth, {
    envelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.2 },
  }).connect(effectsBus);

  // Same pattern as midiEngine.ts throughout — see its comments for the
  // reasoning (gesture-gated resume, pending-track replay, generation
  // counter guarding against a stale load resolving after a newer request).
  let contextStarted: Promise<void> | null = null;
  let pendingTrackId: MusicTrackId | undefined;
  let hasPendingTrackRequest = false;
  let currentBasePlayer: Tone.Player | null = null;
  let currentLayers: ActiveLayer[] = [];
  let currentTrackId: MusicTrackId | undefined;
  let trackStartedAt = 0;
  let requestGeneration = 0;
  let musicState: MusicState = MusicState.Idle;

  function stopCurrentPlayers() {
    currentBasePlayer?.dispose();
    currentBasePlayer = null;
    currentLayers.forEach(({ player }) => player.dispose());
    currentLayers = [];
    currentTrackId = undefined;
  }

  // rampSeconds === 0 sets volume instantly (establishing initial state
  // right after a track starts) — otherwise ramps smoothly (a runtime
  // boosted-state transition).
  function applyLayerVolumes(rampSeconds: number) {
    for (const { layer, player } of currentLayers) {
      // Tone.gainToDb(0) is -Infinity (silent) on its own — no separate
      // "inaudible" branch needed.
      const targetDb = Tone.gainToDb(layerTargetGain(layer.audibleIn, layer.relativeVolume, musicState));
      if (rampSeconds > 0) {
        player.volume.rampTo(targetDb, rampSeconds);
      } else {
        player.volume.value = targetDb;
      }
    }
  }

  function reallyStartTrack(id: MusicTrackId) {
    const track = AUDIO_TRACKS[id];
    if (!track) return;

    const myGeneration = requestGeneration;
    const basePlayer = new Tone.Player({ loop: true }).connect(musicBus);
    const layerEntries: ActiveLayer[] = (track.layers ?? []).map((layer) => ({
      layer,
      player: new Tone.Player({ loop: true }).connect(musicBus),
    }));

    // Every player (base + layers) must finish loading before any of them
    // starts — independent network/decode timing per file would otherwise
    // start them at slightly different moments, audibly drifting a
    // rhythmically-locked layer out of sync with the base over a
    // multi-minute loop. Starting them all at one shared Tone.now()
    // timestamp keeps them sample-accurate regardless of how long each
    // individually took to load.
    Promise.all([
      basePlayer.load(audioAssetUrl(track.assetPath)),
      ...layerEntries.map(({ layer, player }) => player.load(audioAssetUrl(layer.assetPath))),
    ])
      .then(() => {
        // A newer startTrack/stopTrack call landed while this was in
        // flight — don't resurrect a stale track.
        if (myGeneration !== requestGeneration) {
          basePlayer.dispose();
          layerEntries.forEach(({ player }) => player.dispose());
          return;
        }

        const startTime = Tone.now();
        basePlayer.start(startTime);
        layerEntries.forEach(({ player }) => player.start(startTime));

        currentBasePlayer = basePlayer;
        currentLayers = layerEntries;
        currentTrackId = id;
        trackStartedAt = performance.now();
        applyLayerVolumes(0);
      })
      .catch((err) => {
        console.warn(`Failed to load audio track "${id}"; continuing without it.`, err);
      });
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
    stopCurrentPlayers();
    pendingTrackId = id;
    hasPendingTrackRequest = id !== undefined;
    if (!hasPendingTrackRequest) return;
    contextStarted?.then(() => flushPendingTrack()).catch(() => {});
  }

  function stopTrack() {
    requestGeneration += 1;
    hasPendingTrackRequest = false;
    stopCurrentPlayers();
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

  function triggerDeath() {
    if (!currentTrackId) return;
    const track = AUDIO_TRACKS[currentTrackId];
    if (!track) return;

    const elapsedMs = performance.now() - trackStartedAt;
    const chord = activeChordAt(track.timeline, elapsedMs);
    if (!chord) return;

    const midiNote = pickDeathNote(chord);
    const freq = Tone.Frequency(midiNote, "midi").toFrequency();
    pickupSynth.triggerAttackRelease(freq, "2n");
  }

  function setMusicState(nextState: MusicState) {
    if (nextState === musicState) return;
    musicState = nextState;
    applyLayerVolumes(LAYER_FADE_SECONDS);
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
      case AudioCommandType.TriggerDeath:
        return triggerDeath();
      case AudioCommandType.SetMusicMuted:
        return setMusicMuted(command.muted);
      case AudioCommandType.SetMusicVolume:
        return setMusicVolume(command.volume);
      case AudioCommandType.SetEffectsMuted:
        return setEffectsMuted(command.muted);
      case AudioCommandType.SetEffectsVolume:
        return setEffectsVolume(command.volume);
      case AudioCommandType.SetMusicState:
        return setMusicState(command.state);
      default:
        return assertNever(command);
    }
  };
}
