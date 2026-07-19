use std::collections::{HashMap, VecDeque};

use crate::config::{Config, FoodTargeting};
use crate::direction::Direction;
use crate::game::Game;
use crate::snake::{AiBehavior, Snake};

/// Test-only helpers, at crate scope so any `#[cfg(test)] mod` can use them.
impl Game {
    /// Renders the world (or the given window of it) as ASCII, matching
    /// `game_from_grid`'s notation — for printing exactly what a test
    /// (or a long diagnostic run) saw right before a snake died.
    #[allow(dead_code)]
    pub(crate) fn render_ascii(&self, min: (i32, i32), max: (i32, i32)) -> String {
        let mut out = String::new();
        for y in min.1..=max.1 {
            for x in min.0..=max.0 {
                let pos = (x, y);
                let mut ch = '.';
                if self.food.contains(&pos) {
                    ch = '*';
                }
                // Dead snakes' bodies stay frozen at their death position —
                // render them too (not just living ones) since this is
                // often used to see exactly what a snake collided with.
                for (i, s) in self.snakes.iter().enumerate() {
                    if let Some(idx) = s.body.iter().position(|&p| p == pos) {
                        let letter = (b'A' + i as u8) as char;
                        ch = if idx == 0 { letter } else { letter.to_ascii_lowercase() };
                    }
                }
                out.push(ch);
            }
            out.push('\n');
        }
        out
    }
}

/// Builds a `Game` from an ASCII picture instead of hand-computed
/// coordinates — much easier to read and get right for a specific
/// scenario. `.` empty, `*` food, uppercase = a snake's head, matching
/// lowercase = that snake's body (connected 4-directionally from the
/// head; direction is inferred from the head/neck adjacency). `A` is
/// always the player; `B`, `C`, ... are AI in the order their heads
/// appear. Snakes not mentioned in the grid still exist (per
/// `config.num_ai`) but stay at their normal spawn position — give
/// every snake you care about a head letter.
pub(crate) fn game_from_grid(rows: &[&str], config: Config) -> Game {
    let mut game = Game::with_seed(config, 1);
    game.food.clear();

    let mut cells: HashMap<(i32, i32), char> = HashMap::new();
    for (y, row) in rows.iter().enumerate() {
        for (x, ch) in row.chars().enumerate() {
            if ch == '.' {
                continue;
            }
            let pos = (x as i32, y as i32);
            if ch == '*' {
                game.food.push(pos);
            } else {
                cells.insert(pos, ch);
            }
        }
    }

    let mut head_letters: Vec<char> =
        cells.values().copied().filter(|c| c.is_ascii_uppercase()).collect();
    head_letters.sort_unstable();
    head_letters.dedup();

    for head_letter in head_letters {
        let head_pos = *cells.iter().find(|&(_, &c)| c == head_letter).unwrap().0;
        let body_letter = head_letter.to_ascii_lowercase();

        let mut body = vec![head_pos];
        let mut current = head_pos;
        loop {
            let next = [(0, -1), (0, 1), (-1, 0), (1, 0)]
                .iter()
                .map(|&(dx, dy)| (current.0 + dx, current.1 + dy))
                .find(|p| !body.contains(p) && cells.get(p) == Some(&body_letter));
            match next {
                Some(p) => {
                    body.push(p);
                    current = p;
                }
                None => break,
            }
        }

        let direction = if body.len() >= 2 {
            let (hx, hy) = body[0];
            let (nx, ny) = body[1];
            Direction::all()
                .into_iter()
                .find(|d| d.delta() == (hx - nx, hy - ny))
                .unwrap_or(Direction::Right)
        } else {
            Direction::Right
        };

        let index = if head_letter == 'A' {
            0
        } else {
            (head_letter as u8 - b'B' + 1) as usize
        };
        game.snakes[index] = Snake {
            body,
            direction,
            pending_directions: VecDeque::new(),
            alive: true,
            is_player: head_letter == 'A',
            pending_growth: 0,
            move_progress: 0.0,
            food_boost_remaining: 0,
            death_cause: None,
            score: 0,
            food_targeting: FoodTargeting::Nearest,
            ai_behavior: AiBehavior::Default,
        };
    }

    game
}
