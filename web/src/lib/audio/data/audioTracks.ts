import { MusicState, type MusicTrack, type MusicTrackId } from "./tracks";

// Pure data — no playback logic here (see ../audioFileEngine.ts for that).
// Real recorded tracks, as opposed to data/tracks.ts's procedural MIDI —
// see the pending MIDI-to-audio-file migration. "sailing-to-hell" (see
// scripts/process-audio-assets.mjs) is 120 BPM, 3/4 time. `chords` below
// is generated, not hand-authored: run
//   node tools/infer-chords.mjs --bass audio-src/sailing-to-hell-bass.wav --harmonic audio-src/sailing-to-hell-keys-guitar.wav --bpm 120 --beats-per-bar 3
// (tools/infer-chords.mjs analyzes the isolated bass stem for chord roots
// and the keys/guitar stem for major/minor quality). It's a drafting aid,
// not a guaranteed-correct transcription — bars 117-172 and a few scattered
// bars elsewhere (91-99, 206-220) are genuinely busier/less certain than
// the rest; see the tool's per-bar diagnostic output for exactly which.
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
      chords: [
        { bar: 8, chord: "Em" },
        { bar: 12, chord: "G" },
        { bar: 14, chord: "D" },
        { bar: 16, chord: "Em" },
        { bar: 20, chord: "G" },
        { bar: 22, chord: "D" },
        { bar: 24, chord: "Em" },
        { bar: 28, chord: "G" },
        { bar: 30, chord: "D" },
        { bar: 32, chord: "Em" },
        { bar: 36, chord: "G" },
        { bar: 38, chord: "D" },
        { bar: 40, chord: "Em" },
        { bar: 44, chord: "G" },
        { bar: 46, chord: "D" },
        { bar: 48, chord: "Em" },
        { bar: 52, chord: "G" },
        { bar: 54, chord: "D" },
        { bar: 56, chord: "Em" },
        { bar: 59, chord: "D" },
        { bar: 61, chord: "C" },
        { bar: 62, chord: "D" },
        { bar: 63, chord: "C" },
        { bar: 64, chord: "D" },
        { bar: 67, chord: "Em" },
        { bar: 71, chord: "G" },
        { bar: 73, chord: "D" },
        { bar: 75, chord: "Em" },
        { bar: 79, chord: "G" },
        { bar: 81, chord: "D" },
        { bar: 83, chord: "Em" },
        { bar: 87, chord: "G" },
        { bar: 89, chord: "D" },
        { bar: 91, chord: "Em" },
        { bar: 92, chord: "G" },
        { bar: 93, chord: "E" },
        { bar: 94, chord: "Em" },
        { bar: 95, chord: "G" },
        { bar: 96, chord: "B" },
        { bar: 97, chord: "D" },
        { bar: 98, chord: "D#m" },
        { bar: 99, chord: "Em" },
        { bar: 103, chord: "G" },
        { bar: 105, chord: "D" },
        { bar: 107, chord: "Em" },
        { bar: 111, chord: "G" },
        { bar: 113, chord: "D" },
        { bar: 115, chord: "Em" },
        { bar: 116, chord: "G" },
        { bar: 117, chord: "C" },
        { bar: 119, chord: "D" },
        { bar: 120, chord: "C" },
        { bar: 121, chord: "D" },
        { bar: 122, chord: "C" },
        { bar: 123, chord: "D" },
        { bar: 124, chord: "C" },
        { bar: 125, chord: "D" },
        { bar: 126, chord: "C" },
        { bar: 127, chord: "D" },
        { bar: 128, chord: "C" },
        { bar: 129, chord: "D" },
        { bar: 130, chord: "C" },
        { bar: 131, chord: "D" },
        { bar: 133, chord: "Em" },
        { bar: 135, chord: "C" },
        { bar: 138, chord: "Bm" },
        { bar: 139, chord: "Cm" },
        { bar: 140, chord: "Em" },
        { bar: 141, chord: "C" },
        { bar: 151, chord: "D" },
        { bar: 152, chord: "C" },
        { bar: 153, chord: "D" },
        { bar: 154, chord: "C" },
        { bar: 155, chord: "D" },
        { bar: 158, chord: "C" },
        { bar: 160, chord: "Bm" },
        { bar: 162, chord: "C" },
        { bar: 163, chord: "G" },
        { bar: 164, chord: "Bm" },
        { bar: 165, chord: "F#m" },
        { bar: 166, chord: "C" },
        { bar: 168, chord: "Bm" },
        { bar: 170, chord: "C" },
        { bar: 172, chord: "D" },
        { bar: 174, chord: "E" },
        { bar: 176, chord: "Em" },
        { bar: 178, chord: "G" },
        { bar: 180, chord: "D" },
        { bar: 182, chord: "Em" },
        { bar: 186, chord: "G" },
        { bar: 188, chord: "D" },
        { bar: 190, chord: "Em" },
        { bar: 194, chord: "G" },
        { bar: 196, chord: "D" },
        { bar: 198, chord: "Em" },
        { bar: 202, chord: "G" },
        { bar: 204, chord: "D" },
        { bar: 206, chord: "Em" },
        { bar: 207, chord: "G" },
        { bar: 208, chord: "E" },
        { bar: 209, chord: "Em" },
        { bar: 210, chord: "G" },
        { bar: 212, chord: "D" },
        { bar: 214, chord: "Em" },
        { bar: 215, chord: "G" },
        { bar: 216, chord: "E" },
        { bar: 218, chord: "G" },
        { bar: 220, chord: "D" },
        { bar: 222, chord: "Em" },
      ],
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
