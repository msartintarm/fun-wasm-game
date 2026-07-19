#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Direction {
    Up,
    Down,
    Left,
    Right,
}

impl Direction {
    pub(crate) fn from_u8(v: u8) -> Option<Direction> {
        match v {
            0 => Some(Direction::Up),
            1 => Some(Direction::Down),
            2 => Some(Direction::Left),
            3 => Some(Direction::Right),
            _ => None,
        }
    }

    /// Inverse of `from_u8` — for exposing a snake's heading in GameState.
    pub(crate) fn to_u8(self) -> u8 {
        match self {
            Direction::Up => 0,
            Direction::Down => 1,
            Direction::Left => 2,
            Direction::Right => 3,
        }
    }

    pub(crate) fn opposite(self) -> Direction {
        match self {
            Direction::Up => Direction::Down,
            Direction::Down => Direction::Up,
            Direction::Left => Direction::Right,
            Direction::Right => Direction::Left,
        }
    }

    pub(crate) fn delta(self) -> (i32, i32) {
        match self {
            Direction::Up => (0, -1),
            Direction::Down => (0, 1),
            Direction::Left => (-1, 0),
            Direction::Right => (1, 0),
        }
    }

    pub(crate) fn all() -> [Direction; 4] {
        [Direction::Up, Direction::Down, Direction::Left, Direction::Right]
    }
}
