// Matches engine::FoodTargeting's serde(rename_all = "snake_case") output.
// Only AI Snake 2 ever uses this — every other AI always targets the
// nearest food regardless of whether it's reachable.
export type FoodTargeting = "nearest" | "nearest_reachable";

// Mirrors engine::Config (see engine/src/lib.rs) plus tickMs, which is a
// pure render/loop-timing knob the Rust engine doesn't need to know about.
export interface EngineConfig {
  width: number;
  height: number;
  numAi: number;
  playerSpeed: number;
  boostMultiplier: number;
  proximityRadius: number;
  foodBoostTicks: number;
  foodScore: number;
  boostedFoodScore: number;
  minFood: number;
  foodTargeting: FoodTargeting;
  // See engine::Config::wave_mode / vanquish_score_percent.
  waveMode: boolean;
  vanquishScorePercent: number;
}

export interface FullConfig extends EngineConfig {
  tickMs: number;
}

export const TICK_MS_DEFAULT = 90;

type NumericConfigKey = { [K in keyof FullConfig]: FullConfig[K] extends number ? K : never }[keyof FullConfig];

export interface ConfigFieldMeta {
  key: NumericConfigKey;
  label: string;
  min: number;
  max: number;
  step: number;
  description: string;
}

export const CONFIG_FIELDS: ConfigFieldMeta[] = [
  { key: "width", label: "World width", min: 20, max: 300, step: 5, description: "Cells across" },
  { key: "height", label: "World height", min: 20, max: 300, step: 5, description: "Cells tall" },
  { key: "numAi", label: "AI snakes", min: 0, max: 64, step: 1, description: "Number of AI-controlled snakes" },
  { key: "tickMs", label: "Tick interval (ms)", min: 30, max: 300, step: 10, description: "Lower = faster overall game speed" },
  { key: "playerSpeed", label: "Player speed", min: 0.1, max: 1, step: 0.05, description: "Fraction of the AI's baseline speed, before boosts" },
  { key: "boostMultiplier", label: "Boost multiplier", min: 1, max: 5, step: 0.1, description: "Speed multiplier while boosted, for player and AI alike" },
  { key: "proximityRadius", label: "Proximity radius", min: 1, max: 30, step: 1, description: "Distance to another snake that triggers a boost" },
  { key: "foodBoostTicks", label: "Food boost duration", min: 0, max: 300, step: 5, description: "Ticks of speed boost after eating food" },
  { key: "foodScore", label: "Food score", min: 1, max: 1000, step: 1, description: "Points for eating normally" },
  { key: "boostedFoodScore", label: "Boosted food score", min: 1, max: 1000, step: 1, description: "Points for eating while near another snake" },
  { key: "minFood", label: "Min food on board", min: 1, max: 300, step: 1, description: "Food pieces kept on the map at all times" },
];

export interface ConfigSelectFieldMeta {
  key: "foodTargeting";
  label: string;
  options: { value: FoodTargeting; label: string }[];
  description: string;
}

export const CONFIG_SELECT_FIELDS: ConfigSelectFieldMeta[] = [
  {
    key: "foodTargeting",
    label: "AI Snake 2 food targeting",
    options: [
      { value: "nearest", label: "Nearest (may commit to blocked food)" },
      { value: "nearest_reachable", label: "Nearest reachable" },
    ],
    description: "Only AI Snake 2 uses this — every other AI always targets the nearest food regardless of whether it's currently reachable.",
  },
];

// Named, ready-to-play configs. The "difficulty switch" button cycles
// through these — add more here to add more levels.
export interface ConfigPreset {
  name: string;
  config: FullConfig;
}

// Duel is first (and so the default on load / Play) — CONFIG_PRESETS[0] is
// what handlePlay/startGame use to start the very first game.
export const CONFIG_PRESETS: ConfigPreset[] = [
  {
    name: "Duel",
    config: {
      width: 60,
      height: 40,
      numAi: 1,
      tickMs: TICK_MS_DEFAULT,
      playerSpeed: 1,
      boostMultiplier: 1.6,
      proximityRadius: 3,
      foodBoostTicks: 20,
      foodScore: 10,
      boostedFoodScore: 25,
      minFood: 18,
      foodTargeting: "nearest_reachable",
      waveMode: true,
      vanquishScorePercent: 100,
    },
  },
  {
    name: "Chaos Arena",
    config: {
      width: 80,
      height: 60,
      numAi: 30,
      tickMs: TICK_MS_DEFAULT,
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
    },
  },
  {
    name: "Balanced",
    config: {
      width: 100,
      height: 80,
      numAi: 8,
      tickMs: TICK_MS_DEFAULT,
      playerSpeed: 0.85,
      boostMultiplier: 1.6,
      proximityRadius: 3,
      foodBoostTicks: 20,
      foodScore: 10,
      boostedFoodScore: 25,
      minFood: 18,
      foodTargeting: "nearest_reachable",
      waveMode: false,
      vanquishScorePercent: 50,
    },
  },
];
