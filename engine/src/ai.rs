use std::collections::{HashSet, VecDeque};

use crate::config::FoodTargeting;
use crate::direction::Direction;
use crate::game::Game;
use crate::snake::CandidateScore;
use crate::{AI_LOOKAHEAD_STEPS, PROXIMITY_SEEK_DIVISOR};

impl Game {
    /// Like `is_safe`, but obstacle-checks a hypothetical body for
    /// `moving_index` instead of its real one — used by the lookahead
    /// below to simulate the snake a few steps ahead of where it actually
    /// is. Always assumes the simulated tail vacates (no growth mid-
    /// simulation; food is sparse enough that this rarely matters for a
    /// few-step horizon).
    fn is_safe_for_body(&self, pos: (i32, i32), moving_index: usize, moving_body: &[(i32, i32)]) -> bool {
        if !self.in_bounds(pos) {
            return false;
        }
        for (i, snake) in self.snakes.iter().enumerate() {
            if i == moving_index || !snake.alive {
                continue;
            }
            if snake.body.contains(&pos) {
                return false;
            }
        }
        let len = moving_body.len();
        moving_body.iter().enumerate().all(|(j, seg)| j == len - 1 || *seg != pos)
    }

    /// Like `flood_fill_space`, but against a hypothetical body — see
    /// `is_safe_for_body`.
    pub(crate) fn flood_fill_space_for_body(
        &self,
        start: (i32, i32),
        moving_index: usize,
        moving_body: &[(i32, i32)],
        cap: i32,
    ) -> i32 {
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
                if visited.contains(&next) || !self.is_safe_for_body(next, moving_index, moving_body) {
                    continue;
                }
                visited.insert(next);
                queue.push_back(next);
            }
        }

        count
    }

    /// Extends the one-shot flood-fill with a few simulated greedy steps:
    /// starting from `body` (the hypothetical body after taking the
    /// candidate move already under consideration) and `direction`, keep
    /// greedily heading whichever safe way leaves the most space for a few
    /// more steps, and return the SMALLEST space seen along that path —
    /// not just the first step's. A candidate that looks open right now
    /// but narrows into a dead end a few moves later (the classic self-
    /// entanglement failure) scores lower than one that stays open the
    /// whole time; a single flood-fill snapshot can't tell them apart.
    pub(crate) fn lookahead_min_space(
        &self,
        moving_index: usize,
        mut body: Vec<(i32, i32)>,
        mut direction: Direction,
        cap: i32,
    ) -> i32 {
        let mut min_space = self.flood_fill_space_for_body(body[0], moving_index, &body, cap);
        for _ in 0..AI_LOOKAHEAD_STEPS {
            if min_space == 0 {
                break;
            }
            let head = body[0];
            let mut best: Option<(Direction, (i32, i32), i32)> = None;
            for d in Direction::all() {
                if d == direction.opposite() {
                    continue;
                }
                let (dx, dy) = d.delta();
                let next = (head.0 + dx, head.1 + dy);
                if !self.is_safe_for_body(next, moving_index, &body) {
                    continue;
                }
                let space = self.flood_fill_space_for_body(next, moving_index, &body, cap);
                if best.map(|(_, _, s)| space > s).unwrap_or(true) {
                    best = Some((d, next, space));
                }
            }
            match best {
                Some((d, next, space)) => {
                    direction = d;
                    body.insert(0, next);
                    body.pop();
                    min_space = min_space.min(space);
                }
                None => min_space = 0,
            }
        }
        min_space
    }

    fn nearest_food(&self, from: (i32, i32)) -> Option<(i32, i32)> {
        self.food
            .iter()
            .copied()
            .min_by_key(|f| (f.0 - from.0).abs() + (f.1 - from.1).abs())
    }

    /// Every cell reachable from `start` without crossing any snake's body
    /// — `moving_index`'s own tail counts as vacated, matching `is_safe`.
    /// Uncapped (bounded only by the board), so it's a true reachability
    /// set, not just a lower-bound sample the way `flood_fill_space_for_body`
    /// is (that one stops early at a safety-margin cap since it only needs
    /// "enough" space, not the exact set).
    fn reachable_cells(&self, start: (i32, i32), moving_index: usize) -> HashSet<(i32, i32)> {
        let mut visited: HashSet<(i32, i32)> = HashSet::new();
        let mut queue: VecDeque<(i32, i32)> = VecDeque::new();
        visited.insert(start);
        queue.push_back(start);
        while let Some(pos) = queue.pop_front() {
            for d in Direction::all() {
                let (dx, dy) = d.delta();
                let next = (pos.0 + dx, pos.1 + dy);
                if !visited.contains(&next) && self.is_safe(next, moving_index) {
                    visited.insert(next);
                    queue.push_back(next);
                }
            }
        }
        visited
    }

    /// Nearest food that's actually reachable from `from` right now — food
    /// behind a blocking snake body doesn't count until the way opens up.
    fn nearest_reachable_food(&self, from: (i32, i32), moving_index: usize) -> Option<(i32, i32)> {
        let reachable = self.reachable_cells(from, moving_index);
        self.food
            .iter()
            .copied()
            .filter(|f| reachable.contains(f))
            .min_by_key(|f| (f.0 - from.0).abs() + (f.1 - from.1).abs())
    }

    /// Dispatches to whichever pure targeting function `Config::food_targeting`
    /// selects. Adding a strategy is: add a `FoodTargeting` variant, add a
    /// function above, add a match arm here.
    pub(crate) fn select_food_target(&self, from: (i32, i32), moving_index: usize) -> Option<(i32, i32)> {
        match self.snakes[moving_index].food_targeting {
            FoodTargeting::Nearest => self.nearest_food(from),
            FoodTargeting::NearestReachable => self.nearest_reachable_food(from, moving_index),
        }
    }

    /// Nearest occupied cell belonging to any other living snake — used to
    /// give AI a mild pull toward other snakes (for the proximity boost),
    /// the same way `nearest_food` pulls it toward food.
    fn nearest_other_position(&self, moving_index: usize, from: (i32, i32)) -> Option<(i32, i32)> {
        self.snakes
            .iter()
            .enumerate()
            .filter(|(i, s)| *i != moving_index && s.alive)
            .flat_map(|(_, s)| s.body.iter().copied())
            .min_by_key(|p| (p.0 - from.0).abs() + (p.1 - from.1).abs())
    }

    /// Cells another living snake's head could legally occupy next tick
    /// (any direction except its own reverse, since no snake can turn back
    /// on itself). This is inferred purely from each snake's *current*,
    /// publicly visible position and heading — the same information a
    /// human player has by looking at the board — not from any hidden
    /// intent, so it doesn't count as AI-to-AI coordination.
    fn enemy_reachable_cells(&self, moving_index: usize) -> HashSet<(i32, i32)> {
        let mut cells = HashSet::new();
        for (i, snake) in self.snakes.iter().enumerate() {
            if i == moving_index || !snake.alive {
                continue;
            }
            let head = snake.body[0];
            for d in Direction::all() {
                if d == snake.direction.opposite() {
                    continue;
                }
                let (dx, dy) = d.delta();
                cells.insert((head.0 + dx, head.1 + dy));
            }
        }
        cells
    }

    /// Scores every legal candidate direction for `index` — legal meaning
    /// not an immediate reversal and not immediately unsafe. Pure: reads
    /// game state, mutates nothing, so tests can call it directly and
    /// inspect *why* a candidate did or didn't win, not just observe the
    /// final choice through `choose_ai_direction`. That distinction matters
    /// in practice — a test that only checks the final direction can pass
    /// for the wrong reason (e.g. an accidental tie-break) without
    /// actually exercising the signal it's meant to verify.
    ///
    /// Priority order, encoded in `CandidateScore::key`: (1) enough open
    /// space to not trap itself, (2) not stepping somewhere another
    /// snake's head could legally move to next tick, (3) more open space
    /// generally, (4) a blend of "closer to food" and "closer to another
    /// snake" (for the proximity boost) — food-seeking dominates but
    /// proximity nudges ties, since it's a secondary goal.
    pub(crate) fn score_candidates(&self, index: usize) -> Vec<CandidateScore> {
        let snake = &self.snakes[index];
        let head = snake.body[0];
        let current = snake.direction;
        let body_len = snake.body.len() as i32;
        let food_target = self.select_food_target(head, index);
        let other_target = self.nearest_other_position(index, head);
        // A pocket only exactly as big as the snake is already a trap: by
        // the time it's fully entered, there's nowhere left to go, and the
        // snake has likely grown since this decision anyway. Require
        // several times the body length as breathing room, not just enough
        // to physically fit.
        let safety_margin = (body_len * 3).clamp(24, 150);
        let enemy_cells = self.enemy_reachable_cells(index);

        Direction::all()
            .into_iter()
            .filter(|d| *d != current.opposite())
            .filter_map(|d| {
                let (dx, dy) = d.delta();
                let next = (head.0 + dx, head.1 + dy);
                if !self.is_safe(next, index) {
                    return None;
                }
                let sim_body = {
                    let mut b = snake.body.clone();
                    b.insert(0, next);
                    b.pop();
                    b
                };
                let space = self.lookahead_min_space(index, sim_body, d, safety_margin);
                let has_room = space >= safety_margin;
                let not_predicted_collision = !enemy_cells.contains(&next);
                let food_dist = food_target
                    .map(|t| -((next.0 - t.0).abs() + (next.1 - t.1).abs()))
                    .unwrap_or(0);
                // Capped at proximity_radius: once already close enough to
                // be boosted, closing the distance further buys nothing
                // (the boost is binary), so there's no reason to keep
                // pulling the AI toward an actual collision.
                let other_dist = other_target
                    .map(|t| {
                        let d = (next.0 - t.0).abs() + (next.1 - t.1).abs();
                        -d.max(self.config.proximity_radius)
                    })
                    .unwrap_or(0);
                // Scale food_dist up rather than divide other_dist down —
                // same weighting ratio, but avoids integer division
                // truncating two different other_dist values to one tied
                // score.
                let desirability = food_dist * PROXIMITY_SEEK_DIVISOR + other_dist;
                Some(CandidateScore {
                    direction: d,
                    has_room,
                    not_predicted_collision,
                    space,
                    desirability,
                })
            })
            .collect()
    }

    /// Picks a direction using a survival-first heuristic — see
    /// `score_candidates` for the actual reasoning. This is just the
    /// reduction: highest-scoring candidate wins; if nothing was even
    /// legal, keep heading and let collision resolution kill it.
    pub(crate) fn choose_ai_direction(&self, index: usize) -> Direction {
        let mut best: Option<CandidateScore> = None;
        for candidate in self.score_candidates(index) {
            if best.map(|b| candidate.key() > b.key()).unwrap_or(true) {
                best = Some(candidate);
            }
        }
        best.map(|c| c.direction)
            .unwrap_or(self.snakes[index].direction)
    }
}
