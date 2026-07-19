# fun-wasm-game

Multiplayer Snake: a human-controlled snake plus several AI snakes, rendered
in a Next.js app via a Rust game engine compiled to WebAssembly.

## Layout

- `engine/src/` — Rust engine, split by responsibility (all with `pub(crate)`
  visibility across files; `mod tests`/`test_support` are `#[cfg(test)]`):
  - `config.rs` — `Config`, `FoodTargeting`
  - `direction.rs` — `Direction`
  - `snake.rs` — `Snake`, `SnakeState`, `DeathCause`, `CandidateScore`, `GameState`
  - `game.rs` — `Game` struct, spawn/movement/tick, the `#[wasm_bindgen]` API
  - `ai.rs` — all AI decision logic (`score_candidates`, `choose_ai_direction`, flood-fill)
  - `test_support.rs` / `tests.rs` — `game_from_grid`, `render_ascii`, all tests
  - `lib.rs` — just `mod` decls, shared constants, re-exports
- `web/src/`
  - `components/GameCanvas.tsx` — game loop, canvas rendering, keyboard +
    gamepad input
  - `components/ConfigPanel.tsx` + `lib/gameConfig.ts` — settings UI (native
    HTML5 validation) and named difficulty presets
  - `tests/game.spec.ts` — Playwright E2E, no fixed timeouts

## Run it

```
cd web
npm install
npm run dev            # predev runs wasm:build automatically
npm run dev:restart    # kills whatever's on :3000, restarts, waits for it to answer
npm run test:e2e       # first run: npm run test:e2e:install
```

`cargo test` in `engine/` is native and fast for iterating on game logic;
`npm run wasm:build` (or `npm run dev` via `predev`) rebuilds the wasm the
browser actually loads.

## Current state

- Player + configurable AI count. Every AI uses greedy nearest-food +
  flood-fill/lookahead safety + no-AI-coordination avoidance; the *first* AI
  spawned can instead use reachability-aware targeting
  (`FoodTargeting::NearestReachable`, ignores food it can't currently path
  to), toggled via `Config.food_targeting` / the settings panel.
- Speed: AI baseline 1.0, player baseline `player_speed` (config). Boost
  (proximity, food, or being on the arena's edge ring) multiplies current
  speed for both.
- Per-snake score (not just the player's); UI shows player score + top-5 AI
  leaderboard as a canvas overlay (top-right).
- 3 presets (Duel/Balanced/Chaos Arena), cycled via a "Switch Level" button
  below the canvas; settings panel stays in sync with whichever is active.
- Input: keyboard (buffered, up to 3 queued turns) and gamepad D-Pad
  (polled per animation frame, standard button indices 12-15 + stick
  fallback).
- Settings panel is a real `<form>`: `required` + `min`/`max` on every
  numeric field, native browser validation blocks "Apply" until valid.

26 Rust tests (1 `#[ignore]`d diagnostic), 3 Playwright E2E, `tsc` and
`eslint` clean.

## Testing AI logic in specific setups

- `game_from_grid(rows, config)` — builds a `Game` from an ASCII picture.
  `.` empty, `*` food, uppercase = head, lowercase = body (direction
  inferred from head/neck adjacency). `A` = player, `B`/`C`/... = AI in
  order of appearance.
- `game.render_ascii(min, max)` — reverse: prints a live `Game` window in
  the same notation (dead snakes' bodies included). Run with
  `cargo test <name> -- --nocapture` to see it.
- `diagnose_ai_other_collisions` (ignored by default) — seeded stress run
  tallying death causes; `cargo test diagnose_ai_other_collisions --
  --ignored --nocapture`.

## Known limitation: AI self-entanglement

Greedy flood-fill + a short lookahead (`lookahead_min_space`, in `ai.rs`)
catches traps that seal a few steps ahead, but not a slow multi-move spiral
that develops over 20+ otherwise-reasonable moves — no snapshot-based
heuristic can see that far. A real fix needs path planning (Hamiltonian
cycle considered and rejected: too rigid to be fun against, and a "shortcut
when safe" hybrid for multiple moving snakes is a much bigger undertaking
than this heuristic). Aggregate AI survival is still healthy in stress
tests; this is an accepted, documented gap, not a bug.

## Non-obvious design points

- **Interpolation** (`GameCanvas.tsx`): lerp each segment prev-tick →
  curr-tick over the real tick interval. Don't extrapolate from current
  `direction` — a queued turn doesn't commit until its tick, so
  extrapolating points the wrong way for a frame and jumps on every turn.
- **Growth animation**: engine grows by inserting a head and skipping the
  tail pop. Frontend must special-case a length delta — only the new head
  segment animates; everything else already sits at its correct position.
- **AI pathing**: `score_candidates` is a pure function returning every
  candidate's full verdict (room/predicted-collision/space/desirability);
  `choose_ai_direction` just reduces it. Tests can assert *why* a candidate
  lost, not just which one won. `lookahead_min_space` simulates a few more
  greedy steps past the immediate move — a single flood-fill snapshot can't
  tell "open now" from "closes in 3 moves." AI never coordinates (no cell
  reservation), but does avoid cells an enemy head could legally reach next
  tick (public info only) and gets a mild capped pull toward other snakes.
- **Spawn lanes**: lane spacing scales with total snake count — a
  fixed-divisor version collided once AI count grew.
- **Dev server restarts**: always `npm run dev:restart`, never manual
  `lsof|kill` — compound shell commands can't be allowlisted piecemeal.

## Possible next steps

- AI self-entanglement — needs real path-planning, not heuristic tuning.
- No persistence (config/scores reset on reload).
- No touch input.
