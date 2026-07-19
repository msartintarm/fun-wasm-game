import { Midi } from "@tonejs/midi";
import * as Tone from "tone";

import { activeChordAt, loopDurationSeconds } from "./chordTimeline";
import { effectsBus, musicBus, setEffectsMuted, setEffectsVolume, setMusicMuted, setMusicVolume } from "./mixer";
import { pickPickupNote } from "./noteSelection";
import { TRACKS, trackAssetUrl, type MusicTrackId } from "./tracks";
import { assertNever, AudioCommandType, type AudioEngine } from "./audioEngine";

// Parsed MIDI files are cached per track id so revisiting a level doesn't
// re-fetch/re-parse the same file.
const parsedCache = new Map<MusicTrackId, Promise<Midi>>();

function loadMidi(id: MusicTrackId): Promise<Midi> {
  let cached = parsedCache.get(id);
  if (!cached) {
    cached = Midi.fromUrl(trackAssetUrl(TRACKS[id]));
    parsedCache.set(id, cached);
  }
  return cached;
}

export function createEngine(): AudioEngine {
  const backgroundSynth = new Tone.PolySynth(Tone.Synth, {
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.4, release: 0.5 },
  }).connect(musicBus);
  const pickupSynth = new Tone.PolySynth(Tone.Synth, {
    envelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.2 },
  }).connect(effectsBus);

  // Set only once Tone.start() has genuinely resolved — never eagerly, so
  // nothing can call Tone.Transport.start() while the AudioContext is
  // still suspended. resume() is the only place this is ever created,
  // since Tone.start() must run inside a real user-gesture call stack to
  // actually unlock audio (see hooks/useAudioEngine.ts's armAutoplay).
  let contextStarted: Promise<void> | null = null;
  let pendingTrackId: MusicTrackId | undefined;
  let hasPendingTrackRequest = false;
  let currentPart: Tone.Part | null = null;
  let currentTrackId: MusicTrackId | undefined;
  let trackStartedAt = 0;
  // Bumped on every startTrack/stopTrack so an in-flight MIDI load can tell
  // it's been superseded by a newer request before acting.
  let requestGeneration = 0;

  function stopCurrentPart() {
    currentPart?.dispose();
    currentPart = null;
    currentTrackId = undefined;
  }

  function reallyStartTrack(id: MusicTrackId) {
    const track = TRACKS[id];
    if (!track) return;

    const myGeneration = requestGeneration;
    loadMidi(id)
      .then((parsed) => {
        // A newer startTrack/stopTrack call landed while this was in
        // flight — don't resurrect a stale track.
        if (myGeneration !== requestGeneration) return;

        const notes = parsed.tracks.flatMap((t) => t.notes);
        const part = new Tone.Part((time, note) => {
          backgroundSynth.triggerAttackRelease(note.name, note.duration, time, note.velocity);
        }, notes.map((n) => [n.time, n] as const));
        part.loop = true;
        // Bar-aligned, not parsed.duration (see loopDurationSeconds) — a
        // note deliberately cut short before the bar boundary would
        // otherwise make the loop point drift off the beat grid.
        part.loopEnd = loopDurationSeconds(track.timeline);
        part.start(0);

        currentPart = part;
        currentTrackId = id;
        trackStartedAt = performance.now();
        Tone.Transport.start();
      })
      .catch((err) => {
        console.warn(`Failed to load MIDI track "${id}"; continuing without it.`, err);
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
    stopCurrentPart();
    pendingTrackId = id;
    hasPendingTrackRequest = id !== undefined;
    if (!hasPendingTrackRequest) return;
    // If resume() hasn't been called yet, contextStarted is still null and
    // this is a no-op for now — resume()'s own .then() will flush the
    // pending request once a real gesture actually happens. If resume()
    // already ran (whether or not it's resolved yet), attach to that same
    // promise instead of guessing based on a boolean.
    contextStarted?.then(() => flushPendingTrack()).catch(() => {});
  }

  function stopTrack() {
    requestGeneration += 1;
    hasPendingTrackRequest = false;
    stopCurrentPart();
  }

  function triggerPickup() {
    if (!currentTrackId) return;
    const track = TRACKS[currentTrackId];
    if (!track) return;

    const elapsedMs = performance.now() - trackStartedAt;
    const chord = activeChordAt(track.timeline, elapsedMs);
    if (!chord) return;

    const midiNote = pickPickupNote(chord);
    const freq = Tone.Frequency(midiNote, "midi").toFrequency();
    pickupSynth.triggerAttackRelease(freq, "8n");
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
      case AudioCommandType.SetMusicMuted:
        return setMusicMuted(command.muted);
      case AudioCommandType.SetMusicVolume:
        return setMusicVolume(command.volume);
      case AudioCommandType.SetEffectsMuted:
        return setEffectsMuted(command.muted);
      case AudioCommandType.SetEffectsVolume:
        return setEffectsVolume(command.volume);
      case AudioCommandType.SetBoosted:
        return; // no layers to fade — MIDI tracks don't support them
      default:
        return assertNever(command);
    }
  };
}
