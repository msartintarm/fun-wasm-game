use serde::{Deserialize, Serialize};

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
    /// Multiplier applied once per active boost source (near another
    /// snake, recently ate food, at the arena edge) — see
    /// `Game::effective_speed`. These stack multiplicatively, so a snake
    /// hitting two or three sources at once compounds past what any single
    /// source gives alone.
    pub boost_multiplier: f64,
    pub proximity_radius: i32,
    /// How many ticks a food-triggered speed boost lasts.
    pub food_boost_ticks: u32,
    pub food_score: u32,
    pub boosted_food_score: u32,
    pub min_food: u32,
    /// Food-targeting strategy (see `FoodTargeting`) for exactly one
    /// designated AI — the first AI spawned — so its behavior can be
    /// compared against the rest, which always keep the original
    /// distance-only targeting regardless of this setting.
    pub food_targeting: FoodTargeting,
    /// Escalating AI waves — see `Game::advance_wave`.
    pub wave_mode: bool,
    /// Percentage of the dying enemy's own score the player inherits on
    /// every AI death (0 disables it) — see `Game::award_vanquish_score`.
    pub vanquish_score_percent: u32,
    /// No player snake spawns at all — `num_ai` AI-only. `tick()`'s
    /// game-over check naturally never fires without a player to die, so
    /// a spectator match just keeps running (wave_mode keeps it alive
    /// indefinitely rather than idling once every AI is dead).
    pub spectator_mode: bool,
    /// Every AI (including ones spawned mid-match by wave escalation) gets
    /// the `AiBehavior::SpeedSeeking` movement behavior normally reserved
    /// for just the first AI spawned — a whole arena of the "advanced" AI
    /// instead of one for comparison against the baseline.
    pub all_ai_speed_seeking: bool,
}

/// Strategy AI uses to pick a food target, selected via `Config`. Each
/// variant maps to one pure targeting function (see `select_food_target`),
/// so adding a new strategy is: add a variant, add a function, add a match
/// arm — no existing behavior touched.
#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FoodTargeting {
    /// Always the closest food by distance, regardless of whether a path
    /// there actually exists right now. This is the original behavior:
    /// AI commits to food even when another snake is blocking the direct
    /// route, which reads as bold/aggressive rather than indecisive.
    Nearest,
    /// The closest food that's actually reachable without crossing any
    /// snake's body — food behind a blocking snake is treated as
    /// unreachable and ignored until the way opens up.
    NearestReachable,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            width: 60,
            height: 40,
            num_ai: 30,
            player_speed: 1.0,
            boost_multiplier: 1.3,
            proximity_radius: 3,
            food_boost_ticks: 40,
            food_score: 10,
            boosted_food_score: 25,
            min_food: 18,
            food_targeting: FoodTargeting::NearestReachable,
            wave_mode: false,
            vanquish_score_percent: 50,
            spectator_mode: false,
            all_ai_speed_seeking: false,
        }
    }
}

impl Config {
    pub(crate) fn sanitized(self) -> Config {
        let height = self.height.clamp(20, 300);
        // Each snake (player + AI) needs its own starting lane; leave room
        // for spawn_snake's `height - 2` usable rows so lanes never collide.
        let max_ai = (height - 4).max(0) as u32;
        Config {
            width: self.width.clamp(20, 300),
            height,
            num_ai: self.num_ai.clamp(0, 64).min(max_ai),
            player_speed: self.player_speed.clamp(0.1, 1.0),
            boost_multiplier: self.boost_multiplier.clamp(1.0, 5.0),
            proximity_radius: self.proximity_radius.clamp(1, 30),
            food_boost_ticks: self.food_boost_ticks.clamp(0, 300),
            food_score: self.food_score.clamp(1, 1000),
            boosted_food_score: self.boosted_food_score.clamp(1, 1000),
            min_food: self.min_food.clamp(1, 300),
            food_targeting: self.food_targeting,
            wave_mode: self.wave_mode,
            vanquish_score_percent: self.vanquish_score_percent.clamp(0, 1000),
            spectator_mode: self.spectator_mode,
            all_ai_speed_seeking: self.all_ai_speed_seeking,
        }
    }
}
