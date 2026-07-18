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
}

export interface FullConfig extends EngineConfig {
  tickMs: number;
}

export const TICK_MS_DEFAULT = 90;

export interface ConfigFieldMeta {
  key: keyof FullConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  description: string;
}

export const CONFIG_FIELDS: ConfigFieldMeta[] = [
  { key: "width", label: "World width", min: 20, max: 300, step: 5, description: "Cells across" },
  { key: "height", label: "World height", min: 20, max: 300, step: 5, description: "Cells tall" },
  { key: "numAi", label: "AI snakes", min: 0, max: 16, step: 1, description: "Number of AI-controlled snakes" },
  { key: "tickMs", label: "Tick interval (ms)", min: 30, max: 300, step: 10, description: "Lower = faster overall game speed" },
  { key: "playerSpeed", label: "Player speed", min: 0.1, max: 1, step: 0.05, description: "Fraction of the AI's baseline speed" },
  { key: "boostMultiplier", label: "Boost multiplier", min: 1, max: 5, step: 0.1, description: "Speed multiplier while boosted (player is still capped at the AI's baseline speed)" },
  { key: "proximityRadius", label: "Proximity radius", min: 1, max: 30, step: 1, description: "Distance to another snake that triggers a boost" },
  { key: "foodBoostTicks", label: "Food boost duration", min: 0, max: 300, step: 5, description: "Ticks of speed boost after eating food" },
  { key: "foodScore", label: "Food score", min: 1, max: 1000, step: 1, description: "Points for eating normally" },
  { key: "boostedFoodScore", label: "Boosted food score", min: 1, max: 1000, step: 1, description: "Points for eating while near another snake" },
  { key: "minFood", label: "Min food on board", min: 1, max: 300, step: 1, description: "Food pieces kept on the map at all times" },
];
