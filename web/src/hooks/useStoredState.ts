"use client";

import { useCallback, useSyncExternalStore } from "react";

// "storage" events only fire in *other* tabs, so same-tab writes need this
// to notify useSyncExternalStore.
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

// SSR-safe localStorage-backed value: getServerSnapshot returns
// `serverValue` (matching what the server rendered), getSnapshot reads the
// real client value — this is what useSyncExternalStore is for.
export function useStoredState<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string,
  serverValue: T,
): [T, (value: T) => void] {
  const getSnapshot = useCallback(() => parse(window.localStorage.getItem(key)), [key, parse]);
  const getServerSnapshot = useCallback(() => serverValue, [serverValue]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: T) => {
      window.localStorage.setItem(key, serialize(next));
      notify();
    },
    [key, serialize],
  );

  return [value, setValue];
}
