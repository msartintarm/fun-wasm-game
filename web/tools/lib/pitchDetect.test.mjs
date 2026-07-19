import { describe, expect, it } from "vitest";
import { detectPitchAutocorrelation, frequencyToPitchClass, goertzelMagnitude, rms } from "./pitchDetect.mjs";

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

describe("rms", () => {
  it("is 0 for silence", () => {
    expect(rms(new Float32Array(100))).toBe(0);
  });

  it("matches the amplitude of a full-scale square-ish signal", () => {
    const frame = new Float32Array([1, -1, 1, -1]);
    expect(rms(frame)).toBe(1);
  });
});

describe("detectPitchAutocorrelation", () => {
  it("recovers a bass E2 (82.41 Hz) fundamental within bass range", () => {
    const freq = detectPitchAutocorrelation(sine(82.41, 0.3), SAMPLE_RATE, 41, 196);
    expect(freq).not.toBeNull();
    expect(freq).toBeCloseTo(82.41, 0);
  });

  it("recovers a bass A2 (110 Hz) fundamental", () => {
    const freq = detectPitchAutocorrelation(sine(110, 0.3), SAMPLE_RATE, 41, 196);
    expect(freq).toBeCloseTo(110, 0);
  });

  it("does not lock onto a subharmonic for a near-pure tone", () => {
    // The classic octave-error failure mode: a periodic tone correlates
    // just as strongly at 2x its true period as at the true period, so a
    // naive global-max search would report ~41 Hz here instead of ~82 Hz.
    const freq = detectPitchAutocorrelation(sine(82.41, 0.3), SAMPLE_RATE, 41, 196);
    expect(freq).toBeGreaterThan(70);
  });

  it("does not lock onto the 2nd/3rd harmonic for a harmonically rich tone", () => {
    const fundamental = 82.41;
    const rich = mix(
      sine(fundamental, 0.3, 0.5),
      sine(fundamental * 2, 0.3, 0.2),
      sine(fundamental * 3, 0.3, 0.1),
    );
    const freq = detectPitchAutocorrelation(rich, SAMPLE_RATE, 41, 196);
    expect(freq).toBeCloseTo(fundamental, 0);
  });

  it("returns null for silence", () => {
    expect(detectPitchAutocorrelation(new Float32Array(SAMPLE_RATE), SAMPLE_RATE, 41, 196)).toBeNull();
  });

  it("returns null when nothing in range clears the correlation threshold (white noise)", () => {
    const noise = new Float32Array(SAMPLE_RATE * 0.3);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
    expect(detectPitchAutocorrelation(noise, SAMPLE_RATE, 41, 196)).toBeNull();
  });
});

describe("frequencyToPitchClass", () => {
  it("maps A4 (440 Hz) to pitch class 9", () => {
    expect(frequencyToPitchClass(440)).toBe(9);
  });

  it("maps E2 (82.41 Hz) to pitch class 4", () => {
    expect(frequencyToPitchClass(82.41)).toBe(4);
  });

  it("wraps octaves to the same pitch class", () => {
    expect(frequencyToPitchClass(220)).toBe(frequencyToPitchClass(110));
  });
});

describe("goertzelMagnitude", () => {
  it("reports higher energy at a frequency actually present in the signal than one absent from it", () => {
    const frame = sine(200, 0.3, 0.5);
    const present = goertzelMagnitude(frame, SAMPLE_RATE, 200);
    const absent = goertzelMagnitude(frame, SAMPLE_RATE, 300);
    expect(present).toBeGreaterThan(absent * 5);
  });

  it("distinguishes a major third from a minor third mixed with the same root", () => {
    const root = 164.81; // E3
    const majorThird = 207.65; // G#3
    const minorThird = 195.99; // G3

    const majorChord = mix(sine(root, 0.3, 0.3), sine(majorThird, 0.3, 0.3));
    expect(goertzelMagnitude(majorChord, SAMPLE_RATE, majorThird)).toBeGreaterThan(
      goertzelMagnitude(majorChord, SAMPLE_RATE, minorThird) * 2,
    );

    const minorChord = mix(sine(root, 0.3, 0.3), sine(minorThird, 0.3, 0.3));
    expect(goertzelMagnitude(minorChord, SAMPLE_RATE, minorThird)).toBeGreaterThan(
      goertzelMagnitude(minorChord, SAMPLE_RATE, majorThird) * 2,
    );
  });
});
