use std::collections::VecDeque;

use serde::Serialize;

use crate::config::FoodTargeting;
use crate::direction::Direction;

/// One candidate direction's full evaluation from `score_candidates` — the
/// "why" behind an AI's move, kept as data instead of being collapsed
/// straight into a winner. Only legal (safe, non-reversing) candidates get
/// a `CandidateScore` at all; `choose_ai_direction` just reduces a `Vec` of
/// these to the one with the highest `key()`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct CandidateScore {
    pub(crate) direction: Direction,
    pub(crate) has_room: bool,
    pub(crate) not_predicted_collision: bool,
    pub(crate) space: i32,
    pub(crate) desirability: i32,
}

impl CandidateScore {
    /// Lexicographic priority: room to not trap itself, then not stepping
    /// where an enemy head could go next, then raw space, then food/
    /// proximity desirability. See `score_candidates` for the rationale.
    pub(crate) fn key(&self) -> (i32, i32, i32, i32) {
        (
            self.has_room as i32,
            self.not_predicted_collision as i32,
            self.space,
            self.desirability,
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DeathCause {
    Wall,
    SelfCollision,
    OtherCollision,
}

/// An AI's overall movement preference, selected via `Snake::ai_behavior`.
/// Each variant maps to one pure desirability function (see
/// `Game::desirability` in `ai.rs`), so adding a behavior is: add a
/// variant, add a function, add a match arm — no existing behavior touched.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum AiBehavior {
    /// Food-first, proximity as a tiebreaker — the original heuristic.
    Default,
    /// Prioritizes landing on cells that would raise its own effective
    /// speed (edge of the arena / near another snake / an active food
    /// boost) over closing distance to food — it picks its trajectory by
    /// chasing whatever keeps it fastest.
    SpeedSeeking,
}

#[derive(Clone, Serialize)]
pub(crate) struct SnakeState {
    pub(crate) body: Vec<(i32, i32)>,
    pub(crate) alive: bool,
    pub(crate) is_player: bool,
    pub(crate) boosted: bool,
    /// Specifically "within proximity_radius of another snake" — a subset
    /// of `boosted` (which also includes the food-triggered boost). Kept
    /// separate so the frontend can react differently to "close to another
    /// snake" vs. "sped up from eating."
    pub(crate) near_others: bool,
    pub(crate) death_cause: Option<DeathCause>,
    pub(crate) score: u32,
}

pub(crate) struct Snake {
    pub(crate) body: Vec<(i32, i32)>,
    pub(crate) direction: Direction,
    /// Player-only input buffer: turns queued faster than the player
    /// actually steps. Validated against the *previously queued* turn (or
    /// `direction` if empty) at queue time, so a fast Up/Left/Down burst
    /// buffers as three legal 90° turns rather than the later presses
    /// clobbering the earlier ones — and a genuine reversal is rejected
    /// against whichever turn it would actually follow, not stale state.
    pub(crate) pending_directions: VecDeque<Direction>,
    pub(crate) alive: bool,
    pub(crate) is_player: bool,
    pub(crate) pending_growth: u32,
    pub(crate) move_progress: f64,
    pub(crate) food_boost_remaining: u32,
    pub(crate) death_cause: Option<DeathCause>,
    /// Per-snake score, tracked for AI too (not just the player) so the
    /// frontend can show a leaderboard. `Game::score`/`score()` stays the
    /// player's own number, unchanged, for the main HUD.
    pub(crate) score: u32,
    /// Assigned once at spawn time (see `Game::with_seed`) — carrying the
    /// strategy as data on the snake, rather than reading `Config` at
    /// decision time, is what makes it possible for only one AI to use a
    /// non-default strategy while the rest keep the original behavior.
    pub(crate) food_targeting: FoodTargeting,
    /// Same pattern as `food_targeting`, for overall movement preference —
    /// see `AiBehavior`.
    pub(crate) ai_behavior: AiBehavior,
}

#[derive(Serialize)]
pub struct GameState {
    pub(crate) width: i32,
    pub(crate) height: i32,
    pub(crate) snakes: Vec<SnakeState>,
    pub(crate) food: Vec<(i32, i32)>,
    pub(crate) score: u32,
    pub(crate) game_over: bool,
    /// Current wave's enemy count (meaningless unless `wave_mode` is on).
    pub(crate) wave: u32,
}
