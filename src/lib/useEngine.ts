import { useSyncExternalStore } from 'react';
import { engine } from '../audio';

export function useEngineStatus() {
  return useSyncExternalStore(
    (fn) => engine.subscribe(fn),
    () => engine.status,
  );
}

/** Re-render on any engine change (session type etc.). */
export function useEngineTick() {
  return useSyncExternalStore(
    (fn) => engine.subscribe(fn),
    () => `${engine.status}|${engine.sessionType}|${engine.recreations}`,
  );
}
