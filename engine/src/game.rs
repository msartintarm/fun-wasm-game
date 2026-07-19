use std::collections::VecDeque;

use wasm_bindgen::prelude::*;

use crate::config::{Config, FoodTargeting};
use crate::direction::Direction;
use crate::snake::{AiBehavior, DeathCause, GameState, Snake, SnakeState};
use crate::{MAX_QUEUED_DIRECTIONS, MAX_WAVE_ENEMIES, PROXIMITY_TICK_BONUS, STARTING_LENGTH};

#[wasm_bindgen]
pub struct Game {
    pub(crate) config: Config,
    pub(crate) snakes: Vec<Snake>,
    pub(crate) food: Vec<(i32, i32)>,
    pub(crate) score: u32,
    pub(crate) game_over: bool,
    pub(crate) rng_state: u64,
    /// Current wave's enemy count — see `advance_wave`.
    pub(crate) current_wave_size: u32,
}

impl Game {
    /// `index` and `total` place this snake in its own horizontal lane —
    /// spacing scales with `total` (player + AI count) so lanes never
    /// collide regardless of how many snakes are configured, as long as
    /// `Config::sanitized` has kept `total` within what `height` can fit.
    pub(crate) fn spawn_snake(
        width: i32,
        height: i32,
        index: usize,
        total: usize,
        is_player: bool,
        food_targeting: FoodTargeting,
        ai_behavior: AiBehavior,
    ) -> Snake {
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
            pending_directions: VecDeque::new(),
            alive: true,
            is_player,
            pending_growth: 0,
            move_progress: 0.0,
            food_boost_remaining: 0,
            death_cause: None,
            score: 0,
            food_targeting,
            ai_behavior,
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

    pub(crate) fn occupied(&self, pos: (i32, i32)) -> bool {
        self.snakes
            .iter()
            .filter(|s| s.alive)
            .any(|s| s.body.contains(&pos))
            || self.food.contains(&pos)
    }

    pub(crate) fn spawn_food(&mut self) {
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

    /// Like `spawn_food`'s retry loop, not `spawn_snake`'s lane math —
    /// mid-game the board isn't empty, so this needs an occupancy check.
    fn spawn_ai_snake_mid_game(&mut self) -> Snake {
        let width = self.config.width;
        let height = self.config.height;
        loop {
            let start_x = (STARTING_LENGTH as i32 - 1)
                + self.random_range((width - STARTING_LENGTH as i32 + 1).max(1));
            let start_y = self.random_range(height);
            let body: Vec<(i32, i32)> =
                (0..STARTING_LENGTH as i32).map(|i| (start_x - i, start_y)).collect();
            if body.iter().all(|&pos| !self.occupied(pos)) {
                return Snake {
                    body,
                    direction: Direction::Right,
                    pending_directions: VecDeque::new(),
                    alive: true,
                    is_player: false,
                    pending_growth: 0,
                    move_progress: 0.0,
                    food_boost_remaining: 0,
                    death_cause: None,
                    score: 0,
                    food_targeting: FoodTargeting::Nearest,
                    ai_behavior: if self.config.all_ai_speed_seeking {
                        AiBehavior::SpeedSeeking
                    } else {
                        AiBehavior::Default
                    },
                };
            }
        }
    }

    /// One more enemy than the last wave, capped so a starting `num_ai`
    /// above `MAX_WAVE_ENEMIES` is never contradicted (it just means no
    /// headroom to climb further).
    fn advance_wave(&mut self) {
        let cap = MAX_WAVE_ENEMIES.max(self.config.num_ai);
        self.current_wave_size = (self.current_wave_size + 1).min(cap);
        for _ in 0..self.current_wave_size {
            let snake = self.spawn_ai_snake_mid_game();
            self.snakes.push(snake);
        }
    }

    /// Every 2nd body segment (1-based: indices 1, 3, 5, ...) becomes food —
    /// except in spectator mode, where there's no player competing for food,
    /// so every segment drops to keep a bots-only match well fed.
    fn convert_corpse_to_food(&mut self, index: usize) {
        let snake = &self.snakes[index];
        if snake.is_player {
            return;
        }
        let drops: Vec<(i32, i32)> = if self.config.spectator_mode {
            snake.body.iter().skip(1).copied().collect()
        } else {
            snake.body.iter().skip(1).step_by(2).copied().collect()
        };
        self.food.extend(drops);
    }

    fn award_vanquish_score(&mut self, index: usize) {
        if self.config.vanquish_score_percent == 0 || self.snakes[index].is_player {
            return;
        }
        // u64 intermediate: score * percent could exceed u32 range for a
        // long-enough-running, high-percent config.
        let gained = ((self.snakes[index].score as u64 * self.config.vanquish_score_percent as u64)
            / 100) as u32;
        if let Some(player_idx) = self.player_index() {
            self.snakes[player_idx].score += gained;
        }
        self.score += gained;
    }

    pub(crate) fn in_bounds(&self, pos: (i32, i32)) -> bool {
        pos.0 >= 0 && pos.0 < self.config.width && pos.1 >= 0 && pos.1 < self.config.height
    }

    pub(crate) fn is_safe(&self, pos: (i32, i32), moving_index: usize) -> bool {
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

    /// Classifies why `pos` isn't safe for `moving_index` — call only when
    /// `is_safe` has already returned false for this exact position. Wall
    /// takes priority since an out-of-bounds cell has no body to check;
    /// otherwise it's the mover's own body vs. another snake's.
    fn classify_collision(&self, pos: (i32, i32), moving_index: usize) -> DeathCause {
        if !self.in_bounds(pos) {
            return DeathCause::Wall;
        }
        if self.snakes[moving_index].body.contains(&pos) {
            return DeathCause::SelfCollision;
        }
        DeathCause::OtherCollision
    }

    /// Pure, position-based: how close `from` is to any other living
    /// snake's body, not necessarily `index`'s own current head. Lets
    /// `ai.rs` ask "would landing *here* count as near another snake?" for
    /// a hypothetical candidate cell, not just the real-time question.
    pub(crate) fn min_distance_to_others_from(&self, index: usize, from: (i32, i32)) -> i32 {
        let mut best = i32::MAX;
        for (i, snake) in self.snakes.iter().enumerate() {
            if i == index || !snake.alive {
                continue;
            }
            for seg in &snake.body {
                let d = (seg.0 - from.0).abs() + (seg.1 - from.1).abs();
                if d < best {
                    best = d;
                }
            }
        }
        best
    }

    pub(crate) fn min_distance_to_others(&self, index: usize) -> i32 {
        self.min_distance_to_others_from(index, self.snakes[index].body[0])
    }

    /// True when this snake is within the config's proximity radius of any
    /// other living snake. Drives both the proximity portion of the speed
    /// boost and the player's proximity score bonus.
    pub(crate) fn is_near_others(&self, index: usize) -> bool {
        self.snakes[index].alive
            && self.min_distance_to_others(index) <= self.config.proximity_radius
    }

    /// Pure, position-based: true when `pos` is on the outermost ring of
    /// the arena — the same cells the frontend renders as a visually
    /// distinct edge zone. Takes a bare position (not an index) so it can
    /// answer "would a hypothetical candidate cell be on the edge?" too.
    pub(crate) fn is_edge_cell(&self, pos: (i32, i32)) -> bool {
        pos.0 == 0 || pos.1 == 0 || pos.0 == self.config.width - 1 || pos.1 == self.config.height - 1
    }

    /// True when this snake's head is on the edge ring right now.
    pub(crate) fn is_at_edge(&self, index: usize) -> bool {
        self.is_edge_cell(self.snakes[index].body[0])
    }

    /// Ticks moved per external tick for this snake, accounting for boosts.
    /// AI baseline is always 1.0; the player's baseline is `player_speed`
    /// (<= 1.0).
    pub(crate) fn effective_speed(&self, index: usize) -> f64 {
        let snake = &self.snakes[index];
        let base = if snake.is_player { self.config.player_speed } else { 1.0 };
        let boosted =
            self.is_near_others(index) || snake.food_boost_remaining > 0 || self.is_at_edge(index);
        if boosted { base * self.config.boost_multiplier } else { base }
    }

    pub(crate) fn player_index(&self) -> Option<usize> {
        self.snakes.iter().position(|s| s.is_player)
    }

    /// Core constructor, independent of any JS/wasm host so it can be
    /// exercised directly from native `cargo test`.
    pub(crate) fn with_seed(config: Config, seed: u64) -> Game {
        let config = config.sanitized();
        let mut game = Game {
            config,
            snakes: Vec::new(),
            food: Vec::new(),
            score: 0,
            game_over: false,
            rng_state: seed | 1,
            current_wave_size: config.num_ai,
        };

        // spectator_mode: no player lane needed, so AI take index 0.. instead
        // of 1.. and `total` (used for lane-spacing math) drops the +1.
        let ai_index_offset = if config.spectator_mode { 0 } else { 1 };
        let total = config.num_ai as usize + ai_index_offset;
        if !config.spectator_mode {
            game.snakes.push(Game::spawn_snake(
                config.width,
                config.height,
                0,
                total,
                true,
                FoodTargeting::Nearest,
                AiBehavior::Default,
            ));
        }
        for i in 0..config.num_ai as usize {
            // Only the second AI spawned gets the configured food-targeting
            // strategy, and only the first gets the speed-seeking movement
            // behavior — the rest keep the original defaults, so each
            // special behavior can be compared against the baseline side by
            // side in one game.
            let food_targeting = if i == 1 {
                config.food_targeting
            } else {
                FoodTargeting::Nearest
            };
            let ai_behavior = if config.all_ai_speed_seeking || i == 0 {
                AiBehavior::SpeedSeeking
            } else {
                AiBehavior::Default
            };
            game.snakes.push(Game::spawn_snake(
                config.width,
                config.height,
                i + ai_index_offset,
                total,
                false,
                food_targeting,
                ai_behavior,
            ));
        }

        for _ in 0..config.min_food {
            game.spawn_food();
        }

        game
    }

    pub(crate) fn step_one(&mut self, index: usize) {
        if !self.snakes[index].alive {
            return;
        }

        // The player can take at most one step per tick (speed is hard-
        // capped at 1.0), so it's safe to pop exactly one buffered turn per
        // actual step here — each queued direction was already validated
        // against the one before it at queue time.
        if let Some(d) = self.snakes[index].pending_directions.pop_front() {
            self.snakes[index].direction = d;
        }

        let head = self.snakes[index].body[0];
        let (dx, dy) = self.snakes[index].direction.delta();
        let next = (head.0 + dx, head.1 + dy);

        if !self.is_safe(next, index) {
            self.snakes[index].alive = false;
            self.snakes[index].death_cause = Some(self.classify_collision(next, index));
            self.convert_corpse_to_food(index);
            self.award_vanquish_score(index);
            return;
        }

        let ate = self.food.iter().position(|f| *f == next);
        if let Some(pos) = ate {
            self.food.remove(pos);
            self.snakes[index].food_boost_remaining = self.config.food_boost_ticks;
            let near_others = self.is_near_others(index);
            let gained = if near_others {
                self.config.boosted_food_score
            } else {
                self.config.food_score
            };
            self.snakes[index].score += gained;
            if self.snakes[index].is_player {
                self.score += gained;
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
                let last = player.current_heading();
                // Skip repeats of the already-intended heading (e.g. key
                // repeat while holding a direction) so they can't eat up
                // buffer capacity that a later, different turn needs.
                let is_new_turn = d != last;
                let is_legal_turn = d != last.opposite();
                if is_new_turn
                    && is_legal_turn
                    && player.pending_directions.len() < MAX_QUEUED_DIRECTIONS
                {
                    player.pending_directions.push_back(d);
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
            if !self.snakes[i].alive {
                continue;
            }

            if self.is_near_others(i) {
                self.snakes[i].score += PROXIMITY_TICK_BONUS;
                if self.snakes[i].is_player {
                    self.score += PROXIMITY_TICK_BONUS;
                }
            }

            let speed = self.effective_speed(i);
            self.snakes[i].move_progress += speed;
            while self.snakes[i].move_progress >= 1.0 && self.snakes[i].alive {
                self.snakes[i].move_progress -= 1.0;
                // Re-decided before every grid step, not once per tick: a
                // boosted AI can resolve 2+ steps in one tick, and a
                // direction chosen before the first step can be stale by
                // the second (see diagnose_ai_other_collisions).
                if !self.snakes[i].is_player {
                    let d = self.choose_ai_direction(i);
                    self.snakes[i].direction = d;
                }
                self.step_one(i);
            }

            if self.snakes[i].food_boost_remaining > 0 {
                self.snakes[i].food_boost_remaining -= 1;
            }
        }

        if self.config.wave_mode
            && self.snakes.iter().any(|s| !s.is_player)
            && self.snakes.iter().filter(|s| !s.is_player).all(|s| !s.alive)
        {
            self.advance_wave();
        }

        // unwrap_or(false), not true: when there's no player at all
        // (spectator_mode), this must never end the match — the `.map`
        // branch is the only one ever reached when a player does exist, so
        // this changes nothing about the normal (non-spectator) case.
        if self
            .player_index()
            .map(|i| !self.snakes[i].alive)
            .unwrap_or(false)
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
                direction: s.current_heading().to_u8(),
                boosted: s.alive
                    && (self.is_near_others(i) || s.food_boost_remaining > 0 || self.is_at_edge(i)),
                near_others: s.alive && self.is_near_others(i),
                death_cause: s.death_cause,
                score: s.score,
            })
            .collect();

        let state = GameState {
            width: self.config.width,
            height: self.config.height,
            snakes,
            food: self.food.clone(),
            score: self.score,
            game_over: self.game_over,
            wave: self.current_wave_size,
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
