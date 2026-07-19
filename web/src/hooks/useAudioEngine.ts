"use client";

import { useCallback, useEffect, useMemo } from "react";
import { AudioCommandType, getAudioEngine, type AudioCommand, type EngineKind } from "@/lib/audio/audioEngine";
import type { MusicState, MusicTrackId } from "@/lib/audio/tracks";

export interface AudioController {
  armAutoplay: () => void;
  startTrack: (id: MusicTrackId | undefined) => void;
  stopTrack: () => void;
  triggerPickup: () => void;
  setMusicMuted: (muted: boolean) => void;
  setMusicVolume: (volume: number) => void;
  setEffectsMuted: (muted: boolean) => void;
  setEffectsVolume: (volume: number) => void;
  setMusicState: (state: MusicState) => void;
}

// Thin, stable wrapper over the AudioEngine singleton — GameCanvas depends
// on this, not on lib/audio directly, so the engine's own lifecycle
// (lazy-loaded, may still be NullAudioEngine on the first few calls) stays
// out of component code. Named methods here are just ergonomic call sites
// over dispatch() — GameCanvas.tsx keeps calling audio.armAutoplay() etc.
// unchanged; only kind (which engine dispatch targets) is new.
export function useAudioEngine(kind: EngineKind): AudioController {
  const dispatch = useCallback((c: AudioCommand) => getAudioEngine(kind)(c), [kind]);

  const armAutoplay = useCallback(() => dispatch({ type: AudioCommandType.Resume }), [dispatch]);
  const startTrack = useCallback(
    (id: MusicTrackId | undefined) => dispatch({ type: AudioCommandType.StartTrack, id }),
    [dispatch],
  );
  const stopTrack = useCallback(() => dispatch({ type: AudioCommandType.StopTrack }), [dispatch]);
  const triggerPickup = useCallback(() => dispatch({ type: AudioCommandType.TriggerPickup }), [dispatch]);
  const setMusicMuted = useCallback(
    (muted: boolean) => dispatch({ type: AudioCommandType.SetMusicMuted, muted }),
    [dispatch],
  );
  const setMusicVolume = useCallback(
    (volume: number) => dispatch({ type: AudioCommandType.SetMusicVolume, volume }),
    [dispatch],
  );
  const setEffectsMuted = useCallback(
    (muted: boolean) => dispatch({ type: AudioCommandType.SetEffectsMuted, muted }),
    [dispatch],
  );
  const setEffectsVolume = useCallback(
    (volume: number) => dispatch({ type: AudioCommandType.SetEffectsVolume, volume }),
    [dispatch],
  );
  const setMusicState = useCallback(
    (state: MusicState) => dispatch({ type: AudioCommandType.SetMusicState, state }),
    [dispatch],
  );

  useEffect(() => {
    return () => stopTrack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Referentially stable across renders (every member is already a stable
  // useCallback) — matters because GameCanvas puts this object in
  // dependency arrays; a fresh object every render would cascade
  // unnecessary re-creation through startGame/switchLevel/etc. Changes
  // identity when `kind` changes, which is correct — a different engine
  // kind really is a different controller.
  return useMemo(
    () => ({
      armAutoplay,
      startTrack,
      stopTrack,
      triggerPickup,
      setMusicMuted,
      setMusicVolume,
      setEffectsMuted,
      setEffectsVolume,
      setMusicState,
    }),
    [armAutoplay, startTrack, stopTrack, triggerPickup, setMusicMuted, setMusicVolume, setEffectsMuted, setEffectsVolume, setMusicState],
  );
}
