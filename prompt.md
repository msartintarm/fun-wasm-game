# Context for a new session

This repo has grown well past its original spec (below). **`README.md` is
the current, authoritative architecture/state reference — read that first,
not this file.**

## Before you start

- `.claude/settings.json` already allowlists autonomous npm/cargo/rustc/
  wasm-pack/etc. — no need to rebuild it.
- Check `~/.claude/projects/-home-mst-Projects-gamez-fun-wasm-game/memory/`
  (`MEMORY.md` is the index) for standing feedback from past sessions
  before making changes — e.g. use `Edit`, never `cat >>`; never
  `rm -rf .next`; stop after ~2 timeouts on a slow/hanging test instead of
  retrying it.
- `npm run test:e2e` (Playwright) has been unreliable in this environment
  since Tone.js was added — hangs past 120s with no output. Don't loop
  retrying it; verify with `tsc`/`eslint`/`cargo test`/`npm run test:unit`
  instead and say so if E2E coverage is genuinely needed.

## Original spec (superseded by everything in README.md — kept for history only)

Multiplayer Snake, Next.js + Rust/WASM. Human controls one snake, AI
controls the rest. Proximity to other snakes grants a speed boost and more
points. Player moves relatively slowly; the play space is large; the camera
scrolls with the player; movement between grid cells should animate
smoothly.
