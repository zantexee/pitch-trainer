import { cents, foldCents } from '../lib/notes';

// Scoring of a single sung attempt against a target frequency.

export interface PitchSample {
  /** ms since the attempt started listening */
  t: number;
  /** smoothed pitch, or null when nothing was read */
  freq: number | null;
}

export interface ScoreOptions {
  toleranceCents: number;
  /** "Locked" = inside tolerance continuously for this long. */
  holdMs: number;
  /** Ignore this long after voice onset when measuring accuracy (singers scoop in). */
  scoopMs: number;
  /** Must stay inside tolerance this long to count as settled. */
  settleDwellMs: number;
}

export const DEFAULT_SCORE_OPTIONS: ScoreOptions = {
  toleranceCents: 50,
  holdMs: 1000,
  scoopMs: 150,
  settleDwellMs: 200,
};

export type Verdict = 'locked' | 'close' | 'octave' | 'off' | 'unreadable';

export interface AttemptScore {
  verdict: Verdict;
  /** ms from attempt start to first voiced sample */
  onsetMs: number | null;
  /** ms from onset until the voice entered tolerance and stayed for settleDwellMs */
  settleMs: number | null;
  /** mean |cents| vs the exact target (after the scoop window) */
  accuracy: number | null;
  /** mean signed cents (after scoop) – tells sharp vs flat */
  meanCents: number | null;
  /** SD of cents (after scoop) */
  stability: number | null;
  /** most common whole-octave offset: -1 = an octave low */
  octave: number;
  /** mean |pitch-class error| in cents, octave ignored */
  pcAccuracy: number | null;
  longestHoldMs: number;
  locked: boolean;
  voicedMs: number;
}

export type Zone = 'in' | 'close' | 'off';

/** Live feedback colour zone: in tolerance, within 2x tolerance, or off. */
export function zoneFor(centsErr: number, toleranceCents: number): Zone {
  const a = Math.abs(centsErr);
  if (a <= toleranceCents) return 'in';
  if (a <= 2 * toleranceCents) return 'close';
  return 'off';
}

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
}

/** Longest continuous run (ms) of samples satisfying `pred`, starting at or after `from`. */
function longestRun(samples: PitchSample[], pred: (s: PitchSample) => boolean, from = -Infinity): number {
  let best = 0;
  let start: number | null = null;
  for (const s of samples) {
    if (s.t < from) continue;
    if (pred(s)) {
      if (start == null) start = s.t;
      best = Math.max(best, s.t - start);
    } else {
      start = null;
    }
  }
  return best;
}

export function scoreAttempt(samples: PitchSample[], targetHz: number, options: Partial<ScoreOptions> = {}): AttemptScore {
  const o = { ...DEFAULT_SCORE_OPTIONS, ...options };
  const voiced = samples.filter((s): s is { t: number; freq: number } => s.freq != null && s.freq > 0);
  const empty: AttemptScore = {
    verdict: 'unreadable',
    onsetMs: null,
    settleMs: null,
    accuracy: null,
    meanCents: null,
    stability: null,
    octave: 0,
    pcAccuracy: null,
    longestHoldMs: 0,
    locked: false,
    voicedMs: 0,
  };
  if (voiced.length < 3) return empty;

  const onset = voiced[0].t;
  const scored = voiced.filter((s) => s.t >= onset + o.scoopMs);
  const use = scored.length >= 3 ? scored : voiced;
  const cs = use.map((s) => cents(s.freq, targetHz));

  // Octave: most common fold offset.
  const counts = new Map<number, number>();
  const pcs: number[] = [];
  for (const c of cs) {
    const f = foldCents(c);
    counts.set(f.octave, (counts.get(f.octave) ?? 0) + 1);
    pcs.push(f.pcCents);
  }
  let octave = 0;
  let bestCount = -1;
  for (const [oct, n] of counts) {
    if (n > bestCount || (n === bestCount && Math.abs(oct) < Math.abs(octave))) {
      octave = oct;
      bestCount = n;
    }
  }

  const inTol = (s: PitchSample) => s.freq != null && Math.abs(cents(s.freq, targetHz)) <= o.toleranceCents;

  // Settle: first time t >= onset from which we stay in tolerance for settleDwellMs.
  let settleMs: number | null = null;
  let runStart: number | null = null;
  for (const s of samples) {
    if (s.t < onset) continue;
    if (inTol(s)) {
      if (runStart == null) runStart = s.t;
      if (s.t - runStart >= o.settleDwellMs) {
        settleMs = runStart - onset;
        break;
      }
    } else {
      runStart = null;
    }
  }

  const longestHoldMs = longestRun(samples, inTol, onset);
  const locked = longestHoldMs >= o.holdMs;
  const accuracy = mean(cs.map(Math.abs));
  const pcAccuracy = mean(pcs.map(Math.abs));

  let verdict: Verdict;
  if (octave !== 0 && pcAccuracy <= 2 * o.toleranceCents) verdict = 'octave';
  else if (locked) verdict = 'locked';
  else if (accuracy <= 2 * o.toleranceCents) verdict = 'close';
  else verdict = 'off';

  return {
    verdict,
    onsetMs: onset,
    settleMs,
    accuracy,
    meanCents: mean(cs),
    stability: sd(cs),
    octave,
    pcAccuracy,
    longestHoldMs,
    locked,
    voicedMs: voiced[voiced.length - 1].t - onset,
  };
}
