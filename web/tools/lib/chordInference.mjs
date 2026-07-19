import { detectPitchAutocorrelation, frequencyToPitchClass, goertzelMagnitude } from "./pitchDetect.mjs";

export const PITCH_CLASS_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Standard bass guitar range (low E1 to a typical top around G3) — bass
// lines only occasionally go higher, and widening this invites picking up
// harmonics as if they were the fundamental.
const BASS_MIN_FREQ = 41;
const BASS_MAX_FREQ = 196;

const SUB_FRAMES_PER_MEASURE = 4;
const QUALITY_MARGIN_THRESHOLD_PERCENT = 20;

// Octaves searched for chord-quality chroma energy, independent of
// whatever octave the bass root happens to be in — the harmonic
// (keys/guitar) stem's voicing isn't tied to the bass's register. Spans
// typical guitar/keys chord range; wider risks noisier high harmonics,
// narrower risks missing where the chord is actually voiced.
const HARMONIC_ANALYSIS_OCTAVES = [3, 4, 5];

// Scientific pitch notation (octave 4 = A440, matching noteSelection.ts's
// DEFAULT_OCTAVE_MIDI_BASE = 60 for C4).
export function pitchClassToFrequency(pitchClass, octave) {
  const midi = (octave + 1) * 12 + pitchClass;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Splits a measure into sub-frames, autocorrelates each (bass-range
// restricted), and takes the *mode* of the resulting pitch classes — not
// the mean, since notes are semitone-quantized and a walking bassline's
// passing tones should just lose the vote to the sustained root.
export function detectMeasureRoot(bassMeasurePcm, sampleRate) {
  const subFrameLength = Math.floor(bassMeasurePcm.length / SUB_FRAMES_PER_MEASURE);
  if (subFrameLength <= 0) return { pitchClass: null, confidence: "low" };

  const detected = [];
  for (let i = 0; i < SUB_FRAMES_PER_MEASURE; i++) {
    const start = i * subFrameLength;
    const subFrame = bassMeasurePcm.subarray(start, start + subFrameLength);
    const freq = detectPitchAutocorrelation(subFrame, sampleRate, BASS_MIN_FREQ, BASS_MAX_FREQ);
    if (freq !== null) detected.push(frequencyToPitchClass(freq));
  }
  if (detected.length === 0) return { pitchClass: null, confidence: "low" };

  const counts = new Map();
  for (const pc of detected) counts.set(pc, (counts.get(pc) ?? 0) + 1);
  let modePitchClass = detected[0];
  let modeCount = 0;
  for (const [pc, count] of counts) {
    if (count > modeCount) {
      modeCount = count;
      modePitchClass = pc;
    }
  }

  // High confidence needs both signal in at least half the sub-frames and
  // the mode actually being a majority among those that had signal.
  const confidence =
    detected.length >= SUB_FRAMES_PER_MEASURE / 2 && modeCount / detected.length > 0.5 ? "high" : "low";
  return { pitchClass: modePitchClass, confidence };
}

function chromaEnergyForPitchClass(frame, sampleRate, pitchClass) {
  let total = 0;
  for (const octave of HARMONIC_ANALYSIS_OCTAVES) {
    const freq = pitchClassToFrequency(pitchClass, octave);
    if (freq < sampleRate / 2) total += goertzelMagnitude(frame, sampleRate, freq);
  }
  return total;
}

// Major vs. minor via Goertzel chroma energy at the third above the given
// root: "" (major, root+4 semitones) vs "m" (root+3). A root's own
// harmonics bleed into both bins similarly (a fifth's overtone lands near
// one, a higher overtone near the other), which is why this compares the
// two bins against each other rather than trusting either in isolation.
export function detectMeasureQuality(harmonicMeasurePcm, sampleRate, rootPitchClass) {
  const majorThirdPitchClass = (rootPitchClass + 4) % 12;
  const minorThirdPitchClass = (rootPitchClass + 3) % 12;

  const majorEnergy = chromaEnergyForPitchClass(harmonicMeasurePcm, sampleRate, majorThirdPitchClass);
  const minorEnergy = chromaEnergyForPitchClass(harmonicMeasurePcm, sampleRate, minorThirdPitchClass);

  const total = majorEnergy + minorEnergy;
  if (total === 0) return { quality: "", confidence: "low", marginPercent: 0 };

  const marginPercent = (Math.abs(majorEnergy - minorEnergy) / total) * 100;
  return {
    quality: majorEnergy >= minorEnergy ? "" : "m",
    confidence: marginPercent >= QUALITY_MARGIN_THRESHOLD_PERCENT ? "high" : "low",
    marginPercent,
  };
}

export function formatChordSymbol(pitchClass, quality) {
  return `${PITCH_CLASS_NAMES[pitchClass]}${quality}`;
}

// Corrects an isolated single-bar deviation sandwiched between two bars
// that agree with each other — a common artifact of a brief bass fill or
// passing tone at a phrase boundary reading as its own (wrong) chord for
// exactly one bar. Only fires when both immediate neighbors already agree
// with each other; a genuinely sustained change (2+ bars) is left alone,
// and a bar with no neighbor on either side (start/end of the track) is
// never touched. `entries` is one array slot per bar: `{ bar, chord }` or
// `null` for a bar with no detected signal.
export function despikeChordSequence(entries) {
  return entries.map((entry, i) => {
    if (!entry) return entry;
    const prev = entries[i - 1];
    const next = entries[i + 1];
    if (prev && next && prev.chord === next.chord && entry.chord !== prev.chord) {
      return { ...entry, chord: prev.chord };
    }
    return entry;
  });
}
