"use client";

import { useState } from "react";
import { TouchControlsMode, TouchControlsScheme } from "@/lib/touchControlsSettings";
// Reuses ConfigPanel's classes (CSS Modules scope per source file, so this
// is safe) rather than duplicating them.
import styles from "./ConfigPanel.module.css";

interface InputSettingsProps {
  touchControlsMode: TouchControlsMode;
  onTouchControlsModeChange: (mode: TouchControlsMode) => void;
  touchControlsScheme: TouchControlsScheme;
  onTouchControlsSchemeChange: (scheme: TouchControlsScheme) => void;
}

// Separate from ConfigPanel (level/gameplay config, reset on level switch)
// — these are player preferences that must survive one.
export default function InputSettings({
  touchControlsMode,
  onTouchControlsModeChange,
  touchControlsScheme,
  onTouchControlsSchemeChange,
}: InputSettingsProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.wrapper}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={styles.toggleButton}
        aria-expanded={open}
      >
        ⌨ Input settings {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className={styles.panel}>
          <div className={styles.grid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Touch controls</span>
              <select
                value={touchControlsMode}
                onChange={(e) => onTouchControlsModeChange(e.target.value as TouchControlsMode)}
                className={styles.fieldInput}
              >
                <option value={TouchControlsMode.Auto}>Auto (shown on touch devices)</option>
                <option value={TouchControlsMode.Show}>Always show</option>
                <option value={TouchControlsMode.Hide}>Always hide</option>
              </select>
              <span className={styles.fieldDescription}>
                Auto matches whether your device reports a touch (vs. mouse) pointer.
              </span>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Touch control style</span>
              <select
                value={touchControlsScheme}
                onChange={(e) => onTouchControlsSchemeChange(e.target.value as TouchControlsScheme)}
                className={styles.fieldInput}
              >
                <option value={TouchControlsScheme.Dpad}>D-pad (Up/Down/Left/Right)</option>
                <option value={TouchControlsScheme.Relative}>Relative turns (Left/U-turn/U-turn/Right)</option>
              </select>
              <span className={styles.fieldDescription}>
                Relative turns steer left/right from whichever way the snake is currently facing.
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
