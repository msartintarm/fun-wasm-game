// Display-only preferences, persisted via hooks/useStoredState.ts.

export enum TouchControlsMode {
  // Matches TouchControls.module.css's `@media (pointer: coarse)` gate —
  // shown on touch devices, hidden on desktop, no explicit choice made.
  Auto = "auto",
  Show = "show",
  Hide = "hide",
}

export enum TouchControlsScheme {
  // Absolute Up/Down/Left/Right buttons in a cross layout.
  Dpad = "dpad",
  // Turn-left / U-turn-left / U-turn-right / turn-right, relative to
  // whichever way the snake is currently facing — see lib/relativeTurn.ts.
  Relative = "relative",
}

export const TOUCH_CONTROLS_MODE_STORAGE_KEY = "snake-touch-controls-mode";
export const TOUCH_CONTROLS_SCHEME_STORAGE_KEY = "snake-touch-controls-scheme";

export function parseTouchControlsMode(raw: string | null): TouchControlsMode {
  return raw === TouchControlsMode.Show || raw === TouchControlsMode.Hide ? raw : TouchControlsMode.Auto;
}

// Dpad (unchanged existing behavior) stays the default — Relative is an
// experimental scheme users opt into.
export function parseTouchControlsScheme(raw: string | null): TouchControlsScheme {
  return raw === TouchControlsScheme.Relative ? TouchControlsScheme.Relative : TouchControlsScheme.Dpad;
}

// Both enums' values are already their own valid storage strings.
export function serializeTouchControlsMode(mode: TouchControlsMode): string {
  return mode;
}

export function serializeTouchControlsScheme(scheme: TouchControlsScheme): string {
  return scheme;
}
