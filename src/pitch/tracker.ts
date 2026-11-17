import { cents } from '../lib/notes';

// Smoothing on top of the raw detector:
//  * median of the last N accepted frames,
//  * octave-jump guard: a frame ~2x or ~0.5x away from the stable estimate is
//    only believed after `octaveConfirm` consecutive frames agree,
//  * other big jumps (a real note change) need `jumpConfirm` frames,
//  * short dropouts are bridged; a longer silence ends the note.

export interface TrackerOptions {
  medianSize: number;
  octaveConfirm: number;
  jumpConfirm: number;
  /** Changes larger than this (cents) count as a jump rather than drift/vibrato. */
  jumpCents: number;
  /** How close (cents) to an exact octave a jump must be to count as an octave jump. */
  octaveWindowCents: number;
  /** Silence longer than this (ms) ends the current note. */
  releaseMs: number;
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  medianSize: 5,
  octaveConfirm: 3,
  jumpConfirm: 2,
  jumpCents: 250,
  octaveWindowCents: 150,
  releaseMs: 250,
};

export interface TrackerOutput {
  t: number;
  /** Smoothed, octave-guarded pitch in Hz, or null when not singing. */
  freq: number | null;
  /** This frame's accepted raw pitch, if any. */
  raw: number | null;
  /** True on the first frame of a new voiced segment. */
  onset: boolean;
  /** True while an octave jump is waiting for confirmation. */
  octavePending: boolean;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export class PitchTracker {
  private opts: TrackerOptions;
  private buf: number[] = [];
  private candidates: number[] = [];
  private candidateIsOctave = false;
  private stable: number | null = null;
  private lastAcceptedT = -Infinity;

  constructor(opts: Partial<TrackerOptions> = {}) {
    this.opts = { ...DEFAULT_TRACKER_OPTIONS, ...opts };
  }

  reset(): void {
    this.buf = [];
    this.candidates = [];
    this.stable = null;
    this.lastAcceptedT = -Infinity;
  }

  get current(): number | null {
    return this.stable;
  }

  /** Feed one analysis frame. `freq` is null for rejected frames. `t` in ms. */
  push(t: number, freq: number | null): TrackerOutput {
    const o = this.opts;
    if (freq == null) {
      if (t - this.lastAcceptedT > o.releaseMs) {
        this.buf = [];
        this.candidates = [];
        this.stable = null;
      }
      return { t, freq: this.stable, raw: null, onset: false, octavePending: this.candidates.length > 0 && this.candidateIsOctave };
    }

    this.lastAcceptedT = t;

    if (this.stable == null) {
      this.buf = [freq];
      this.candidates = [];
      this.stable = freq;
      return { t, freq, raw: freq, onset: true, octavePending: false };
    }

    const d = cents(freq, this.stable);
    if (Math.abs(d) <= o.jumpCents) {
      this.buf.push(freq);
      if (this.buf.length > o.medianSize) this.buf.shift();
      this.candidates = [];
      this.stable = median(this.buf);
      return { t, freq: this.stable, raw: freq, onset: false, octavePending: false };
    }

    // A jump. Is it (close to) a whole number of octaves?
    const oct = Math.round(d / 1200);
    const isOctave = oct !== 0 && Math.abs(d - 1200 * oct) < o.octaveWindowCents;

    const last = this.candidates[this.candidates.length - 1];
    if (last !== undefined && Math.abs(cents(freq, last)) <= 100) {
      this.candidates.push(freq);
    } else {
      this.candidates = [freq];
      this.candidateIsOctave = isOctave;
    }
    const needed = this.candidateIsOctave ? o.octaveConfirm : o.jumpConfirm;
    if (this.candidates.length >= needed) {
      this.buf = this.candidates.slice(-o.medianSize);
      this.candidates = [];
      this.stable = median(this.buf);
      return { t, freq: this.stable, raw: freq, onset: false, octavePending: false };
    }
    return { t, freq: this.stable, raw: freq, onset: false, octavePending: this.candidateIsOctave };
  }
}
