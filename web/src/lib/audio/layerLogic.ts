import { MusicState } from "./data/tracks";

// Pure — deliberately kept in its own module, separate from
// audioFileEngine.ts (which imports `tone`), so it's testable without
// pulling in any Tone.js/AudioContext dependency.
export function layerShouldBeAudible(audibleIn: MusicState[], state: MusicState): boolean {
  return audibleIn.includes(state);
}
