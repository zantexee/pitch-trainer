import { describe, expect, it } from 'vitest';
import { initialState, leverValue, recordOutcome, type LeverDef } from '../src/engine/adaptive';

const levers: LeverDef[] = [
  { id: 'tol', label: 'Tolerance', steps: [50, 35, 25, 15] },
  { id: 'hold', label: 'Hold', steps: [500, 1000, 2000] },
];

function run(state = initialState(levers), outcomes: boolean[]) {
  const changes = [];
  for (const o of outcomes) {
    const r = recordOutcome(state, levers, o);
    state = r.state;
    if (r.change) changes.push(r.change);
  }
  return { state, changes };
}

describe('adaptive difficulty', () => {
  it('starts at the easiest step', () => {
    const s = initialState(levers);
    expect(leverValue(levers, s, 'tol')).toBe(50);
    expect(leverValue(levers, s, 'hold')).toBe(500);
  });
  it('needs a minimum number of attempts', () => {
    expect(run(undefined, Array(7).fill(true)).changes).toHaveLength(0);
  });
  it('raises levers round-robin when success > 90%', () => {
    const { state, changes } = run(undefined, Array(16).fill(true));
    expect(changes.map((c) => c.lever)).toEqual(['tol', 'hold']);
    expect(state.levels).toEqual({ tol: 1, hold: 1 });
  });
  it('holds steady in the 70–90% band', () => {
    // 10 of 12 = 83%
    const pattern = [true, true, true, true, false, true, true, true, true, true, false, true];
    expect(run(undefined, pattern).changes).toHaveLength(0);
  });
  it('lowers the most recently raised lever when success < 70%', () => {
    let { state } = run(undefined, Array(16).fill(true)); // tol 1, hold 1
    const r = run(state, Array(8).fill(false));
    expect(r.changes[0]).toMatchObject({ lever: 'hold', dir: -1 });
    state = r.state;
    const r2 = run(state, Array(8).fill(false));
    expect(r2.changes[0]).toMatchObject({ lever: 'tol', dir: -1 });
  });
  it('never goes below the easiest or above the hardest step', () => {
    expect(run(undefined, Array(40).fill(false)).state.levels).toEqual({ tol: 0, hold: 0 });
    expect(run(undefined, Array(200).fill(true)).state.levels).toEqual({ tol: 3, hold: 2 });
  });
});
