import { describe, expect, it } from 'vitest';
import { scoreAttempt, zoneFor, type PitchSample } from '../src/pitch/scoring';

const target = 261.63;
const at = (c: number) => target * Math.pow(2, c / 1200);

function series(fn: (t: number) => number | null, ms: number, startMs = 0, step = 1000 / 60): PitchSample[] {
  const out: PitchSample[] = [];
  for (let t = 0; t <= ms; t += step) out.push({ t, freq: t < startMs ? null : fn(t) });
  return out;
}

describe('zones', () => {
  it('green / amber / grey', () => {
    expect(zoneFor(10, 25)).toBe('in');
    expect(zoneFor(-25, 25)).toBe('in');
    expect(zoneFor(-40, 25)).toBe('close');
    expect(zoneFor(51, 25)).toBe('off');
  });
});

describe('scoreAttempt', () => {
  it('silence is unreadable', () => {
    expect(scoreAttempt(series(() => null, 1000), target).verdict).toBe('unreadable');
  });

  it('steady accurate note locks', () => {
    const s = scoreAttempt(series(() => at(5), 2000, 200), target, { toleranceCents: 25, holdMs: 1000 });
    expect(s.verdict).toBe('locked');
    expect(s.locked).toBe(true);
    expect(s.accuracy).toBeCloseTo(5, 1);
    expect(s.stability).toBeLessThan(0.01);
    expect(s.onsetMs!).toBeGreaterThanOrEqual(200);
    expect(s.onsetMs!).toBeLessThan(220);
    expect(s.settleMs).toBe(0);
    expect(s.octave).toBe(0);
  });

  it('ignores the scoop but reports settle time', () => {
    // scoop from -300 cents up to 0 over the first 120 ms, then steady.
    const s = scoreAttempt(series((t) => at(t < 120 ? -300 + (300 * t) / 120 : 0), 1500), target, { toleranceCents: 25, holdMs: 1000 });
    expect(s.accuracy!).toBeLessThan(1);
    expect(s.settleMs!).toBeGreaterThan(90);
    expect(s.settleMs!).toBeLessThan(140);
    expect(s.verdict).toBe('locked');
  });

  it('right note an octave low is "octave", not "off"', () => {
    const s = scoreAttempt(series(() => at(-1200 + 8), 1500), target, { toleranceCents: 25 });
    expect(s.verdict).toBe('octave');
    expect(s.octave).toBe(-1);
    expect(s.pcAccuracy!).toBeCloseTo(8, 1);
  });

  it('wrong note is "off"', () => {
    const s = scoreAttempt(series(() => at(400), 1500), target, { toleranceCents: 25 });
    expect(s.verdict).toBe('off');
    expect(s.octave).toBe(0);
  });

  it('near miss is "close"', () => {
    const s = scoreAttempt(series(() => at(40), 1500), target, { toleranceCents: 25 });
    expect(s.verdict).toBe('close');
    expect(s.meanCents!).toBeCloseTo(40, 1);
  });

  it('too short a hold is not locked', () => {
    const s = scoreAttempt(series((t) => (t < 600 ? at(0) : at(200)), 1500), target, { toleranceCents: 25, holdMs: 1000 });
    expect(s.locked).toBe(false);
    expect(s.longestHoldMs).toBeGreaterThan(550);
    expect(s.longestHoldMs).toBeLessThan(620);
  });

  it('stability is the SD of cents', () => {
    const s = scoreAttempt(series((t) => at(20 * Math.sin((2 * Math.PI * 5 * t) / 1000)), 2000), target, { toleranceCents: 50 });
    expect(s.stability!).toBeGreaterThan(12);
    expect(s.stability!).toBeLessThan(16); // 20/sqrt(2) ≈ 14.1
  });
});
