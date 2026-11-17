import { describe, expect, it } from 'vitest';
import { octaveTasks, pickOctaveTask, tasksWithFallback, pairKey } from '../src/engine/octave';
import { DEFAULT_RANGE, type VoiceRange } from '../src/lib/range';
import { rng } from './signals';

const R: VoiceRange = { low: { lo: 33, hi: 45 }, chest: { lo: 45, hi: 64 }, falsetto: { lo: 57, hi: 77 } };
const inSpan = (m: number, s: { lo: number; hi: number }) => m >= s.lo && m <= s.hi;

describe('octave tasks', () => {
  it('stage 0: C only, one octave, same register', () => {
    const t = octaveTasks(R, 0);
    expect(t.length).toBeGreaterThan(0);
    for (const x of t) {
      expect(x.ref % 12).toBe(0);
      expect(Math.abs(x.jump)).toBe(12);
      expect(x.refReg).toBe(x.targetReg);
    }
  });
  it('stage 1 adds register crossings, marked new', () => {
    const t = octaveTasks(R, 1);
    expect(t.some((x) => x.refReg !== x.targetReg && x.isNew)).toBe(true);
    expect(t.filter((x) => !x.isNew).every((x) => x.refReg === x.targetReg)).toBe(true);
  });
  it('stage 2 adds two-octave jumps', () => {
    expect(octaveTasks(R, 2).some((x) => Math.abs(x.jump) === 24)).toBe(true);
  });
  it('stages 3–4 widen pitch classes', () => {
    expect(new Set(octaveTasks(R, 3).map((x) => x.ref % 12)).has(1)).toBe(false);
    expect(new Set(octaveTasks(R, 3).map((x) => x.ref % 12)).size).toBeGreaterThan(1);
    expect(octaveTasks(R, 4).some((x) => x.ref % 12 === 1)).toBe(true);
  });
  it('stage 5 adds octave + interval (hear C3, sing G4)', () => {
    const t = octaveTasks(R, 5);
    expect(t.some((x) => x.ref === 48 && x.target === 67)).toBe(true);
  });
  it('every task fits the measured registers', () => {
    for (let s = 0; s <= 5; s++) {
      for (const x of octaveTasks(R, s)) {
        expect(inSpan(x.ref, R[x.refReg])).toBe(true);
        expect(inSpan(x.target, R[x.targetReg])).toBe(true);
      }
    }
  });
  it('falls back when the range is too narrow', () => {
    const narrow: VoiceRange = { low: { lo: 40, hi: 41 }, chest: { lo: 50, hi: 59 }, falsetto: { lo: 62, hi: 70 } };
    const r = tasksWithFallback(narrow, 0);
    expect(r.tasks.length).toBeGreaterThan(0); // D3 (50) → D4 (62) etc. after relaxing pitch class
    expect(tasksWithFallback(DEFAULT_RANGE, 5).tasks.length).toBeGreaterThan(0);
  });
  it('picker prefers weak register pairs', () => {
    const t = octaveTasks(R, 1);
    const crossKey = pairKey(t.find((x) => x.refReg !== x.targetReg)!);
    const stats: Record<string, { n: number; ok: number }> = {};
    for (const x of t) stats[pairKey(x)] = { n: 10, ok: pairKey(x) === crossKey ? 0 : 10 };
    const r = rng(2);
    let hits = 0;
    for (let i = 0; i < 2000; i++) if (pairKey(pickOctaveTask(t, r, stats)) === crossKey) hits++;
    const share = t.filter((x) => pairKey(x) === crossKey).length / t.length;
    expect(hits / 2000).toBeGreaterThan(share);
  });
});
