// Note / frequency maths. Scientific pitch notation: C4 = MIDI 60 = middle C, A4 = MIDI 69.

export const DEFAULT_A4 = 440;
export const A4_MIN = 430;
export const A4_MAX = 450;

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Equal-temperament frequency of a (possibly fractional) MIDI note. */
export function noteToFreq(midi: number, a4 = DEFAULT_A4): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/** Fractional MIDI note for a frequency. */
export function freqToMidi(freq: number, a4 = DEFAULT_A4): number {
  return 69 + 12 * Math.log2(freq / a4);
}

/** "C4", "F#3", "A#-1". Uses sharps. */
export function midiToName(midi: number): string {
  const m = Math.round(midi);
  const pc = ((m % 12) + 12) % 12;
  const octave = Math.floor(m / 12) - 1;
  return `${SHARP_NAMES[pc]}${octave}`;
}

/** Pitch-class name without octave ("F#"). */
export function pitchClassName(midi: number): string {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return SHARP_NAMES[pc];
}

/** Parse "C4", "F#3", "Bb2", "c#5", "E-1". Returns null if invalid. */
export function nameToMidi(name: string): number | null {
  const m = /^\s*([A-Ga-g])([#b♯♭]{0,2})(-?\d+)\s*$/.exec(name);
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === '#' || ch === '♯' ? 1 : -1;
  const octave = parseInt(m[3], 10);
  return (octave + 1) * 12 + pc;
}

/** Signed distance in cents from target to f. Positive = sharp. */
export function cents(f: number, target: number): number {
  return 1200 * Math.log2(f / target);
}

export interface FoldedError {
  /** Total signed error in cents. */
  totalCents: number;
  /** Pitch-class error in [-600, +600) cents. */
  pcCents: number;
  /** Whole-octave offset: -1 = one octave low, +1 = one octave high. */
  octave: number;
}

/**
 * Octave-folded error. Separates "right note, wrong octave" from "wrong note".
 * totalCents = pcCents + 1200 * octave, with pcCents in [-600, 600).
 */
export function foldError(f: number, target: number): FoldedError {
  const total = cents(f, target);
  return foldCents(total);
}

export function foldCents(total: number): FoldedError {
  // floor((x + 600) / 1200) puts the boundary at -600 inclusive / +600 exclusive.
  const octave = Math.floor((total + 600) / 1200);
  let pc = total - 1200 * octave;
  if (Object.is(pc, -0)) pc = 0;
  return { totalCents: total, pcCents: pc, octave: octave === 0 ? 0 : octave };
}

/** Nearest note to a frequency plus cents off that note. */
export function nearestNote(freq: number, a4 = DEFAULT_A4): { midi: number; name: string; cents: number } {
  const exact = freqToMidi(freq, a4);
  const midi = Math.round(exact);
  return { midi, name: midiToName(midi), cents: (exact - midi) * 100 };
}

export const clampA4 = (a4: number) => Math.min(A4_MAX, Math.max(A4_MIN, a4));
