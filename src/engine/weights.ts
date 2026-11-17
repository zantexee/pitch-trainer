// Weak-spot targeting: weighted random choice where items you get wrong come up more.

export interface Stat {
  n: number;
  ok: number;
}

/** Weight for an item: 1 (mastered) … 3 (always wrong); unknown items sit in the middle. */
export function weakness(stat: Stat | undefined, minN = 3): number {
  const rate = stat && stat.n >= minN ? stat.ok / stat.n : 0.5;
  return 1 + 2 * (1 - rate);
}

export function weightedPick<T>(items: T[], weight: (t: T) => number, rand: () => number): T {
  const w = items.map(weight);
  const total = w.reduce((a, b) => a + b, 0);
  let x = rand() * total;
  for (let i = 0; i < items.length; i++) {
    x -= w[i];
    if (x <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function statsFromHistory(history: Record<string, boolean[]>): Record<string, Stat> {
  const out: Record<string, Stat> = {};
  for (const [k, v] of Object.entries(history)) out[k] = { n: v.length, ok: v.filter(Boolean).length };
  return out;
}

export function bump(stats: Record<string, Stat>, key: string, ok: boolean): Record<string, Stat> {
  const s = stats[key] ?? { n: 0, ok: 0 };
  return { ...stats, [key]: { n: s.n + 1, ok: s.ok + (ok ? 1 : 0) } };
}
