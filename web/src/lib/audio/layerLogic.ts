import { MusicState } from "./data/tracks";

// Pure — deliberately kept in its own module, separate from
// audioFileEngine.ts (which imports `tone`), so it's testable without
// pulling in any Tone.js/AudioContext dependency.
export function layerShouldBeAudible(audibleIn: MusicState[], state: MusicState): boolean {
  return audibleIn.includes(state);
}

// Linear gain (0-1) a layer should play at right now: 0 when inaudible in
// the current state, otherwise its own relativeVolume (default 1 = unity).
// Also pure/Tone-free — audioFileEngine.ts converts the result to dB via
// Tone.gainToDb() when actually driving playback.
export function layerTargetGain(
  audibleIn: MusicState[],
  relativeVolume: number | undefined,
  state: MusicState,
): number {
  return layerShouldBeAudible(audibleIn, state) ? (relativeVolume ?? 1) : 0;
}
