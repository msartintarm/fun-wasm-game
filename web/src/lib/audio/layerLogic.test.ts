import { describe, expect, it } from "vitest";
import { LayerCondition } from "./data/tracks";
import { layerShouldBeAudible } from "./layerLogic";

describe("layerShouldBeAudible", () => {
  it("Boosted condition is audible only while the player is boosted", () => {
    expect(layerShouldBeAudible(LayerCondition.Boosted, true)).toBe(true);
    expect(layerShouldBeAudible(LayerCondition.Boosted, false)).toBe(false);
  });
});
