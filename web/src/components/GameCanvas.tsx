"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ConfigPanel from "./ConfigPanel";
import { CONFIG_PRESETS, TICK_MS_DEFAULT, type FullConfig } from "@/lib/gameConfig";
import styles from "./GameCanvas.module.css";

const VIEWPORT_CELLS_W = 64;
const VIEWPORT_CELLS_H = 48;
const CELL_SIZE = 20;

const CANVAS_W = VIEWPORT_CELLS_W * CELL_SIZE;
const CANVAS_H = VIEWPORT_CELLS_H * CELL_SIZE;

const AI_COLORS = ["#3b82f6", "#f97316", "#a855f7", "#06b6d4", "#e879f9"];
const DEATH_FADE_MS = 1000;
const DEATH_COLOR = "#7f1d1d";
const EAT_FLASH_MS = 500;

// Priority: dead > just ate > near another snake > boosted > idle.
const EMOJI_EATING = "😋";
const EMOJI_NEAR = "😬";
const EMOJI_BOOSTED = "😎";
const EMOJI_IDLE = "🙂";
// Death emoji varies by cause, from the engine's DeathCause classification.
const EMOJI_DEAD_WALL = "🤕";
const EMOJI_DEAD_SELF = "🪢";
const EMOJI_DEAD_OTHER = "💥";

// Placeholder until default_config() loads from the wasm module.
const FALLBACK_CONFIG: FullConfig = {
  width: 60,
  height: 40,
  numAi: 30,
  playerSpeed: 1,
  boostMultiplier: 1.6,
  proximityRadius: 3,
  foodBoostTicks: 20,
  foodScore: 10,
  boostedFoodScore: 25,
  minFood: 18,
  foodTargeting: "nearest_reachable",
  tickMs: TICK_MS_DEFAULT,
};

type Point = [number, number];
// String values match the engine's serde(rename_all = "snake_case") output.
enum DeathCause {
  Wall = "wall",
  SelfCollision = "self_collision",
  OtherCollision = "other_collision",
}

interface SnakeState {
  body: Point[];
  alive: boolean;
  is_player: boolean;
  boosted: boolean;
  near_others: boolean;
  death_cause: DeathCause | null;
  score: number;
}

interface AiScoreEntry {
  label: string;
  score: number;
}

const TOP_AI_COUNT = 5;

// Labels AI snakes by their fixed position among AI in the snakes array
// (spawn order), which stays stable for a game's whole lifetime even as
// snakes die — then ranks by current score, highest first.
function topAiScores(snakes: SnakeState[]): AiScoreEntry[] {
  let aiNumber = 0;
  return snakes
    .filter((s) => !s.is_player)
    .map((s) => {
      aiNumber += 1;
      return { label: `AI Snake ${aiNumber}`, score: s.score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_AI_COUNT);
}

function headEmoji(snake: SnakeState, ateRecently: boolean): string {
  if (ateRecently) return EMOJI_EATING;
  if (snake.near_others) return EMOJI_NEAR;
  if (snake.boosted) return EMOJI_BOOSTED;
  return EMOJI_IDLE;
}

function deathEmoji(cause: DeathCause): string {
  switch (cause) {
    case DeathCause.Wall:
      return EMOJI_DEAD_WALL;
    case DeathCause.SelfCollision:
      return EMOJI_DEAD_SELF;
    case DeathCause.OtherCollision:
      return EMOJI_DEAD_OTHER;
  }
}

interface GameStateJson {
  width: number;
  height: number;
  snakes: SnakeState[];
  food: Point[];
  score: number;
  game_over: boolean;
}

interface GameInstance {
  set_player_direction(dir: number): void;
  tick(): void;
  state(): GameStateJson;
  score(): number;
  is_game_over(): boolean;
  free(): void;
}

interface EngineModule {
  default: (input?: unknown) => Promise<unknown>;
  Game: new (config: unknown) => GameInstance;
  default_config: () => Partial<EngineConfigJson>;
}

// The engine's Config struct, camelCase via serde(rename_all).
type EngineConfigJson = Omit<FullConfig, "tickMs">;

const KEY_TO_DIR: Record<string, number> = {
  ArrowUp: 0,
  w: 0,
  W: 0,
  ArrowDown: 1,
  s: 1,
  S: 1,
  ArrowLeft: 2,
  a: 2,
  A: 2,
  ArrowRight: 3,
  d: 3,
  D: 3,
};

// Standard Gamepad API button indices for the D-Pad (the W3C "standard"
// gamepad layout — https://w3c.github.io/gamepad/#remapping). Most
// controllers the browser recognizes, including an 8BitDo pad in its
// XInput mode, report this way; unrecognized pads may not populate
// `buttons` at these indices at all, which is what the axis fallback below
// is for.
const GAMEPAD_DPAD_BUTTONS: [number, number, number, number] = [12, 13, 14, 15]; // Up, Down, Left, Right
const GAMEPAD_AXIS_DEADZONE = 0.5;

// No "button pressed" event exists for gamepads — the API only exposes a
// snapshot you poll (see the loop this is called from). Edge-detects
// against `prev` so a held direction queues once per press, not once per
// animation frame, matching how a keydown behaves.
function pollGamepadDirections(prev: readonly boolean[]): { dirs: number[]; next: boolean[] } {
  const next = [false, false, false, false];
  const pad = navigator.getGamepads?.().find((p): p is Gamepad => p !== null);
  if (pad) {
    GAMEPAD_DPAD_BUTTONS.forEach((buttonIndex, dir) => {
      if (pad.buttons[buttonIndex]?.pressed) next[dir] = true;
    });
    // Left stick fallback, for pads whose D-Pad doesn't land on buttons
    // 12-15 (e.g. reported via a non-"standard" mapping).
    const [x, y] = pad.axes;
    if (y < -GAMEPAD_AXIS_DEADZONE) next[0] = true;
    if (y > GAMEPAD_AXIS_DEADZONE) next[1] = true;
    if (x < -GAMEPAD_AXIS_DEADZONE) next[2] = true;
    if (x > GAMEPAD_AXIS_DEADZONE) next[3] = true;
  }
  const dirs = next
    .map((pressed, dir) => (pressed && !prev[dir] ? dir : null))
    .filter((d): d is number => d !== null);
  return { dirs, next };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// Interpolates each segment from its previous-tick position to its
// current-tick position, over the real fixed tick interval. This only ever
// blends between two states the engine actually reported, so it can't
// guess wrong at a turn the way projecting forward from "current
// direction" can (a queued turn doesn't take effect until the tick it
// commits, so extrapolating past that point points the wrong way and then
// has to jump-correct). Falls back to snapping when there's no matching
// previous body (just spawned, or grew/shrank this tick).
// prevSnake is always defined: prevState/currState always hold the same
// number of snakes for a game's whole lifetime (fixed at construction).
function interpolatedBody(prevSnake: SnakeState, snake: SnakeState, t: number): Point[] {
  if (!prevSnake.alive) {
    return snake.body;
  }
  const grew = snake.body.length - prevSnake.body.length;
  if (grew === 0) {
    return snake.body.map(([x, y], j) => {
      const [px, py] = prevSnake.body[j];
      return [lerp(px, x, t), lerp(py, y, t)] as Point;
    });
  }
  if (grew === 1) {
    // The engine grows by inserting a new head and skipping the tail pop,
    // so every existing segment keeps its exact position (just shifted one
    // index down) — only the new head segment actually needs to animate,
    // sliding out from where the old head was. Without this, a length
    // change fell back to snapping the whole body, which read as the
    // growth popping in at the head instead of the head smoothly extending
    // while the tail holds still.
    return snake.body.map(([x, y], j) => {
      if (j === 0) {
        const [px, py] = prevSnake.body[0];
        return [lerp(px, x, t), lerp(py, y, t)] as Point;
      }
      return [x, y] as Point;
    });
  }
  // Rare (e.g. a heavily boosted snake eating twice in one tick) or a
  // shrink, which shouldn't happen — snap rather than guess.
  return snake.body;
}

interface DeathInfo {
  body: Point[];
  diedAt: number;
  cause: DeathCause;
}

// Checkerboard shades — close in value so the pattern reads as texture
// rather than a loud grid, plus a distinct warm tone for the outermost
// ring of cells so the playing field's edge is unmistakable at a glance.
function cellColor(x: number, y: number, width: number, height: number): string {
  const isEdge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
  const parity = (x + y) % 2 === 0;
  if (isEdge) return parity ? "#3f2a14" : "#33220f";
  return parity ? "#0d1424" : "#111c33";
}

function drawHeadEmoji(
  ctx: CanvasRenderingContext2D,
  emoji: string,
  x: number,
  y: number,
) {
  ctx.font = `${CELL_SIZE * 0.95}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, x * CELL_SIZE + CELL_SIZE / 2, y * CELL_SIZE + CELL_SIZE / 2 + 1);
}

function render(
  ctx: CanvasRenderingContext2D,
  prevState: GameStateJson,
  currState: GameStateJson,
  deaths: (DeathInfo | null)[],
  ateTimestamps: (number | null)[],
  config: FullConfig,
  lastTickTime: number,
  now: number,
) {
  const t = clamp((now - lastTickTime) / config.tickMs, 0, 1);

  const playerIndex = currState.snakes.findIndex((s) => s.is_player);
  const currPlayer = playerIndex >= 0 ? currState.snakes[playerIndex] : undefined;

  let camX = currState.width / 2;
  let camY = currState.height / 2;
  if (currPlayer && playerIndex >= 0) {
    // currPlayer.body is frozen at the death cell once dead — use it
    // directly so the camera holds still there instead of snapping to center.
    const body = currPlayer.alive
      ? interpolatedBody(prevState.snakes[playerIndex], currPlayer, t)
      : currPlayer.body;
    [camX, camY] = body[0];
  }
  camX = clamp(camX, VIEWPORT_CELLS_W / 2, currState.width - VIEWPORT_CELLS_W / 2);
  camY = clamp(camY, VIEWPORT_CELLS_H / 2, currState.height - VIEWPORT_CELLS_H / 2);

  const offsetX = CANVAS_W / 2 - camX * CELL_SIZE;
  const offsetY = CANVAS_H / 2 - camY * CELL_SIZE;

  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.save();
  ctx.translate(offsetX, offsetY);

  // Only paint the checkerboard cells actually inside the viewport — the
  // world can be far larger than what's on screen at once.
  const minX = Math.max(0, Math.floor(camX - VIEWPORT_CELLS_W / 2) - 1);
  const maxX = Math.min(currState.width - 1, Math.ceil(camX + VIEWPORT_CELLS_W / 2) + 1);
  const minY = Math.max(0, Math.floor(camY - VIEWPORT_CELLS_H / 2) - 1);
  const maxY = Math.min(currState.height - 1, Math.ceil(camY + VIEWPORT_CELLS_H / 2) + 1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      ctx.fillStyle = cellColor(x, y, currState.width, currState.height);
      ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }

  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 3;
  ctx.strokeRect(1, 1, currState.width * CELL_SIZE - 2, currState.height * CELL_SIZE - 2);

  ctx.fillStyle = "#ef4444";
  for (const [x, y] of currState.food) {
    ctx.beginPath();
    ctx.arc(
      x * CELL_SIZE + CELL_SIZE / 2,
      y * CELL_SIZE + CELL_SIZE / 2,
      CELL_SIZE * 0.3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  let aiIndex = 0;
  currState.snakes.forEach((snake, i) => {
    if (!snake.alive) {
      const death = deaths[i];
      if (!death) return;
      const elapsed = now - death.diedAt;
      if (elapsed >= DEATH_FADE_MS) return;
      ctx.globalAlpha = 1 - elapsed / DEATH_FADE_MS;
      ctx.fillStyle = DEATH_COLOR;
      death.body.forEach(([x, y], j) => {
        const pad = j === 0 ? 1 : 2;
        ctx.fillRect(
          x * CELL_SIZE + pad,
          y * CELL_SIZE + pad,
          CELL_SIZE - pad * 2,
          CELL_SIZE - pad * 2,
        );
      });
      const [dx, dy] = death.body[0];
      drawHeadEmoji(ctx, deathEmoji(death.cause), dx, dy);
      ctx.globalAlpha = 1;
      return;
    }

    let color: string;
    if (snake.is_player) {
      color = snake.boosted ? "#facc15" : "#22c55e";
    } else {
      color = AI_COLORS[aiIndex % AI_COLORS.length];
      aiIndex += 1;
    }

    const body = interpolatedBody(prevState.snakes[i], snake, t);
    ctx.fillStyle = color;
    body.forEach(([x, y], j) => {
      const pad = j === 0 ? 1 : 2;
      ctx.fillRect(
        x * CELL_SIZE + pad,
        y * CELL_SIZE + pad,
        CELL_SIZE - pad * 2,
        CELL_SIZE - pad * 2,
      );
    });

    const [hx, hy] = body[0];
    if (snake.boosted) {
      ctx.strokeStyle = snake.is_player ? "#facc15" : color;
      ctx.lineWidth = 2;
      ctx.strokeRect(hx * CELL_SIZE - 1, hy * CELL_SIZE - 1, CELL_SIZE + 2, CELL_SIZE + 2);
    }

    const ateAt = ateTimestamps[i];
    const ateRecently = ateAt !== null && ateAt !== undefined && now - ateAt < EAT_FLASH_MS;
    drawHeadEmoji(ctx, headEmoji(snake, ateRecently), hx, hy);
  });

  ctx.restore();
}

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameInstance | null>(null);
  const moduleRef = useRef<EngineModule | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number>(0);
  const prevStateRef = useRef<GameStateJson | null>(null);
  const currStateRef = useRef<GameStateJson | null>(null);
  const lastTickTimeRef = useRef<number>(0);
  const deathsRef = useRef<(DeathInfo | null)[]>([]);
  const ateRef = useRef<(number | null)[]>([]);
  const gameOverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gamepadStateRef = useRef<boolean[]>([false, false, false, false]);

  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [loading, setLoading] = useState(true);
  const [boosted, setBoosted] = useState(false);
  const [aiScores, setAiScores] = useState<AiScoreEntry[]>([]);
  const [config, setConfig] = useState<FullConfig>(FALLBACK_CONFIG);
  const [defaults, setDefaults] = useState<FullConfig>(FALLBACK_CONFIG);
  const [presetIndex, setPresetIndex] = useState(0);

  const startGame = useCallback((cfg: FullConfig) => {
    const mod = moduleRef.current;
    if (!mod) return;

    if (intervalRef.current) clearInterval(intervalRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (gameOverTimeoutRef.current) clearTimeout(gameOverTimeoutRef.current);
    gameOverTimeoutRef.current = null;
    gameRef.current?.free();

    const game = new mod.Game(cfg);
    gameRef.current = game;
    const initial = game.state();
    prevStateRef.current = initial;
    currStateRef.current = initial;
    lastTickTimeRef.current = performance.now();
    deathsRef.current = initial.snakes.map(() => null);
    ateRef.current = initial.snakes.map(() => null);
    setConfig(cfg);
    setScore(0);
    setGameOver(false);
    setBoosted(false);
    setAiScores(topAiScores(initial.snakes));

    intervalRef.current = setInterval(() => {
      const g = gameRef.current;
      if (!g) return;
      if (!g.is_game_over()) {
        g.tick();
      }
      const nextState = g.state();
      const now = performance.now();
      const prevState = currStateRef.current;
      const deaths = deathsRef.current;
      const ateAt = ateRef.current;
      nextState.snakes.forEach((s, i) => {
        const prevSnake = prevState?.snakes[i];
        const wasAlive = prevSnake?.alive ?? true;
        if (wasAlive && !s.alive) {
          // The engine sets death_cause in the same step that flips alive
          // to false, so it's always present here — this fallback is only
          // a defensive boundary guard against that invariant, not an
          // expected case.
          deaths[i] = { body: s.body, diedAt: now, cause: s.death_cause ?? DeathCause.OtherCollision };
        }
        if (prevSnake && s.body.length > prevSnake.body.length) {
          ateAt[i] = now;
        }
      });
      prevStateRef.current = prevState;
      currStateRef.current = nextState;
      lastTickTimeRef.current = now;
      setScore(g.score());
      setBoosted(nextState.snakes.find((s) => s.is_player)?.boosted ?? false);
      setAiScores(topAiScores(nextState.snakes));

      // Delay the Game Over overlay so the death fade is actually visible
      // underneath it instead of being covered up the instant it starts.
      if (g.is_game_over() && !gameOverTimeoutRef.current) {
        gameOverTimeoutRef.current = setTimeout(() => setGameOver(true), DEATH_FADE_MS);
      }
    }, cfg.tickMs);

    function frame() {
      const g = gameRef.current;
      if (g && !g.is_game_over()) {
        const { dirs, next } = pollGamepadDirections(gamepadStateRef.current);
        gamepadStateRef.current = next;
        for (const dir of dirs) {
          g.set_player_direction(dir);
        }
      }

      const ctx = canvasRef.current?.getContext("2d");
      const prev = prevStateRef.current;
      const curr = currStateRef.current;
      if (ctx && prev && curr) {
        render(
          ctx,
          prev,
          curr,
          deathsRef.current,
          ateRef.current,
          cfg,
          lastTickTimeRef.current,
          performance.now(),
        );
      }
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
  }, []);

  const switchLevel = useCallback(() => {
    const next = (presetIndex + 1) % CONFIG_PRESETS.length;
    setPresetIndex(next);
    startGame(CONFIG_PRESETS[next].config);
  }, [presetIndex, startGame]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Loaded from /public at runtime, not bundled — it's a wasm-pack
      // "web" target build, not an ES module webpack should process.
      // @ts-expect-error — served from public/ at runtime, not part of the TS program
      const mod = (await import(/* webpackIgnore: true */ "/wasm-pkg/engine.js")) as EngineModule;
      await mod.default();
      if (cancelled) return;
      moduleRef.current = mod;

      const engineDefaults = mod.default_config() as EngineConfigJson;
      const fullDefaults: FullConfig = { ...engineDefaults, tickMs: TICK_MS_DEFAULT };
      setDefaults(fullDefaults);
      setLoading(false);
      // Start on the first preset (not the raw engine defaults) so the
      // "Level: X" label is accurate from the first frame.
      startGame(CONFIG_PRESETS[0].config);
    }

    load();

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (gameOverTimeoutRef.current) clearTimeout(gameOverTimeoutRef.current);
      gameRef.current?.free();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const dir = KEY_TO_DIR[e.key];
      if (dir === undefined) return;
      e.preventDefault();
      if (gameOver) {
        if (e.key === "r" || e.key === "R") startGame(config);
        return;
      }
      gameRef.current?.set_player_direction(dir);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [gameOver, startGame, config]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.canvasWrapper}>
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className={styles.canvas}
        />
        <div className={styles.scoreOverlay}>
          <div className={styles.playerScoreRow}>
            <span>Score: {score}</span>
            {boosted && !gameOver && <span className={styles.boost}>⚡ Boost!</span>}
          </div>
          {aiScores.length > 0 && (
            <ul className={styles.aiScoreList}>
              {aiScores.map((entry) => (
                <li key={entry.label}>
                  {entry.label}: {entry.score}
                </li>
              ))}
            </ul>
          )}
        </div>
        {loading && <div className={styles.loadingOverlay}>Loading engine…</div>}
        {gameOver && !loading && (
          <div className={styles.gameOverOverlay}>
            <p className={styles.gameOverTitle}>Game Over</p>
            <p>Final score: {score}</p>
            <button onClick={() => startGame(config)} className={styles.restartButton}>
              Restart (R)
            </button>
          </div>
        )}
      </div>
      <div className={styles.levelRow}>
        <span>Level: {CONFIG_PRESETS[presetIndex].name}</span>
        <button onClick={switchLevel} className={styles.switchLevelButton}>
          Switch Level
        </button>
      </div>
      <p className={styles.description}>
        Arrow keys or WASD to move. Get close to another snake — or eat food
        — to speed up and score more points. But don&apos;t crash.
      </p>
      <ConfigPanel config={config} defaults={defaults} onApply={startGame} />
    </div>
  );
}
