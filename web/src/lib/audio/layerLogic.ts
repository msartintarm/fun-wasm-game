import { assertNever } from "./audioEngine";
import { LayerCondition } from "./data/tracks";

// Pure — deliberately kept in its own module, separate from
// audioFileEngine.ts (which imports `tone`), so it's testable without
// pulling in any Tone.js/AudioContext dependency.
export function layerShouldBeAudible(condition: LayerCondition, boosted: boolean): boolean {
  switch (condition) {
    case LayerCondition.Boosted:
      return boosted;
    default:
      return assertNever(condition);
  }
}
