import type { ChordTimeline } from "../chordTimeline";

export type MusicTrackId = string;

// A runtime condition that gates whether a layer is audible. Only
// consumed by audioFileEngine.ts (see setBoosted) — midiEngine.ts doesn't
// support layers and never reads this.
export enum LayerCondition {
  Boosted = "boosted",
}

export interface TrackLayer {
  id: string;
  // Same relative-path convention as MusicTrack.assetPath below.
  assetPath: string;
  condition: LayerCondition;
}

export interface MusicTrack {
  id: MusicTrackId;
  // Relative to the audio asset base URL (see ../assetUrl) — never an
  // absolute URL, so the same entry works whether assets are served from
  // this app's public/ folder or, later, a CDN. Also format-agnostic on
  // purpose: today it points at a .mid file, but a future non-MIDI engine
  // implementation (see AGENTS-level note on the pending audio-file
  // migration) reads the same field for its own asset format.
  assetPath: string;
  timeline: ChordTimeline;
  // Additional stems played in sample-accurate sync with the base track,
  // faded in/out based on `condition` — see audioFileEngine.ts. Optional
  // and MIDI-tracks never set it; undefined is the correct "no layers" state.
  layers?: TrackLayer[];
}

// Pure data — no playback logic here (see ../tracks.ts for that). Add
// entries here keyed by track id as more assets + matching hand-authored
// chord timelines get sourced. `rock-drums-bass` (see
// scripts/generate-midi-assets.mjs) is the only one so far — its
// ChordTimeline mirrors exactly what the bass line in that file actually
// plays (C, D, E, F, one per bar).
export const TRACKS: Record<MusicTrackId, MusicTrack> = {
  "rock-drums-bass": {
    id: "rock-drums-bass",
    assetPath: "tracks/rock-drums-bass.mid",
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
