import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeMonoPcm, inferChords } from "./infer-chords.mjs";

// Coarser pass on top of pitchDetect.test.mjs/chordInference.test.mjs's
// synthetic fixtures: runs the real pipeline against genuine committed
// music (not gitignored audio-src/ raw sources, so this runs in CI too),
// checking the output is well-formed rather than asserting exact chords —
// this tool is a drafting aid a human reviews, not a guaranteed-correct
// oracle.
const tracksDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "audio", "tracks");
const CHORD_SYMBOL_PATTERN = /^[A-G][#b]?m?$/;

describe("infer-chords against real committed audio", () => {
  it("runs end-to-end on the sailing-to-hell stems and produces well-formed output", () => {
    const sampleRate = 11025;
    const bassPcm = decodeMonoPcm(join(tracksDir, "sailing-to-hell-bass.mp3"), sampleRate);
    const harmonicPcm = decodeMonoPcm(join(tracksDir, "sailing-to-hell-keys-guitar.mp3"), sampleRate);

    const { chordEvents, totalMeasures, mostCommonChord } = inferChords({
      bassPcm,
      harmonicPcm,
      sampleRate,
      bpm: 120,
      beatsPerBar: 3,
    });

    expect(totalMeasures).toBeGreaterThan(200); // ~232 bars expected for this ~348s track
    expect(chordEvents.length).toBeGreaterThan(0);
    expect(mostCommonChord).toMatch(CHORD_SYMBOL_PATTERN);

    let previousBar = -1;
    for (const event of chordEvents) {
      expect(event.bar).toBeGreaterThan(previousBar);
      expect(event.chord).toMatch(CHORD_SYMBOL_PATTERN);
      previousBar = event.bar;
    }
  }, 30_000);

  it("runs bass-only (no harmonic stem) without crashing", () => {
    const sampleRate = 11025;
    const bassPcm = decodeMonoPcm(join(tracksDir, "sailing-to-hell-bass.mp3"), sampleRate);

    const { chordEvents } = inferChords({ bassPcm, harmonicPcm: null, sampleRate, bpm: 120, beatsPerBar: 3 });

    expect(chordEvents.length).toBeGreaterThan(0);
    // No harmonic stem -> quality always defaults to major ("").
    for (const event of chordEvents) {
      expect(event.chord.endsWith("m")).toBe(false);
    }
  }, 30_000);
});
