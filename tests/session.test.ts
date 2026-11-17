import { describe, expect, it } from 'vitest';
import { buildSession, extraRound, isEar, themeFor } from '../src/engine/session';
import { weakness, weightedPick } from '../src/engine/weights';
import { addDays } from '../src/engine/dates';
import { rng } from './signals';

describe('session builder', () => {
  it('fills the session with 60–90 s rounds', () => {
    const r = rng(1);
    for (const minutes of [2, 5, 10]) {
      for (let i = 0; i < 50; i++) {
        const p = buildSession({ minutes, dateKey: '2026-11-17', rand: r, bonusChance: 0 });
        const total = p.rounds.reduce((a, b) => a + b.seconds, 0);
        expect(total).toBeGreaterThanOrEqual(minutes * 60 - 30);
        expect(total).toBeLessThanOrEqual(minutes * 60 + 90);
        for (const x of p.rounds) {
          expect(x.seconds).toBeGreaterThanOrEqual(60);
          expect(x.seconds).toBeLessThanOrEqual(90);
        }
      }
    }
  });
  it('never repeats an exercise type back to back', () => {
    const r = rng(2);
    for (let i = 0; i < 200; i++) {
      const p = buildSession({ minutes: 10, dateKey: addDays('2026-11-17', i), rand: r, bonusChance: 0 });
      for (let k = 1; k < p.rounds.length; k++) expect(p.rounds[k].type).not.toBe(p.rounds[k - 1].type);
    }
  });
  it('silent sessions are ear-only and have no bonus', () => {
    const r = rng(3);
    for (let i = 0; i < 50; i++) {
      const p = buildSession({ minutes: 10, dateKey: '2026-11-17', rand: r, silent: true, bonusChance: 1 });
      expect(p.rounds.every((x) => isEar(x.type) && !x.bonus)).toBe(true);
    }
  });
  it('themes rotate daily through the four', () => {
    const themes = new Set(Array.from({ length: 4 }, (_, i) => themeFor(addDays('2026-11-17', i))));
    expect(themes).toEqual(new Set(['octave', 'drone', 'ear', 'mystery']));
  });
  it('octave day leans on Octave Jump', () => {
    const r = rng(4);
    const day = Array.from({ length: 8 }, (_, i) => addDays('2026-11-01', i)).find((d) => themeFor(d) === 'octave')!;
    let octave = 0;
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const p = buildSession({ minutes: 10, dateKey: day, rand: r, bonusChance: 0 });
      octave += p.rounds.filter((x) => x.type === 'octave').length;
      total += p.rounds.length;
    }
    expect(octave / total).toBeGreaterThan(0.2);
  });
  it('about 1 session in 4 has a bonus round', () => {
    const r = rng(5);
    let n = 0;
    for (let i = 0; i < 1000; i++) if (buildSession({ minutes: 5, dateKey: '2026-11-17', rand: r }).rounds.some((x) => x.bonus)) n++;
    expect(n / 1000).toBeGreaterThan(0.18);
    expect(n / 1000).toBeLessThan(0.32);
  });
  it('one more round picks a different type', () => {
    const r = rng(6);
    const p = buildSession({ minutes: 2, dateKey: '2026-11-17', rand: r, bonusChance: 0 });
    for (let i = 0; i < 50; i++) expect(extraRound(p, r).type).not.toBe(p.rounds[p.rounds.length - 1].type);
  });
});

describe('weak-spot weights', () => {
  it('weak items get picked more', () => {
    expect(weakness({ n: 10, ok: 0 })).toBe(3);
    expect(weakness({ n: 10, ok: 10 })).toBe(1);
    expect(weakness(undefined)).toBe(2);
    const r = rng(7);
    const stats: Record<string, { n: number; ok: number }> = { a: { n: 10, ok: 10 }, b: { n: 10, ok: 0 } };
    let b = 0;
    for (let i = 0; i < 4000; i++) if (weightedPick(['a', 'b'], (x) => weakness(stats[x]), r) === 'b') b++;
    expect(b / 4000).toBeGreaterThan(0.7);
  });
});
