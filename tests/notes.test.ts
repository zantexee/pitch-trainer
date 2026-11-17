import { describe, expect, it } from 'vitest';
import { cents, foldCents, foldError, freqToMidi, midiToName, nameToMidi, nearestNote, noteToFreq, clampA4 } from '../src/lib/notes';

describe('note maths', () => {
  it('reference pitches', () => {
    expect(noteToFreq(69)).toBeCloseTo(440, 10);
    expect(noteToFreq(60)).toBeCloseTo(261.6256, 3);
    expect(noteToFreq(36)).toBeCloseTo(65.4064, 3); // C2
    expect(noteToFreq(33)).toBeCloseTo(55, 6); // A1
    expect(noteToFreq(84)).toBeCloseTo(1046.502, 2); // C6
  });
  it('respects A4 tuning', () => {
    expect(noteToFreq(69, 432)).toBeCloseTo(432, 10);
    expect(noteToFreq(81, 450)).toBeCloseTo(900, 10);
    expect(freqToMidi(432, 432)).toBeCloseTo(69, 10);
    expect(clampA4(400)).toBe(430);
    expect(clampA4(460)).toBe(450);
  });
  it('freq <-> midi round trip', () => {
    for (let m = 21; m <= 108; m++) expect(freqToMidi(noteToFreq(m))).toBeCloseTo(m, 9);
  });
  it('names', () => {
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(69)).toBe('A4');
    expect(midiToName(54)).toBe('F#3');
    expect(midiToName(36)).toBe('C2');
    expect(midiToName(0)).toBe('C-1');
    expect(midiToName(11)).toBe('B-1');
    expect(midiToName(12)).toBe('C0');
    expect(nameToMidi('C4')).toBe(60);
    expect(nameToMidi('F#3')).toBe(54);
    expect(nameToMidi('Gb3')).toBe(54);
    expect(nameToMidi('c#5')).toBe(73);
    expect(nameToMidi('B#3')).toBe(60);
    expect(nameToMidi('Cb4')).toBe(59);
    expect(nameToMidi('C-1')).toBe(0);
    expect(nameToMidi('H2')).toBeNull();
    for (let m = 0; m < 128; m++) expect(nameToMidi(midiToName(m))).toBe(m);
  });
  it('nearest note', () => {
    const n = nearestNote(445);
    expect(n.name).toBe('A4');
    expect(n.cents).toBeCloseTo(19.56, 1);
  });
});

describe('cents and octave folding', () => {
  it('cents', () => {
    expect(cents(880, 440)).toBeCloseTo(1200, 9);
    expect(cents(220, 440)).toBeCloseTo(-1200, 9);
    expect(cents(440, 440)).toBe(0);
    expect(cents(noteToFreq(70), noteToFreq(69))).toBeCloseTo(100, 9);
  });
  it('same note one octave low is octave -1, pitch class 0', () => {
    const f = foldError(130.81, 261.63);
    expect(f.octave).toBe(-1);
    expect(Math.abs(f.pcCents)).toBeLessThan(1);
  });
  it('two octaves high', () => {
    const f = foldError(noteToFreq(84), noteToFreq(60));
    expect(f.octave).toBe(2);
    expect(f.pcCents).toBeCloseTo(0, 6);
  });
  it('wrong note in the right octave', () => {
    const f = foldError(noteToFreq(67), noteToFreq(60)); // G4 vs C4
    expect(f.octave).toBe(1); // +700 folds to -500 an octave up
    expect(f.pcCents).toBeCloseTo(-500, 6);
    const g = foldError(noteToFreq(64), noteToFreq(60)); // E4 vs C4
    expect(g.octave).toBe(0);
    expect(g.pcCents).toBeCloseTo(400, 6);
  });
  it('pitch class stays in [-600, 600) and recombines', () => {
    for (let c = -3000; c <= 3000; c += 37) {
      const f = foldCents(c);
      expect(f.pcCents).toBeGreaterThanOrEqual(-600);
      expect(f.pcCents).toBeLessThan(600);
      expect(f.pcCents + 1200 * f.octave).toBeCloseTo(c, 9);
    }
    expect(foldCents(600)).toMatchObject({ pcCents: -600, octave: 1 });
    expect(foldCents(-600)).toMatchObject({ pcCents: -600, octave: 0 });
    expect(foldCents(-1190)).toMatchObject({ octave: -1 });
  });
});
