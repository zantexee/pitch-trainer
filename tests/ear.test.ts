import { describe, expect, it } from 'vitest';
import { newStaircase, stepStaircase, thresholdEstimate } from '../src/engine/staircase';
import { degreeSet, resolution, INTERVAL_LEVELS, octaveQuestion, noteOfTheDay, localDateKey, OCTAVE_LEVELS } from '../src/engine/ear';
import { rng } from './signals';

describe('staircase', () => {
  it('starts at 100 cents and shrinks on success', () => {
    let s = newStaircase();
    expect(s.delta).toBe(100);
    s = stepStaircase(s, true);
    expect(s.delta).toBeLessThan(100);
  });
  it('2-down 1-up after the first reversal', () => {
    let s = newStaircase();
    s = stepStaircase(s, true); // 75
    s = stepStaircase(s, false); // reversal → 112.5
    const d = s.delta;
    s = stepStaircase(s, true);
    expect(s.delta).toBe(d); // one correct: no move
    s = stepStaircase(s, true);
    expect(s.delta).toBeLessThan(d);
  });
  it('stays within bounds', () => {
    let s = newStaircase();
    for (let i = 0; i < 200; i++) s = stepStaircase(s, true);
    expect(s.delta).toBe(1);
    for (let i = 0; i < 200; i++) s = stepStaircase(s, false);
    expect(s.delta).toBe(300);
  });
  it('converges near a simulated listener threshold', () => {
    // listener: always right above 12¢, chance below
    const r = rng(7);
    let s = newStaircase();
    for (let i = 0; i < 300; i++) s = stepStaircase(s, s.delta >= 12 ? true : r() < 0.5);
    const est = thresholdEstimate(s)!;
    expect(est).toBeGreaterThan(6);
    expect(est).toBeLessThan(24);
  });
  it('no estimate until enough reversals', () => {
    expect(thresholdEstimate(newStaircase())).toBeNull();
  });
});

describe('scale degrees', () => {
  it('starts with 1 vs 5 and adds one degree at a time', () => {
    expect(degreeSet(0)).toEqual([0, 7]);
    expect(degreeSet(1)).toEqual([0, 7, 4]);
    expect(degreeSet(99)).toHaveLength(7);
  });
  it('resolutions end on the tonic', () => {
    for (const d of [0, 2, 4, 5, 7, 9, 11]) {
      const r = resolution(d);
      expect(r[0]).toBe(d);
      expect([0, 12]).toContain(r[r.length - 1]);
    }
    expect(resolution(11)).toEqual([11, 12]);
    expect(resolution(5)[1]).toBe(4);
  });
});

describe('intervals', () => {
  it('starts with three very different ascending intervals', () => {
    expect(INTERVAL_LEVELS[0]).toEqual({ intervals: [2, 7, 12], dirs: ['up'] });
  });
  it('adds descending before harmonic, and ends with all 12', () => {
    const di = INTERVAL_LEVELS.findIndex((l) => l.dirs.includes('down'));
    const hi = INTERVAL_LEVELS.findIndex((l) => l.dirs.includes('harmonic'));
    expect(di).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(di);
    expect(INTERVAL_LEVELS[INTERVAL_LEVELS.length - 1].intervals).toHaveLength(12);
  });
});

describe('which octave', () => {
  it('generates valid questions at every level', () => {
    const r = rng(11);
    for (let lv = 0; lv < OCTAVE_LEVELS; lv++) {
      for (let i = 0; i < 200; i++) {
        const q = octaveQuestion(lv, r);
        if (q.kind === 'same') {
          const d = Math.abs(q.b - q.a);
          if (q.same) expect(d).toBe(12);
          else expect(d).not.toBe(12);
        } else {
          expect(q.options).toContain(q.note);
          expect(new Set(q.options.map((o) => o % 12)).size).toBe(1);
          expect(q.options.length).toBe(lv < 1 ? 2 : 3);
          if (lv < 2) expect(q.note % 12).toBe(0);
        }
      }
    }
  });
});

describe('note of the day', () => {
  it('is stable within a day and stays in range', () => {
    const a = noteOfTheDay('2026-11-17', 48, 60);
    expect(noteOfTheDay('2026-11-17', 48, 60)).toBe(a);
    for (let d = 1; d <= 28; d++) {
      const n = noteOfTheDay(`2026-02-${String(d).padStart(2, '0')}`, 48, 60);
      expect(n).toBeGreaterThanOrEqual(48);
      expect(n).toBeLessThanOrEqual(60);
    }
  });
  it('local date key', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
