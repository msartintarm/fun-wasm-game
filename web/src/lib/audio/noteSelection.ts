const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

// Semitone offsets from the root, keyed by everything after the root
// letter+accidental (e.g. "Cmaj7" -> root "C", quality "maj7").
const CHORD_INTERVALS: Record<string, number[]> = {
  "": [0, 4, 7], // major triad
  m: [0, 3, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  sus4: [0, 5, 7],
};

const DEFAULT_OCTAVE_MIDI_BASE = 60; // C4

export function parseChordName(chord: string): { root: string; quality: string } {
  const match = /^([A-G][#b]?)(.*)$/.exec(chord);
  if (!match) {
    return { root: "C", quality: "" };
  }
  const [, root, quality] = match;
  return { root, quality };
}

// Picks uniformly among the chord's tones — deliberately not always the
// root, since "one of several piano notes" is meant to have variety.
// `rng` is injectable (defaults to Math.random) so this is deterministically
// testable.
export function pickPickupNote(chord: string, rng: () => number = Math.random): number {
  const { root, quality } = parseChordName(chord);
  const rootSemitone = NOTE_TO_SEMITONE[root] ?? 0;
  const intervals = CHORD_INTERVALS[quality] ?? CHORD_INTERVALS[""];
  const interval = intervals[Math.floor(rng() * intervals.length)];
  return DEFAULT_OCTAVE_MIDI_BASE + rootSemitone + interval;
}
