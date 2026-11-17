import { getSettings, updateSettings } from './settings';

// Personal bests. A first value is stored silently; only beating a previous
// best earns a message, so you aren't told "new best" on day one for everything.

export function recordBest(key: string, value: number, dir: 'max' | 'min' = 'max'): boolean {
  if (!Number.isFinite(value)) return false;
  const bests = getSettings().bests;
  const prev = bests[key];
  const better = prev == null || (dir === 'max' ? value > prev : value < prev);
  if (!better) return false;
  updateSettings({ bests: { ...bests, [key]: value } });
  return prev != null;
}

/** Consecutive successes in a visit, with a best-run check. */
export function nextRun(run: number, ok: boolean, key: string): { run: number; best: string | null } {
  const r = ok ? run + 1 : 0;
  const best = ok && r >= 3 && recordBest(key, r) ? `New best: ${r} in a row` : null;
  return { run: r, best };
}
