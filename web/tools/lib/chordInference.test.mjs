import { describe, expect, it } from "vitest";
import {
  despikeChordSequence,
  detectMeasureQuality,
  detectMeasureRoot,
  formatChordSymbol,
  pitchClassToFrequency,
} from "./chordInference.mjs";

const SAMPLE_RATE = 11025;

function sine(freq, seconds, amplitude = 0.5) {
  const n = Math.floor(SAMPLE_RATE * seconds);
  const frame = new Float32Array(n);
  for (let i = 0; i < n; i++) frame[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
  return frame;
}

function mix(...frames) {
  const out = new Float32Array(frames[0].length);
  for (const frame of frames) {
    for (let i = 0; i < out.length; i++) out[i] += frame[i];
  }
  return out;
}

describe("pitchClassToFrequency", () => {
  it("matches A4 = 440 Hz (pitch class 9, octave 4)", () => {
    expect(pitchClassToFrequency(9, 4)).toBeCloseTo(440, 1);
  });
});

describe("detectMeasureRoot", () => {
  it("detects a sustained E2 bass note as pitch class 4 with high confidence", () => {
    const measure = sine(82.41, 2.0);
    expect(detectMeasureRoot(measure, SAMPLE_RATE)).toEqual({ pitchClass: 4, confidence: "high" });
  });

  it("takes the mode, not the first note, when a passing tone briefly interrupts a sustained root", () => {
    // 4 sub-frames: E2, E2, E2, A2 (a passing tone in the last quarter) —
    // E2 should still win 3-to-1.
    const e2 = sine(82.41, 0.5);
    const a2 = sine(110, 0.5);
    const measure = new Float32Array(e2.length * 3 + a2.length);
    measure.set(e2, 0);
    measure.set(e2, e2.length);
    measure.set(e2, e2.length * 2);
    measure.set(a2, e2.length * 3);
    expect(detectMeasureRoot(measure, SAMPLE_RATE)).toEqual({ pitchClass: 4, confidence: "high" });
  });

  it("reports low confidence for silence", () => {
    const measure = new Float32Array(SAMPLE_RATE * 2);
    expect(detectMeasureRoot(measure, SAMPLE_RATE)).toEqual({ pitchClass: null, confidence: "low" });
  });
});

describe("detectMeasureQuality", () => {
  it("identifies a major third above the root as major (\"\")", () => {
    const root = 4; // E
    const measure = mix(sine(pitchClassToFrequency(root, 3), 2.0, 0.3), sine(pitchClassToFrequency(8, 3), 2.0, 0.3));
    const result = detectMeasureQuality(measure, SAMPLE_RATE, root);
    expect(result.quality).toBe("");
    expect(result.confidence).toBe("high");
  });

  it("identifies a minor third above the root as minor (\"m\")", () => {
    const root = 4; // E
    const measure = mix(sine(pitchClassToFrequency(root, 3), 2.0, 0.3), sine(pitchClassToFrequency(7, 3), 2.0, 0.3));
    const result = detectMeasureQuality(measure, SAMPLE_RATE, root);
    expect(result.quality).toBe("m");
    expect(result.confidence).toBe("high");
  });

  it("reports low confidence for silence", () => {
    const measure = new Float32Array(SAMPLE_RATE * 2);
    const result = detectMeasureQuality(measure, SAMPLE_RATE, 4);
    expect(result.confidence).toBe("low");
  });
});

describe("formatChordSymbol", () => {
  it("formats a major chord as just the root letter", () => {
    expect(formatChordSymbol(4, "")).toBe("E");
  });

  it("formats a minor chord with a trailing m", () => {
    expect(formatChordSymbol(4, "m")).toBe("Em");
  });
});

function bar(n, chord) {
  return { bar: n, chord };
}

describe("despikeChordSequence", () => {
  it("corrects a single-bar A-B-A spike back to the surrounding chord", () => {
    const entries = [bar(0, "Em"), bar(1, "G"), bar(2, "Em")];
    expect(despikeChordSequence(entries)).toEqual([bar(0, "Em"), bar(1, "Em"), bar(2, "Em")]);
  });

  it("leaves a genuinely sustained 2-bar change alone", () => {
    const entries = [bar(0, "Em"), bar(1, "G"), bar(2, "G"), bar(3, "Em")];
    expect(despikeChordSequence(entries)).toEqual(entries);
  });

  it("does not touch a bar at either end of the track (no neighbor on one side)", () => {
    const entries = [bar(0, "G"), bar(1, "Em"), bar(2, "Em")];
    expect(despikeChordSequence(entries)).toEqual(entries);
  });

  it("leaves silence (null) entries untouched and does not use them as a neighbor match", () => {
    const entries = [bar(0, "Em"), null, bar(2, "Em")];
    expect(despikeChordSequence(entries)).toEqual(entries);
  });

  it("is a no-op when every bar already agrees", () => {
    const entries = [bar(0, "D"), bar(1, "D"), bar(2, "D")];
    expect(despikeChordSequence(entries)).toEqual(entries);
  });
});
