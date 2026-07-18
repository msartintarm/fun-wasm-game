"use client";

import { useState } from "react";
import { CONFIG_FIELDS, type FullConfig } from "@/lib/gameConfig";

interface ConfigPanelProps {
  config: FullConfig;
  defaults: FullConfig;
  onApply: (config: FullConfig) => void;
}

export default function ConfigPanel({ config, defaults, onApply }: ConfigPanelProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FullConfig>(config);

  function updateField(key: keyof FullConfig, value: number) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function handleApply() {
    onApply(draft);
  }

  function handleReset() {
    setDraft(defaults);
    onApply(defaults);
  }

  return (
    <div className="w-full max-w-2xl">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-left text-sm font-medium text-zinc-200 hover:bg-zinc-800"
        aria-expanded={open}
      >
        ⚙ Game settings {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {CONFIG_FIELDS.map((field) => (
              <label key={field.key} className="flex flex-col gap-1 text-sm text-zinc-300">
                <span className="font-medium text-zinc-100">{field.label}</span>
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={draft[field.key]}
                  onChange={(e) => updateField(field.key, Number(e.target.value))}
                  className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-50 focus:border-zinc-400 focus:outline-none"
                />
                <span className="text-xs text-zinc-500">{field.description}</span>
              </label>
            ))}
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={handleApply}
              className="rounded-full bg-zinc-50 px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
            >
              Apply &amp; Restart
            </button>
            <button
              onClick={handleReset}
              className="rounded-full border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
            >
              Reset to Defaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
