// Round summaries for drills: percentage, best streak, where the problems
// were (per dimension), and the most common mix-ups.

export interface TrialRecord {
  correct: boolean;
  /** dimension key → value, e.g. { size: '< 10¢', dir: 'lower' } */
  tags: Record<string, string>;
  expected?: string;
  answer?: string;
}

export interface Dimension {
  key: string;
  label: string;
  /** optional display order of values */
  order?: string[];
}

export interface Group {
  value: string;
  n: number;
  ok: number;
  pct: number;
}

export interface Problem {
  dimension: string;
  value: string;
  misses: number;
  n: number;
  pct: number;
}

export interface RoundSummary {
  n: number;
  ok: number;
  pct: number;
  bestStreak: number;
  dims: { key: string; label: string; groups: Group[] }[];
  problems: Problem[];
  confusions: { expected: string; answer: string; count: number }[];
}

export function bestStreak(trials: TrialRecord[]): number {
  let best = 0;
  let cur = 0;
  for (const t of trials) {
    cur = t.correct ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

export function currentStreak(trials: TrialRecord[]): number {
  let n = 0;
  for (let i = trials.length - 1; i >= 0 && trials[i].correct; i--) n++;
  return n;
}

export function summarizeRound(trials: TrialRecord[], dims: Dimension[]): RoundSummary {
  const n = trials.length;
  const ok = trials.filter((t) => t.correct).length;
  const pct = n ? Math.round((100 * ok) / n) : 0;
  const overallMiss = n ? (n - ok) / n : 0;

  const outDims = dims.map((d) => {
    const map = new Map<string, Group>();
    for (const t of trials) {
      const v = t.tags[d.key];
      if (v == null) continue;
      const g = map.get(v) ?? { value: v, n: 0, ok: 0, pct: 0 };
      g.n++;
      if (t.correct) g.ok++;
      map.set(v, g);
    }
    const groups = [...map.values()].map((g) => ({ ...g, pct: Math.round((100 * g.ok) / g.n) }));
    if (d.order) groups.sort((a, b) => d.order!.indexOf(a.value) - d.order!.indexOf(b.value));
    else groups.sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
    return { key: d.key, label: d.label, groups };
  });

  // A problem: at least 2 misses and a miss rate clearly above the round's average.
  const problems: Problem[] = [];
  for (const d of outDims) {
    if (d.groups.length < 2) continue;
    for (const g of d.groups) {
      const misses = g.n - g.ok;
      const rate = misses / g.n;
      if (misses >= 2 && rate > overallMiss + 0.1) problems.push({ dimension: d.label, value: g.value, misses, n: g.n, pct: g.pct });
    }
  }
  problems.sort((a, b) => b.misses / b.n - a.misses / a.n || b.misses - a.misses);

  const conf = new Map<string, { expected: string; answer: string; count: number }>();
  for (const t of trials) {
    if (t.correct || t.expected == null || t.answer == null) continue;
    const k = `${t.expected}→${t.answer}`;
    const c = conf.get(k) ?? { expected: t.expected, answer: t.answer, count: 0 };
    c.count++;
    conf.set(k, c);
  }
  const confusions = [...conf.values()].filter((c) => c.count >= 2).sort((a, b) => b.count - a.count).slice(0, 3);

  return { n, ok, pct, bestStreak: bestStreak(trials), dims: outDims, problems: problems.slice(0, 3), confusions };
}

/** Higher-or-lower tags. */
export function hlTags(deltaCents: number, dir: 'higher' | 'lower', baseHz: number): Record<string, string> {
  const size = deltaCents < 10 ? '< 10¢' : deltaCents < 25 ? '10–25¢' : deltaCents < 50 ? '25–50¢' : '50¢ +';
  const reg = baseHz < 300 ? 'low' : baseHz < 450 ? 'middle' : 'high';
  return { size, dir: dir === 'higher' ? '2nd tone higher' : '2nd tone lower', reg };
}
export const HL_DIMS: Dimension[] = [
  { key: 'size', label: 'Difference', order: ['< 10¢', '10–25¢', '25–50¢', '50¢ +'] },
  { key: 'dir', label: 'Direction', order: ['2nd tone higher', '2nd tone lower'] },
  { key: 'reg', label: 'Pitch area', order: ['low', 'middle', 'high'] },
];
