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

pub use config::{Config, FoodTargeting};
pub use game::{default_config, Game};
pub use snake::GameState;
