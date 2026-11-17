import { Autocorrelator } from 'pitchy';

// McLeod Pitch Method with a bounded lag range.
//
// pitchy's own PitchDetector searches every lag up to the full window length.
// Near the end of the window the overlap is only a few samples, so the
// normalised square difference function (NSDF) can climb back to ~1 and the
// detector reports absurd sub-octaves (we saw 11–13 Hz readings on a synthetic
// C2 voice). We reuse pitchy's FFT autocorrelator and run the MPM peak picking
// ourselves, only over lags that correspond to [minHz, maxHz] and never beyond
// half the window, so there is always at least half a window of overlap.

export interface MpmResult {
  freq: number;
  clarity: number;
}

export class BoundedMpm {
  private ac: Autocorrelator<Float32Array>;
  private nsdf: Float32Array;
  readonly size: number;
  /** MPM constant k: pick the first key maximum ≥ k · highest maximum. */
  k = 0.9;
  /**
   * Octave-up guard: if the peak at twice the chosen lag is clearly more
   * periodic (by this NSDF margin), the chosen peak was a harmonic, not the
   * fundamental. Happens on voices whose 1st and 3rd harmonics are weak
   * (some vowels, phone mics with low-frequency roll-off): MPM then reads
   * G5 when you sing G4.
   */
  subOctaveMargin = 0.01;

  constructor(size: number) {
    this.size = size;
    this.ac = Autocorrelator.forFloat32Array(size);
    this.nsdf = new Float32Array(size);
  }

  detect(input: Float32Array, sampleRate: number, minHz: number, maxHz: number): MpmResult {
    const n = this.size;
    const minLag = Math.max(2, Math.floor(sampleRate / maxHz) - 1);
    const maxLag = Math.min(Math.floor(n / 2), Math.ceil(sampleRate / minHz) + 1);
    this.ac.autocorrelate(input, this.nsdf);
    const r = this.nsdf; // r[τ] (autocorrelation), turned into NSDF in place below

    // m(τ) = Σ_{j=0}^{n-τ-1} (x_j² + x_{j+τ}²), computed incrementally.
    let m = 2 * r[0];
    if (m <= 0) return { freq: 0, clarity: 0 };
    const nsdf = r;
    nsdf[0] = 1;
    for (let tau = 1; tau <= maxLag + 1 && tau < n; tau++) {
      m -= input[tau - 1] * input[tau - 1] + input[n - tau] * input[n - tau];
      nsdf[tau] = m > 0 ? (2 * r[tau]) / m : 0;
    }

    // Key maxima: the highest point between each positive-going zero crossing
    // and the next negative-going one.
    const peaks: number[] = [];
    let tau = 1;
    // skip the initial positive lobe around lag 0
    while (tau <= maxLag && nsdf[tau] > 0) tau++;
    let best = -1;
    let inPositive = false;
    for (; tau <= maxLag; tau++) {
      if (nsdf[tau] > 0 && nsdf[tau - 1] <= 0) {
        inPositive = true;
        best = tau;
      } else if (inPositive && nsdf[tau] <= 0 && nsdf[tau - 1] > 0) {
        inPositive = false;
        if (best >= minLag) peaks.push(best);
      }
      if (inPositive && nsdf[tau] > nsdf[best]) best = tau;
    }
    if (inPositive && best >= minLag && best < maxLag) peaks.push(best);
    if (peaks.length === 0) return { freq: 0, clarity: 0 };

    let nMax = -Infinity;
    for (const p of peaks) nMax = Math.max(nMax, nsdf[p]);
    const threshold = this.k * nMax;
    let chosen = peaks.find((p) => nsdf[p] >= threshold)!;

    // Check the lag one octave down (2x period), repeatedly.
    for (;;) {
      const lo = Math.floor(chosen * 2 * 0.97);
      const hi = Math.ceil(chosen * 2 * 1.03);
      const sub = peaks.find((p) => p >= lo && p <= hi);
      if (sub === undefined || nsdf[sub] < nsdf[chosen] + this.subOctaveMargin) break;
      chosen = sub;
    }

    // Parabolic interpolation around the chosen peak.
    const a = nsdf[chosen - 1];
    const b = nsdf[chosen];
    const c = nsdf[chosen + 1];
    const denom = a - 2 * b + c;
    const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
    const refined = chosen + shift;
    const clarity = Math.min(1, b - 0.25 * (a - c) * shift);
    return { freq: sampleRate / refined, clarity };
  }
}
