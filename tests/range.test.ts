import { describe, expect, it } from 'vitest';
import { DEFAULT_RANGE, notesInRange, pickNote, registerFor, steadyExtremes, type MidiSample } from '../src/lib/range';
import { rng } from './signals';

const step = 1000 / 60;
function glide(parts: [number, number, number][]): MidiSample[] {
  // parts: [fromMidi, toMidi, durationMs]
  const out: MidiSample[] = [];
  let t = 0;
  for (const [a, b, d] of parts) {
    for (let x = 0; x < d; x += step) {
      out.push({ t, midi: a + ((b - a) * x) / d });
      t += step;
    }
  }
  return out;
}

describe('steadyExtremes', () => {
  it('finds held ends of a glide, ignores the fast middle', () => {
    const s = glide([
      [48, 48, 500], // hold C3
      [48, 67, 1200], // glide up fast
      [67, 67, 400], // hold G4
      [67, 75, 200], // brief flick higher, not held
    ]);
    expect(steadyExtremes(s)).toEqual({ lo: 48, hi: 67 });
  });
  it('requires 300 ms', () => {
    expect(steadyExtremes(glide([[50, 50, 250]]))).toBeNull();
    expect(steadyExtremes(glide([[50, 50, 320]]))).toEqual({ lo: 50, hi: 50 });
  });
  it('tolerates short dropouts and small wobble', () => {
    const s = glide([[40, 40, 400]]).map((p, i) => ({ t: p.t, midi: i % 7 === 3 ? null : 40 + 0.3 * Math.sin(i) }));
    expect(steadyExtremes(s)).toEqual({ lo: 40, hi: 40 });
  });
  it('silence gives null', () => {
    expect(steadyExtremes([{ t: 0, midi: null }])).toBeNull();
  });
});

describe('range helpers', () => {
  it('notesInRange unions registers and stretches', () => {
    const r = { low: { lo: 36, hi: 40 }, chest: { lo: 45, hi: 50 }, falsetto: { lo: 49, hi: 55 } };
    expect(notesInRange(r, ['chest'])).toEqual([45, 46, 47, 48, 49, 50]);
    expect(notesInRange(r, ['chest'], true)).toEqual([43, 44, 45, 46, 47, 48, 49, 50, 51, 52]);
    expect(notesInRange(r, ['chest', 'falsetto']).length).toBe(11);
  });
  it('registerFor', () => {
    expect(registerFor(38, DEFAULT_RANGE)).toBe('low');
    expect(registerFor(52, DEFAULT_RANGE)).toBe('chest');
    expect(registerFor(70, DEFAULT_RANGE)).toBe('falsetto');
    expect(registerFor(100, DEFAULT_RANGE)).toBeNull();
  });
  it('pickNote stays in pool, respects max step, avoids repeats', () => {
    const pool = notesInRange(DEFAULT_RANGE, ['chest']);
    const r = rng(4);
    let prev = 50;
    for (let i = 0; i < 200; i++) {
      const n = pickNote(pool, r, prev, 3);
      expect(pool).toContain(n);
      expect(n).not.toBe(prev);
      expect(Math.abs(n - prev)).toBeLessThanOrEqual(3);
      prev = n;
    }
  });
});
