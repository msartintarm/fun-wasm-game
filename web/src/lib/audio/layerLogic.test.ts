import { describe, expect, it } from "vitest";
import { MusicState } from "./data/tracks";
import { layerShouldBeAudible } from "./layerLogic";

describe("layerShouldBeAudible", () => {
  it("is audible when the current state is in the layer's list", () => {
    expect(layerShouldBeAudible([MusicState.Boosted], MusicState.Boosted)).toBe(true);
  });

  it("is not audible when the current state is missing from the layer's list", () => {
    expect(layerShouldBeAudible([MusicState.Boosted], MusicState.Idle)).toBe(false);
    expect(layerShouldBeAudible([MusicState.Boosted], MusicState.Dead)).toBe(false);
  });

  it("supports a layer audible across multiple states, e.g. bass in Boosted and Dead", () => {
    const bassAudibleIn = [MusicState.Boosted, MusicState.Dead];
    expect(layerShouldBeAudible(bassAudibleIn, MusicState.Idle)).toBe(false);
    expect(layerShouldBeAudible(bassAudibleIn, MusicState.Boosted)).toBe(true);
    expect(layerShouldBeAudible(bassAudibleIn, MusicState.Dead)).toBe(true);
  });

  it("an empty list is never audible", () => {
    expect(layerShouldBeAudible([], MusicState.Idle)).toBe(false);
  });
});
