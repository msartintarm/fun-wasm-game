"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ConfigPanel from "./ConfigPanel";
import { TICK_MS_DEFAULT, type FullConfig } from "@/lib/gameConfig";

const VIEWPORT_CELLS_W = 32;
const VIEWPORT_CELLS_H = 24;
const CELL_SIZE = 20;

const CANVAS_W = VIEWPORT_CELLS_W * CELL_SIZE;
const CANVAS_H = VIEWPORT_CELLS_H * CELL_SIZE;

const AI_COLORS = ["#3b82f6", "#f97316", "#a855f7", "#06b6d4", "#e879f9"];
const DEATH_FADE_MS = 1000;
const DEATH_COLOR = "#7f1d1d";
const EAT_FLASH_MS = 500;

// Priority: dead > just ate > near another snake > boosted > idle.
const EMOJI_DEAD = "💀";
const EMOJI_EATING = "😋";
const EMOJI_NEAR = "😬";
const EMOJI_BOOSTED = "😎";
const EMOJI_IDLE = "🙂";

// Placeholder until default_config() loads from the wasm module.
const FALLBACK_CONFIG: FullConfig = {
  width: 100,
  height: 80,
  numAi: 4,
  playerSpeed: 0.85,
  boostMultiplier: 1.6,
  proximityRadius: 3,
  foodBoostTicks: 20,
  foodScore: 10,
  boostedFoodScore: 25,
  minFood: 18,
  tickMs: TICK_MS_DEFAULT,
};

type Point = [number, number];

interface SnakeState {
  body: Point[];
  alive: boolean;
  is_player: boolean;
  boosted: boolean;
  near_others: boolean;
}

function headEmoji(snake: SnakeState, ateRecently: boolean): string {
  if (ateRecently) return EMOJI_EATING;
  if (snake.near_others) return EMOJI_NEAR;
  if (snake.boosted) return EMOJI_BOOSTED;
  return EMOJI_IDLE;
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
function interpolatedBody(prevSnake: SnakeState | undefined, snake: SnakeState, t: number): Point[] {
  if (!prevSnake || !prevSnake.alive || prevSnake.body.length !== snake.body.length) {
    return snake.body;
  }
  return snake.body.map(([x, y], j) => {
    const [px, py] = prevSnake.body[j];
    return [lerp(px, x, t), lerp(py, y, t)] as Point;
  });
}

interface DeathInfo {
  body: Point[];
  diedAt: number;
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
      drawHeadEmoji(ctx, EMOJI_DEAD, dx, dy);
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

  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [loading, setLoading] = useState(true);
  const [boosted, setBoosted] = useState(false);
  const [config, setConfig] = useState<FullConfig>(FALLBACK_CONFIG);
  const [defaults, setDefaults] = useState<FullConfig>(FALLBACK_CONFIG);

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
          deaths[i] = { body: s.body, diedAt: now };
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

      // Delay the Game Over overlay so the death fade is actually visible
      // underneath it instead of being covered up the instant it starts.
      if (g.is_game_over() && !gameOverTimeoutRef.current) {
        gameOverTimeoutRef.current = setTimeout(() => setGameOver(true), DEATH_FADE_MS);
      }
    }, cfg.tickMs);

    function frame() {
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
      startGame(fullDefaults);
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
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-6 text-lg font-medium text-zinc-50">
        <span>Score: {score}</span>
        {boosted && !gameOver && (
          <span className="text-yellow-400">⚡ Boost!</span>
        )}
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="rounded-lg border border-zinc-700"
        />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/70 text-zinc-100">
            Loading engine…
          </div>
        )}
        {gameOver && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-black/70 text-zinc-100">
            <p className="text-2xl font-semibold">Game Over</p>
            <p>Final score: {score}</p>
            <button
              onClick={() => startGame(config)}
              className="mt-2 rounded-full bg-zinc-50 px-5 py-2 text-sm font-medium text-black hover:bg-zinc-200"
            >
              Restart (R)
            </button>
          </div>
        )}
      </div>
      <p className="max-w-md text-center text-sm text-zinc-400">
        Arrow keys or WASD to move. Get close to another snake — or eat food
        — to speed up and score more points. But don&apos;t crash.
      </p>
      <ConfigPanel config={config} defaults={defaults} onApply={startGame} />
    </div>
  );
}
