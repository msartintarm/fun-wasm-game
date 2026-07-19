import { describe, expect, it } from "vitest";
import { RelativeTurn, resolveRelativeTurn, rotateLeft, rotateRight } from "./relativeTurn";

// 0=Up, 1=Down, 2=Left, 3=Right (matches GameCanvas.tsx's KEY_TO_DIR).
const UP = 0;
const DOWN = 1;
const LEFT = 2;
const RIGHT = 3;

describe("rotateLeft", () => {
  it("cycles counterclockwise: Up -> Left -> Down -> Right -> Up", () => {
    expect(rotateLeft(UP)).toBe(LEFT);
    expect(rotateLeft(LEFT)).toBe(DOWN);
    expect(rotateLeft(DOWN)).toBe(RIGHT);
    expect(rotateLeft(RIGHT)).toBe(UP);
  });
});

describe("rotateRight", () => {
  it("cycles clockwise: Up -> Right -> Down -> Left -> Up", () => {
    expect(rotateRight(UP)).toBe(RIGHT);
    expect(rotateRight(RIGHT)).toBe(DOWN);
    expect(rotateRight(DOWN)).toBe(LEFT);
    expect(rotateRight(LEFT)).toBe(UP);
  });

  it("is the exact inverse of rotateLeft for every direction", () => {
    for (const dir of [UP, DOWN, LEFT, RIGHT]) {
      expect(rotateRight(rotateLeft(dir))).toBe(dir);
      expect(rotateLeft(rotateRight(dir))).toBe(dir);
    }
  });
});

describe("resolveRelativeTurn", () => {
  it("Left/Right resolve to a single 90-degree turn", () => {
    expect(resolveRelativeTurn(RelativeTurn.Left, UP)).toEqual([LEFT]);
    expect(resolveRelativeTurn(RelativeTurn.Right, UP)).toEqual([RIGHT]);
  });

  it("UTurnLeft resolves to two left turns, net 180 degrees", () => {
    expect(resolveRelativeTurn(RelativeTurn.UTurnLeft, UP)).toEqual([LEFT, DOWN]);
  });

  it("UTurnRight resolves to two right turns, net 180 degrees", () => {
    expect(resolveRelativeTurn(RelativeTurn.UTurnRight, UP)).toEqual([RIGHT, DOWN]);
  });

  it("both U-turn variants end up facing the same net-reversed direction, only the intermediate step differs", () => {
    const left = resolveRelativeTurn(RelativeTurn.UTurnLeft, RIGHT);
    const right = resolveRelativeTurn(RelativeTurn.UTurnRight, RIGHT);
    expect(left[1]).toBe(LEFT);
    expect(right[1]).toBe(LEFT);
    expect(left[0]).not.toBe(right[0]);
  });
});
