import { MusicState, type MusicTrack, type MusicTrackId } from "./tracks";

// Pure data — no playback logic here (see ../audioFileEngine.ts for that).
// Real recorded tracks, as opposed to data/tracks.ts's procedural MIDI —
// see the pending MIDI-to-audio-file migration. "sailing-to-hell" (see
// scripts/process-audio-assets.mjs) is 120 BPM, 3/4 time, one chord (E
// minor) for its whole length — no chord changes yet.
//
// Three-stem adaptive mix: base is drums-only (always audible — see
// MusicTrack's doc comment), bass mixes in for both Idle and Boosted, and
// keys/guitar mixes in only while Boosted. Net effect per MusicState:
//   Dead    -> drums only
//   Idle    -> drums + bass
//   Boosted -> drums + bass + keys/guitar (everything)
// All three stems are sample-locked to the same 347.796625s duration,
// verified by process-audio-assets.mjs at generation time.
export const AUDIO_TRACKS: Record<MusicTrackId, MusicTrack> = {
  "sailing-to-hell": {
    id: "sailing-to-hell",
    assetPath: "tracks/sailing-to-hell.mp3",
    timeline: {
      bpm: 120,
      beatsPerBar: 3,
      loopLengthBars: 232, // ~347.8s duration / 1.5s-per-bar at 120 BPM 3/4
      chords: [{ bar: 0, chord: "Em" }],
    },
    layers: [
      {
        id: "bass",
        assetPath: "tracks/sailing-to-hell-bass.mp3",
        audibleIn: [MusicState.Idle, MusicState.Boosted],
      },
      {
        id: "keys-guitar",
        assetPath: "tracks/sailing-to-hell-keys-guitar.mp3",
        audibleIn: [MusicState.Boosted],
        // Mixed 5% quieter than drums/bass — it read as too loud relative
        // to the rhythm section at unity gain.
        relativeVolume: 0.95,
      },
    ],
  },
};

// Keyed by CONFIG_PRESETS[i].name (see lib/gameConfig.ts), same shape as
// data/tracks.ts's PRESET_TRACKS. Only one real-audio track exists so far,
// so every preset shares it for now.
export const AUDIO_PRESET_TRACKS: Record<string, MusicTrackId[]> = {
  "Chaos Arena": ["sailing-to-hell"],
  Duel: ["sailing-to-hell"],
  Balanced: ["sailing-to-hell"],
};
