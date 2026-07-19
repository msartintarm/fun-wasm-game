// Pure — extracted from process-audio-assets.mjs so the drift math and
// error-message formatting are independently unit-testable without
// shelling out to ffprobe/ffmpeg.

export function layerDurationDrift(baseDurationSeconds, layerDurationSeconds) {
  return Math.abs(layerDurationSeconds - baseDurationSeconds);
}

// Throws when a layer's duration doesn't match the base track's within
// `maxDriftSeconds` — a mismatch that small couldn't happen from an honest
// same-session DAW render at a fixed sample rate, so this is a real error
// (wrong file pointed at), not natural rendering variance to tolerate.
export function assertLayerDurationMatches(baseDurationSeconds, layerDurationSeconds, maxDriftSeconds, context) {
  const drift = layerDurationDrift(baseDurationSeconds, layerDurationSeconds);
  if (drift > maxDriftSeconds) {
    throw new Error(
      `${context}: duration ${layerDurationSeconds.toFixed(3)}s doesn't match the base track's ${baseDurationSeconds.toFixed(3)}s (drift ${drift.toFixed(3)}s, max allowed ${maxDriftSeconds}s) — this layer would audibly drift out of sync over the loop. Re-render it to match the base track's exact length.`,
    );
  }
}
