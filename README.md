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
  - `lib/audio/` + `hooks/useAudioEngine.ts` — looping background tracks +
    chord-synced pickup notes, behind a swappable `AudioEngine` interface
    (see Non-obvious design points)
  - `tests/game.spec.ts` — Playwright E2E, no fixed timeouts; `src/lib/audio/*.test.ts` — Vitest unit tests (`npm run test:unit`)

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
  flood-fill/lookahead safety + no-AI-coordination avoidance. Two AI get a
  non-default behavior, always by spawn order regardless of config: AI
  Snake 1 (😈) uses `AiBehavior::SpeedSeeking` — picks candidates by
  estimated *time* to food (`distance / speed`), so a boost only wins if it
  actually gets there faster, not just because it's a boost. AI Snake 2
  (🐱) can use reachability-aware food targeting
  (`FoodTargeting::NearestReachable`, ignores food it can't currently path
  to), toggled via `Config.food_targeting` / the settings panel.
- Speed: AI baseline 1.0, player baseline `player_speed` (config). Boost
  (proximity, food, or being on the arena's edge ring) multiplies current
  speed for both — edge boost is speed-only, never scores points.
- Per-snake score (not just the player's); UI shows player score + top-5 AI
  leaderboard as a canvas overlay (top-right).
- 3 presets (Chaos Arena/Duel/Balanced), cycled via a "Switch Level" button
  below the canvas; Chaos Arena is default; settings panel stays in sync
  with whichever is active.
- Input: keyboard (buffered, up to 3 queued turns) and gamepad D-Pad
  (polled per animation frame, standard button indices 12-15 + stick
  fallback).
- Settings panel is a real `<form>`: `required` + `min`/`max` on every
  numeric field, native browser validation blocks "Apply" until valid.
- Looping background music per level (random pick among that level's
  tracks) + a piano note on pickup, chosen from whatever chord is active in
  a hand-authored chord timeline at that moment. MIDI-based for now (Tone.js
  + @tonejs/midi) behind a swappable interface; one placeholder track
  (`rock-drums-bass`) is wired in — see Possible next steps for more.

28 Rust tests (1 `#[ignore]`d diagnostic), 4 Playwright E2E, 16 Vitest unit
tests, `tsc` and `eslint` clean. **`npm run test:e2e` has been unreliable in
this dev environment since Tone.js was added** — hangs past 120s with no
output rather than failing outright. Don't loop retrying it; verify with
`tsc`/`eslint`/`cargo test`/`npm run test:unit` and flag the gap instead.

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
- **Audio**: `GameCanvas` only ever calls `useAudioEngine()`'s four methods
  (`armAutoplay`/`startTrack`/`stopTrack`/`triggerPickup`) — never MIDI,
  chords, or Tone.js directly. `lib/audio/audioEngine.ts` is the swap
  boundary; `midiEngine.ts` (today's implementation) is dynamically
  imported, same pattern as the wasm engine load. Chord-at-time-T is a pure
  function over hand-authored `ChordTimeline` data, not derived from the
  MIDI file's actual notes — keep `ChordTimeline.bpm`/`loopLengthBars` in
  sync with each track's real tempo/length by hand; nothing checks that for
  you. `getAudioEngine()` never throws — any load/playback failure falls
  back to a silent no-op engine, so the game is always fully playable.
- **`E2E_DEBUG`**: server-side-only flag (`lib/env.ts`, gated on
  `NODE_ENV !== "production"` too) that exposes `window.__testHooks` for
  Playwright to read canvas-only render state (emoji theme, boosted, color)
  that has no natural DOM representation. Only set by
  `playwright.config.ts`'s `webServer.env` — never a developer's own
  `npm run dev`.

## Possible next steps

- AI self-entanglement — needs real path-planning, not heuristic tuning.
- No persistence (config/scores reset on reload).
- No touch input.
- One track (`rock-drums-bass`, 100 BPM, drums + a bass line playing
  C/D/E/F over its 4 bars) is wired into every preset — same track for now,
  since it's the only one. `scripts/generate-midi-assets.mjs` (rerunnable)
  also wrote 12 single-chord piano MIDI files to `public/audio/chords/`
  (one major triad per key), not currently wired into gameplay. More
  distinct per-level tracks would need more assets + matching
  `ChordTimeline`s in `lib/audio/tracks.ts`.
- Eventual Web Audio API rewrite (replace `midiEngine.ts`, same interface).
