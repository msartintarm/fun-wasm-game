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

// Fallback used only if the wasm module's default_config() can't be reached
// before the settings panel needs something to render; overwritten by the
// engine's real defaults as soon as the module loads.
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

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}

/** Interpolated positions of a snake's segments between two ticks. Falls
 * back to snapping to `curr` when the body length changed (growth/shrink),
 * since segments don't correspond 1:1 across a length change. */
function interpolatedBody(
  prev: SnakeState | undefined,
  curr: SnakeState,
  t: number,
): Point[] {
  if (!prev || !prev.alive || prev.body.length !== curr.body.length) {
    return curr.body;
  }
  return curr.body.map(([x, y], i) => {
    const [px, py] = prev.body[i];
    return [lerp(px, x, t), lerp(py, y, t)] as Point;
  });
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

function render(
  ctx: CanvasRenderingContext2D,
  prevState: GameStateJson,
  currState: GameStateJson,
  t: number,
) {
  const currPlayer = currState.snakes.find((s) => s.is_player);
  const prevPlayer = prevState.snakes.find((s) => s.is_player);

  let camX = currState.width / 2;
  let camY = currState.height / 2;
  if (currPlayer?.alive) {
    const [cx, cy] = currPlayer.body[0];
    if (prevPlayer?.alive && prevPlayer.body.length === currPlayer.body.length) {
      const [px, py] = prevPlayer.body[0];
      camX = lerp(px, cx, t);
      camY = lerp(py, cy, t);
    } else {
      camX = cx;
      camY = cy;
    }
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
    if (!snake.alive) return;

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

    if (snake.boosted) {
      const [hx, hy] = body[0];
      ctx.strokeStyle = snake.is_player ? "#facc15" : color;
      ctx.lineWidth = 2;
      ctx.strokeRect(hx * CELL_SIZE - 1, hy * CELL_SIZE - 1, CELL_SIZE + 2, CELL_SIZE + 2);
    }
  });

  ctx.restore();
}

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameInstance | null>(null);
  const moduleRef = useRef<EngineModule | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number>(0);
  const simRef = useRef<{
    prev: GameStateJson;
    curr: GameStateJson;
    tickTime: number;
  } | null>(null);

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
    gameRef.current?.free();

    const game = new mod.Game(cfg);
    gameRef.current = game;
    const initial = game.state();
    simRef.current = { prev: initial, curr: initial, tickTime: performance.now() };
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
      const sim = simRef.current;
      simRef.current = {
        prev: sim ? sim.curr : nextState,
        curr: nextState,
        tickTime: performance.now(),
      };
      setScore(g.score());
      setGameOver(g.is_game_over());
      setBoosted(nextState.snakes.find((s) => s.is_player)?.boosted ?? false);
    }, cfg.tickMs);

    function frame() {
      const ctx = canvasRef.current?.getContext("2d");
      const sim = simRef.current;
      if (ctx && sim) {
        const elapsedT = clamp((performance.now() - sim.tickTime) / cfg.tickMs, 0, 1);
        render(ctx, sim.prev, sim.curr, elapsedT);
      }
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Loaded from /public at runtime — kept out of the Next.js bundler
      // graph since it's a wasm-pack "web" target build, not an ES module
      // meant to be statically analyzed/bundled.
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
