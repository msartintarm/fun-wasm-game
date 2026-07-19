import type { ChordTimeline } from "./chordTimeline";

export type MusicTrackId = string;

export interface MusicTrack {
  id: MusicTrackId;
  midiUrl: string;
  timeline: ChordTimeline;
}

// Add entries here keyed by track id as more .mid assets + matching
// hand-authored chord timelines get sourced. `rock-drums-bass` (see
// scripts/generate-midi-assets.mjs) is the only one so far — its
// ChordTimeline mirrors exactly what the bass line in that file actually
// plays (C, D, E, F, one per bar).
export const TRACKS: Record<MusicTrackId, MusicTrack> = {
  "rock-drums-bass": {
    id: "rock-drums-bass",
    midiUrl: "/audio/tracks/rock-drums-bass.mid",
    timeline: {
      bpm: 100,
      beatsPerBar: 4,
      loopLengthBars: 4,
      chords: [
        { bar: 0, chord: "C" },
        { bar: 1, chord: "D" },
        { bar: 2, chord: "E" },
        { bar: 3, chord: "F" },
      ],
    },
  },
};

// Keyed by CONFIG_PRESETS[i].name (see lib/gameConfig.ts). Each level can
// have multiple candidate tracks; one is picked at random per level start.
// Only one track exists so far, so every preset shares it for now.
export const PRESET_TRACKS: Record<string, MusicTrackId[]> = {
  "Chaos Arena": ["rock-drums-bass"],
  Duel: ["rock-drums-bass"],
  Balanced: ["rock-drums-bass"],
};

// Pure aside from the injectable rng (matches pickPickupNote's pattern, for
// deterministic tests). Undefined when the preset has no tracks defined yet.
export function pickTrackForPreset(
  presetName: string,
  rng: () => number = Math.random,
): MusicTrackId | undefined {
  const candidates = PRESET_TRACKS[presetName];
  if (!candidates || candidates.length === 0) return undefined;
  return candidates[Math.floor(rng() * candidates.length)];
}
