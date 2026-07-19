import { describe, expect, it } from "vitest";
import { activeChordAt, loopDurationSeconds, type ChordTimeline } from "./chordTimeline";

const timeline: ChordTimeline = {
  bpm: 120,
  beatsPerBar: 4,
  loopLengthBars: 4,
  chords: [
    { bar: 0, chord: "Cmaj7" },
    { bar: 2, chord: "Am7" },
    { bar: 3, chord: "G7" },
  ],
};

// At 120 bpm, 4 beats/bar: one bar = 2000ms.
describe("activeChordAt", () => {
  it("returns the first chord at the very start", () => {
    expect(activeChordAt(timeline, 0)).toBe("Cmaj7");
  });

  it("returns the chord in effect partway through its bar", () => {
    expect(activeChordAt(timeline, 3000)).toBe("Cmaj7"); // 1.5 bars in
  });

  it("switches exactly at a chord's bar boundary", () => {
    expect(activeChordAt(timeline, 4000)).toBe("Am7"); // exactly bar 2
  });

  it("holds the last chord through the end of the loop", () => {
    expect(activeChordAt(timeline, 7999)).toBe("G7"); // just before wrap
  });

  it("wraps back to the first chord after a full loop", () => {
    expect(activeChordAt(timeline, 8000)).toBe("Cmaj7"); // exactly one loop (4 bars = 8000ms)
  });

  it("wraps correctly for elapsed times spanning multiple loops", () => {
    expect(activeChordAt(timeline, 8000 * 3 + 4000)).toBe("Am7");
  });

  it("returns an empty string for a timeline with no chords", () => {
    expect(activeChordAt({ ...timeline, chords: [] }, 0)).toBe("");
  });
});

describe("loopDurationSeconds", () => {
  it("computes bar-aligned loop length from bpm/beatsPerBar/loopLengthBars alone", () => {
    // 120 bpm, 4 beats/bar -> 2s/bar; 4 bars -> 8s. Independent of any note
    // data — this is the whole point (see the comment on the function).
    expect(loopDurationSeconds(timeline)).toBe(8);
  });

  it("matches the rock-drums-bass track's real 100 bpm / 4-bar length", () => {
    expect(
      loopDurationSeconds({ bpm: 100, beatsPerBar: 4, loopLengthBars: 4, chords: [] }),
    ).toBeCloseTo(9.6);
  });
});
