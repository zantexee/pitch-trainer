import { describe, expect, it } from 'vitest';
import { computeStreak, repairText, MIN_SECONDS, type PracticeLog } from '../src/engine/streaks';
import { addDays, dateKey, daysBetween, startOfDayMs, weekStart, keyFromMs } from '../src/engine/dates';

const T0 = '2026-03-02'; // a Monday
function log(days: (string | [string, number])[]): PracticeLog {
  const l: PracticeLog = {};
  for (const d of days) {
    if (Array.isArray(d)) l[d[0]] = d[1];
    else l[d] = 300;
  }
  return l;
}
const run = (l: PracticeLog, today: string, extra: Partial<Parameters<typeof computeStreak>[0]> = {}) =>
  computeStreak({ log: l, sessions: [], today, now: startOfDayMs(today) + 12 * 3600e3, ...extra });
const seq = (start: string, n: number) => Array.from({ length: n }, (_, i) => addDays(start, i));

describe('dates', () => {
  it('adds days across month, year and DST boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // EU DST change
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-03-28', '2026-03-31')).toBe(3);
  });
  it('day keys follow local midnight', () => {
    expect(dateKey(new Date(2026, 4, 3, 23, 59))).toBe('2026-05-03');
    expect(dateKey(new Date(2026, 4, 4, 0, 1))).toBe('2026-05-04');
    expect(keyFromMs(startOfDayMs('2026-05-04'))).toBe('2026-05-04');
    expect(keyFromMs(startOfDayMs('2026-05-04') - 1)).toBe('2026-05-03');
  });
  it('weeks start on Monday', () => {
    expect(weekStart('2026-03-02')).toBe('2026-03-02');
    expect(weekStart('2026-03-08')).toBe('2026-03-02'); // Sunday
    expect(weekStart('2026-03-09')).toBe('2026-03-09');
  });
});

describe('daily streak', () => {
  it('counts consecutive days with ≥ 2 minutes', () => {
    const s = run(log(seq(T0, 4)), addDays(T0, 3));
    expect(s.current).toBe(4);
    expect(s.todayDone).toBe(true);
    expect(s.totalDays).toBe(4);
  });
  it('under 2 minutes does not count', () => {
    const s = run(log([T0, [addDays(T0, 1), MIN_SECONDS - 1]]), addDays(T0, 1));
    expect(s.current).toBe(1);
    expect(s.todayDone).toBe(false);
  });
  it('today not done yet does not break the streak', () => {
    expect(run(log(seq(T0, 3)), addDays(T0, 3)).current).toBe(3);
  });
  it('a missed day without freezes breaks it, history stays', () => {
    const s = run(log([...seq(T0, 3), addDays(T0, 4)]), addDays(T0, 4), { now: startOfDayMs(addDays(T0, 10)) });
    expect(s.current).toBe(1);
    expect(s.best).toBe(3);
    expect(s.totalDays).toBe(4);
  });
  it('earns a freeze every 5 practice days and uses it automatically', () => {
    const days = [...seq(T0, 5), ...seq(addDays(T0, 6), 2)]; // miss day 6
    const s = run(log(days), addDays(T0, 7));
    expect(s.frozenDays).toEqual([addDays(T0, 5)]);
    expect(s.current).toBe(7);
    expect(s.freezes).toBe(0);
  });
  it('banks at most 2 freezes', () => {
    const s = run(log(seq(T0, 20)), addDays(T0, 19));
    expect(s.freezes).toBe(2);
  });
  it('repair: 2 sessions within 48 h restore the streak', () => {
    const miss = addDays(T0, 3);
    const after = startOfDayMs(addDays(T0, 4));
    const l = log([...seq(T0, 3), addDays(T0, 4)]);
    const sessions = [after + 9 * 3600e3, after + 20 * 3600e3];
    const s = run(l, addDays(T0, 4), { sessions, now: after + 21 * 3600e3 });
    expect(s.repairedDays).toEqual([miss]);
    expect(s.current).toBe(4);
    expect(s.repair).toBeNull();
  });
  it('repair offer is shown while pending, with neutral copy', () => {
    const after = startOfDayMs(addDays(T0, 4));
    const l = log([...seq(T0, 3), addDays(T0, 4)]);
    const now = after + 10 * 3600e3;
    const s = run(l, addDays(T0, 4), { sessions: [after + 9 * 3600e3], now });
    expect(s.repair).toMatchObject({ lost: 3, sessionsDone: 1, needed: 2 });
    expect(repairText(s.repair!, now)).toMatch(/^Life happens\. Repair your 3-day streak with 1 more session/);
  });
  it('repair window closes after 48 h', () => {
    const after = startOfDayMs(addDays(T0, 4));
    const l = log([...seq(T0, 3), addDays(T0, 6)]);
    const s = run(l, addDays(T0, 6), { sessions: [after + 50 * 3600e3, after + 51 * 3600e3], now: after + 52 * 3600e3 });
    expect(s.current).toBe(1);
    expect(s.repair).toBeNull();
  });
  it('practice just after midnight counts for the new day', () => {
    const l: PracticeLog = {};
    l[keyFromMs(startOfDayMs(T0) + 23.9 * 3600e3)] = 200;
    l[keyFromMs(startOfDayMs(addDays(T0, 1)) + 0.1 * 3600e3)] = 200;
    const s = run(l, addDays(T0, 1));
    expect(s.current).toBe(2);
  });
});

describe('weekly goal mode', () => {
  it('counts weeks that hit the goal; the current week never breaks it', () => {
    const w1 = seq(T0, 4); // 4 days in week 1
    const w2 = seq(addDays(T0, 7), 4);
    const w3 = [addDays(T0, 14)]; // week 3 in progress, 1 day so far
    const s = run(log([...w1, ...w2, ...w3]), addDays(T0, 15), { mode: 'weekly', weeklyGoal: 4 });
    expect(s.current).toBe(2);
    expect(s.weekDays).toBe(1);
  });
  it('a short week breaks it', () => {
    const s = run(log([...seq(T0, 4), ...seq(addDays(T0, 7), 2), ...seq(addDays(T0, 14), 4)]), addDays(T0, 20), { mode: 'weekly', weeklyGoal: 4 });
    expect(s.current).toBe(1);
    expect(s.best).toBe(1);
  });
});
