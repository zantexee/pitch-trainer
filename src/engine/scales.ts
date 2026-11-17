import { notesInRange, type VoiceRange } from '../lib/range';

// Scales menu: every major and minor scale, placed where it fits your voice.

export const KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export type ScaleType = 'major' | 'minor' | 'harmonic' | 'melodic';

export const SCALE_TYPES: { id: ScaleType; label: string; up: number[]; down?: number[] }[] = [
  { id: 'major', label: 'Major', up: [0, 2, 4, 5, 7, 9, 11, 12] },
  { id: 'minor', label: 'Natural minor', up: [0, 2, 3, 5, 7, 8, 10, 12] },
  { id: 'harmonic', label: 'Harmonic minor', up: [0, 2, 3, 5, 7, 8, 11, 12] },
  // melodic minor: raised 6 and 7 going up, natural minor coming down
  { id: 'melodic', label: 'Melodic minor', up: [0, 2, 3, 5, 7, 9, 11, 12], down: [12, 10, 8, 7, 5, 3, 2, 0] },
];

export const scaleDef = (t: ScaleType) => SCALE_TYPES.find((x) => x.id === t)!;

/** Offsets for one pass up and back down (top note once). */
export function upDownOffsets(t: ScaleType): number[] {
  const d = scaleDef(t);
  const down = d.down ?? [...d.up].reverse();
  return [...d.up, ...down.slice(1)];
}

/** Every distinct pitch the scale uses (for the keyboard), relative to the tonic. */
export function scaleOffsets(t: ScaleType): number[] {
  const d = scaleDef(t);
  return [...new Set([...d.up, ...(d.down ?? [])])].sort((a, b) => a - b);
}

/**
 * Tonic MIDI for a key: the octave of that pitch class whose 8 notes sit best
 * in your chest range (then falsetto, then the low voice). Ties go to the lower octave.
 */
export function tonicFor(pc: number, range: VoiceRange): number {
  const chest = new Set(notesInRange(range, ['chest']));
  const falsetto = new Set(notesInRange(range, ['falsetto']));
  const low = new Set(notesInRange(range, ['low']));
  let best = 48 + pc;
  let bestScore = -Infinity;
  for (let t = 24 + pc; t <= 84; t += 12) {
    let score = 0;
    for (let o = 0; o <= 12; o++) {
      if (chest.has(t + o)) score += 2;
      else if (falsetto.has(t + o)) score += 1;
      else if (low.has(t + o)) score -= 1; // the low "bassy" voice is experimental
      else score -= 3;
    }
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

export const SPEEDS = [
  { id: 'slow', label: 'Slow', ms: 1000 },
  { id: 'medium', label: 'Medium', ms: 650 },
  { id: 'fast', label: 'Fast', ms: 400 },
] as const;
