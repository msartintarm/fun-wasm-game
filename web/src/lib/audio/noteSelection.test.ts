import { describe, expect, it } from "vitest";
import { parseChordName, pickPickupNote } from "./noteSelection";

describe("parseChordName", () => {
  it("parses a plain major triad", () => {
    expect(parseChordName("C")).toEqual({ root: "C", quality: "" });
  });

  it("parses a sharp root with a two-character quality", () => {
    expect(parseChordName("F#m7")).toEqual({ root: "F#", quality: "m7" });
  });

  it("parses a flat root", () => {
    expect(parseChordName("Bbmaj7")).toEqual({ root: "Bb", quality: "maj7" });
  });

  it("falls back to C major for an unparseable name", () => {
    expect(parseChordName("")).toEqual({ root: "C", quality: "" });
  });
});

describe("pickPickupNote", () => {
  it("is deterministic for a fixed rng", () => {
    expect(pickPickupNote("Cmaj7", () => 0)).toBe(60); // root, C4
    expect(pickPickupNote("Cmaj7", () => 0.99)).toBe(71); // last interval (11 semitones), B4
  });

  it("stays within the chord's own tones across the full rng range", () => {
    // Cmaj7 intervals: [0, 4, 7, 11] -> MIDI 60, 64, 67, 71
    const possible = new Set([60, 64, 67, 71]);
    for (let i = 0; i < 20; i++) {
      const rng = i / 20;
      expect(possible.has(pickPickupNote("Cmaj7", () => rng))).toBe(true);
    }
  });

  it("falls back to a major triad for an unrecognized quality", () => {
    expect(pickPickupNote("Cxyz", () => 0)).toBe(60);
  });
});
