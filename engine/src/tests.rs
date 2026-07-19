use std::collections::HashSet;

use crate::config::{Config, FoodTargeting};
use crate::direction::Direction;
use crate::game::Game;
use crate::snake::DeathCause;
use crate::test_support::game_from_grid;
use crate::{MAX_QUEUED_DIRECTIONS, PROXIMITY_TICK_BONUS, STARTING_LENGTH};

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
    config.food_targeting = FoodTargeting::NearestReachable;
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
fn only_the_first_ai_gets_the_configured_food_targeting_strategy() {
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

    assert_eq!(
        game.snakes[ai_indices[0]].food_targeting,
        FoodTargeting::NearestReachable,
        "the designated AI should carry the configured strategy"
    );
    for &i in &ai_indices[1..] {
        assert_eq!(
            game.snakes[i].food_targeting,
            FoodTargeting::Nearest,
            "every other AI should keep the original distance-only targeting"
        );
    }
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
