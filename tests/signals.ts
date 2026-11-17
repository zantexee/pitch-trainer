// Synthetic test signals for the detector test. Everything is generated
// directly into Float32Arrays, no Web Audio needed.

export type SignalKind = 'sine' | 'saw' | 'voice';

/** Deterministic PRNG (mulberry32) so tests are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ cookbook band-pass (constant 0 dB peak gain). */
function bandpass(input: Float32Array, sr: number, f0: number, q: number): Float32Array {
  const w0 = (2 * Math.PI * f0) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b1 = 0, b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w0)) / a0, a2 = (1 - alpha) / a0;
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return out;
}

export interface Signal {
  samples: Float32Array;
  /** instantaneous fundamental per sample (Hz) */
  inst: Float32Array;
}

/**
 * Generate `seconds` of signal at fundamental `f0`.
 * - sine: pure tone
 * - saw: band-limited sawtooth (additive, harmonics below Nyquist)
 * - voice: saw → 3 "ah" formant band-passes + 5.5 Hz vibrato at ±30 cents + noise (-30 dB)
 */
export function makeSignal(kind: SignalKind, f0: number, sr: number, seconds = 1, seed = 1): Signal {
  const n = Math.round(sr * seconds);
  const inst = new Float32Array(n);
  const vibCents = kind === 'voice' ? 30 : 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    inst[i] = f0 * Math.pow(2, (vibCents * Math.sin(2 * Math.PI * 5.5 * t)) / 1200);
  }
  const maxF = f0 * Math.pow(2, vibCents / 1200);
  const harmonics = kind === 'sine' ? 1 : Math.max(1, Math.floor((sr / 2 - 100) / maxF));
  const raw = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * inst[i]) / sr;
    if (phase > 2 * Math.PI * 1e6) phase -= 2 * Math.PI * 1e6;
    let s = 0;
    for (let k = 1; k <= harmonics; k++) s += Math.sin(k * phase) / k;
    raw[i] = s;
  }
  let out = raw;
  if (kind === 'voice') {
    const f1 = bandpass(raw, sr, 730, 5);
    const f2 = bandpass(raw, sr, 1090, 6);
    const f3 = bandpass(raw, sr, 2440, 8);
    const rand = rng(seed);
    out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = 0.25 * raw[i] + f1[i] + 0.5 * f2[i] + 0.25 * f3[i];
    // normalise, then add white noise 30 dB below the signal RMS
    normalise(out, 0.2);
    const noiseAmp = 0.2 * Math.pow(10, -30 / 20) * Math.sqrt(3); // uniform → RMS = amp/√3
    for (let i = 0; i < n; i++) out[i] += noiseAmp * (2 * rand() - 1);
  } else {
    normalise(out, 0.2);
  }
  return { samples: out, inst };
}

function normalise(buf: Float32Array, targetRms: number) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  const r = Math.sqrt(s / buf.length) || 1;
  const g = targetRms / r;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
}
