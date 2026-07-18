"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const GRID_WIDTH = 32;
const GRID_HEIGHT = 24;
const CELL_SIZE = 20;
const NUM_AI = 4;
const TICK_MS = 110;

const AI_COLORS = ["#3b82f6", "#f97316", "#a855f7", "#06b6d4", "#e879f9"];

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
  Game: new (width: number, height: number, numAi: number) => GameInstance;
}

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

function drawState(ctx: CanvasRenderingContext2D, state: GameStateJson) {
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, state.width * CELL_SIZE, state.height * CELL_SIZE);

  ctx.fillStyle = "#ef4444";
  for (const [x, y] of state.food) {
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
  for (const snake of state.snakes) {
    if (!snake.alive) continue;

    let color: string;
    if (snake.is_player) {
      color = snake.boosted ? "#facc15" : "#22c55e";
    } else {
      color = AI_COLORS[aiIndex % AI_COLORS.length];
      aiIndex += 1;
    }

    ctx.fillStyle = color;
    snake.body.forEach(([x, y], i) => {
      const pad = i === 0 ? 1 : 2;
      ctx.fillRect(
        x * CELL_SIZE + pad,
        y * CELL_SIZE + pad,
        CELL_SIZE - pad * 2,
        CELL_SIZE - pad * 2,
      );
    });

    if (snake.is_player && snake.boosted) {
      const [hx, hy] = snake.body[0];
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        hx * CELL_SIZE - 1,
        hy * CELL_SIZE - 1,
        CELL_SIZE + 2,
        CELL_SIZE + 2,
      );
    }
  }
}

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameInstance | null>(null);
  const moduleRef = useRef<EngineModule | null>(null);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [loading, setLoading] = useState(true);
  const [boosted, setBoosted] = useState(false);

  const startGame = useCallback(() => {
    const mod = moduleRef.current;
    if (!mod) return;
    gameRef.current?.free();
    gameRef.current = new mod.Game(GRID_WIDTH, GRID_HEIGHT, NUM_AI);
    setScore(0);
    setGameOver(false);
    setBoosted(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    async function load() {
      // Loaded from /public at runtime — kept out of the Next.js bundler
      // graph since it's a wasm-pack "web" target build, not an ES module
      // meant to be statically analyzed/bundled.
      // @ts-expect-error — served from public/ at runtime, not part of the TS program
      const mod = (await import(/* webpackIgnore: true */ "/wasm-pkg/engine.js")) as EngineModule;
      await mod.default();
      if (cancelled) return;
      moduleRef.current = mod;
      gameRef.current = new mod.Game(GRID_WIDTH, GRID_HEIGHT, NUM_AI);
      setLoading(false);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");

      interval = setInterval(() => {
        const game = gameRef.current;
        if (!game || !ctx) return;
        if (!game.is_game_over()) {
          game.tick();
        }
        const state = game.state();
        drawState(ctx, state);
        setScore(game.score());
        setGameOver(game.is_game_over());
        setBoosted(
          state.snakes.find((s) => s.is_player)?.boosted ?? false,
        );
      }, TICK_MS);
    }

    load();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      gameRef.current?.free();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const dir = KEY_TO_DIR[e.key];
      if (dir === undefined) return;
      e.preventDefault();
      if (gameOver) {
        if (e.key === "r" || e.key === "R") startGame();
        return;
      }
      gameRef.current?.set_player_direction(dir);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [gameOver, startGame]);

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
          width={GRID_WIDTH * CELL_SIZE}
          height={GRID_HEIGHT * CELL_SIZE}
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
              onClick={startGame}
              className="mt-2 rounded-full bg-zinc-50 px-5 py-2 text-sm font-medium text-black hover:bg-zinc-200"
            >
              Restart (R)
            </button>
          </div>
        )}
      </div>
      <p className="max-w-md text-center text-sm text-zinc-400">
        Arrow keys or WASD to move. Get close to another snake to speed up
        and score more points — but don&apos;t crash into them.
      </p>
    </div>
  );
}
