import { describe, expect, it } from "vitest";
import { assertLayerDurationMatches, layerDurationDrift } from "./durationCheck.mjs";

describe("layerDurationDrift", () => {
  it("computes the absolute difference regardless of which is larger", () => {
    expect(layerDurationDrift(100, 100.02)).toBeCloseTo(0.02, 5);
    expect(layerDurationDrift(100.02, 100)).toBeCloseTo(0.02, 5);
  });

  it("is zero for identical durations", () => {
    expect(layerDurationDrift(347.796625, 347.796625)).toBe(0);
  });
});

describe("assertLayerDurationMatches", () => {
  it("does not throw when drift is within tolerance", () => {
    expect(() => assertLayerDurationMatches(347.796625, 347.797, 0.05, "test layer")).not.toThrow();
  });

  it("does not throw exactly at the tolerance boundary", () => {
    expect(() => assertLayerDurationMatches(100, 100.05, 0.05, "test layer")).not.toThrow();
  });

  it("throws when drift exceeds tolerance", () => {
    expect(() => assertLayerDurationMatches(347.8, 300, 0.05, "test layer")).toThrow(/test layer/);
  });

  it("throws with a message naming both durations", () => {
    let message = "";
    try {
      assertLayerDurationMatches(100, 100.2, 0.05, "sailing-to-hell layer guitar");
    } catch (err) {
      message = err.message;
    }
    expect(message).toContain("100.000s");
    expect(message).toContain("100.200s");
  });
});
