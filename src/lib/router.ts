import { useSyncExternalStore } from 'react';

// Hash routing works on any static host (GitHub Pages included) with no rewrites.

function subscribe(fn: () => void) {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash.replace(/^#/, '') || '/');
}

export function go(path: string) {
  window.location.hash = path;
}
