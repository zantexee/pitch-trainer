import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../db/db';

// In-memory settings cache backed by IndexedDB.

let current: Settings = DEFAULT_SETTINGS;
let loaded = false;
/** false until IndexedDB has answered (so first-run checks don't flash) */
export const isSettingsLoaded = () => loaded;
const listeners = new Set<() => void>();

export const settingsReady: Promise<Settings> = loadSettings()
  .then((s) => {
    current = s;
    loaded = true;
    listeners.forEach((l) => l());
    return s;
  })
  .catch(() => {
    loaded = true;
    listeners.forEach((l) => l());
    return current;
  });

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  listeners.forEach((l) => l());
  void saveSettings(current).catch(() => {});
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}
