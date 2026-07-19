// 0=Up, 1=Down, 2=Left, 3=Right — matches KEY_TO_DIR/set_player_direction.
export enum RelativeTurn {
  Left = "left",
  Right = "right",
  UTurnLeft = "uturn-left",
  UTurnRight = "uturn-right",
}

// Literal tables, not modular arithmetic — Up/Down/Left/Right's 0-3 order
// isn't itself a rotational sequence.
const ROTATE_LEFT: Record<number, number> = { 0: 2, 2: 1, 1: 3, 3: 0 };
const ROTATE_RIGHT: Record<number, number> = { 0: 3, 3: 1, 1: 2, 2: 0 };

export function rotateLeft(dir: number): number {
  return ROTATE_LEFT[dir];
}

export function rotateRight(dir: number): number {
  return ROTATE_RIGHT[dir];
}

// A direct 180 would run the snake into its own neck, so a U-turn is two
// 90-degree turns, not one.
export function resolveRelativeTurn(turn: RelativeTurn, currentDirection: number): number[] {
  switch (turn) {
    case RelativeTurn.Left:
      return [rotateLeft(currentDirection)];
    case RelativeTurn.Right:
      return [rotateRight(currentDirection)];
    case RelativeTurn.UTurnLeft: {
      const first = rotateLeft(currentDirection);
      return [first, rotateLeft(first)];
    }
    case RelativeTurn.UTurnRight: {
      const first = rotateRight(currentDirection);
      return [first, rotateRight(first)];
    }
  }
}
