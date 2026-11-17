// Voice ranges per register, in MIDI note numbers.

export type Register = 'low' | 'chest' | 'falsetto';
export const REGISTERS: Register[] = ['chest', 'falsetto', 'low'];
export const REGISTER_LABEL: Record<Register, string> = { chest: 'Chest', falsetto: 'Falsetto', low: 'Low / bassy' };

export interface Span {
  lo: number;
  hi: number;
}

export type VoiceRange = Record<Register, Span>;

/** Used until the range finder has run. Roughly the example ranges from the spec. */
export const DEFAULT_RANGE: VoiceRange = {
  low: { lo: 36, hi: 45 }, // C2–A2
  chest: { lo: 45, hi: 62 }, // A2–D4
  falsetto: { lo: 60, hi: 74 }, // C4–D5
};

export const STRETCH = 2;

export interface MidiSample {
  t: number;
  midi: number | null;
}

/**
 * Lowest and highest notes held steady (within ±windowSemis of where the
 * hold started) for at least holdMs. Returns rounded MIDI notes, or null if
 * nothing was held long enough.
 */
export function steadyExtremes(samples: MidiSample[], holdMs = 300, windowSemis = 0.5, maxGapMs = 120): Span | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i];
    if (a.midi == null) continue;
    const vals: number[] = [a.midi];
    let lastT = a.t;
    for (let j = i + 1; j < samples.length; j++) {
      const b = samples[j];
      if (b.midi == null) {
        if (b.t - lastT > maxGapMs) break;
        continue;
      }
      if (Math.abs(b.midi - a.midi) > windowSemis) break;
      vals.push(b.midi);
      lastT = b.t;
      if (lastT - a.t >= holdMs) {
        vals.sort((x, y) => x - y);
        const note = Math.round(vals[vals.length >> 1]);
        lo = Math.min(lo, note);
        hi = Math.max(hi, note);
        break;
      }
    }
  }
  return Number.isFinite(lo) ? { lo, hi } : null;
}

/** All notes available for exercises in the given registers (optionally stretched ±2 semitones). */
export function notesInRange(range: VoiceRange, registers: Register[] = REGISTERS, stretch = false): number[] {
  const set = new Set<number>();
  for (const r of registers) {
    const s = range[r];
    if (!s || s.hi < s.lo) continue;
    const pad = stretch ? STRETCH : 0;
    for (let m = s.lo - pad; m <= s.hi + pad; m++) set.add(m);
  }
  return [...set].sort((a, b) => a - b);
}

/** The register a note most comfortably belongs to (centre of the span wins ties). */
export function registerFor(midi: number, range: VoiceRange): Register | null {
  let best: Register | null = null;
  let bestScore = -Infinity;
  for (const r of REGISTERS) {
    const s = range[r];
    if (midi < s.lo || midi > s.hi) continue;
    const centre = (s.lo + s.hi) / 2;
    const score = -Math.abs(midi - centre) / Math.max(1, s.hi - s.lo);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

export function fullSpan(range: VoiceRange): Span {
  const all = notesInRange(range);
  return all.length ? { lo: all[0], hi: all[all.length - 1] } : { lo: 48, hi: 72 };
}

/** Pick a note in range, at most `maxStep` semitones from `prev` (if given), never repeating prev. */
export function pickNote(pool: number[], rand: () => number, prev?: number | null, maxStep = 12): number {
  let candidates = pool;
  if (prev != null) {
    const near = pool.filter((m) => m !== prev && Math.abs(m - prev) <= maxStep);
    if (near.length) candidates = near;
  }
  return candidates[Math.floor(rand() * candidates.length)];
}
