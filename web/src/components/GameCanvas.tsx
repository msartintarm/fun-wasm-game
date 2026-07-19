"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import ConfigPanel from "./ConfigPanel";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import { EngineKind, pickTrackForPreset } from "@/lib/audio/audioEngine";
import { AUDIO_PRESET_TRACKS } from "@/lib/audio/data/audioTracks";
import { PRESET_TRACKS, type MusicTrackId } from "@/lib/audio/tracks";
import { CONFIG_PRESETS, TICK_MS_DEFAULT, type FullConfig } from "@/lib/gameConfig";
import styles from "./GameCanvas.module.css";

const VIEWPORT_CELLS_W = 64;
const VIEWPORT_CELLS_H = 48;
const CELL_SIZE = 20;

const CANVAS_W = VIEWPORT_CELLS_W * CELL_SIZE;
const CANVAS_H = VIEWPORT_CELLS_H * CELL_SIZE;

const AI_COLORS = ["#3b82f6", "#f97316", "#a855f7", "#06b6d4", "#e879f9"];
const AI_BOOST_TINT_AMOUNT = 1; // scales the additive bump below, 0-1
// Additive R/G/B bump for a boosted AI's color — more red and green than
// blue (a yellowish push) without blending toward a fixed color, so it
// never matches the player's flat boosted color (#facc15) exactly.
const AI_BOOST_TINT: [number, number, number] = [90, 90, 20];
const DEATH_FADE_MS = 1000;
const DEATH_COLOR = "#7f1d1d";
const EAT_FLASH_MS = 500;

// Per-snake emoji set. Priority within a set: dead > just ate > near
// another snake > boosted > idle.
interface EmojiTheme {
  idle: string;
  near: string;
  boosted: string;
  eating: string;
  deadWall: string;
  deadSelf: string;
  deadOther: string;
}

const DEFAULT_THEME: EmojiTheme = {
  idle: "🙂",
  near: "😬",
  boosted: "😎",
  eating: "😋",
  deadWall: "🤕",
  deadSelf: "🪢",
  deadOther: "💥",
};
// AI Snake 1 — also the AI that uses the speed-seeking movement behavior.
const DEVIL_THEME: EmojiTheme = {
  idle: "😈",
  near: "😏",
  boosted: "🔥",
  eating: "👹",
  deadWall: "💥",
  deadSelf: "🪢",
  deadOther: "💀",
};
// AI Snake 2 — also the AI that uses reachability-aware food targeting.
const CAT_THEME: EmojiTheme = {
  idle: "🐱",
  near: "🙀",
  boosted: "😼",
  eating: "😻",
  deadWall: "💫",
  deadSelf: "🧶",
  deadOther: "😾",
};

type ThemeName = "default" | "devil" | "cat";

const EMOJI_THEMES: Record<ThemeName, EmojiTheme> = {
  default: DEFAULT_THEME,
  devil: DEVIL_THEME,
  cat: CAT_THEME,
};

function themeNameForAiNumber(aiNumber: number | null): ThemeName {
  if (aiNumber === 1) return "devil";
  if (aiNumber === 2) return "cat";
  return "default";
}

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
  waveMode: false,
  vanquishScorePercent: 50,
  spectatorMode: false,
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

// Stable AI numbering (1-based, by spawn-order position among AI, null for
// the player) — independent of current alive/dead status, so identity
// (theme, leaderboard label) doesn't shift as other snakes die.
function aiNumbers(snakes: SnakeState[]): (number | null)[] {
  let n = 0;
  return snakes.map((s) => {
    if (s.is_player) return null;
    n += 1;
    return n;
  });
}

function topAiScores(snakes: SnakeState[]): AiScoreEntry[] {
  return aiNumbers(snakes)
    .map((n, i) => (n === null ? null : { label: `AI Snake ${n}`, score: snakes[i].score }))
    .filter((entry): entry is AiScoreEntry => entry !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_AI_COUNT);
}

interface SnakeDebugInfo {
  aiNumber: number | null;
  isPlayer: boolean;
  alive: boolean;
  boosted: boolean;
  theme: ThemeName;
  color: string;
}

interface TestHooks {
  snakes: SnakeDebugInfo[];
  wave: number;
}

declare global {
  interface Window {
    // Only ever assigned when e2eDebug is true (see isE2EDebug) — a
    // namespaced escape hatch for Playwright to read render state that
    // isn't naturally DOM-shaped (it's canvas draw calls), without adding
    // markup or React state for tests' sake.
    __testHooks?: TestHooks;
  }
}

// Reuses the exact same theme/color functions the canvas renderer calls,
// so window.__testHooks can never disagree with what's actually drawn.
function snakeDebugInfo(snakes: SnakeState[]): SnakeDebugInfo[] {
  const nums = aiNumbers(snakes);
  return snakes.map((s, i) => ({
    aiNumber: nums[i],
    isPlayer: s.is_player,
    alive: s.alive,
    boosted: s.boosted,
    theme: themeNameForAiNumber(nums[i]),
    color: colorFor(s, nums[i]),
  }));
}

function headEmoji(snake: SnakeState, ateRecently: boolean, theme: EmojiTheme): string {
  if (ateRecently) return theme.eating;
  if (snake.near_others) return theme.near;
  if (snake.boosted) return theme.boosted;
  return theme.idle;
}

function deathEmoji(cause: DeathCause, theme: EmojiTheme): string {
  switch (cause) {
    case DeathCause.Wall:
      return theme.deadWall;
    case DeathCause.SelfCollision:
      return theme.deadSelf;
    case DeathCause.OtherCollision:
      return theme.deadOther;
  }
}

// Nudges a #rrggbb color by additive [dR, dG, dB] (scaled by `amount`,
// 0-1), clamped to a valid channel range — used to give a boosted AI's own
// color a yellowish tint without losing its identity hue, as opposed to
// the player's flat color swap when boosted.
function tint(hex: string, delta: [number, number, number], amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const bump = (c: number, d: number) => clamp(Math.round(c + d * amount), 0, 255);
  return `rgb(${bump(r, delta[0])}, ${bump(g, delta[1])}, ${bump(b, delta[2])})`;
}

// AI keeps its identity hue but tints yellow when boosted — distinct from
// the player's flat color swap. Shared by the canvas renderer and the debug
// DOM mirror so they can never disagree.
function colorFor(snake: SnakeState, aiNumber: number | null): string {
  if (snake.is_player) {
    return snake.boosted ? "#facc15" : "#22c55e";
  }
  const base = AI_COLORS[((aiNumber ?? 1) - 1) % AI_COLORS.length];
  return snake.boosted ? tint(base, AI_BOOST_TINT, AI_BOOST_TINT_AMOUNT) : base;
}

interface GameStateJson {
  width: number;
  height: number;
  snakes: SnakeState[];
  food: Point[];
  score: number;
  game_over: boolean;
  wave: number;
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
// prevSnake is undefined for a snake that didn't exist last tick (wave
// mode can append new AI mid-game) — treat that like "not alive yet".
function interpolatedBody(
  prevSnake: SnakeState | undefined,
  snake: SnakeState,
  t: number,
): Point[] {
  if (!prevSnake || !prevSnake.alive) {
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

// The checkerboard + border are a pure function of world size, fixed for a
// game's whole lifetime — painting ~3,000 individual fillRect calls (plus a
// fillStyle change per cell) every single animation frame was pure waste.
// Rasterized once per startGame() into an offscreen canvas instead, then
// blitted with a single drawImage() per frame (see render() below).
function buildBackgroundCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width * CELL_SIZE;
  canvas.height = height * CELL_SIZE;
  const ctx = canvas.getContext("2d")!;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      ctx.fillStyle = cellColor(x, y, width, height);
      ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 3;
  ctx.strokeRect(1, 1, width * CELL_SIZE - 2, height * CELL_SIZE - 2);
  return canvas;
}

function drawHeadEmoji(
  ctx: CanvasRenderingContext2D,
  emoji: string,
  x: number,
  y: number,
) {
  ctx.font = `${CELL_SIZE * 1.1875}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, x * CELL_SIZE + CELL_SIZE / 2, y * CELL_SIZE + CELL_SIZE / 2 + 1);
}

function render(
  ctx: CanvasRenderingContext2D,
  background: HTMLCanvasElement,
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
  // No player to follow in spectator mode — fit the whole arena in the
  // viewport (camX/camY already default to its center) instead of panning
  // to track anyone. scale=1 in every other mode is exactly the original,
  // unscaled behavior.
  let scale = 1;

  if (config.spectatorMode) {
    scale = Math.min(CANVAS_W / (currState.width * CELL_SIZE), CANVAS_H / (currState.height * CELL_SIZE));
  } else {
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
  }

  const offsetX = CANVAS_W / 2 - camX * CELL_SIZE * scale;
  const offsetY = CANVAS_H / 2 - camY * CELL_SIZE * scale;

  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // Static checkerboard + border, pre-rasterized once in startGame() — the
  // browser clips this to the visible canvas area, so it costs one blit
  // regardless of how much larger the world is than the viewport.
  ctx.drawImage(background, 0, 0);

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

  const nums = aiNumbers(currState.snakes);
  currState.snakes.forEach((snake, i) => {
    const theme = EMOJI_THEMES[themeNameForAiNumber(nums[i])];
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
      drawHeadEmoji(ctx, deathEmoji(death.cause, theme), dx, dy);
      ctx.globalAlpha = 1;
      return;
    }

    const color = colorFor(snake, nums[i]);

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
    drawHeadEmoji(ctx, headEmoji(snake, ateRecently, theme), hx, hy);
  });

  ctx.restore();
}

interface GameCanvasProps {
  // Server-provided (see isE2EDebug in lib/env.ts, passed down from
  // app/page.tsx) — only true when Playwright's webServer sets E2E_DEBUG
  // AND this isn't a production build. Never true in a developer's own
  // `npm run dev`.
  e2eDebug: boolean;
}

const MUSIC_MUTED_STORAGE_KEY = "snake-music-muted";
const MUSIC_VOLUME_STORAGE_KEY = "snake-music-volume";
const EFFECTS_MUTED_STORAGE_KEY = "snake-effects-muted";
const EFFECTS_VOLUME_STORAGE_KEY = "snake-effects-volume";
const ENGINE_KIND_STORAGE_KEY = "snake-engine-kind";
const DEFAULT_VOLUME = 0.8;

function loadStoredMuted(key: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(key) === "1";
}

function loadStoredVolume(key: string): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return DEFAULT_VOLUME;
  const stored = Number(raw);
  return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : DEFAULT_VOLUME;
}

// One mute+volume channel's state/persistence/handlers — used twice below
// (music, effects), each wired to its own storage keys and its own pair of
// audio-controller setters, so the two channels are genuinely independent.
function useChannelControl(
  mutedKey: string,
  volumeKey: string,
  setEngineMuted: (muted: boolean) => void,
  setEngineVolume: (volume: number) => void,
) {
  const [muted, setMutedState] = useState(() => loadStoredMuted(mutedKey));
  const [volume, setVolumeState] = useState(() => loadStoredVolume(volumeKey));

  // Applies whatever was persisted from a previous visit — safe to call
  // before the engine has actually loaded (see getAudioEngine's proxy).
  useEffect(() => {
    setEngineMuted(muted);
    setEngineVolume(volume);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMuted = useCallback(() => {
    const next = !muted;
    setMutedState(next);
    setEngineMuted(next);
    window.localStorage.setItem(mutedKey, next ? "1" : "0");
  }, [muted, setEngineMuted, mutedKey]);

  const handleVolumeChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      setVolumeState(next);
      setEngineVolume(next);
      window.localStorage.setItem(volumeKey, String(next));
    },
    [setEngineVolume, volumeKey],
  );

  return { muted, volume, toggleMuted, handleVolumeChange };
}

function loadStoredEngineKind(): EngineKind {
  if (typeof window === "undefined") return EngineKind.Midi;
  return window.localStorage.getItem(ENGINE_KIND_STORAGE_KEY) === EngineKind.Audio ? EngineKind.Audio : EngineKind.Midi;
}

export default function GameCanvas({ e2eDebug }: GameCanvasProps) {
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
  const backgroundRef = useRef<HTMLCanvasElement | null>(null);
  // Whatever track id the audio engine currently has loaded — startGame()
  // compares against this so a restart (game over -> Restart/'r', or
  // reapplying config for the same preset) doesn't interrupt/replay a
  // track that's already playing; only a genuine track change restarts it.
  const currentAudioTrackIdRef = useRef<MusicTrackId | undefined>(undefined);

  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [loading, setLoading] = useState(true);
  const [started, setStarted] = useState(false);
  const [boosted, setBoosted] = useState(false);
  const [aiScores, setAiScores] = useState<AiScoreEntry[]>([]);
  const [config, setConfig] = useState<FullConfig>(FALLBACK_CONFIG);
  const [defaults, setDefaults] = useState<FullConfig>(FALLBACK_CONFIG);
  const [presetIndex, setPresetIndex] = useState(0);
  const [engineKind, setEngineKindState] = useState(loadStoredEngineKind);
  const audio = useAudioEngine(engineKind);

  const music = useChannelControl(
    MUSIC_MUTED_STORAGE_KEY,
    MUSIC_VOLUME_STORAGE_KEY,
    audio.setMusicMuted,
    audio.setMusicVolume,
  );
  const effects = useChannelControl(
    EFFECTS_MUTED_STORAGE_KEY,
    EFFECTS_VOLUME_STORAGE_KEY,
    audio.setEffectsMuted,
    audio.setEffectsVolume,
  );

  const selectEngineKind = useCallback((kind: EngineKind) => {
    setEngineKindState(kind);
    window.localStorage.setItem(ENGINE_KIND_STORAGE_KEY, kind);
  }, []);

  // Reflects "speed mode" (boosted) to the audio engine — audioFileEngine.ts
  // fades condition-gated layers (e.g. the guitar stem) in/out in response;
  // midiEngine.ts has no layers, so this is a no-op there.
  useEffect(() => {
    audio.setBoosted(boosted);
  }, [boosted, audio]);

  // Takes the preset index explicitly rather than reading `presetIndex`
  // state: switchLevel() below calls setPresetIndex(next) and startGame(...)
  // in the same tick, before React re-renders, so the state closure here
  // would still see the old value.
  const startGame = useCallback((cfg: FullConfig, presetIdx: number) => {
    const mod = moduleRef.current;
    if (!mod) return;

    const presetTracks = engineKind === EngineKind.Midi ? PRESET_TRACKS : AUDIO_PRESET_TRACKS;
    const nextTrackId = pickTrackForPreset(presetTracks, CONFIG_PRESETS[presetIdx].name);
    // Only (re)start audio when the track identity actually changes — a
    // restart (game over -> Restart/'r') or reapplying config for the same
    // preset must not interrupt/replay a track that's already looping.
    if (nextTrackId !== currentAudioTrackIdRef.current) {
      currentAudioTrackIdRef.current = nextTrackId;
      audio.startTrack(nextTrackId);
    }

    if (intervalRef.current) clearInterval(intervalRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (gameOverTimeoutRef.current) clearTimeout(gameOverTimeoutRef.current);
    gameOverTimeoutRef.current = null;
    gameRef.current?.free();

    const game = new mod.Game(cfg);
    gameRef.current = game;
    backgroundRef.current = buildBackgroundCanvas(cfg.width, cfg.height);
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
    if (e2eDebug) window.__testHooks = { snakes: snakeDebugInfo(initial.snakes), wave: initial.wave };

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
          if (s.is_player) audio.triggerPickup();
        }
      });
      prevStateRef.current = prevState;
      currStateRef.current = nextState;
      lastTickTimeRef.current = now;
      setScore(g.score());
      setBoosted(nextState.snakes.find((s) => s.is_player)?.boosted ?? false);
      setAiScores(topAiScores(nextState.snakes));
      if (e2eDebug) window.__testHooks = { snakes: snakeDebugInfo(nextState.snakes), wave: nextState.wave };

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
      const background = backgroundRef.current;
      if (ctx && prev && curr && background) {
        render(
          ctx,
          background,
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
  }, [e2eDebug, audio, engineKind]);

  const switchLevel = useCallback(() => {
    audio.armAutoplay();
    setStarted(true);
    const next = (presetIndex + 1) % CONFIG_PRESETS.length;
    setPresetIndex(next);
    startGame(CONFIG_PRESETS[next].config, next);
  }, [presetIndex, startGame, audio]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Loaded from /public at runtime, not bundled — it's a wasm-pack
      // "web" target build, not an ES module webpack should process.
      // Absolute path, so (unlike next/link or next/image) it needs the
      // same NEXT_PUBLIC_BASE_PATH prefix next.config.ts's basePath uses —
      // empty locally, e.g. "/snake" once deployed under a subpath. A
      // template-literal specifier, unlike a plain string literal, isn't
      // statically resolved against the TS program, so the directive that
      // used to suppress a "not found" error here is no longer needed.
      const mod = (await import(
        /* webpackIgnore: true */ `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/wasm-pkg/engine.js`
      )) as EngineModule;
      await mod.default();
      if (cancelled) return;
      moduleRef.current = mod;

      const engineDefaults = mod.default_config() as EngineConfigJson;
      const fullDefaults: FullConfig = { ...engineDefaults, tickMs: TICK_MS_DEFAULT };
      setDefaults(fullDefaults);
      setLoading(false);
      // The game itself (and its audio track) doesn't start until the
      // player clicks Play on the splash screen — see handlePlay below.
      // Browsers refuse to start an AudioContext without a user gesture,
      // so starting eagerly here would leave the music silently stuck.
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
  }, []);

  const handlePlay = useCallback(() => {
    audio.armAutoplay();
    setStarted(true);
    // Start on the first preset (not the raw engine defaults) so the
    // "Level: X" label is accurate from the first frame.
    startGame(CONFIG_PRESETS[0].config, 0);
  }, [startGame, audio]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const dir = KEY_TO_DIR[e.key];
      if (dir === undefined) return;
      audio.armAutoplay();
      e.preventDefault();
      if (gameOver) {
        if (e.key === "r" || e.key === "R") startGame(config, presetIndex);
        return;
      }
      gameRef.current?.set_player_direction(dir);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [gameOver, startGame, config, presetIndex, audio]);

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
          {!config.spectatorMode && (
            <div className={styles.playerScoreRow}>
              <span>Score: {score}</span>
              {boosted && !gameOver && <span className={styles.boost}>⚡ Boost!</span>}
            </div>
          )}
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
        {!loading && !started && (
          <div className={styles.splashOverlay}>
            <p className={styles.splashTitle}>Chaos Snake</p>
            <div className={styles.engineKindRow} role="radiogroup" aria-label="Music engine">
              <button
                onClick={() => selectEngineKind(EngineKind.Midi)}
                aria-pressed={engineKind === EngineKind.Midi}
                className={styles.engineKindButton}
              >
                MIDI
              </button>
              <button
                onClick={() => selectEngineKind(EngineKind.Audio)}
                aria-pressed={engineKind === EngineKind.Audio}
                className={styles.engineKindButton}
              >
                Audio
              </button>
            </div>
            <button onClick={handlePlay} className={styles.playButton}>
              Play
            </button>
          </div>
        )}
        {gameOver && !loading && (
          <div className={styles.gameOverOverlay}>
            <p className={styles.gameOverTitle}>Game Over</p>
            <p>Final score: {score}</p>
            <button
              onClick={() => {
                audio.armAutoplay();
                startGame(config, presetIndex);
              }}
              className={styles.restartButton}
            >
              Restart (R)
            </button>
          </div>
        )}
        <div className={styles.audioControls}>
          <div className={styles.audioChannelRow}>
            <button
              onClick={music.toggleMuted}
              className={styles.muteButton}
              aria-label={music.muted ? "Unmute music" : "Mute music"}
            >
              {music.muted ? "🔇" : "🎵"}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={music.volume}
              onChange={music.handleVolumeChange}
              className={styles.volumeSlider}
              aria-label="Music volume"
            />
          </div>
          <div className={styles.audioChannelRow}>
            <button
              onClick={effects.toggleMuted}
              className={styles.muteButton}
              aria-label={effects.muted ? "Unmute sound effects" : "Mute sound effects"}
            >
              {effects.muted ? "🔇" : "🔔"}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={effects.volume}
              onChange={effects.handleVolumeChange}
              className={styles.volumeSlider}
              aria-label="Sound effects volume"
            />
          </div>
        </div>
      </div>
      <div className={styles.levelRow}>
        <span>Level: {CONFIG_PRESETS[presetIndex].name}</span>
        <button onClick={switchLevel} className={styles.switchLevelButton}>
          Switch Level
        </button>
      </div>
      <p className={styles.description}>
        Arrow keys or WASD to move. Get close to another snake, eat food, or
        hug the arena&apos;s edge to speed up — proximity and food also
        score points. But don&apos;t crash.
      </p>
      <ConfigPanel
        config={config}
        defaults={defaults}
        onApply={(cfg) => {
          audio.armAutoplay();
          setStarted(true);
          startGame(cfg, presetIndex);
        }}
      />
    </div>
  );
}
