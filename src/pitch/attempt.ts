import { cents, foldCents, type FoldedError } from '../lib/notes';
import { scoreAttempt, zoneFor, type AttemptScore, type PitchSample, type Zone } from './scoring';

// Live state of one sung attempt: what the needle and the trace colour show,
// lock detection, and the final score.

export interface AttemptOptions {
  toleranceCents: number;
  holdMs: number;
}

export interface AttemptLive {
  cents: number | null;
  folded: FoldedError | null;
  zone: Zone | null;
  /** ms continuously inside tolerance so far */
  inTolMs: number;
  locked: boolean;
  /** true only on the frame where the lock happened */
  justLocked: boolean;
  voiced: boolean;
}

export class LiveAttempt {
  readonly targetHz: number;
  readonly opts: AttemptOptions;
  readonly samples: PitchSample[] = [];
  private t0: number | null = null;
  private runStart: number | null = null;
  locked = false;
  lockedAt: number | null = null;

  constructor(targetHz: number, opts: AttemptOptions) {
    this.targetHz = targetHz;
    this.opts = opts;
  }

  /** `t` in ms (any clock), `freq` smoothed Hz or null. */
  push(t: number, freq: number | null): AttemptLive {
    if (this.t0 == null) this.t0 = t;
    const rel = t - this.t0;
    this.samples.push({ t: rel, freq });
    if (freq == null) {
      this.runStart = null;
      return { cents: null, folded: null, zone: null, inTolMs: 0, locked: this.locked, justLocked: false, voiced: false };
    }
    const c = cents(freq, this.targetHz);
    const zone = zoneFor(c, this.opts.toleranceCents);
    let justLocked = false;
    if (zone === 'in') {
      this.runStart ??= rel;
    } else {
      this.runStart = null;
    }
    const inTolMs = this.runStart == null ? 0 : rel - this.runStart;
    if (!this.locked && inTolMs >= this.opts.holdMs) {
      this.locked = true;
      this.lockedAt = rel;
      justLocked = true;
    }
    return { cents: c, folded: foldCents(c), zone, inTolMs, locked: this.locked, justLocked, voiced: true };
  }

  /** ms since the first voiced sample */
  get voicedMs(): number {
    const first = this.samples.find((s) => s.freq != null);
    const last = this.samples[this.samples.length - 1];
    return first && last ? last.t - first.t : 0;
  }

  finish(): AttemptScore {
    return scoreAttempt(this.samples, this.targetHz, { toleranceCents: this.opts.toleranceCents, holdMs: this.opts.holdMs });
  }
}
