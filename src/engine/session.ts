import { dayIndex } from './dates';

// Session builder: one tap → a Daily Mix of 60–90 s rounds, a different
// exercise each round, themed by day, with an occasional surprise bonus.

export type RoundType = 'match' | 'octave' | 'ladder' | 'drone' | 'ear-degrees' | 'ear-hl' | 'ear-intervals' | 'ear-octave';
export type Theme = 'octave' | 'drone' | 'ear' | 'mystery';
export type Bonus = 'hold' | 'ears-only' | 'reverse-scale' | 'note-of-day' | 'new-timbre';

export const ROUND_LABEL: Record<RoundType, string> = {
  match: 'Pitch Match',
  octave: 'Octave Jump',
  ladder: 'Scale Ladder',
  drone: 'Drone challenge',
  'ear-degrees': 'Scale degrees',
  'ear-hl': 'Higher or lower',
  'ear-intervals': 'Intervals',
  'ear-octave': 'Which octave?',
};

export const THEME_LABEL: Record<Theme, string> = { octave: 'Octave Day', drone: 'Drone Day', ear: 'Ear Day', mystery: 'Mystery Mix' };

export const BONUS_LABEL: Record<Bonus, string> = {
  hold: 'Longest steady hold',
  'ears-only': 'Ears-only round',
  'reverse-scale': 'Reverse scale',
  'note-of-day': 'Note of the day check',
  'new-timbre': 'New sound',
};

export const EAR_TYPES: RoundType[] = ['ear-degrees', 'ear-hl', 'ear-intervals', 'ear-octave'];
export const SING_TYPES: RoundType[] = ['match', 'octave', 'ladder', 'drone'];
export const isEar = (t: RoundType) => t.startsWith('ear-');

export interface Round {
  type: RoundType;
  seconds: number;
  bonus?: Bonus;
}

export interface SessionPlan {
  theme: Theme;
  minutes: number;
  rounds: Round[];
  silent: boolean;
}

const BASE: Record<RoundType, number> = {
  match: 3,
  octave: 2,
  ladder: 2,
  drone: 1.5,
  'ear-degrees': 2,
  'ear-hl': 1,
  'ear-intervals': 1.5,
  'ear-octave': 1,
};

export function themeFor(key: string): Theme {
  const themes: Theme[] = ['octave', 'drone', 'ear', 'mystery'];
  return themes[((dayIndex(key) % 4) + 4) % 4];
}

export function themeWeights(theme: Theme, rand: () => number): Record<RoundType, number> {
  const w = { ...BASE };
  if (theme === 'octave') {
    w.octave = 6;
    w['ear-octave'] = 3;
  } else if (theme === 'drone') {
    w.drone = 6;
    w.ladder = 3;
  } else if (theme === 'ear') {
    for (const t of EAR_TYPES) w[t] *= 3;
    for (const t of SING_TYPES) w[t] *= 0.5;
  } else {
    for (const t of Object.keys(w) as RoundType[]) w[t] = 0.5 + rand() * 3;
  }
  return w;
}

export interface BuildOptions {
  minutes: number;
  dateKey: string;
  rand: () => number;
  /** ear-only: no singing (bus, bed) */
  silent?: boolean;
  /** note of the day memorised but not yet sung today */
  noteOfDayPending?: boolean;
  /** chance of a surprise bonus round */
  bonusChance?: number;
}

export function buildSession(o: BuildOptions): SessionPlan {
  const theme = themeFor(o.dateKey);
  const weights = themeWeights(theme, o.rand);
  const allowed = (Object.keys(weights) as RoundType[]).filter((t) => (o.silent ? isEar(t) : true));
  const total = o.minutes * 60;
  const rounds: Round[] = [];
  const counts: Partial<Record<RoundType, number>> = {};
  let sum = 0;
  while (sum < total) {
    const maxEach = Math.max(1, Math.ceil((total / 75) / 2));
    const prev = rounds[rounds.length - 1]?.type;
    let pool = allowed.filter((t) => t !== prev && (counts[t] ?? 0) < maxEach);
    if (!pool.length) pool = allowed.filter((t) => t !== prev);
    if (!pool.length) pool = allowed;
    const type = pick(pool, (t) => weights[t], o.rand);
    let seconds = 60 + 15 * Math.floor(o.rand() * 3); // 60, 75 or 90
    seconds = Math.min(seconds, Math.max(60, total - sum));
    rounds.push({ type, seconds });
    counts[type] = (counts[type] ?? 0) + 1;
    sum += seconds;
  }

  // ~1 session in 4: a surprise bonus round in the middle.
  if (!o.silent && o.rand() < (o.bonusChance ?? 0.25) && rounds.length >= 2) {
    const bonuses: Bonus[] = ['hold', 'ears-only', 'reverse-scale', 'new-timbre'];
    if (o.noteOfDayPending) bonuses.push('note-of-day', 'note-of-day');
    const bonus = bonuses[Math.floor(o.rand() * bonuses.length)];
    const type: RoundType = bonus === 'hold' ? 'drone' : bonus === 'reverse-scale' ? 'ladder' : 'match';
    const at = Math.max(1, Math.floor(rounds.length / 2));
    rounds.splice(at, 0, { type, seconds: bonus === 'note-of-day' ? 45 : 60, bonus });
    // The bonus replaces time, it doesn't add to it.
    let sum2 = rounds.reduce((x, r) => x + r.seconds, 0);
    while (sum2 > total + 30 && rounds.length > 2 && !rounds[rounds.length - 1].bonus) sum2 -= rounds.pop()!.seconds;
  }
  return { theme, minutes: o.minutes, rounds, silent: !!o.silent };
}

function pick<T>(items: T[], w: (t: T) => number, rand: () => number): T {
  const ws = items.map(w);
  let x = rand() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    x -= ws[i];
    if (x <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** "One more round?" — a round of a type not used last. */
export function extraRound(plan: SessionPlan, rand: () => number): Round {
  const last = plan.rounds[plan.rounds.length - 1]?.type;
  const pool = (Object.keys(BASE) as RoundType[]).filter((t) => t !== last && (!plan.silent || isEar(t)));
  return { type: pool[Math.floor(rand() * pool.length)], seconds: 75 };
}

export interface RoundResult {
  type: RoundType;
  bonus?: Bonus;
  n: number;
  ok: number;
  bests: string[];
  seconds: number;
}

export interface SavedSession {
  date: string;
  plan: SessionPlan;
  index: number;
  /** seconds left in the current round */
  remaining: number;
  results: RoundResult[];
}

/** Drone rounds pick one challenge. */
export const DRONE_VARIANTS = ['hold', 'degree', 'slide'] as const;
