// Adaptive staircase for pitch discrimination (Higher or lower?).
// 2-down / 1-up converges on ~70.7% correct. Steps are multiplicative so the
// staircase moves quickly from 100¢ down to a few cents.

export interface Staircase {
  /** current difference in cents */
  delta: number;
  /** consecutive correct answers at this level */
  streak: number;
  /** last direction moved: -1 down (harder), +1 up (easier), 0 none */
  lastDir: -1 | 0 | 1;
  /** deltas at which the direction reversed */
  reversals: number[];
  trials: number;
}

export interface StaircaseConfig {
  start: number;
  min: number;
  max: number;
  down: number; // factor on success (harder)
  up: number; // factor on miss (easier)
  /** reversals averaged for the threshold estimate */
  reversalsForEstimate: number;
}

export const DEFAULT_STAIRCASE: StaircaseConfig = { start: 100, min: 1, max: 300, down: 0.75, up: 1.5, reversalsForEstimate: 6 };

export function newStaircase(cfg: StaircaseConfig = DEFAULT_STAIRCASE, start = cfg.start): Staircase {
  return { delta: start, streak: 0, lastDir: 0, reversals: [], trials: 0 };
}

export function stepStaircase(s: Staircase, correct: boolean, cfg: StaircaseConfig = DEFAULT_STAIRCASE): Staircase {
  let { delta, streak, lastDir } = s;
  const reversals = [...s.reversals];
  let dir: -1 | 0 | 1 = 0;
  if (correct) {
    streak++;
    // Before the first reversal, move down after every correct answer to get there fast.
    if (streak >= 2 || reversals.length === 0) {
      dir = -1;
      streak = 0;
    }
  } else {
    dir = 1;
    streak = 0;
  }
  if (dir !== 0) {
    if (lastDir !== 0 && dir !== lastDir) reversals.push(delta);
    delta = dir < 0 ? delta * cfg.down : delta * cfg.up;
    delta = Math.min(cfg.max, Math.max(cfg.min, delta));
    lastDir = dir;
  }
  return { delta, streak, lastDir, reversals, trials: s.trials + 1 };
}

/** Threshold estimate: geometric mean of the last few reversals (null until enough). */
export function thresholdEstimate(s: Staircase, cfg: StaircaseConfig = DEFAULT_STAIRCASE): number | null {
  const r = s.reversals.slice(-cfg.reversalsForEstimate);
  if (r.length < 4) return null;
  return Math.exp(r.reduce((a, b) => a + Math.log(b), 0) / r.length);
}
