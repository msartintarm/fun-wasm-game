import { describe, expect, it } from "vitest";
import { assertNever, pickTrackForPreset } from "./audioEngine";

describe("pickTrackForPreset", () => {
  const registry = {
    "Chaos Arena": ["a", "b", "c"],
    Empty: [],
  };

  it("returns undefined for a preset with no entry in the registry", () => {
    expect(pickTrackForPreset(registry, "Nonexistent")).toBeUndefined();
  });

  it("returns undefined for a preset with an empty candidate list", () => {
    expect(pickTrackForPreset(registry, "Empty")).toBeUndefined();
  });

  it("picks deterministically via an injectable rng", () => {
    expect(pickTrackForPreset(registry, "Chaos Arena", () => 0)).toBe("a");
    expect(pickTrackForPreset(registry, "Chaos Arena", () => 0.4)).toBe("b");
    expect(pickTrackForPreset(registry, "Chaos Arena", () => 0.99)).toBe("c");
  });
});

describe("assertNever", () => {
  it("throws for any value at runtime (the compile-time guarantee doesn't exist once erased to JS)", () => {
    // @ts-expect-error intentionally passing a non-never value to exercise the runtime guard
    expect(() => assertNever("unexpected")).toThrow(/Unhandled audio command/);
  });
});
