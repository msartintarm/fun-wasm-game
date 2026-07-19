"use client";

import { useState } from "react";
import {
  CONFIG_FIELDS,
  CONFIG_SELECT_FIELDS,
  type FoodTargeting,
  type FullConfig,
} from "@/lib/gameConfig";
import styles from "./ConfigPanel.module.css";

interface ConfigPanelProps {
  config: FullConfig;
  defaults: FullConfig;
  onApply: (config: FullConfig) => void;
}

export default function ConfigPanel({ config, defaults, onApply }: ConfigPanelProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FullConfig>(config);
  // Tracks the last `config` the draft was synced to, so a prop change
  // (level switch, restart with edited settings, etc.) can reset the draft
  // during render rather than via an effect — avoids the extra render pass
  // an effect would cost, and setState-during-render is the sanctioned way
  // to derive state from a changed prop.
  const [syncedConfig, setSyncedConfig] = useState(config);
  if (config !== syncedConfig) {
    setSyncedConfig(config);
    setDraft(config);
  }

  function updateField(key: keyof FullConfig, value: number) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function updateSelectField(key: "foodTargeting", value: FoodTargeting) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  // The browser's native constraint validation (required + min/max on each
  // input) runs before a form submit fires, so this only ever executes
  // with a draft that already satisfies every field's bounds — no need to
  // re-check here.
  function handleApply(e: React.FormEvent) {
    e.preventDefault();
    onApply(draft);
  }

  function handleReset() {
    setDraft(defaults);
    onApply(defaults);
  }

  return (
    <div className={styles.wrapper}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={styles.toggleButton}
        aria-expanded={open}
      >
        ⚙ Level settings {open ? "▲" : "▼"}
      </button>
      {open && (
        <form className={styles.panel} onSubmit={handleApply}>
          <p className={styles.legend}>
            Boosts stack from three sources: near another snake, after eating
            food, or along the arena&apos;s edge. AI Snake 1 (😈) picks its
            path to chase whichever boost gets it to food fastest. AI Snake 2
            (🐱) can ignore food it can&apos;t currently reach — see &quot;AI
            Snake 2 food targeting&quot; below.
          </p>
          <div className={styles.grid}>
            {CONFIG_FIELDS.map((field) => (
              <label key={field.key} className={styles.field}>
                <span className={styles.fieldLabel}>{field.label}</span>
                <input
                  type="number"
                  required
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={draft[field.key]}
                  onChange={(e) => updateField(field.key, Number(e.target.value))}
                  className={styles.fieldInput}
                />
                <span className={styles.fieldDescription}>{field.description}</span>
              </label>
            ))}
            {CONFIG_SELECT_FIELDS.map((field) => (
              <label key={field.key} className={styles.field}>
                <span className={styles.fieldLabel}>{field.label}</span>
                <select
                  required
                  value={draft[field.key]}
                  onChange={(e) =>
                    updateSelectField(field.key, e.target.value as FoodTargeting)
                  }
                  className={styles.fieldInput}
                >
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className={styles.fieldDescription}>{field.description}</span>
              </label>
            ))}
          </div>
          <div className={styles.actions}>
            <button type="submit" className={styles.applyButton}>
              Apply &amp; Restart
            </button>
            <button type="button" onClick={handleReset} className={styles.resetButton}>
              Reset to Defaults
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
