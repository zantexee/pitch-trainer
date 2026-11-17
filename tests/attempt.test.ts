import { describe, expect, it } from 'vitest';
import { LiveAttempt } from '../src/pitch/attempt';

const target = 220;
const at = (c: number) => target * Math.pow(2, c / 1200);
const step = 1000 / 60;

describe('LiveAttempt', () => {
  it('locks once after holding inside tolerance', () => {
    const a = new LiveAttempt(target, { toleranceCents: 25, holdMs: 500 });
    let locks = 0;
    let t = 0;
    for (let i = 0; i < 60; i++) {
      const s = a.push((t += step), at(10));
      if (s.justLocked) locks++;
    }
    expect(locks).toBe(1);
    expect(a.locked).toBe(true);
    expect(a.lockedAt!).toBeGreaterThanOrEqual(500);
    expect(a.lockedAt!).toBeLessThan(540);
  });
  it('leaving tolerance resets the hold', () => {
    const a = new LiveAttempt(target, { toleranceCents: 25, holdMs: 500 });
    let t = 0;
    for (let i = 0; i < 20; i++) a.push((t += step), at(0));
    const out = a.push((t += step), at(60));
    expect(out.zone).toBe('off');
    expect(out.inTolMs).toBe(0);
    for (let i = 0; i < 20; i++) a.push((t += step), at(0));
    expect(a.locked).toBe(false);
  });
  it('reports zones and octave folding live', () => {
    const a = new LiveAttempt(target, { toleranceCents: 25, holdMs: 500 });
    expect(a.push(0, at(40)).zone).toBe('close');
    const s = a.push(16, target / 2);
    expect(s.folded!.octave).toBe(-1);
    expect(Math.abs(s.folded!.pcCents)).toBeLessThan(1e-9);
    expect(a.push(32, null).voiced).toBe(false);
  });
  it('finish() scores the attempt', () => {
    const a = new LiveAttempt(target, { toleranceCents: 25, holdMs: 500 });
    let t = 0;
    for (let i = 0; i < 60; i++) a.push((t += step), at(5));
    const sc = a.finish();
    expect(sc.verdict).toBe('locked');
    expect(sc.accuracy!).toBeCloseTo(5, 1);
  });
});
