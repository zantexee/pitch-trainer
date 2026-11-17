import { describe, expect, it } from 'vitest';
import { scaleOffsets, tonicFor, upDownOffsets } from '../src/engine/scales';
import { DEFAULT_RANGE } from '../src/lib/range';

describe('scales', () => {
  it('builds major and the three minors correctly', () => {
    expect(upDownOffsets('major')).toEqual([0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0]);
    expect(upDownOffsets('harmonic').slice(0, 8)).toEqual([0, 2, 3, 5, 7, 8, 11, 12]);
    // melodic: up with raised 6/7, down natural
    expect(upDownOffsets('melodic')).toEqual([0, 2, 3, 5, 7, 9, 11, 12, 10, 8, 7, 5, 3, 2, 0]);
    expect(scaleOffsets('melodic')).toEqual([0, 2, 3, 5, 7, 8, 9, 10, 11, 12]);
  });
  it('places every key inside a G2–E4 chest range where possible', () => {
    const range = { low: { lo: 36, hi: 43 }, chest: { lo: 43, hi: 64 }, falsetto: { lo: 60, hi: 76 } };
    for (let pc = 0; pc < 12; pc++) {
      const t = tonicFor(pc, range);
      expect(((t % 12) + 12) % 12).toBe(pc);
      expect(t).toBeGreaterThanOrEqual(43); // never starts in the low voice
      expect(t + 12).toBeLessThanOrEqual(66); // F and F#: the top note or two go into falsetto, never down into the low voice
    }
    expect(tonicFor(0, DEFAULT_RANGE) % 12).toBe(0);
  });
});
