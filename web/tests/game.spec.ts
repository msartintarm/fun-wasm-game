import { test, expect, type Page } from "@playwright/test";

// This game is driven by real randomness (AI targeting, food placement) and
// a live requestAnimationFrame loop, so pixel-diff screenshot regression
// would be inherently flaky here — a passing run and a failing run can look
// nearly identical while differing by a few animated pixels. Instead these
// tests assert on the things that actually indicate a regression (the wasm
// engine loads, the canvas renders, input is handled, game-over/restart
// works) and capture screenshots as inspectable artifacts alongside that,
// not as the pass/fail signal itself.

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  return errors;
}

test("loads the wasm engine and renders the game", async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.goto("/");
  await expect(page.getByText("Loading engine…")).toBeHidden({ timeout: 15_000 });

  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByText(/Score: \d+/)).toBeVisible();

  await page.screenshot({ path: "test-results/screenshots/game-loaded.png" });

  expect(errors).toEqual([]);
});

test("responds to keyboard input without erroring", async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.goto("/");
  await expect(page.getByText("Loading engine…")).toBeHidden({ timeout: 15_000 });
  await page.locator("canvas").click();
  await page.keyboard.press("ArrowDown");

  await expect(page.getByText(/Score: \d+/)).toBeVisible();
  await expect(page.getByText("Game Over")).toBeHidden();

  // Confirms the keypress actually reached the engine: turned downward off
  // its default rightward heading, the player still runs the simulation
  // through to a deterministic Game Over (off the south wall instead of the
  // east one). Waiting on this text is what proves ticking/input kept
  // working for the whole run — no fixed-duration sleep involved.
  await expect(page.getByText("Game Over")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "test-results/screenshots/game-playing.png" });

  expect(errors).toEqual([]);
});

test("shows game over on wall collision and restarts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Loading engine…")).toBeHidden({ timeout: 15_000 });

  // With no steering input the player keeps its default rightward heading
  // and eventually runs into the world's east wall — a deterministic way to
  // reach game-over regardless of AI/food randomness.
  await expect(page.getByText("Game Over")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "test-results/screenshots/game-over.png" });

  await page.getByRole("button", { name: /Restart/ }).click();
  await expect(page.getByText("Game Over")).toBeHidden();
  await expect(page.getByText("Score: 0")).toBeVisible();
});

// Per-snake render state (emoji theme, boosted, color) only exists inside
// canvas draw calls, which nothing in Playwright can inspect directly — so
// GameCanvas exposes it via window.__testHooks (see isE2EDebug in
// lib/env.ts, only set by this project's webServer config) instead of
// relying on screenshots to verify it.
test("window.__testHooks reflects the devil (AI 1) and cat (AI 2) theme assignment", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Loading engine…")).toBeHidden({ timeout: 15_000 });
  // Chaos Arena (the default level) has 30 AI, so both AI Snake 1 and
  // AI Snake 2 already exist without switching levels.

  await page.waitForFunction(() => (window.__testHooks?.snakes.length ?? 0) > 0);
  const hooks = await page.evaluate(() => window.__testHooks);

  const themes = hooks?.snakes.map((s) => s.theme) ?? [];
  expect(themes).toContain("devil");
  expect(themes).toContain("cat");
  expect(hooks?.snakes.some((s) => s.isPlayer)).toBe(true);
});
