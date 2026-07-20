use std::collections::HashSet;

use crate::config::{Config, FoodTargeting};
use crate::direction::Direction;
use crate::game::Game;
use crate::snake::{AiBehavior, DeathCause};
use crate::test_support::game_from_grid;
use crate::{MAX_QUEUED_DIRECTIONS, MAX_WAVE_ENEMIES, PROXIMITY_TICK_BONUS, STARTING_LENGTH};

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
        food_targeting: FoodTargeting::Nearest,
        wave_mode: false,
        vanquish_score_percent: 0,
        spectator_mode: false,
        all_ai_speed_seeking: false,
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
    assert!(game.snakes[player].pending_directions.is_empty());

    game.set_player_direction(0); // Up — a valid turn
    assert_eq!(game.snakes[player].pending_directions.back(), Some(&Direction::Up));
}

#[test]
fn current_heading_reflects_a_queued_turn_immediately_without_a_tick() {
    let mut game = Game::with_seed(test_config(), 1);
    let player = game.player_index().unwrap();
    assert_eq!(game.snakes[player].current_heading(), Direction::Right);

    game.set_player_direction(0); // Up — queued, not yet stepped
    assert_eq!(game.snakes[player].current_heading(), Direction::Up);

    game.set_player_direction(2); // Left — 90° from the queued Up, also legal
    assert_eq!(game.snakes[player].current_heading(), Direction::Left);
}

#[test]
fn buffers_a_quick_burst_of_turns_as_the_next_moves() {
    // Regression test for the exact scenario reported: rapidly pressing
    // up/left/down (each a 90° turn from the last) must not let the
    // snake reverse into itself, and all three turns should still take
    // effect in order rather than the later presses clobbering earlier
    // ones because the engine hadn't stepped yet.
    let mut config = test_config();
    config.num_ai = 0; // isolate from boost/AI interference
    let mut game = Game::with_seed(config, 1);
    let player = game.player_index().unwrap();
    assert_eq!(game.snakes[player].direction, Direction::Right);

    game.set_player_direction(0); // Up — 90° from Right, legal
    game.set_player_direction(2); // Left — 90° from Up, legal
    game.set_player_direction(1); // Down — 90° from Left, legal (not opposite of Left)
    assert_eq!(game.snakes[player].pending_directions.len(), 3);

    let start = game.snakes[player].body[0];
    // player_speed = 1/3 in test_config, so each buffered turn takes 3
    // ticks to actually execute as a step.
    for _ in 0..3 {
        game.tick();
    }
    assert_eq!(game.snakes[player].direction, Direction::Up);
    let after_up = game.snakes[player].body[0];
    assert_eq!(after_up, (start.0, start.1 - 1));

    for _ in 0..3 {
        game.tick();
    }
    assert_eq!(game.snakes[player].direction, Direction::Left);
    let after_left = game.snakes[player].body[0];
    assert_eq!(after_left, (after_up.0 - 1, after_up.1));

    for _ in 0..3 {
        game.tick();
    }
    assert_eq!(game.snakes[player].direction, Direction::Down);
    assert!(game.snakes[player].alive);
    let after_down = game.snakes[player].body[0];
    assert_eq!(after_down, (after_left.0, after_left.1 + 1));
}

#[test]
fn rejects_a_reversal_against_the_last_queued_turn_not_stale_state() {
    let mut game = Game::with_seed(test_config(), 1);
    let player = game.player_index().unwrap();

    game.set_player_direction(0); // Up — queued, legal from Right
    game.set_player_direction(1); // Down — opposite of the queued Up, must be rejected
    assert_eq!(game.snakes[player].pending_directions.len(), 1);
    assert_eq!(game.snakes[player].pending_directions.back(), Some(&Direction::Up));

    // A legal follow-up should still queue fine after the rejection.
    game.set_player_direction(2); // Left — 90° from the queued Up
    assert_eq!(game.snakes[player].pending_directions.len(), 2);
}

#[test]
fn caps_the_queue_and_ignores_repeats_of_the_intended_heading() {
    let mut game = Game::with_seed(test_config(), 1);
    let player = game.player_index().unwrap();

    game.set_player_direction(0); // Up
    game.set_player_direction(0); // repeat — should not consume a queue slot
    assert_eq!(game.snakes[player].pending_directions.len(), 1);

    game.set_player_direction(2); // Left
    game.set_player_direction(1); // Down
    game.set_player_direction(3); // Right — queue already at MAX_QUEUED_DIRECTIONS, dropped
    assert_eq!(game.snakes[player].pending_directions.len(), MAX_QUEUED_DIRECTIONS);
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
fn boosted_player_can_exceed_ai_baseline_speed() {
    let mut config = test_config();
    config.num_ai = 1;
    config.player_speed = 1.0;
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
    // player_speed 1.0 * boost_multiplier 5.0 = 5 cells in one tick —
    // the player is no longer capped at the AI's baseline speed.
    assert_eq!(
        game.snakes[player].body[0],
        (start_head.0 + dx * 5, start_head.1 + dy * 5),
        "boosted player should not be capped at one cell per tick"
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
fn is_boosted_at_the_edge_of_the_arena() {
    let config = test_config();
    let mut game = Game::with_seed(config, 1);
    let player = game.player_index().unwrap();
    game.snakes[player].body = vec![(0, 10), (1, 10), (2, 10), (3, 10)]; // head on the west edge

    assert!(game.is_at_edge(player));
    let expected = config.player_speed * config.boost_multiplier;
    assert!(
        (game.effective_speed(player) - expected).abs() < 1e-9,
        "expected edge-boosted speed {expected}, got {}",
        game.effective_speed(player)
    );
}

#[test]
fn is_not_boosted_away_from_the_edge() {
    // Default spawn position (mid-board) isn't near any edge.
    let game = Game::with_seed(test_config(), 1);
    let player = game.player_index().unwrap();
    assert!(!game.is_at_edge(player));
}

#[test]
fn boost_sources_stack_multiplicatively_not_flat() {
    let mut config = test_config();
    config.num_ai = 1;
    let mut game = Game::with_seed(config, 1);
    let player = game.player_index().unwrap();
    let ai = 1 - player;

    // Edge + proximity active simultaneously: player on the west edge,
    // with the AI within proximity_radius of it.
    game.snakes[player].body = vec![(0, 10), (1, 10), (2, 10), (3, 10)];
    game.snakes[ai].body = vec![(0, 10 + config.proximity_radius)];

    assert!(game.is_at_edge(player));
    assert!(game.is_near_others(player));

    let single_source = config.player_speed * config.boost_multiplier;
    let two_sources_stacked = config.player_speed * config.boost_multiplier * config.boost_multiplier;
    let actual = game.effective_speed(player);

    assert!(
        (actual - two_sources_stacked).abs() < 1e-9,
        "expected two stacked sources to give {two_sources_stacked}, got {actual}"
    );
    assert!(
        actual > single_source,
        "stacked boost ({actual}) should exceed a single source ({single_source})"
    );
}

#[test]
fn all_three_boost_sources_stack_together() {
    let mut config = test_config();
    config.num_ai = 1;
    let mut game = Game::with_seed(config, 1);
    let player = game.player_index().unwrap();
    let ai = 1 - player;

    game.snakes[player].body = vec![(0, 10), (1, 10), (2, 10), (3, 10)]; // edge
    game.snakes[ai].body = vec![(0, 10 + config.proximity_radius)]; // proximity
    game.snakes[player].food_boost_remaining = config.food_boost_ticks; // food

    let expected = config.player_speed * config.boost_multiplier.powi(3);
    let actual = game.effective_speed(player);
    assert!(
        (actual - expected).abs() < 1e-9,
        "expected all three sources stacked to give {expected}, got {actual}"
    );
    assert_eq!(game.boost_stack_count(player), 3);
}

#[test]
fn boost_stack_count_reflects_exactly_the_active_sources() {
    let mut config = test_config();
    config.num_ai = 1;
    let mut game = Game::with_seed(config, 1);
    let player = game.player_index().unwrap();

    assert_eq!(game.boost_stack_count(player), 0);

    game.snakes[player].body = vec![(0, 10), (1, 10), (2, 10), (3, 10)]; // edge only
    assert_eq!(game.boost_stack_count(player), 1);

    game.snakes[player].food_boost_remaining = config.food_boost_ticks; // + food
    assert_eq!(game.boost_stack_count(player), 2);
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
    assert!(matches!(game.snakes[player].death_cause, Some(DeathCause::Wall)));

    let score_before = game.score;
    let body_before = game.snakes[player].body.clone();
    game.tick();
    assert_eq!(game.score, score_before);
    assert_eq!(game.snakes[player].body, body_before);
}

#[test]
fn classifies_self_collision() {
    let mut game = Game::with_seed(test_config(), 1);
    let player = game.player_index().unwrap();
    // Heading straight back into the segment right behind the head.
    game.snakes[player].body = vec![(10, 10), (10, 11), (11, 11), (11, 10)];
    game.snakes[player].direction = Direction::Down;

    game.step_one(player);

    assert!(!game.snakes[player].alive);
    assert!(matches!(
        game.snakes[player].death_cause,
        Some(DeathCause::SelfCollision)
    ));
}

#[test]
fn classifies_other_collision() {
    let mut config = test_config();
    config.num_ai = 1;
    let mut game = Game::with_seed(config, 1);
    let player = game.player_index().unwrap();
    let ai = 1 - player;

    game.snakes[player].body = vec![(10, 10), (9, 10), (8, 10), (7, 10)];
    game.snakes[player].direction = Direction::Up;
    game.snakes[ai].body = vec![(10, 9), (10, 8), (10, 7), (10, 6)];

    game.step_one(player);

    assert!(!game.snakes[player].alive);
    assert!(matches!(
        game.snakes[player].death_cause,
        Some(DeathCause::OtherCollision)
    ));
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

#[test]
fn spawn_lanes_never_collide_even_with_many_ai_snakes() {
    let mut config = test_config();
    config.height = 20; // small on purpose to stress the lane spacing
    config.num_ai = 16;
    let game = Game::with_seed(config, 1);

    // sanitized() may have trimmed num_ai to fit height=20, but however
    // many snakes actually spawned, none of their starting cells overlap.
    let mut seen = HashSet::new();
    for snake in &game.snakes {
        for seg in &snake.body {
            assert!(seen.insert(*seg), "duplicate starting cell {:?}", seg);
        }
    }
}

#[test]
fn ai_flood_fill_avoids_a_dead_end_even_toward_food() {
    let mut config = test_config();
    config.num_ai = 1;
    let mut game = Game::with_seed(config, 1);
    let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();

    // Build a one-cell-wide dead-end pocket directly ahead of the AI
    // (east), sealed except for the entrance, with food inside it —
    // greedy nearest-food would walk straight in and trap itself.
    let head = (10, 10);
    game.snakes[ai].body = vec![head, (9, 10), (8, 10), (7, 10)];
    game.snakes[ai].direction = Direction::Right;

    let blocker = game.snakes.iter().position(|s| s.is_player).unwrap();
    // Wall off the pocket at (11,10) using the player snake's body as
    // obstacles on three sides, leaving only the entrance at (11,10)
    // open from `head`, with food at (12,10) inside the pocket.
    game.snakes[blocker].body = vec![
        (11, 9), (12, 9), (13, 9), (13, 10), (13, 11), (12, 11), (11, 11),
    ];
    game.food = vec![(12, 10)];

    let d = game.choose_ai_direction(ai);
    assert_ne!(
        d,
        Direction::Right,
        "should avoid walking into the sealed pocket even though food is there"
    );
}

#[test]
fn nearest_reachable_food_ignores_food_sealed_by_a_snake_body() {
    let mut config = test_config();
    config.num_ai = 2;
    let mut game = Game::with_seed(config, 1);
    let ai_indices: Vec<usize> = game
        .snakes
        .iter()
        .enumerate()
        .filter(|(_, s)| !s.is_player)
        .map(|(i, _)| i)
        .collect();
    let ai = ai_indices[0];
    let wall = ai_indices[1];
    // Set directly rather than relying on spawn-order assignment — keeps
    // this test independent of which AI number the config happens to wire
    // NearestReachable to.
    game.snakes[ai].food_targeting = FoodTargeting::NearestReachable;

    game.snakes[ai].body = vec![(5, 10), (6, 10), (7, 10), (8, 10)];
    // The wall snake's body seals (10, 10) off from all 4 orthogonal
    // neighbors — a minimal ring, not a full box, since flood fill is
    // 4-connected and diagonals can't be entered anyway.
    game.snakes[wall].body = vec![(9, 10), (11, 10), (10, 9), (10, 11)];
    game.food = vec![(10, 10), (20, 10)]; // sealed-but-closer, open-but-farther

    let target = game.select_food_target((5, 10), ai);
    assert_eq!(
        target,
        Some((20, 10)),
        "sealed-but-closer food should be ignored in NearestReachable mode"
    );
}

#[test]
fn nearest_food_ignores_reachability_by_default() {
    let mut config = test_config();
    config.num_ai = 2;
    // Default food_targeting is FoodTargeting::Nearest — preserves the
    // original "commits to the nearest food even when blocked" feel.
    let mut game = Game::with_seed(config, 1);
    let ai_indices: Vec<usize> = game
        .snakes
        .iter()
        .enumerate()
        .filter(|(_, s)| !s.is_player)
        .map(|(i, _)| i)
        .collect();
    let ai = ai_indices[0];
    let wall = ai_indices[1];

    game.snakes[ai].body = vec![(5, 10), (6, 10), (7, 10), (8, 10)];
    game.snakes[wall].body = vec![(9, 10), (11, 10), (10, 9), (10, 11)];
    game.food = vec![(10, 10), (20, 10)];

    let target = game.select_food_target((5, 10), ai);
    assert_eq!(
        target,
        Some((10, 10)),
        "default Nearest mode should still target the closer food even though it's sealed off"
    );
}

#[test]
fn only_the_second_ai_gets_the_configured_food_targeting_strategy() {
    let mut config = test_config();
    config.num_ai = 3;
    config.food_targeting = FoodTargeting::NearestReachable;
    let game = Game::with_seed(config, 1);
    let ai_indices: Vec<usize> = game
        .snakes
        .iter()
        .enumerate()
        .filter(|(_, s)| !s.is_player)
        .map(|(i, _)| i)
        .collect();

    assert_eq!(game.snakes[ai_indices[0]].food_targeting, FoodTargeting::Nearest);
    assert_eq!(
        game.snakes[ai_indices[1]].food_targeting,
        FoodTargeting::NearestReachable,
        "the designated AI should carry the configured strategy"
    );
    assert_eq!(game.snakes[ai_indices[2]].food_targeting, FoodTargeting::Nearest);
}

#[test]
fn only_the_first_ai_gets_the_speed_seeking_behavior() {
    let mut config = test_config();
    config.num_ai = 3;
    let game = Game::with_seed(config, 1);
    let ai_indices: Vec<usize> = game
        .snakes
        .iter()
        .enumerate()
        .filter(|(_, s)| !s.is_player)
        .map(|(i, _)| i)
        .collect();

    assert_eq!(
        game.snakes[ai_indices[0]].ai_behavior,
        AiBehavior::SpeedSeeking,
        "the first AI should carry the speed-seeking movement behavior"
    );
    for &i in &ai_indices[1..] {
        assert_eq!(game.snakes[i].ai_behavior, AiBehavior::Default);
    }
}

#[test]
fn all_ai_speed_seeking_gives_every_ai_the_speed_seeking_behavior() {
    let mut config = test_config();
    config.num_ai = 4;
    config.all_ai_speed_seeking = true;
    let game = Game::with_seed(config, 1);

    for snake in game.snakes.iter().filter(|s| !s.is_player) {
        assert_eq!(snake.ai_behavior, AiBehavior::SpeedSeeking);
    }
}

#[test]
fn all_ai_speed_seeking_also_applies_to_wave_respawned_ai() {
    let mut config = test_config();
    config.num_ai = 2;
    config.wave_mode = true;
    config.all_ai_speed_seeking = true;
    let mut game = Game::with_seed(config, 1);

    for i in 0..game.snakes.len() {
        game.snakes[i].alive = false;
    }
    game.tick();

    assert!(game.snakes.len() > 2, "the wave should have respawned AI");
    for snake in game.snakes.iter().filter(|s| !s.is_player && s.alive) {
        assert_eq!(snake.ai_behavior, AiBehavior::SpeedSeeking);
    }
}

#[test]
fn speed_seeking_does_not_detour_to_the_edge_when_food_is_right_there() {
    // Regression guard: an earlier version gave the edge a flat bonus that
    // dominated regardless of cost, so the AI would detour to the wall
    // even when doing so moved it away from food that was immediately
    // reachable — using the wall for its own sake, not because it helped.
    let mut config = test_config();
    config.num_ai = 1;
    let mut game = Game::with_seed(config, 1);
    let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();
    game.snakes[ai].ai_behavior = AiBehavior::SpeedSeeking;

    // Head one cell off the west edge, body trailing south so Left (to the
    // edge) and Right (into open space) are both legal, safe candidates.
    game.snakes[ai].body = vec![(1, 20), (1, 21), (1, 22), (1, 23)];
    game.snakes[ai].direction = Direction::Up;
    // Food sits exactly where Right would land — reachable in one step
    // without ever detouring toward the edge at all.
    game.food = vec![(2, 20)];

    let scores = game.score_candidates(ai);
    let left = scores.iter().find(|c| c.direction == Direction::Left).unwrap();
    let right = scores.iter().find(|c| c.direction == Direction::Right).unwrap();

    assert!(
        right.desirability > left.desirability,
        "should prefer immediate food over a detour to the edge that doesn't help \
         (left={}, right={})",
        left.desirability,
        right.desirability
    );
}

#[test]
fn speed_seeking_prefers_a_boost_that_costs_no_extra_distance() {
    // When two candidates are equally far from food, the boost-eligible
    // one should win — it reaches food in less estimated time for the
    // same distance, no trade-off involved.
    let mut config = test_config();
    config.num_ai = 2;
    let mut game = Game::with_seed(config, 1);
    let ai_indices: Vec<usize> = game
        .snakes
        .iter()
        .enumerate()
        .filter(|(_, s)| !s.is_player)
        .map(|(i, _)| i)
        .collect();
    let ai = ai_indices[0];
    let ally = ai_indices[1];
    game.snakes[ai].ai_behavior = AiBehavior::SpeedSeeking;

    // Body runs south so Left and Right are both legal, safe candidates,
    // and both land exactly 21 cells (Manhattan) from the food straight
    // north — equidistant.
    game.snakes[ai].body = vec![(20, 20), (20, 21), (20, 22), (20, 23)];
    game.snakes[ai].direction = Direction::Down;
    game.food = vec![(20, 0)];
    // Within proximity_radius (3) of Right's landing cell (21, 20) but not
    // of Left's (19, 20) — distance 2 vs. 4.
    game.snakes[ally].body = vec![(23, 20)];

    let scores = game.score_candidates(ai);
    let left = scores.iter().find(|c| c.direction == Direction::Left).unwrap();
    let right = scores.iter().find(|c| c.direction == Direction::Right).unwrap();

    assert!(
        right.desirability > left.desirability,
        "equal food distance should let the boost-eligible candidate win \
         (left={}, right={})",
        left.desirability,
        right.desirability
    );
}

#[test]
fn most_ai_snakes_survive_a_long_run() {
    // Regression guard for the flood-fill lookahead in
    // choose_ai_direction: a naive greedy-to-food AI tends to trap
    // itself over time as snakes grow, so this asserts a healthy
    // majority of AI snakes are still alive after a long run, and
    // that survival has stabilized rather than trending toward zero.
    let mut config = test_config();
    config.width = 100;
    config.height = 80;
    config.num_ai = 8;
    let mut game = Game::with_seed(config, 1);

    let ai_alive_count =
        |g: &Game| g.snakes.iter().filter(|s| s.alive && !s.is_player).count();

    for _ in 0..150 {
        game.tick();
    }
    let mid_alive = ai_alive_count(&game);

    for _ in 0..150 {
        game.tick();
    }
    let end_alive = ai_alive_count(&game);

    assert!(
        end_alive >= 5,
        "expected most of 8 AI snakes to survive, got {end_alive}"
    );
    assert!(
        end_alive >= mid_alive,
        "AI survival should stabilize, not keep declining (mid={mid_alive}, end={end_alive})"
    );
}

#[test]
fn avoids_a_cell_the_enemy_could_move_into_next_tick() {
    let mut config = test_config();
    config.num_ai = 1;
    let mut game = Game::with_seed(config, 1);
    let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();
    let enemy = 1 - ai;

    game.snakes[ai].body = vec![(20, 20), (19, 20), (18, 20), (17, 20)];
    game.snakes[ai].direction = Direction::Right;

    // Enemy head at (20,18) moving Down can legally reach (20,19) next
    // tick (not a reversal) — exactly the AI's "Up" candidate, and
    // currently empty, so plain is_safe wouldn't flag it.
    game.snakes[enemy].body = vec![(20, 18), (20, 17), (20, 16), (20, 15)];
    game.snakes[enemy].direction = Direction::Down;
    game.food.clear();

    let d = game.choose_ai_direction(ai);
    assert_ne!(d, Direction::Up, "should avoid a cell the enemy could step into");
}

#[test]
fn score_candidates_explains_why_up_loses_not_just_that_it_does() {
    // Same scenario as `avoids_a_cell_the_enemy_could_move_into_next_tick`,
    // but asserting on the *reason* via `score_candidates` directly —
    // demonstrates the thing that test couldn't tell you: not just
    // that Up loses, but specifically because of the predicted-
    // collision check, not because of space or desirability.
    let mut config = test_config();
    config.num_ai = 1;
    let mut game = Game::with_seed(config, 1);
    let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();
    let enemy = 1 - ai;

    game.snakes[ai].body = vec![(20, 20), (19, 20), (18, 20), (17, 20)];
    game.snakes[ai].direction = Direction::Right;
    game.snakes[enemy].body = vec![(20, 18), (20, 17), (20, 16), (20, 15)];
    game.snakes[enemy].direction = Direction::Down;
    game.food.clear();

    let scores = game.score_candidates(ai);
    let up = scores
        .iter()
        .find(|c| c.direction == Direction::Up)
        .expect("Up should still be a legal (if bad) candidate");

    assert!(!up.not_predicted_collision, "Up should be flagged as enemy-reachable");
    assert!(up.has_room, "Up isn't losing on space — the pocket beyond it is wide open");
}

/// Same scenario as above, via `game_from_grid` — compare readability:
/// the picture directly shows the AI (B, facing right) about to have
/// its "Up" candidate cell (row above B's head) stepped into by the
/// enemy (A, facing down) next tick.
#[test]
fn avoids_a_cell_the_enemy_could_move_into_next_tick_via_grid() {
    let mut config = test_config();
    config.num_ai = 1;
    let game = game_from_grid(
        &[
            ".....b..",
            ".....b..",
            ".....b..",
            ".....A..",
            "........",
            "..bbbB..",
            "........",
        ],
        config,
    );
    let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();

    let d = game.choose_ai_direction(ai);
    assert_ne!(d, Direction::Up, "should avoid a cell the enemy could step into");
}

#[test]
fn drifts_toward_another_snake_when_nothing_else_favors_a_direction() {
    let mut config = test_config();
    config.num_ai = 1;
    let mut game = Game::with_seed(config, 1);
    let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();
    let other = 1 - ai;
    // This tests the default proximity-desirability heuristic specifically
    // — set explicitly rather than relying on which AI number spawn
    // assignment happens to give the default behavior to.
    game.snakes[ai].ai_behavior = AiBehavior::Default;

    game.snakes[ai].body = vec![(20, 20), (19, 20), (18, 20), (17, 20)];
    game.snakes[ai].direction = Direction::Right;

    // Far enough away that none of the AI's candidate cells are ones
    // the other snake could reach next tick — only the proximity pull
    // should be in play, not collision-avoidance.
    game.snakes[other].body = vec![(20, 30), (21, 30), (22, 30), (23, 30)];
    game.snakes[other].direction = Direction::Left;
    game.food.clear();

    let d = game.choose_ai_direction(ai);
    assert_eq!(
        d,
        Direction::Down,
        "with no food and equal safety, should drift toward the other snake"
    );
}

#[test]
fn lookahead_reveals_a_corridor_that_a_single_step_check_misses() {
    // A 26-cell dead-end corridor: the single-step flood-fill from
    // just inside the entrance reads as safe (margin for body_len=4 is
    // 24, and the corridor alone clears that), because the AI's own
    // body hasn't yet consumed enough of it to reveal the dead end.
    // Three more simulated steps forward — still "safe" at each
    // individual step — consume enough of the corridor that the
    // remaining reachable count drops below the margin. This is the
    // exact mechanism `lookahead_min_space` was added to catch;
    // asserting on it directly (rather than through the full
    // `choose_ai_direction` ranking, which has other tie-breaking
    // signals that can mask this) is the precise regression check.
    let mut config = Config::default();
    config.num_ai = 1;
    config.width = 36;
    config.height = 6;
    let game = game_from_grid(
        &[
            "....................................",
            "........Aaaaaaaaaaaaaaaaaaaaaaaaaaa.",
            "....bbbB..........................a.",
            "........aaaaaaaaaaaaaaaaaaaaaaaaaaa.",
            "....................................",
            "....................................",
        ],
        config,
    );
    let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();
    let margin = 24;

    let head = game.snakes[ai].body[0];
    let direction = game.snakes[ai].direction; // Right, into the corridor
    let (dx, dy) = direction.delta();
    let next = (head.0 + dx, head.1 + dy);
    let sim_body = {
        let mut b = game.snakes[ai].body.clone();
        b.insert(0, next);
        b.pop();
        b
    };

    let depth0 = game.flood_fill_space_for_body(next, ai, &sim_body, margin);
    let lookahead = game.lookahead_min_space(ai, sim_body, direction, margin);

    assert!(
        depth0 >= margin,
        "the bug this guards against: a single-step check reads the corridor as safe (got {depth0})"
    );
    assert!(
        lookahead < margin,
        "the lookahead should reveal the corridor seals a few steps in (got {lookahead})"
    );
}

/// Diagnostic, not a regression test: runs the real `tick()` against
/// many seeds and tallies death causes, to check whether AI density /
/// world size is producing an excessive OtherCollision rate. Run with
/// `cargo test diagnose_ai_other_collisions -- --ignored --nocapture`.
#[test]
#[ignore]
fn diagnose_ai_other_collisions() {
    let config = Config::default();
    let mut death_tally: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut ticks_survived: Vec<u32> = Vec::new();

    for seed in 0..80u64 {
        let mut game = Game::with_seed(config, seed * 7919 + 13);
        let mut alive_prev = vec![true; game.snakes.len()];
        for t in 0..3000u32 {
            if game.snakes.iter().all(|s| !s.alive) {
                break;
            }
            game.tick();
            for i in 0..game.snakes.len() {
                if alive_prev[i] && !game.snakes[i].alive {
                    alive_prev[i] = false;
                    ticks_survived.push(t);
                    let cause = game.snakes[i].death_cause.unwrap();
                    *death_tally.entry(format!("{cause:?}")).or_insert(0) += 1;
                }
            }
        }
    }

    let avg_survival =
        ticks_survived.iter().sum::<u32>() as f64 / ticks_survived.len().max(1) as f64;
    eprintln!(
        "config: {}x{} world, {} AI",
        config.width, config.height, config.num_ai
    );
    eprintln!("death tally across 80 seeded games: {death_tally:?}");
    eprintln!("average ticks survived per snake: {avg_survival:.0}");
}

#[test]
fn wave_mode_starts_with_the_configured_num_ai_as_wave_size() {
    let mut config = test_config();
    config.num_ai = 3;
    config.wave_mode = true;
    let game = Game::with_seed(config, 1);
    assert_eq!(game.snakes.len(), 4);
    assert_eq!(game.current_wave_size, 3);
}

#[test]
fn wave_mode_off_never_spawns_additional_ai_when_the_only_ai_dies() {
    let mut config = test_config();
    config.num_ai = 1;
    config.wave_mode = false;
    let mut game = Game::with_seed(config, 1);
    let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();
    game.snakes[ai].alive = false;
    let count_before = game.snakes.len();

    game.tick();

    assert_eq!(game.snakes.len(), count_before);
}

#[test]
fn wave_clears_spawn_the_next_wave_with_one_more_enemy() {
    let mut config = test_config();
    config.num_ai = 2;
    config.wave_mode = true;
    let mut game = Game::with_seed(config, 1);
    assert_eq!(game.current_wave_size, 2);

    for i in 0..game.snakes.len() {
        if !game.snakes[i].is_player {
            game.snakes[i].alive = false;
        }
    }
    game.tick();
    assert_eq!(game.current_wave_size, 3);
    assert_eq!(
        game.snakes.iter().filter(|s| !s.is_player && s.alive).count(),
        3
    );

    for i in 0..game.snakes.len() {
        if !game.snakes[i].is_player {
            game.snakes[i].alive = false;
        }
    }
    game.tick();
    assert_eq!(game.current_wave_size, 4);
    assert_eq!(
        game.snakes.iter().filter(|s| !s.is_player && s.alive).count(),
        4
    );
}

#[test]
fn wave_escalation_is_capped_at_the_maximum_wave_size() {
    let mut config = test_config();
    config.num_ai = 1;
    config.wave_mode = true;
    let mut game = Game::with_seed(config, 1);

    for _ in 0..(MAX_WAVE_ENEMIES + 3) {
        for i in 0..game.snakes.len() {
            if !game.snakes[i].is_player {
                game.snakes[i].alive = false;
            }
        }
        game.tick();
        assert!(game.current_wave_size <= MAX_WAVE_ENEMIES);
    }
    assert_eq!(game.current_wave_size, MAX_WAVE_ENEMIES);
}

#[test]
fn wave_cap_never_drops_below_a_larger_configured_starting_num_ai() {
    let mut config = test_config();
    // Deliberately above MAX_WAVE_ENEMIES, and within test_config's
    // height=50 lane capacity (46), so sanitize() doesn't trim it either.
    config.num_ai = MAX_WAVE_ENEMIES + 8;
    config.wave_mode = true;
    let mut game = Game::with_seed(config, 1);
    assert_eq!(game.current_wave_size, config.num_ai);

    // The cap (MAX_WAVE_ENEMIES.max(num_ai)) coincides with the starting
    // size here, so there's no headroom left to climb — a clear holds
    // steady at the same size rather than dropping below it or growing
    // past it.
    for i in 0..game.snakes.len() {
        if !game.snakes[i].is_player {
            game.snakes[i].alive = false;
        }
    }
    game.tick();

    assert_eq!(game.current_wave_size, config.num_ai);
    assert_eq!(
        game.snakes.iter().filter(|s| !s.is_player && s.alive).count() as u32,
        config.num_ai
    );
}

#[test]
fn dying_ai_converts_every_second_body_segment_to_food_one_based() {
    let mut config = test_config();
    config.num_ai = 1;
    let mut game = Game::with_seed(config, 1);
    let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();

    // 8-long body heading right, head at the last in-bounds column — the
    // next step_one call walks it straight into the east wall.
    let body: Vec<(i32, i32)> = (0..8).map(|i| (49 - i, 10)).collect();
    game.snakes[ai].body = body.clone();
    game.snakes[ai].direction = Direction::Right;
    game.food.clear();

    game.step_one(ai);

    assert!(!game.snakes[ai].alive);
    assert!(matches!(game.snakes[ai].death_cause, Some(DeathCause::Wall)));
    assert_eq!(game.food.len(), 4);
    assert!(game.food.contains(&body[1]));
    assert!(game.food.contains(&body[3]));
    assert!(game.food.contains(&body[5]));
    assert!(game.food.contains(&body[7]));
}

#[test]
fn dying_ai_with_a_short_body_converts_only_the_segments_that_exist() {
    let mut config = test_config();
    config.num_ai = 1;
    let mut game = Game::with_seed(config, 1);
    let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();

    // 5-long (odd) body — index 5 would be the next drop but doesn't exist,
    // so this proves the conversion stops rather than panicking.
    let body: Vec<(i32, i32)> = (0..5).map(|i| (49 - i, 10)).collect();
    game.snakes[ai].body = body.clone();
    game.snakes[ai].direction = Direction::Right;
    game.food.clear();

    game.step_one(ai);

    assert!(!game.snakes[ai].alive);
    assert_eq!(game.food.len(), 2);
    assert!(game.food.contains(&body[1]));
    assert!(game.food.contains(&body[3]));
}

#[test]
fn dying_ai_in_spectator_mode_converts_every_body_segment_to_food() {
    let mut config = test_config();
    config.num_ai = 1;
    config.spectator_mode = true;
    let mut game = Game::with_seed(config, 1);
    let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();

    let body: Vec<(i32, i32)> = (0..8).map(|i| (49 - i, 10)).collect();
    game.snakes[ai].body = body.clone();
    game.snakes[ai].direction = Direction::Right;
    game.food.clear();

    game.step_one(ai);

    assert!(!game.snakes[ai].alive);
    assert_eq!(game.food.len(), 7);
    for segment in &body[1..] {
        assert!(game.food.contains(segment));
    }
}

#[test]
fn player_death_does_not_convert_body_segments_to_food() {
    let config = test_config();
    let mut game = Game::with_seed(config, 1);
    let player = game.player_index().unwrap();

    let body: Vec<(i32, i32)> = (0..8).map(|i| (49 - i, 10)).collect();
    game.snakes[player].body = body;
    game.snakes[player].direction = Direction::Right;
    game.food.clear();

    game.step_one(player);

    assert!(!game.snakes[player].alive);
    assert_eq!(game.food.len(), 0);
}

#[test]
fn vanquish_score_awards_the_configured_percent_of_the_vanquished_enemys_score() {
    let mut config = test_config();
    config.num_ai = 1;
    config.vanquish_score_percent = 100;
    let mut game = Game::with_seed(config, 1);
    let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();
    let player = game.player_index().unwrap();

    let body: Vec<(i32, i32)> = (0..8).map(|i| (49 - i, 10)).collect();
    game.snakes[ai].body = body;
    game.snakes[ai].direction = Direction::Right;
    game.snakes[ai].score = 42; // deliberately unrelated to body length (8)
    let score_before = game.score;

    game.step_one(ai);

    assert!(!game.snakes[ai].alive);
    assert_eq!(game.score, score_before + 42);
    assert_eq!(game.snakes[player].score, 42);
}

#[test]
fn vanquish_score_awards_a_partial_percentage() {
    let mut config = test_config();
    config.num_ai = 1;
    config.vanquish_score_percent = 50;
    let mut game = Game::with_seed(config, 1);
    let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();
    let player = game.player_index().unwrap();

    let body: Vec<(i32, i32)> = (0..8).map(|i| (49 - i, 10)).collect();
    game.snakes[ai].body = body;
    game.snakes[ai].direction = Direction::Right;
    game.snakes[ai].score = 42;
    let score_before = game.score;

    game.step_one(ai);

    assert_eq!(game.score, score_before + 21);
    assert_eq!(game.snakes[player].score, 21);
}

#[test]
fn vanquish_score_percent_zero_awards_nothing() {
    let mut config = test_config();
    config.num_ai = 1;
    config.vanquish_score_percent = 0;
    let mut game = Game::with_seed(config, 1);
    let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();

    let body: Vec<(i32, i32)> = (0..8).map(|i| (49 - i, 10)).collect();
    game.snakes[ai].body = body;
    game.snakes[ai].direction = Direction::Right;
    game.snakes[ai].score = 42;
    let score_before = game.score;

    game.step_one(ai);

    assert_eq!(game.score, score_before);
}

#[test]
fn vanquish_score_does_not_award_for_player_death() {
    let mut config = test_config();
    config.vanquish_score_percent = 100;
    let mut game = Game::with_seed(config, 1);
    let player = game.player_index().unwrap();

    let body: Vec<(i32, i32)> = (0..8).map(|i| (49 - i, 10)).collect();
    game.snakes[player].body = body;
    game.snakes[player].direction = Direction::Right;
    let score_before = game.score;

    game.step_one(player);

    assert_eq!(game.score, score_before);
}

#[test]
fn vanquish_score_reflects_score_the_enemy_actually_earned_through_play() {
    // Unlike the hand-set-score tests above, this drives the AI's score up
    // through the real tick()/eating pipeline, not a direct field write —
    // closes the gap between "the transfer mechanism works" and "it works
    // with score accumulated the way a real game actually produces it".
    let mut config = test_config();
    config.num_ai = 1;
    config.vanquish_score_percent = 100;
    let mut game = Game::with_seed(config, 1);
    let ai = game.snakes.iter().position(|s| !s.is_player).unwrap();

    for _ in 0..3 {
        let head = game.snakes[ai].body[0];
        let (dx, dy) = game.snakes[ai].direction.delta();
        let next = (head.0 + dx, head.1 + dy);
        game.food = vec![next];
        game.tick();
    }
    assert_eq!(game.snakes[ai].score, 30);

    game.snakes[ai].body = vec![(49, 10), (48, 10), (47, 10), (46, 10)];
    game.snakes[ai].direction = Direction::Right;
    let score_before = game.score;

    game.step_one(ai);

    assert!(!game.snakes[ai].alive);
    assert_eq!(game.score, score_before + 30);
    assert_eq!(game.snakes[game.player_index().unwrap()].score, 30);
}

#[test]
fn spectator_mode_spawns_no_player() {
    let mut config = test_config();
    config.num_ai = 5;
    config.spectator_mode = true;
    let game = Game::with_seed(config, 1);

    assert_eq!(game.snakes.len(), 5);
    assert!(game.snakes.iter().all(|s| !s.is_player));
    assert_eq!(game.player_index(), None);
    for snake in &game.snakes {
        assert_eq!(snake.body.len(), STARTING_LENGTH);
        assert!(snake.alive);
    }
}

#[test]
fn spectator_mode_never_ends_even_when_every_ai_is_dead() {
    let mut config = test_config();
    config.num_ai = 3;
    config.spectator_mode = true;
    let mut game = Game::with_seed(config, 1);

    for snake in &mut game.snakes {
        snake.alive = false;
    }
    game.tick();

    assert!(!game.game_over);
}

#[test]
fn spectator_mode_composes_with_wave_mode() {
    let mut config = test_config();
    config.num_ai = 2;
    config.spectator_mode = true;
    config.wave_mode = true;
    let mut game = Game::with_seed(config, 1);
    assert_eq!(game.current_wave_size, 2);

    for i in 0..game.snakes.len() {
        game.snakes[i].alive = false;
    }
    game.tick();

    assert!(!game.game_over);
    assert_eq!(game.current_wave_size, 3);
    assert_eq!(game.snakes.iter().filter(|s| s.alive).count(), 3);
}
