// Pure DSP over Float32Array PCM — no fs/ffmpeg here, so this is testable
// with hand-built sine waves (see pitchDetect.test.mjs).

const SILENCE_RMS_FLOOR = 0.01;
const AUTOCORR_PEAK_THRESHOLD = 0.6;

export function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

function normalizedAutocorrelationAt(frame, lag) {
  const n = frame.length - lag;
  if (n <= 0) return 0;
  let cross = 0;
  let energyA = 0;
  let energyB = 0;
  for (let i = 0; i < n; i++) {
    const a = frame[i];
    const b = frame[i + lag];
    cross += a * b;
    energyA += a * a;
    energyB += b * b;
  }
  const denom = Math.sqrt(energyA * energyB);
  return denom > 0 ? cross / denom : 0;
}

// Parabolic interpolation around a correlation peak (values array, indexed
// the same way as the `lag` loop below) for sub-sample lag precision.
function refineLagParabolic(correlations, i, minLag) {
  if (i <= 0 || i >= correlations.length - 1) return minLag + i;
  const yMinus = correlations[i - 1];
  const yCenter = correlations[i];
  const yPlus = correlations[i + 1];
  const denom = yMinus - 2 * yCenter + yPlus;
  const offset = denom === 0 ? 0 : (0.5 * (yMinus - yPlus)) / denom;
  return minLag + i + offset;
}

// Fundamental frequency via normalized autocorrelation, restricted to
// [minFreq, maxFreq]. Returns the *first* genuine local peak clearing
// AUTOCORR_PEAK_THRESHOLD scanning from the smallest lag (highest
// frequency) upward — not the global maximum. A periodic (or near-pure)
// tone correlates just as strongly at 2x/3x its true period as at the true
// period itself, so a global-max search readily locks onto a subharmonic;
// taking the first (shortest-period) qualifying peak avoids that.
export function detectPitchAutocorrelation(frame, sampleRate, minFreq, maxFreq) {
  if (rms(frame) < SILENCE_RMS_FLOOR) return null;

  const minLag = Math.max(1, Math.floor(sampleRate / maxFreq));
  const maxLag = Math.min(frame.length - 1, Math.ceil(sampleRate / minFreq));
  if (maxLag <= minLag) return null;

  const correlations = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    correlations.push(normalizedAutocorrelationAt(frame, lag));
  }

  for (let i = 1; i < correlations.length - 1; i++) {
    const curr = correlations[i];
    if (curr >= AUTOCORR_PEAK_THRESHOLD && curr >= correlations[i - 1] && curr >= correlations[i + 1]) {
      return sampleRate / refineLagParabolic(correlations, i, minLag);
    }
  }
  return null;
}

export function frequencyToPitchClass(freq) {
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return ((midi % 12) + 12) % 12;
}

// Single-bin Goertzel magnitude — avoids a full FFT since chord-quality
// detection only ever needs energy at ~12 specific pitch classes across a
// couple octaves, not the whole spectrum.
export function goertzelMagnitude(frame, sampleRate, targetFreq) {
  const n = frame.length;
  const k = Math.round((n * targetFreq) / sampleRate);
  const omega = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = frame[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * Math.cos(omega);
  const imag = s2 * Math.sin(omega);
  return Math.sqrt(real * real + imag * imag);
}
