mod ai;
mod config;
mod direction;
mod game;
mod snake;

#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;

pub(crate) const STARTING_LENGTH: usize = 4;
pub(crate) const PROXIMITY_TICK_BONUS: u32 = 1;
/// How strongly food-seeking dominates over drifting toward other snakes
/// (for the proximity boost): food_dist is scaled by this before summing
/// with other_dist, so food wins unless distances are close.
pub(crate) const PROXIMITY_SEEK_DIVISOR: i32 = 10;
/// How many simulated steps past the immediate candidate move
/// `lookahead_min_space` walks before settling on a safety score.
pub(crate) const AI_LOOKAHEAD_STEPS: u32 = 3;
pub(crate) const MAX_QUEUED_DIRECTIONS: usize = 3;
/// Preference for a boost-eligible candidate over a non-boosted one when
/// there's no food to weigh it against (see `speed_seeking_desirability`)
/// — arbitrary but small relative to the scaled time-to-food terms used
/// when food does exist, since it's a fallback, not the main signal.
pub(crate) const SPEED_SEEKING_BOOST_BONUS: i32 = 500;
/// Scales the time-to-food estimate (`distance / speed`) up before casting
/// to `i32`, so fractional differences from the boost multiplier survive
/// truncation instead of collapsing distinct candidates to the same score.
pub(crate) const SPEED_ESTIMATE_SCALE: f64 = 10.0;
/// Ceiling on wave-mode escalation — see `Game::advance_wave`.
pub(crate) const MAX_WAVE_ENEMIES: u32 = 12;

pub use config::{Config, FoodTargeting};
pub use game::{default_config, Game};
pub use snake::GameState;
