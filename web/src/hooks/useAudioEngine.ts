"use client";

import { useCallback, useEffect, useMemo } from "react";
import { getAudioEngine } from "@/lib/audio/audioEngine";
import type { MusicTrackId } from "@/lib/audio/tracks";

export interface AudioController {
  armAutoplay: () => void;
  startTrack: (id: MusicTrackId | undefined) => void;
  stopTrack: () => void;
  triggerPickup: () => void;
}

// Thin, stable wrapper over the AudioEngine singleton — GameCanvas depends
// on this, not on lib/audio directly, so the engine's own lifecycle
// (lazy-loaded, may still be NullAudioEngine on the first few calls) stays
// out of component code.
export function useAudioEngine(): AudioController {
  const armAutoplay = useCallback(() => getAudioEngine().resume(), []);
  const startTrack = useCallback((id: MusicTrackId | undefined) => getAudioEngine().startTrack(id), []);
  const stopTrack = useCallback(() => getAudioEngine().stopTrack(), []);
  const triggerPickup = useCallback(() => getAudioEngine().triggerPickup(), []);

  useEffect(() => {
    return () => stopTrack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Referentially stable across renders (all four members are already
  // stable useCallbacks) — matters because GameCanvas puts this object in
  // dependency arrays; a fresh object every render would cascade
  // unnecessary re-creation through startGame/switchLevel/etc.
  return useMemo(
    () => ({ armAutoplay, startTrack, stopTrack, triggerPickup }),
    [armAutoplay, startTrack, stopTrack, triggerPickup],
  );
}
