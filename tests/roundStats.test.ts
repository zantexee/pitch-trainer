import { describe, expect, it } from 'vitest';
import { summarizeRound, currentStreak, hlTags, HL_DIMS, type TrialRecord } from '../src/engine/roundStats';

const t = (correct: boolean, tags: Record<string, string>, expected?: string, answer?: string): TrialRecord => ({ correct, tags, expected, answer });

describe('round summary', () => {
  it('percentage and streaks', () => {
    const trials = [t(true, {}), t(true, {}), t(false, {}), t(true, {}), t(true, {}), t(true, {})];
    const s = summarizeRound(trials, []);
    expect(s.pct).toBe(83);
    expect(s.bestStreak).toBe(3);
    expect(currentStreak(trials)).toBe(3);
  });
  it('finds where the problems were', () => {
    const trials: TrialRecord[] = [];
    for (let i = 0; i < 10; i++) trials.push(t(true, hlTags(60, 'higher', 400)));
    for (let i = 0; i < 4; i++) trials.push(t(false, hlTags(8, 'lower', 500)));
    trials.push(t(true, hlTags(8, 'higher', 250)));
    const s = summarizeRound(trials, HL_DIMS);
    expect(s.problems[0]).toMatchObject({ dimension: 'Direction', value: '2nd tone lower', misses: 4, n: 4 });
    expect(s.problems).toContainEqual(expect.objectContaining({ dimension: 'Difference', value: '< 10¢', misses: 4 }));
    expect(s.problems.map((p) => p.value)).not.toContain('middle');
    expect(s.dims[0].groups.map((g) => g.value)).toEqual(['< 10¢', '50¢ +']);
  });
  it('no problems when misses are spread evenly', () => {
    const trials = [t(false, { d: 'a' }), t(true, { d: 'a' }), t(false, { d: 'b' }), t(true, { d: 'b' })];
    expect(summarizeRound(trials, [{ key: 'd', label: 'D' }]).problems).toHaveLength(0);
  });
  it('lists repeated confusions', () => {
    const trials = [t(false, {}, '3', '5'), t(false, {}, '3', '5'), t(false, {}, '2', '1'), t(true, {}, '1', '1')];
    expect(summarizeRound(trials, []).confusions).toEqual([{ expected: '3', answer: '5', count: 2 }]);
  });
});
