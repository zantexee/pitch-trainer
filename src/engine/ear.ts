// Ear-training drill content: scale-degree sets and resolutions, interval
// levels, and "which octave?" questions.

// ---------- scale degrees (functional ear training) ----------

/** Degrees introduced one at a time, starting with 1 vs 5. Offsets in semitones. */
export const DEGREE_ORDER = [0, 7, 4, 5, 2, 9, 11];
export const DEGREE_NAMES: Record<number, string> = { 0: '1', 2: '2', 4: '3', 5: '4', 7: '5', 9: '6', 11: '7' };

/** Degree set for a level (level 0 = {1, 5}). */
export function degreeSet(level: number): number[] {
  return DEGREE_ORDER.slice(0, Math.min(DEGREE_ORDER.length, level + 2));
}
export const DEGREE_LEVELS = DEGREE_ORDER.length - 1;

/**
 * Resolution to the tonic, played after the answer so the degree is learned
 * musically: 2→1, 3→2→1, 4→3→2→1, 5→6→7→8, 6→7→8, 7→8.
 */
export function resolution(offset: number): number[] {
  switch (offset) {
    case 0:
      return [0];
    case 2:
      return [2, 0];
    case 4:
      return [4, 2, 0];
    case 5:
      return [5, 4, 2, 0];
    case 7:
      return [7, 9, 11, 12];
    case 9:
      return [9, 11, 12];
    case 11:
      return [11, 12];
    default:
      return [offset, 0];
  }
}

// ---------- intervals ----------

export type IntervalDir = 'up' | 'down' | 'harmonic';

export const INTERVAL_NAMES: Record<number, string> = {
  1: 'm2',
  2: 'M2',
  3: 'm3',
  4: 'M3',
  5: 'P4',
  6: 'Tritone',
  7: 'P5',
  8: 'm6',
  9: 'M6',
  10: 'm7',
  11: 'M7',
  12: 'Octave',
};

export interface IntervalLevel {
  intervals: number[];
  dirs: IntervalDir[];
}

/** Start with 3 very different intervals, interleaved from the start; ascending → +descending → +harmonic. */
export const INTERVAL_LEVELS: IntervalLevel[] = (() => {
  const steps: ({ add: number } | { dir: IntervalDir })[] = [
    { add: 4 },
    { add: 5 },
    { dir: 'down' },
    { add: 3 },
    { add: 9 },
    { dir: 'harmonic' },
    { add: 10 },
    { add: 8 },
    { add: 11 },
    { add: 6 },
    { add: 1 },
  ];
  const levels: IntervalLevel[] = [{ intervals: [2, 7, 12], dirs: ['up'] }];
  for (const st of steps) {
    const prev = levels[levels.length - 1];
    levels.push('add' in st ? { intervals: [...prev.intervals, st.add].sort((a, b) => a - b), dirs: prev.dirs } : { intervals: prev.intervals, dirs: [...prev.dirs, st.dir] });
  }
  return levels;
})();

// ---------- which octave? ----------

export type OctaveQuestion =
  | { kind: 'same'; a: number; b: number; same: boolean }
  | { kind: 'which'; note: number; options: number[] };

/** How far off the octave the "different" note is, per level (smaller = harder). */
const SAME_OFFSETS = [[5, 7], [2, 3], [1, 2], [1]];

export const OCTAVE_LEVELS = 4;

/**
 * Level 0–3. "same": two notes, either the same pitch class an octave apart or
 * a different note near the octave. "which": is this C3 or C4 (later: 3 options,
 * any pitch class).
 */
export function octaveQuestion(level: number, rand: () => number, lo = 45, hi = 72): OctaveQuestion {
  const lv = Math.max(0, Math.min(OCTAVE_LEVELS - 1, level));
  if (rand() < 0.5) {
    const a = lo + Math.floor(rand() * Math.max(1, hi - 12 - lo));
    const same = rand() < 0.5;
    const offs = SAME_OFFSETS[lv];
    const off = offs[Math.floor(rand() * offs.length)] * (rand() < 0.5 ? -1 : 1);
    const b = a + 12 + (same ? 0 : off);
    return rand() < 0.5 ? { kind: 'same', a, b, same } : { kind: 'same', a: b, b: a, same };
  }
  const pcs = lv < 2 ? [0] : [0, 2, 4, 5, 7, 9, 11];
  const pc = pcs[Math.floor(rand() * pcs.length)];
  const nOptions = lv < 1 ? 2 : 3;
  // octaves whose note (pc) lies within [lo-12, hi+12] so options stay audible
  const candidates: number[] = [];
  for (let m = 24 + pc; m <= 96; m += 12) if (m >= lo - 12 && m <= hi + 12) candidates.push(m);
  const start = Math.floor(rand() * Math.max(1, candidates.length - nOptions + 1));
  const options = candidates.slice(start, start + nOptions);
  const note = options[Math.floor(rand() * options.length)];
  return { kind: 'which', note, options };
}

// ---------- note of the day ----------

export function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Deterministic note of the day within [lo, hi] (same all day, changes daily). */
export function noteOfTheDay(dateKey: string, lo: number, hi: number): number {
  let h = 2166136261;
  for (const ch of dateKey) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return lo + (h % Math.max(1, hi - lo + 1));
}
