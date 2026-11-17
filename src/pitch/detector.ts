import { BoundedMpm } from './mpm';

// Raw per-window pitch detection (McLeod Pitch Method, built on pitchy's
// autocorrelator; see mpm.ts for why the lag range is bounded) plus the
// accept/reject rules from the spec: detection range, noise gate, clarity.
// Smoothing and the octave-jump guard live in tracker.ts.

export const MIN_HZ = 50; // a little below A1 (55 Hz) so A1 itself is safely inside
export const MAX_HZ = 1100; // just above C6
/** Below this target frequency we use the long (4096-sample) window. */
export const LOW_WINDOW_HZ = 110;

export interface DetectorSettings {
  /** RMS below this is silence. Calibrated from 2 s of room noise. */
  noiseGate: number;
  /** Minimum clarity to accept a frame (normal range). */
  clarity: number;
  /** Minimum clarity for low notes (below LOW_WINDOW_HZ). */
  lowClarity: number;
}

export const DEFAULT_DETECTOR_SETTINGS: DetectorSettings = {
  noiseGate: 0.003,
  clarity: 0.9,
  lowClarity: 0.8,
};

export type RejectReason = 'quiet' | 'unclear' | 'range';

export interface Frame {
  /** Detected frequency in Hz if the frame was accepted, else null. */
  freq: number | null;
  /** Raw detector output, even when rejected (for Diagnostics). */
  rawFreq: number;
  clarity: number;
  rms: number;
  windowSize: number;
  reject?: RejectReason;
}

/** Window length for a target (or the current stable estimate). Unknown → long window, which is safe for low notes. */
export function windowSizeFor(hintHz: number | null | undefined): 2048 | 4096 {
  if (hintHz == null || !Number.isFinite(hintHz)) return 4096;
  return hintHz < LOW_WINDOW_HZ ? 4096 : 2048;
}

export function rms(buf: ArrayLike<number>, start = 0, end = buf.length): number {
  let s = 0;
  for (let i = start; i < end; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, end - start));
}

export class Detector {
  private detectors = new Map<number, BoundedMpm>();
  settings: DetectorSettings;

  constructor(settings: Partial<DetectorSettings> = {}) {
    this.settings = { ...DEFAULT_DETECTOR_SETTINGS, ...settings };
  }

  private get(size: number): BoundedMpm {
    let d = this.detectors.get(size);
    if (!d) {
      // MPM peak-picking constant k stays at the paper's 0.9; it is not the
      // acceptance threshold (that's settings.clarity).
      d = new BoundedMpm(size);
      this.detectors.set(size, d);
    }
    return d;
  }

  /**
   * Analyse the most recent `windowSize` samples of `buffer`.
   * `hintHz` is the target note (or current stable pitch); it picks the window size.
   */
  analyze(buffer: Float32Array, sampleRate: number, hintHz?: number | null, forceWindow?: number): Frame {
    const size = Math.min(buffer.length, forceWindow ?? windowSizeFor(hintHz));
    const win = buffer.length === size ? buffer : buffer.subarray(buffer.length - size);
    const level = rms(win);
    if (level < this.settings.noiseGate) {
      return { freq: null, rawFreq: 0, clarity: 0, rms: level, windowSize: size, reject: 'quiet' };
    }
    const { freq: f, clarity } = this.get(size).detect(win, sampleRate, MIN_HZ, MAX_HZ);
    const base: Frame = { freq: null, rawFreq: f, clarity, rms: level, windowSize: size };
    if (!(f >= MIN_HZ && f <= MAX_HZ)) return { ...base, reject: 'range' };
    const lowRef = hintHz ?? f;
    const minClarity = lowRef < LOW_WINDOW_HZ ? this.settings.lowClarity : this.settings.clarity;
    if (clarity < minClarity) return { ...base, reject: 'unclear' };
    return { ...base, freq: f };
  }
}

/**
 * Noise-gate calibration: given RMS readings taken over ~2 s of silence,
 * return a gate comfortably above the room's noise floor.
 */
export function calibrateNoiseGate(silenceRms: number[]): number {
  if (silenceRms.length === 0) return DEFAULT_DETECTOR_SETTINGS.noiseGate;
  const sorted = [...silenceRms].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  // At least 2.5x the loud end of the noise, never below an absolute floor.
  return Math.min(0.05, Math.max(0.0015, p95 * 2.5));
}
