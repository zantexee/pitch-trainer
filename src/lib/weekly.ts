import { db, type Attempt } from '../db/db';
import { addDays, dateKey, startOfDayMs, weekStart } from '../engine/dates';
import { MIN_SECONDS, type PracticeLog } from '../engine/streaks';

export interface WeekStats {
  days: number;
  minutes: number;
  attempts: number;
  pct: number | null;
}

export interface WeeklySummary {
  thisWeek: WeekStats;
  lastWeek: WeekStats;
  /** module with the biggest accuracy gain vs last week */
  improved: { module: string; from: number; to: number } | null;
}

export const MODULE_LABEL: Record<string, string> = {
  'pitch-match': 'Pitch Match',
  'octave-jump': 'Octave Jump',
  'scale-ladder': 'Scale Ladder',
  'drone-hold': 'Drone hold',
  'drone-degree': 'Drone intervals',
  'drone-slide': 'Drone slides',
  'ear-higher-lower': 'Higher or lower',
  'ear-degree': 'Scale degrees',
  'ear-interval': 'Intervals',
  'ear-octave': 'Which octave?',
  'note-of-day': 'Note of the day',
};

const ok = (a: Attempt) => a.result === 'success';

function weekStats(log: PracticeLog, attempts: Attempt[], from: string, today: string): WeekStats {
  let days = 0;
  let secs = 0;
  for (let i = 0; i < 7; i++) {
    const k = addDays(from, i);
    if (k > today) break;
    secs += log[k] ?? 0;
    if ((log[k] ?? 0) >= MIN_SECONDS) days++;
  }
  const n = attempts.length;
  return { days, minutes: Math.round(secs / 60), attempts: n, pct: n ? Math.round((100 * attempts.filter(ok).length) / n) : null };
}

export async function weeklySummary(log: PracticeLog, today = dateKey()): Promise<WeeklySummary> {
  const ws = weekStart(today);
  const prev = addDays(ws, -7);
  const t0 = startOfDayMs(prev);
  const t1 = startOfDayMs(ws);
  let all: Attempt[] = [];
  try {
    all = await db.attempts.where('ts').aboveOrEqual(t0).toArray();
  } catch {
    /* ignore */
  }
  const last = all.filter((a) => a.ts < t1);
  const cur = all.filter((a) => a.ts >= t1);
  let improved: WeeklySummary['improved'] = null;
  for (const m of new Set(cur.map((a) => a.module))) {
    const A = last.filter((a) => a.module === m);
    const B = cur.filter((a) => a.module === m);
    if (A.length < 5 || B.length < 5) continue;
    const from = Math.round((100 * A.filter(ok).length) / A.length);
    const to = Math.round((100 * B.filter(ok).length) / B.length);
    if (to - from >= 5 && (!improved || to - from > improved.to - improved.from)) improved = { module: m, from, to };
  }
  return { thisWeek: weekStats(log, cur, ws, today), lastWeek: weekStats(log, last, prev, today), improved };
}
