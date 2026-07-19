import type { MusicTrackId } from "./tracks";

// The one interface calling code (see hooks/useAudioEngine.ts) depends on —
// nothing about MIDI, chords, or the underlying playback library leaks past
// this boundary. Swapping the MIDI-based implementation (midiEngine.ts) for
// a future Web Audio API-based one is a contained change: implement this
// interface differently, change nothing at the call sites.
export interface AudioEngine {
  // Unlocks/creates the underlying AudioContext. Must be reachable from
  // inside a real user-gesture event handler's call stack. Idempotent —
  // safe to call on every keypress.
  resume(): void;

  // Fire-and-forget. Replaces whatever track is playing (if any) with this
  // one, looping from bar 0. `undefined` (no track defined for this preset
  // yet) is a no-op. Safe to call before resume() has fired — the request
  // is remembered and started once audio actually unlocks.
  startTrack(id: MusicTrackId | undefined): void;

  stopTrack(): void;

  // Fire-and-forget. Plays one note from whichever chord the current
  // track's timeline says is active right now. No-op if nothing is
  // playing, audio isn't resumed yet, or the engine failed to load.
  triggerPickup(): void;
}

export const NullAudioEngine: AudioEngine = {
  resume() {},
  startTrack() {},
  stopTrack() {},
  triggerPickup() {},
};

let cached: AudioEngine | null = null;

// SSR-safe (no window access outside the dynamic import) and never throws —
// falls back to NullAudioEngine on any load or construction failure, so the
// game is always fully playable with no sound rather than broken.
export function getAudioEngine(): AudioEngine {
  if (typeof window === "undefined") {
    return NullAudioEngine;
  }
  if (cached) {
    return cached;
  }

  // Lazily replaced with the real engine once the dynamic import resolves;
  // calls made before that land on NullAudioEngine and are simply missed
  // (acceptable — resume() is called from every keypress, so the real
  // engine is live well before any pickup could plausibly happen).
  cached = NullAudioEngine;
  import("./midiEngine")
    .then((mod) => {
      cached = mod.createMidiAudioEngine();
    })
    .catch((err) => {
      console.warn("Audio engine failed to load; continuing without sound.", err);
    });
  return cached;
}
