import { describe, expect, it } from 'vitest';
import { buildLadder, cadence, chooseTonic, degreeLabel, ladderPlan, LADDER_STAGES, SCALES, solfege } from '../src/engine/ladder';
import { DEFAULT_RANGE, notesInRange, type VoiceRange } from '../src/lib/range';
import { rng } from './signals';

const R: VoiceRange = { low: { lo: 33, hi: 45 }, chest: { lo: 45, hi: 64 }, falsetto: { lo: 57, hi: 77 } };

describe('ladder plans', () => {
  it('Kodály order: early stages only use their notes', () => {
    const r = rng(1);
    const allowed = [[7, 4], [7, 4, 9], [0, 4, 7, 9], [0, 2, 4, 7, 9]];
    allowed.forEach((set, stage) => {
      for (let i = 0; i < 20; i++) {
        const p = ladderPlan(stage, r);
        for (const s of p.steps) expect(set).toContain(s.offset);
        for (let k = 1; k < p.steps.length; k++) expect(p.steps[k].offset).not.toBe(p.steps[k - 1].offset);
      }
    });
  });
  it('scale stages go up and back down', () => {
    const p = ladderPlan(4, rng(1));
    expect(p.steps.map((s) => s.offset)).toEqual([0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0]);
    expect(ladderPlan(5, rng(1)).steps.map((s) => s.offset)).toContain(3);
  });
  it('modes and jumps stay in their scale', () => {
    const r = rng(3);
    for (let i = 0; i < 20; i++) {
      const p = ladderPlan(6, r);
      for (const s of p.steps) expect(SCALES[p.scale]).toContain(s.offset);
      const j = ladderPlan(7, r);
      expect(j.steps[0].offset).toBe(0);
      for (const s of j.steps) expect(SCALES.major).toContain(s.offset);
    }
  });
  it('register transfer: chest then the same scale an octave up in falsetto', () => {
    const p = ladderPlan(8, rng(1));
    expect(p.steps.slice(0, 8).every((s) => s.register === 'chest')).toBe(true);
    expect(p.steps.slice(8).every((s) => s.register === 'falsetto')).toBe(true);
    expect(p.steps[8].offset).toBe(12);
  });
  it('has a title per stage', () => expect(LADDER_STAGES.length).toBe(9));
});

describe('tonic selection', () => {
  it('fits every step into the chest range', () => {
    const r = rng(5);
    const chest = new Set(notesInRange(R, ['chest']));
    for (let stage = 0; stage < 8; stage++) {
      const p = ladderPlan(stage, r);
      const t = chooseTonic(p, R, false, r)!;
      expect(t).not.toBeNull();
      for (const s of p.steps) expect(chest.has(t + s.offset)).toBe(true);
    }
  });
  it('register transfer needs both registers', () => {
    const r = rng(5);
    const p = ladderPlan(8, r);
    const t = chooseTonic(p, R, false, r)!;
    expect(t).toBeGreaterThanOrEqual(45);
    expect(t + 12).toBeLessThanOrEqual(64);
    expect(t + 12).toBeGreaterThanOrEqual(57);
    expect(t + 24).toBeLessThanOrEqual(77);
    const tiny: VoiceRange = { ...R, falsetto: { lo: 70, hi: 74 } };
    expect(chooseTonic(p, tiny, false, r)).toBeNull();
  });
  it('buildLadder drops to an easier stage when needed', () => {
    const tiny: VoiceRange = { ...DEFAULT_RANGE, chest: { lo: 50, hi: 58 }, falsetto: { lo: 70, hi: 72 } };
    const b = buildLadder(8, tiny, false, rng(1))!;
    expect(b.plan.stage).toBeLessThan(8);
  });
});

describe('labels', () => {
  it('solfège and degrees', () => {
    expect([0, 2, 4, 5, 7, 9, 11].map(solfege)).toEqual(['do', 're', 'mi', 'fa', 'sol', 'la', 'ti']);
    expect(degreeLabel(3)).toBe('♭3');
    expect(degreeLabel(12)).toBe('8');
    expect(degreeLabel(7)).toBe('5');
  });
  it('cadence has four chords and uses a minor third in minor', () => {
    expect(cadence('major')).toHaveLength(4);
    expect(cadence('minor')[0]).toContain(3);
    expect(cadence('major')[0]).toContain(4);
  });
});
