import type { MusicState, MusicTrackId } from "./tracks";

// Every side effect an engine can perform, as data. An engine is then just
// a function that interprets commands — not an object of six methods.
// Two things fall out of this for free:
// - the load-before-ready proxy in getAudioEngine() below is one line
//   ("queue commands, replay them once loaded") instead of one
//   hand-written wrapper per method;
// - "does this engine support everything the other one does" becomes a
//   TypeScript-checked exhaustive switch inside each implementation
//   (midiEngine.ts / audioFileEngine.ts), not six independently
//   maintained method bodies that can silently drift apart.
export enum AudioCommandType {
  Resume = "resume",
  StartTrack = "startTrack",
  StopTrack = "stopTrack",
  TriggerPickup = "triggerPickup",
  // Music and sound-effect volume/mute are independent channels (see
  // mixer.ts) — both engines route their background track/synth through
  // musicBus and their pickup sound through effectsBus, so these four
  // commands act on genuinely separate buses, not a shared master fader.
  SetMusicMuted = "setMusicMuted",
  SetMusicVolume = "setMusicVolume",
  SetEffectsMuted = "setEffectsMuted",
  SetEffectsVolume = "setEffectsVolume",
  SetMusicState = "setMusicState",
}

export type AudioCommand =
  | { type: AudioCommandType.Resume }
  | { type: AudioCommandType.StartTrack; id: MusicTrackId | undefined }
  | { type: AudioCommandType.StopTrack }
  | { type: AudioCommandType.TriggerPickup }
  | { type: AudioCommandType.SetMusicMuted; muted: boolean }
  | { type: AudioCommandType.SetMusicVolume; volume: number }
  | { type: AudioCommandType.SetEffectsMuted; muted: boolean }
  | { type: AudioCommandType.SetEffectsVolume; volume: number }
  // Reflects the player's current adaptive-music state (see MusicState:
  // idle / boosted / dead) — only audioFileEngine.ts acts on it (fades
  // layers in/out based on each one's audibleIn list); midiEngine.ts has
  // no layers, so it's a no-op there. Still a required case in both
  // engines' switches, via assertNever below.
  | { type: AudioCommandType.SetMusicState; state: MusicState };

export type AudioEngine = (command: AudioCommand) => void;

export const NullAudioEngine: AudioEngine = () => {};

// For a `default: return assertNever(command)` arm in each engine's
// dispatch switch — makes "every engine handles every command" an actual
// compile error on a missing case, not just a convention to remember.
export function assertNever(value: never): never {
  throw new Error(`Unhandled audio command: ${JSON.stringify(value)}`);
}

export enum EngineKind {
  Midi = "midi",
  Audio = "audio",
}

const ENGINE_LOADERS: Record<EngineKind, () => Promise<{ createEngine(): AudioEngine }>> = {
  [EngineKind.Midi]: () => import("./midiEngine"),
  [EngineKind.Audio]: () => import("./audioFileEngine"),
};

// Each kind gets its own permanent cache slot — no shared "current kind"
// pointer to mutate, so switching kinds can't race a still-in-flight load
// for whichever kind was previously selected against a newer one. "Which
// kind is selected" lives only as React state (see hooks/useAudioEngine.ts),
// passed in here as a plain argument.
const loaded: Partial<Record<EngineKind, AudioEngine>> = {};
const loading: Partial<Record<EngineKind, Promise<AudioEngine>>> = {};

function loadEngine(kind: EngineKind): Promise<AudioEngine> {
  if (!loading[kind]) {
    loading[kind] = ENGINE_LOADERS[kind]()
      .then((mod) => {
        const engine = mod.createEngine();
        loaded[kind] = engine;
        return engine;
      })
      .catch((err) => {
        console.warn(`Audio engine "${kind}" failed to load; continuing without sound.`, err);
        loaded[kind] = NullAudioEngine;
        return NullAudioEngine;
      });
  }
  return loading[kind]!;
}

// SSR-safe (no window access outside the dynamic import) and never throws —
// falls back to NullAudioEngine on any load or construction failure, so the
// game is always fully playable with no sound rather than broken.
export function getAudioEngine(kind: EngineKind): AudioEngine {
  if (typeof window === "undefined") {
    return NullAudioEngine;
  }
  if (loaded[kind]) {
    return loaded[kind]!;
  }

  // Not loaded yet (possibly not even started) — return a proxy that
  // queues each command and replays it, in order, once the real engine
  // resolves, instead of silently dropping commands issued before then
  // (e.g. the Play button firing "resume" then "startTrack" back to back).
  const pending = loadEngine(kind);
  return (command) => {
    pending.then((engine) => engine(command));
  };
}

// Pure — takes the registry as an explicit parameter rather than closing
// over a specific module-level constant, so the exact same function serves
// both midiEngine.ts's PRESET_TRACKS and audioFileEngine.ts's
// AUDIO_PRESET_TRACKS.
export function pickTrackForPreset(
  presetTracks: Record<string, MusicTrackId[]>,
  presetName: string,
  rng: () => number = Math.random,
): MusicTrackId | undefined {
  const candidates = presetTracks[presetName];
  if (!candidates || candidates.length === 0) return undefined;
  return candidates[Math.floor(rng() * candidates.length)];
}
