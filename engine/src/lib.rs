use std::collections::{HashSet, VecDeque};

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

const STARTING_LENGTH: usize = 4;
const PROXIMITY_TICK_BONUS: u32 = 1;

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub width: i32,
    pub height: i32,
    pub num_ai: u32,
    /// AI snakes always move at speed 1.0 (once per tick) as the reference
    /// rate. The player's baseline speed is a fraction of that — "slightly
    /// slower" by default.
    pub player_speed: f64,
    /// Multiplier applied to a snake's own current speed while boosted
    /// (near another snake, or recently ate food). The player's boosted
    /// speed is always hard-capped at the AI baseline (1.0) regardless of
    /// this value, so the player is never faster than the AI.
    pub boost_multiplier: f64,
    pub proximity_radius: i32,
    /// How many ticks a food-triggered speed boost lasts.
    pub food_boost_ticks: u32,
    pub food_score: u32,
    pub boosted_food_score: u32,
    pub min_food: u32,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            width: 100,
            height: 80,
            num_ai: 4,
            player_speed: 0.85,
            boost_multiplier: 1.6,
            proximity_radius: 3,
            food_boost_ticks: 20,
            food_score: 10,
            boosted_food_score: 25,
            min_food: 18,
        }
    }
}

impl Config {
    fn sanitized(self) -> Config {
        let height = self.height.clamp(20, 300);
        // Each snake (player + AI) needs its own starting lane; leave room
        // for spawn_snake's `height - 2` usable rows so lanes never collide.
        let max_ai = (height - 4).max(0) as u32;
        Config {
            width: self.width.clamp(20, 300),
            height,
            num_ai: self.num_ai.clamp(0, 16).min(max_ai),
            player_speed: self.player_speed.clamp(0.1, 1.0),
            boost_multiplier: self.boost_multiplier.clamp(1.0, 5.0),
            proximity_radius: self.proximity_radius.clamp(1, 30),
            food_boost_ticks: self.food_boost_ticks.clamp(0, 300),
            food_score: self.food_score.clamp(1, 1000),
            boosted_food_score: self.boosted_food_score.clamp(1, 1000),
            min_food: self.min_food.clamp(1, 300),
        }
    }
}

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
    move_progress: f64,
    food_boost_remaining: u32,
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
    config: Config,
    snakes: Vec<Snake>,
    food: Vec<(i32, i32)>,
    score: u32,
    game_over: bool,
    rng_state: u64,
}

impl Game {
    /// `index` and `total` place this snake in its own horizontal lane —
    /// spacing scales with `total` (player + AI count) so lanes never
    /// collide regardless of how many snakes are configured, as long as
    /// `Config::sanitized` has kept `total` within what `height` can fit.
    fn spawn_snake(width: i32, height: i32, index: usize, total: usize, is_player: bool) -> Snake {
        let spacing = ((height - 2).max(1)) / (total as i32 + 1).max(1);
        let start_y = (1 + spacing * (index as i32 + 1)).clamp(1, height - 2);
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
            move_progress: 0.0,
            food_boost_remaining: 0,
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
            let pos = (
                self.random_range(self.config.width),
                self.random_range(self.config.height),
            );
            if !self.occupied(pos) {
                self.food.push(pos);
                return;
            }
        }
    }

    fn in_bounds(&self, pos: (i32, i32)) -> bool {
        pos.0 >= 0 && pos.0 < self.config.width && pos.1 >= 0 && pos.1 < self.config.height
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

    /// Counts cells reachable from `start` via a BFS that treats current
    /// snake bodies as obstacles (same tail-skip rule as `is_safe`), capped
    /// at `cap` visits. Used so AI snakes can tell a dead-end or a pocket
    /// too small for their own body from open space, before committing to a
    /// direction — the standard fix for greedy Snake AI trapping itself.
    fn flood_fill_space(&self, start: (i32, i32), moving_index: usize, cap: i32) -> i32 {
        let mut visited: HashSet<(i32, i32)> = HashSet::new();
        let mut queue: VecDeque<(i32, i32)> = VecDeque::new();
        visited.insert(start);
        queue.push_back(start);
        let mut count = 0;

        while let Some(pos) = queue.pop_front() {
            count += 1;
            if count >= cap {
                break;
            }
            for d in Direction::all() {
                let (dx, dy) = d.delta();
                let next = (pos.0 + dx, pos.1 + dy);
                if visited.contains(&next) || !self.is_safe(next, moving_index) {
                    continue;
                }
                visited.insert(next);
                queue.push_back(next);
            }
        }

        count
    }

    fn nearest_food(&self, from: (i32, i32)) -> Option<(i32, i32)> {
        self.food
            .iter()
            .copied()
            .min_by_key(|f| (f.0 - from.0).abs() + (f.1 - from.1).abs())
    }

    /// Picks a direction using a survival-first heuristic: among moves that
    /// don't immediately collide, prefer ones that leave enough open space
    /// to fit the snake's own body (via `flood_fill_space`) — this is what
    /// keeps AI snakes from greedily chasing food into a dead end or a
    /// pocket they can't fit in. Only among moves that clear that bar does
    /// proximity to food break the tie; if nothing clears it, the move with
    /// the most space wins as the best available option.
    fn choose_ai_direction(&mut self, index: usize) -> Direction {
        let snake = &self.snakes[index];
        let head = snake.body[0];
        let current = snake.direction;
        let body_len = snake.body.len() as i32;
        let target = self.nearest_food(head);
        let space_cap = (body_len * 2).clamp(20, 200);

        let candidates: Vec<Direction> = Direction::all()
            .into_iter()
            .filter(|d| *d != current.opposite())
            .collect();

        let mut best: Option<(Direction, (i32, i32, i32))> = None;
        for d in candidates {
            let (dx, dy) = d.delta();
            let next = (head.0 + dx, head.1 + dy);
            if !self.is_safe(next, index) {
                continue;
            }
            let space = self.flood_fill_space(next, index, space_cap);
            let has_room = if space >= body_len { 1 } else { 0 };
            let food_dist = target
                .map(|t| -((next.0 - t.0).abs() + (next.1 - t.1).abs()))
                .unwrap_or(0);
            // Lexicographic: prefer moves with enough room first, then more
            // space, then closer food.
            let key = (has_room, space, food_dist);
            if best.map(|(_, best_key)| key > best_key).unwrap_or(true) {
                best = Some((d, key));
            }
        }

        match best {
            Some((d, _)) => d,
            // Nothing safe at all — keep heading and let collision resolution kill it.
            None => current,
        }
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

    /// True when this snake is within the config's proximity radius of any
    /// other living snake. Drives both the proximity portion of the speed
    /// boost and the player's proximity score bonus.
    fn is_near_others(&self, index: usize) -> bool {
        self.snakes[index].alive
            && self.min_distance_to_others(index) <= self.config.proximity_radius
    }

    /// Ticks moved per external tick for this snake, accounting for boosts.
    /// AI baseline is always 1.0; the player's baseline is `player_speed`
    /// (<= 1.0). Boosted speed is hard-capped at 1.0 for the player, so it
    /// can never outrun the AI's own baseline pace.
    fn effective_speed(&self, index: usize) -> f64 {
        let snake = &self.snakes[index];
        let base = if snake.is_player { self.config.player_speed } else { 1.0 };
        let boosted = self.is_near_others(index) || snake.food_boost_remaining > 0;
        let speed = if boosted { base * self.config.boost_multiplier } else { base };
        if snake.is_player { speed.min(1.0) } else { speed }
    }

    fn player_index(&self) -> Option<usize> {
        self.snakes.iter().position(|s| s.is_player)
    }

    /// Core constructor, independent of any JS/wasm host so it can be
    /// exercised directly from native `cargo test`.
    fn with_seed(config: Config, seed: u64) -> Game {
        let config = config.sanitized();
        let mut game = Game {
            config,
            snakes: Vec::new(),
            food: Vec::new(),
            score: 0,
            game_over: false,
            rng_state: seed | 1,
        };

        let total = config.num_ai as usize + 1;
        game.snakes
            .push(Game::spawn_snake(config.width, config.height, 0, total, true));
        for i in 0..config.num_ai as usize {
            game.snakes
                .push(Game::spawn_snake(config.width, config.height, i + 1, total, false));
        }

        for _ in 0..config.min_food {
            game.spawn_food();
        }

        game
    }
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(config: JsValue) -> Game {
        let config: Config = serde_wasm_bindgen::from_value(config).unwrap_or_default();
        let seed = ((js_sys::Math::random() * (u64::MAX as f64)) as u64) | 1;
        Game::with_seed(config, seed)
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

    /// Advances the simulation by one tick. Every snake accumulates its own
    /// effective speed (see `effective_speed`) and steps once per whole
    /// unit accumulated, so sub- and super-1.0 speeds both work smoothly.
    pub fn tick(&mut self) {
        if self.game_over {
            return;
        }

        for i in 0..self.snakes.len() {
            if !self.snakes[i].is_player && self.snakes[i].alive {
                let d = self.choose_ai_direction(i);
                self.snakes[i].direction = d;
            }
        }

        for i in 0..self.snakes.len() {
            if !self.snakes[i].alive {
                continue;
            }

            if self.snakes[i].is_player && self.is_near_others(i) {
                self.score += PROXIMITY_TICK_BONUS;
            }

            let speed = self.effective_speed(i);
            self.snakes[i].move_progress += speed;
            while self.snakes[i].move_progress >= 1.0 && self.snakes[i].alive {
                self.snakes[i].move_progress -= 1.0;
                self.step_one(i);
            }

            if self.snakes[i].food_boost_remaining > 0 {
                self.snakes[i].food_boost_remaining -= 1;
            }
        }

        if self
            .player_index()
            .map(|i| !self.snakes[i].alive)
            .unwrap_or(true)
        {
            self.game_over = true;
        }

        while self.food.len() < self.config.min_food as usize {
            self.spawn_food();
        }
    }

    pub fn state(&self) -> JsValue {
        let snakes = self
            .snakes
            .iter()
            .enumerate()
            .map(|(i, s)| SnakeState {
                body: s.body.clone(),
                alive: s.alive,
                is_player: s.is_player,
                boosted: s.alive && (self.is_near_others(i) || s.food_boost_remaining > 0),
            })
            .collect();

        let state = GameState {
            width: self.config.width,
            height: self.config.height,
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

/// Returns the default `Config` as a JS object, so the frontend's settings
/// UI can seed its defaults from the same source of truth as the engine.
#[wasm_bindgen]
pub fn default_config() -> JsValue {
    serde_wasm_bindgen::to_value(&Config::default()).unwrap_or(JsValue::NULL)
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
            self.snakes[index].food_boost_remaining = self.config.food_boost_ticks;
            if self.snakes[index].is_player {
                let near_others = self.is_near_others(index);
                self.score += if near_others {
                    self.config.boosted_food_score
                } else {
                    self.config.food_score
                };
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

    fn test_config() -> Config {
        Config {
            width: 50,
            height: 50,
            num_ai: 0,
            player_speed: 1.0 / 3.0,
            boost_multiplier: 1.6,
            proximity_radius: 3,
            food_boost_ticks: 20,
            food_score: 10,
            boosted_food_score: 25,
            min_food: 18,
        }
    }

    #[test]
    fn spawns_player_and_ai_with_correct_starting_length() {
        let mut config = test_config();
        config.num_ai = 3;
        let game = Game::with_seed(config, 1);
        assert_eq!(game.snakes.len(), 4);
        assert_eq!(game.snakes.iter().filter(|s| s.is_player).count(), 1);
        for snake in &game.snakes {
            assert_eq!(snake.body.len(), STARTING_LENGTH);
            assert!(snake.alive);
        }
    }

    #[test]
    fn ignores_direct_reversal_but_accepts_turns() {
        let mut game = Game::with_seed(test_config(), 1);
        let player = game.player_index().unwrap();
        assert_eq!(game.snakes[player].direction, Direction::Right);

        game.set_player_direction(2); // Left — opposite of Right, must be ignored
        assert_eq!(game.snakes[player].direction, Direction::Right);

        game.set_player_direction(0); // Up — a valid turn
        assert_eq!(game.snakes[player].direction, Direction::Up);
    }

    #[test]
    fn player_moves_slower_than_ai_at_baseline() {
        // num_ai = 0 keeps the player's min distance to others at i32::MAX,
        // so it never counts as boosted here. player_speed = 1/3 means it
        // should take exactly 3 ticks to move once.
        let mut game = Game::with_seed(test_config(), 1);
        let player = game.player_index().unwrap();
        let start_head = game.snakes[player].body[0];

        game.tick();
        assert_eq!(game.snakes[player].body[0], start_head);
        game.tick();
        assert_eq!(game.snakes[player].body[0], start_head);

        game.tick();
        let (dx, dy) = Direction::Right.delta();
        assert_eq!(
            game.snakes[player].body[0],
            (start_head.0 + dx, start_head.1 + dy)
        );
    }

    #[test]
    fn boosted_player_never_exceeds_ai_baseline_speed() {
        let mut config = test_config();
        config.num_ai = 1;
        config.boost_multiplier = 5.0; // deliberately extreme
        let mut game = Game::with_seed(config, 1);
        let player = game.player_index().unwrap();
        let ai = 1 - player;

        // Place the AI snake's head near the player's, within proximity
        // radius, without touching (which would kill on step).
        let player_head = game.snakes[player].body[0];
        game.snakes[ai].body = vec![(player_head.0, player_head.1 + config.proximity_radius)];
        game.food.clear(); // freeze the AI's target so it holds position

        let start_head = game.snakes[player].body[0];
        game.tick();
        let (dx, dy) = Direction::Right.delta();
        // Even with a 5x multiplier, the player is capped at speed 1.0 (AI
        // baseline), so it moves at most one cell in a single tick.
        assert_eq!(
            game.snakes[player].body[0],
            (start_head.0 + dx, start_head.1 + dy),
            "boosted player should move at most once per tick"
        );
        assert!(game.score >= PROXIMITY_TICK_BONUS);
    }

    #[test]
    fn eating_food_grants_a_temporary_speed_boost_to_any_snake() {
        let mut config = test_config();
        config.num_ai = 1;
        let mut game = Game::with_seed(config, 1);
        let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();

        assert_eq!(game.snakes[ai].food_boost_remaining, 0);
        game.snakes[ai].food_boost_remaining = 0;

        let head = game.snakes[ai].body[0];
        let (dx, dy) = game.snakes[ai].direction.delta();
        let next = (head.0 + dx, head.1 + dy);
        game.food = vec![next];

        // AI moves every tick at baseline, so one tick is enough to reach it.
        game.tick();
        assert_eq!(game.snakes[ai].food_boost_remaining, config.food_boost_ticks - 1);
    }

    #[test]
    fn dies_on_wall_collision_and_freezes_state() {
        let mut config = test_config();
        config.width = 6;
        config.height = 6;
        let mut game = Game::with_seed(config, 1);
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
        let config = test_config();
        let mut game = Game::with_seed(config, 1);
        let player = game.player_index().unwrap();
        let head = game.snakes[player].body[0];
        let (dx, dy) = Direction::Right.delta();
        let next = (head.0 + dx, head.1 + dy);

        game.food = vec![next];
        let len_before = game.snakes[player].body.len();

        // player_speed = 1/3 in test_config, so 3 ticks to take one step.
        for _ in 0..3 {
            game.tick();
        }

        assert_eq!(game.score, config.food_score);
        assert_eq!(game.snakes[player].body.len(), len_before + 1);
        assert!(!game.food.contains(&next));
    }
}
