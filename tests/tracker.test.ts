import { describe, expect, it } from 'vitest';
import { PitchTracker, median } from '../src/pitch/tracker';

const step = 1000 / 60;

describe('median', () => {
  it('odd/even', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('PitchTracker', () => {
  it('median smooths a single outlier', () => {
    const tr = new PitchTracker();
    let t = 0;
    for (const f of [220, 221, 219, 220, 240, 220, 221]) tr.push((t += step), f);
    expect(tr.current!).toBeGreaterThan(219);
    expect(tr.current!).toBeLessThan(222);
  });

  it('a single octave glitch is ignored', () => {
    const tr = new PitchTracker();
    let t = 0;
    for (let i = 0; i < 6; i++) tr.push((t += step), 220);
    const out = tr.push((t += step), 440);
    expect(out.freq).toBe(220);
    expect(out.octavePending).toBe(true);
    tr.push((t += step), 220);
    expect(tr.current).toBe(220);
  });

  it('two octave frames are not enough, three are', () => {
    const tr = new PitchTracker();
    let t = 0;
    for (let i = 0; i < 6; i++) tr.push((t += step), 220);
    tr.push((t += step), 110);
    expect(tr.push((t += step), 110.5).freq).toBe(220);
    const third = tr.push((t += step), 110.2);
    expect(third.freq!).toBeCloseTo(110.2, 0);
  });

  it('a real note change (a fifth) needs two frames', () => {
    const tr = new PitchTracker();
    let t = 0;
    for (let i = 0; i < 6; i++) tr.push((t += step), 220);
    expect(tr.push((t += step), 330).freq).toBe(220);
    expect(tr.push((t += step), 330).freq).toBe(330);
  });

  it('bridges short dropouts and releases after silence', () => {
    const tr = new PitchTracker({ releaseMs: 250 });
    let t = 0;
    for (let i = 0; i < 5; i++) tr.push((t += step), 300);
    expect(tr.push((t += 100), null).freq).toBe(300);
    expect(tr.push((t += 200), null).freq).toBeNull();
    const back = tr.push((t += step), 200);
    expect(back.onset).toBe(true);
    expect(back.freq).toBe(200);
  });

  it('follows a continuous glide', () => {
    const tr = new PitchTracker();
    let t = 0;
    let f = 100;
    for (let i = 0; i < 120; i++) {
      tr.push((t += step), f);
      f *= Math.pow(2, 30 / 1200); // 30 cents per frame
    }
    // median-of-5 lags ~2 frames = ~60 cents
    const lag = 1200 * Math.log2(f / tr.current!);
    expect(lag).toBeLessThan(120);
    expect(lag).toBeGreaterThan(0);
  });
});
