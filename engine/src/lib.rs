use serde::Serialize;
use wasm_bindgen::prelude::*;

const PROXIMITY_RADIUS: i32 = 3;
const FOOD_SCORE: u32 = 10;
const BOOSTED_FOOD_SCORE: u32 = 25;
const PROXIMITY_TICK_BONUS: u32 = 1;
const STARTING_LENGTH: usize = 4;
/// The player advances once every this-many ticks at baseline speed; AI
/// snakes advance every tick. Being within PROXIMITY_RADIUS of another
/// snake lets the player advance every tick too (i.e. "faster").
const PLAYER_SLOW_FACTOR: u32 = 3;
const MIN_FOOD: usize = 18;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Direction {
    Up,
    Down,
    Left,
    Right,
}

impl Direction {
    fn from_u8(v: u8) -> Option<Direction> {
        match v {
            0 => Some(Direction::Up),
            1 => Some(Direction::Down),
            2 => Some(Direction::Left),
            3 => Some(Direction::Right),
            _ => None,
        }
    }

    fn opposite(self) -> Direction {
        match self {
            Direction::Up => Direction::Down,
            Direction::Down => Direction::Up,
            Direction::Left => Direction::Right,
            Direction::Right => Direction::Left,
        }
    }

    fn delta(self) -> (i32, i32) {
        match self {
            Direction::Up => (0, -1),
            Direction::Down => (0, 1),
            Direction::Left => (-1, 0),
            Direction::Right => (1, 0),
        }
    }

    fn all() -> [Direction; 4] {
        [Direction::Up, Direction::Down, Direction::Left, Direction::Right]
    }
}

#[derive(Clone, Serialize)]
struct SnakeState {
    body: Vec<(i32, i32)>,
    alive: bool,
    is_player: bool,
    boosted: bool,
}

struct Snake {
    body: Vec<(i32, i32)>,
    direction: Direction,
    alive: bool,
    is_player: bool,
    pending_growth: u32,
}

#[derive(Serialize)]
pub struct GameState {
    width: i32,
    height: i32,
    snakes: Vec<SnakeState>,
    food: Vec<(i32, i32)>,
    score: u32,
    game_over: bool,
}

#[wasm_bindgen]
pub struct Game {
    width: i32,
    height: i32,
    snakes: Vec<Snake>,
    food: Vec<(i32, i32)>,
    score: u32,
    game_over: bool,
    rng_state: u64,
    player_tick_counter: u32,
}

impl Game {
    fn spawn_snake(width: i32, height: i32, index: usize, is_player: bool) -> Snake {
        let lane = (index as i32 + 1) * height / 6;
        let start_y = lane.clamp(1, height - 2);
        let start_x = width / 2;
        let mut body = Vec::with_capacity(STARTING_LENGTH);
        for i in 0..STARTING_LENGTH as i32 {
            body.push((start_x - i, start_y));
        }
        Snake {
            body,
            direction: Direction::Right,
            alive: true,
            is_player,
            pending_growth: 0,
        }
    }

    fn next_u32(&mut self) -> u32 {
        // xorshift64* — deterministic, seeded from JS Math.random() at construction.
        let mut x = self.rng_state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.rng_state = x;
        (x >> 32) as u32
    }

    fn random_range(&mut self, bound: i32) -> i32 {
        (self.next_u32() % bound as u32) as i32
    }

    fn occupied(&self, pos: (i32, i32)) -> bool {
        self.snakes
            .iter()
            .filter(|s| s.alive)
            .any(|s| s.body.contains(&pos))
            || self.food.contains(&pos)
    }

    fn spawn_food(&mut self) {
        loop {
            let pos = (self.random_range(self.width), self.random_range(self.height));
            if !self.occupied(pos) {
                self.food.push(pos);
                return;
            }
        }
    }

    fn in_bounds(&self, pos: (i32, i32)) -> bool {
        pos.0 >= 0 && pos.0 < self.width && pos.1 >= 0 && pos.1 < self.height
    }

    fn is_safe(&self, pos: (i32, i32), moving_index: usize) -> bool {
        if !self.in_bounds(pos) {
            return false;
        }
        for (i, snake) in self.snakes.iter().enumerate() {
            if !snake.alive {
                continue;
            }
            let body = &snake.body;
            // Skip the tail cell for the snake that's about to move, since it
            // vacates that cell this tick unless it just ate.
            let skip_tail = i == moving_index && snake.pending_growth == 0;
            let len = body.len();
            for (j, seg) in body.iter().enumerate() {
                if skip_tail && j == len - 1 {
                    continue;
                }
                if *seg == pos {
                    return false;
                }
            }
        }
        true
    }

    fn nearest_food(&self, from: (i32, i32)) -> Option<(i32, i32)> {
        self.food
            .iter()
            .copied()
            .min_by_key(|f| (f.0 - from.0).abs() + (f.1 - from.1).abs())
    }

    fn choose_ai_direction(&mut self, index: usize) -> Direction {
        let snake = &self.snakes[index];
        let head = snake.body[0];
        let current = snake.direction;
        let target = self.nearest_food(head);

        let mut candidates: Vec<Direction> = Direction::all()
            .into_iter()
            .filter(|d| *d != current.opposite())
            .collect();

        if let Some(target) = target {
            candidates.sort_by_key(|d| {
                let (dx, dy) = d.delta();
                let next = (head.0 + dx, head.1 + dy);
                (next.0 - target.0).abs() + (next.1 - target.1).abs()
            });
        }

        for d in &candidates {
            let (dx, dy) = d.delta();
            let next = (head.0 + dx, head.1 + dy);
            if self.is_safe(next, index) {
                return *d;
            }
        }

        // Nothing safe — keep current heading and let collision resolution kill it.
        current
    }

    fn min_distance_to_others(&self, index: usize) -> i32 {
        let head = self.snakes[index].body[0];
        let mut best = i32::MAX;
        for (i, snake) in self.snakes.iter().enumerate() {
            if i == index || !snake.alive {
                continue;
            }
            for seg in &snake.body {
                let d = (seg.0 - head.0).abs() + (seg.1 - head.1).abs();
                if d < best {
                    best = d;
                }
            }
        }
        best
    }

    fn player_index(&self) -> Option<usize> {
        self.snakes.iter().position(|s| s.is_player)
    }

    /// Core constructor, independent of any JS/wasm host so it can be
    /// exercised directly from native `cargo test`.
    fn with_seed(width: i32, height: i32, num_ai: u32, seed: u64) -> Game {
        let mut game = Game {
            width,
            height,
            snakes: Vec::new(),
            food: Vec::new(),
            score: 0,
            game_over: false,
            rng_state: seed | 1,
            player_tick_counter: 0,
        };

        game.snakes.push(Game::spawn_snake(width, height, 0, true));
        for i in 0..num_ai as usize {
            game.snakes.push(Game::spawn_snake(width, height, i + 1, false));
        }

        for _ in 0..MIN_FOOD {
            game.spawn_food();
        }

        game
    }
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32, num_ai: u32) -> Game {
        let seed = ((js_sys::Math::random() * (u64::MAX as f64)) as u64) | 1;
        Game::with_seed(width as i32, height as i32, num_ai, seed)
    }

    pub fn set_player_direction(&mut self, dir: u8) {
        if let Some(d) = Direction::from_u8(dir) {
            if let Some(player) = self.snakes.iter_mut().find(|s| s.is_player) {
                if d != player.direction.opposite() {
                    player.direction = d;
                }
            }
        }
    }

    /// Advances the simulation by one tick. AI snakes move every tick; the
    /// player only moves every PLAYER_SLOW_FACTOR ticks at baseline, unless
    /// within PROXIMITY_RADIUS of another snake, in which case it moves
    /// every tick (i.e. "faster") and earns bonus score.
    pub fn tick(&mut self) {
        if self.game_over {
            return;
        }

        let player_index = self.player_index();
        let boosted = player_index
            .map(|i| self.snakes[i].alive && self.min_distance_to_others(i) <= PROXIMITY_RADIUS)
            .unwrap_or(false);

        for i in 0..self.snakes.len() {
            if !self.snakes[i].is_player && self.snakes[i].alive {
                let d = self.choose_ai_direction(i);
                self.snakes[i].direction = d;
            }
        }

        for i in 0..self.snakes.len() {
            if !self.snakes[i].is_player {
                self.step_one(i);
            }
        }

        if let Some(player_index) = player_index {
            self.player_tick_counter += 1;
            let should_step = boosted || self.player_tick_counter >= PLAYER_SLOW_FACTOR;
            if should_step && self.snakes[player_index].alive {
                self.player_tick_counter = 0;
                if boosted {
                    self.score += PROXIMITY_TICK_BONUS;
                }
                self.step_one(player_index);
            }
        }

        if self
            .player_index()
            .map(|i| !self.snakes[i].alive)
            .unwrap_or(true)
        {
            self.game_over = true;
        }

        while self.food.len() < MIN_FOOD {
            self.spawn_food();
        }
    }

    pub fn state(&self) -> JsValue {
        let player_index = self.player_index();
        let snakes = self
            .snakes
            .iter()
            .map(|s| SnakeState {
                body: s.body.clone(),
                alive: s.alive,
                is_player: s.is_player,
                boosted: s.is_player
                    && s.alive
                    && player_index
                        .map(|i| self.min_distance_to_others(i) <= PROXIMITY_RADIUS)
                        .unwrap_or(false),
            })
            .collect();

        let state = GameState {
            width: self.width,
            height: self.height,
            snakes,
            food: self.food.clone(),
            score: self.score,
            game_over: self.game_over,
        };
        serde_wasm_bindgen::to_value(&state).unwrap_or(JsValue::NULL)
    }

    pub fn score(&self) -> u32 {
        self.score
    }

    pub fn is_game_over(&self) -> bool {
        self.game_over
    }
}

impl Game {
    fn step_one(&mut self, index: usize) {
        if !self.snakes[index].alive {
            return;
        }

        let head = self.snakes[index].body[0];
        let (dx, dy) = self.snakes[index].direction.delta();
        let next = (head.0 + dx, head.1 + dy);

        if !self.is_safe(next, index) {
            self.snakes[index].alive = false;
            return;
        }

        let ate = self.food.iter().position(|f| *f == next);
        if let Some(pos) = ate {
            self.food.remove(pos);
            let boosted = self.snakes[index].is_player
                && self.min_distance_to_others(index) <= PROXIMITY_RADIUS;
            if self.snakes[index].is_player {
                self.score += if boosted { BOOSTED_FOOD_SCORE } else { FOOD_SCORE };
            }
            self.snakes[index].pending_growth += 1;
        }

        self.snakes[index].body.insert(0, next);
        if self.snakes[index].pending_growth > 0 {
            self.snakes[index].pending_growth -= 1;
        } else {
            self.snakes[index].body.pop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spawns_player_and_ai_with_correct_starting_length() {
        let game = Game::with_seed(40, 30, 3, 1);
        assert_eq!(game.snakes.len(), 4);
        assert_eq!(game.snakes.iter().filter(|s| s.is_player).count(), 1);
        for snake in &game.snakes {
            assert_eq!(snake.body.len(), STARTING_LENGTH);
            assert!(snake.alive);
        }
    }

    #[test]
    fn ignores_direct_reversal_but_accepts_turns() {
        let mut game = Game::with_seed(40, 30, 0, 1);
        let player = game.player_index().unwrap();
        assert_eq!(game.snakes[player].direction, Direction::Right);

        game.set_player_direction(2); // Left — opposite of Right, must be ignored
        assert_eq!(game.snakes[player].direction, Direction::Right);

        game.set_player_direction(0); // Up — a valid turn
        assert_eq!(game.snakes[player].direction, Direction::Up);
    }

    #[test]
    fn player_moves_once_every_player_slow_factor_ticks_at_baseline() {
        // num_ai = 0 keeps the player's min distance to others at i32::MAX,
        // so it never counts as boosted here.
        let mut game = Game::with_seed(50, 50, 0, 1);
        let player = game.player_index().unwrap();
        let start_head = game.snakes[player].body[0];

        for _ in 0..(PLAYER_SLOW_FACTOR - 1) {
            game.tick();
            assert_eq!(
                game.snakes[player].body[0], start_head,
                "player should not move before PLAYER_SLOW_FACTOR ticks elapse"
            );
        }

        game.tick();
        let (dx, dy) = Direction::Right.delta();
        assert_eq!(
            game.snakes[player].body[0],
            (start_head.0 + dx, start_head.1 + dy)
        );
    }

    #[test]
    fn boosted_player_moves_every_tick() {
        let mut game = Game::with_seed(50, 50, 1, 1);
        let player = game.player_index().unwrap();
        let ai = 1 - player; // the only other snake, index 0 or 1

        // Place the AI snake's head right next to the player's, well within
        // PROXIMITY_RADIUS, without touching (which would kill on step).
        let player_head = game.snakes[player].body[0];
        game.snakes[ai].body = vec![(player_head.0, player_head.1 + PROXIMITY_RADIUS)];
        // Freeze the AI in place so it doesn't wander out of range chasing food.
        game.food.clear();

        let start_head = game.snakes[player].body[0];
        game.tick();
        let (dx, dy) = Direction::Right.delta();
        assert_eq!(
            game.snakes[player].body[0],
            (start_head.0 + dx, start_head.1 + dy),
            "boosted player should move on the very next tick"
        );
        assert!(game.score >= PROXIMITY_TICK_BONUS);
    }

    #[test]
    fn dies_on_wall_collision_and_freezes_state() {
        let mut game = Game::with_seed(6, 6, 0, 1);
        let player = game.player_index().unwrap();
        // Player starts at x = width/2 = 3 moving right; drive it into the
        // east wall (x == 5) well within a generous tick budget.
        for _ in 0..200 {
            if game.game_over {
                break;
            }
            game.tick();
        }
        assert!(game.game_over);
        assert!(!game.snakes[player].alive);

        let score_before = game.score;
        let body_before = game.snakes[player].body.clone();
        game.tick();
        assert_eq!(game.score, score_before);
        assert_eq!(game.snakes[player].body, body_before);
    }

    #[test]
    fn eating_food_grows_snake_and_scores() {
        let mut game = Game::with_seed(50, 50, 0, 1);
        let player = game.player_index().unwrap();
        let head = game.snakes[player].body[0];
        let (dx, dy) = Direction::Right.delta();
        let next = (head.0 + dx, head.1 + dy);

        game.food = vec![next];
        let len_before = game.snakes[player].body.len();

        for _ in 0..PLAYER_SLOW_FACTOR {
            game.tick();
        }

        assert_eq!(game.score, FOOD_SCORE);
        assert_eq!(game.snakes[player].body.len(), len_before + 1);
        assert!(!game.food.contains(&next));
    }
}
