// Hand-authored, not derived from a MIDI file's actual notes — a track's
// chord progression is data that ships alongside it, independent of
// whatever the audio engine actually renders. `bpm` and `loopLengthBars`
// must match the paired .mid file's real tempo/length; that's an authoring
// responsibility, not something this module can check.
export interface ChordEvent {
  bar: number; // 0-based bar within one loop iteration, ascending order
  chord: string; // e.g. "Cmaj7" — matched against noteSelection's interval table
}

export interface ChordTimeline {
  bpm: number;
  beatsPerBar: number;
  loopLengthBars: number;
  chords: ChordEvent[];
}

function msPerBar(bpm: number, beatsPerBar: number): number {
  return (60_000 / bpm) * beatsPerBar;
}

// The musically-correct loop point, in seconds — purely a function of
// tempo and bar count, not of where any note happens to end. A MIDI file's
// own reported duration (e.g. @tonejs/midi's `Midi.duration`, derived from
// the last note-off event) is the wrong thing to loop on: a track that
// deliberately shortens its last note for a gap effect would report a
// duration short of the real bar boundary, cutting the loop off the beat
// grid. Use this for `Tone.Part.loopEnd` instead.
export function loopDurationSeconds(timeline: ChordTimeline): number {
  const { bpm, beatsPerBar, loopLengthBars } = timeline;
  return (60 / bpm) * beatsPerBar * loopLengthBars;
}

// Pure. Finds the chord active at `elapsedMs` into a looping track: converts
// elapsed time to a bar position (wrapping at loopLengthBars), then returns
// the last chord whose `bar` is at or before that position.
export function activeChordAt(timeline: ChordTimeline, elapsedMs: number): string {
  const { bpm, beatsPerBar, loopLengthBars, chords } = timeline;
  const barInLoop = (elapsedMs / msPerBar(bpm, beatsPerBar)) % loopLengthBars;

  let active = chords[0]?.chord ?? "";
  for (const event of chords) {
    if (event.bar > barInLoop) break;
    active = event.chord;
  }
  return active;
}
