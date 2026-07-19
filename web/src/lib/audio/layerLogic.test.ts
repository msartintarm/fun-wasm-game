import { describe, expect, it } from "vitest";
import { MusicState } from "./data/tracks";
import { layerShouldBeAudible, layerTargetGain } from "./layerLogic";

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

describe("layerTargetGain", () => {
  it("is 0 when the layer is inaudible in the current state, regardless of relativeVolume", () => {
    expect(layerTargetGain([MusicState.Boosted], 0.95, MusicState.Idle)).toBe(0);
  });

  it("defaults to unity (1) when audible and relativeVolume is unset", () => {
    expect(layerTargetGain([MusicState.Boosted], undefined, MusicState.Boosted)).toBe(1);
  });

  it("uses the layer's own relativeVolume when audible, e.g. a stem mixed 5% quieter", () => {
    expect(layerTargetGain([MusicState.Boosted], 0.95, MusicState.Boosted)).toBe(0.95);
  });
});
