import * as Tone from "tone";

// Two independent buses so music and sound-effect volume/mute are
// controllable separately — both engines route their background
// track/synth through musicBus and their pickup sound through
// effectsBus instead of straight to the master destination. Module-level
// singletons: whichever engine module (midiEngine.ts / audioFileEngine.ts)
// gets dynamically imported first, both end up importing this exact same
// cached module instance, so the two buses are genuinely shared state
// regardless of which EngineKind is active.
export const musicBus = new Tone.Volume(0).toDestination();
export const effectsBus = new Tone.Volume(0).toDestination();

// A fixed mix-balance trim on top of whatever the user's own music slider
// is set to (~5% quieter than sound effects, which have no such trim) —
// a mixing decision, not a UI default, so it applies regardless of the
// slider's current or stored position.
const MUSIC_MIX_TRIM = 0.95;

export function setMusicVolume(volume: number) {
  musicBus.volume.value = Tone.gainToDb(Math.max(0, Math.min(1, volume)) * MUSIC_MIX_TRIM);
}

export function setMusicMuted(muted: boolean) {
  musicBus.mute = muted;
}

export function setEffectsVolume(volume: number) {
  effectsBus.volume.value = Tone.gainToDb(Math.max(0, Math.min(1, volume)));
}

export function setEffectsMuted(muted: boolean) {
  effectsBus.mute = muted;
}
