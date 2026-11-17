import { describe, expect, it } from 'vitest';
import { Detector, windowSizeFor, calibrateNoiseGate } from '../src/pitch/detector';
import { PitchTracker } from '../src/pitch/tracker';
import { cents, nameToMidi, noteToFreq } from '../src/lib/notes';
import { makeSignal, rng, type SignalKind } from './signals';

const NOTES = ['A1', 'C2', 'E2', 'A2', 'C3', 'C4', 'A4', 'C5', 'C6'];
const RATES = [44100, 48000];
const KINDS: SignalKind[] = ['sine', 'saw', 'voice'];
const HOP = 800; // ≈ 55-60 analyses per second

function medianOf(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

describe('detector on synthetic signals', () => {
  for (const sr of RATES) {
    for (const kind of KINDS) {
      for (const name of NOTES) {
        it(`${kind} ${name} @ ${sr / 1000} kHz`, () => {
          const target = noteToFreq(nameToMidi(name)!);
          const { samples, inst } = makeSignal(kind, target, sr, 1.2, 7);
          const det = new Detector();
          const tracker = new PitchTracker();
          const size = windowSizeFor(target);
          const rawErrors: number[] = [];
          const smoothErrors: number[] = [];
          const smoothVsTarget: number[] = [];
          let rawOctaveErrors = 0;
          let smoothOctaveErrors = 0;
          let frames = 0;
          let accepted = 0;
          for (let end = size; end <= samples.length; end += HOP) {
            frames++;
            const frame = det.analyze(samples.subarray(end - size, end), sr, target);
            // True pitch = mean instantaneous f0 over the window.
            let sum = 0;
            for (let i = end - size; i < end; i++) sum += inst[i];
            const truth = sum / size;
            const out = tracker.push((end / sr) * 1000, frame.freq);
            if (frame.freq != null) {
              accepted++;
              const e = cents(frame.freq, truth);
              rawErrors.push(Math.abs(e));
              if (Math.abs(e) > 600) rawOctaveErrors++;
            }
            if (out.freq != null) {
              const e = cents(out.freq, truth);
              smoothErrors.push(Math.abs(e));
              smoothVsTarget.push(cents(out.freq, target));
              if (Math.abs(e) > 600) smoothOctaveErrors++;
            }
          }
          expect(accepted / frames, 'share of frames accepted').toBeGreaterThan(0.9);
          expect(rawOctaveErrors, 'raw octave errors').toBe(0);
          expect(smoothOctaveErrors, 'smoothed octave errors').toBe(0);
          expect(medianOf(rawErrors), 'median |error| cents').toBeLessThan(10);
          // The median-of-5 smoother lags the 5.5 Hz vibrato by ~2 frames, so
          // against the *instantaneous* pitch it reads up to ~20¢ behind. What
          // the app scores is the sung note, so for the smoothed output we
          // check the median error against the target note instead.
          expect(Math.abs(medianOf(smoothVsTarget)), 'median smoothed error vs target, cents').toBeLessThan(10);
          if (kind !== 'voice') expect(medianOf(smoothErrors), 'median smoothed |error| cents').toBeLessThan(10);
        });
      }
    }
  }
});

describe('silence', () => {
  for (const sr of RATES) {
    it(`digital silence returns no pitch @ ${sr}`, () => {
      const det = new Detector();
      const buf = new Float32Array(4096);
      expect(det.analyze(buf, sr, null).freq).toBeNull();
      expect(det.analyze(buf, sr, 440).freq).toBeNull();
    });
    it(`quiet room noise returns no pitch @ ${sr}`, () => {
      const rand = rng(3);
      const noise = new Float32Array(sr * 2);
      for (let i = 0; i < noise.length; i++) noise[i] = 0.0008 * (2 * rand() - 1);
      // calibrate on the first second, test on the second
      const levels: number[] = [];
      for (let end = 2048; end <= sr; end += HOP) {
        let s = 0;
        for (let i = end - 2048; i < end; i++) s += noise[i] * noise[i];
        levels.push(Math.sqrt(s / 2048));
      }
      const det = new Detector({ noiseGate: calibrateNoiseGate(levels) });
      for (let end = sr + 4096; end <= noise.length; end += HOP) {
        expect(det.analyze(noise.subarray(end - 4096, end), sr, null).freq).toBeNull();
      }
    });
    it(`louder white noise is rejected as unclear @ ${sr}`, () => {
      const rand = rng(9);
      const noise = new Float32Array(4096 * 20);
      for (let i = 0; i < noise.length; i++) noise[i] = 0.1 * (2 * rand() - 1);
      const det = new Detector();
      let hits = 0;
      for (let end = 4096; end <= noise.length; end += 2048) if (det.analyze(noise.subarray(end - 4096, end), sr, null).freq != null) hits++;
      expect(hits).toBe(0);
    });
  }
});

describe('window size', () => {
  it('long window for low targets', () => {
    expect(windowSizeFor(65.4)).toBe(4096);
    expect(windowSizeFor(109)).toBe(4096);
    expect(windowSizeFor(110)).toBe(2048);
    expect(windowSizeFor(440)).toBe(2048);
    expect(windowSizeFor(null)).toBe(4096);
  });
});
