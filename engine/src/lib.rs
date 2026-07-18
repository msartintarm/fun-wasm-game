use serde::Serialize;
use wasm_bindgen::prelude::*;

const PROXIMITY_RADIUS: i32 = 3;
const FOOD_SCORE: u32 = 10;
const BOOSTED_FOOD_SCORE: u32 = 25;
const PROXIMITY_TICK_BONUS: u32 = 1;
const STARTING_LENGTH: usize = 4;

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
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32, num_ai: u32) -> Game {
        let width = width as i32;
        let height = height as i32;
        let mut game = Game {
            width,
            height,
            snakes: Vec::new(),
            food: Vec::new(),
            score: 0,
            game_over: false,
            rng_state: ((js_sys::Math::random() * (u64::MAX as f64)) as u64) | 1,
        };

        game.snakes.push(Game::spawn_snake(width, height, 0, true));
        for i in 0..num_ai as usize {
            game.snakes.push(Game::spawn_snake(width, height, i + 1, false));
        }

        for _ in 0..(3 + num_ai) {
            game.spawn_food();
        }

        game
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

    /// Advances the simulation by one step. When the player is within
    /// PROXIMITY_RADIUS of another snake, the player takes an extra step
    /// this tick (moves faster) and earns bonus score.
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

        self.step_all();

        if let Some(player_index) = self.player_index() {
            if self.snakes[player_index].alive {
                let dist = self.min_distance_to_others(player_index);
                if dist <= PROXIMITY_RADIUS {
                    self.score += PROXIMITY_TICK_BONUS;
                    self.step_one(player_index);
                }
            }
        }

        if self
            .player_index()
            .map(|i| !self.snakes[i].alive)
            .unwrap_or(true)
        {
            self.game_over = true;
        }

        while self.food.len() < 3 {
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
    fn step_all(&mut self) {
        for i in 0..self.snakes.len() {
            self.step_one(i);
        }
    }

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
