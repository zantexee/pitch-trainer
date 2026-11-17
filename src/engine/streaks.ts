import { addDays, daysBetween, startOfDayMs, weekStart } from './dates';

// Forgiving streaks.
//  * A day counts with at least 2 minutes of practice.
//  * 1 freeze is earned per 5 practice days (max 2 banked) and is used
//    automatically on a missed day.
//  * A broken streak can be repaired: 2 sessions within 48 hours of the end
//    of the missed day restore it.
//  * Optional weekly-goal mode (e.g. 4 days a week) instead of daily.
// Today never breaks a streak: it isn't over yet.

export const MIN_SECONDS = 120;
export const FREEZE_EVERY = 5;
export const MAX_FREEZES = 2;
export const REPAIR_SESSIONS = 2;
export const REPAIR_WINDOW_MS = 48 * 3600 * 1000;

export type PracticeLog = Record<string, number>;

export interface StreakInput {
  log: PracticeLog;
  /** timestamps (ms) of practice sessions (≥ 2 min) */
  sessions: number[];
  today: string;
  now: number;
  mode?: 'daily' | 'weekly';
  weeklyGoal?: number;
}

export interface StreakState {
  mode: 'daily' | 'weekly';
  /** days (daily mode) or weeks (weekly mode) */
  current: number;
  best: number;
  freezes: number;
  frozenDays: string[];
  repairedDays: string[];
  repair: { lost: number; brokenDay: string; deadline: number; sessionsDone: number; needed: number } | null;
  totalDays: number;
  todayDone: boolean;
  /** weekly mode: practice days so far this week */
  weekDays: number;
  weeklyGoal: number;
}

export const qualifies = (log: PracticeLog, key: string) => (log[key] ?? 0) >= MIN_SECONDS;

export function computeStreak(input: StreakInput): StreakState {
  const { log, today, now } = input;
  const mode = input.mode ?? 'daily';
  const goal = input.weeklyGoal ?? 4;
  const days = Object.keys(log)
    .filter((k) => qualifies(log, k) && k <= today)
    .sort();
  const totalDays = days.length;
  const todayDone = qualifies(log, today);
  const base: StreakState = { mode, current: 0, best: 0, freezes: 0, frozenDays: [], repairedDays: [], repair: null, totalDays, todayDone, weekDays: 0, weeklyGoal: goal };
  if (!days.length) return base;
  if (mode === 'weekly') return weekly(input, base, days[0], goal);

  const sessions = [...input.sessions].sort((a, b) => a - b);
  let streak = 0;
  let best = 0;
  let freezes = 0;
  let practiceDays = 0;
  let forgiveThrough: string | null = null;
  let repair: StreakState['repair'] = null;
  const frozenDays: string[] = [];
  const repairedDays: string[] = [];

  for (let d = days[0]; d <= today; d = addDays(d, 1)) {
    if (qualifies(log, d)) {
      streak++;
      practiceDays++;
      if (practiceDays % FREEZE_EVERY === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
      best = Math.max(best, streak);
      continue;
    }
    if (d === today) break; // today isn't over
    if (forgiveThrough && d <= forgiveThrough) {
      repairedDays.push(d);
      continue;
    }
    if (freezes > 0) {
      freezes--;
      frozenDays.push(d);
      continue;
    }
    // Broken. Can it be repaired?
    const windowStart = startOfDayMs(addDays(d, 1));
    const deadline = windowStart + REPAIR_WINDOW_MS;
    const inWindow = sessions.filter((t) => t >= windowStart && t <= deadline && t <= now);
    if (inWindow.length >= REPAIR_SESSIONS && streak > 0) {
      repairedDays.push(d);
      forgiveThrough = addDays(d, 2);
      continue; // streak carries on
    }
    if (streak > 0 && now <= deadline) {
      repair = { lost: streak, brokenDay: d, deadline, sessionsDone: inWindow.length, needed: REPAIR_SESSIONS };
    } else if (repair && d > repair.brokenDay) {
      // a second miss inside a pending window keeps the original offer
    } else {
      repair = null;
    }
    streak = 0;
  }
  // If a repair is pending but the user has practised since, keep showing the offer
  // (the restored value would be lost + current).
  if (repair && now > repair.deadline) repair = null;
  return { ...base, current: streak, best, freezes, frozenDays, repairedDays, repair };
}

function weekly(input: StreakInput, base: StreakState, first: string, goal: number): StreakState {
  const { log, today } = input;
  const thisWeek = weekStart(today);
  const countWeek = (ws: string) => {
    let n = 0;
    for (let i = 0; i < 7; i++) {
      const k = addDays(ws, i);
      if (k <= today && qualifies(log, k)) n++;
    }
    return n;
  };
  let streak = 0;
  let best = 0;
  for (let ws = weekStart(first); ws < thisWeek; ws = addDays(ws, 7)) {
    if (countWeek(ws) >= goal) {
      streak++;
      best = Math.max(best, streak);
    } else streak = 0;
  }
  const weekDays = countWeek(thisWeek);
  if (weekDays >= goal) {
    streak++;
    best = Math.max(best, streak);
  }
  return { ...base, current: streak, best, weekDays };
}

/** Text for the repair offer (neutral, never guilt). */
export function repairText(r: NonNullable<StreakState['repair']>, now: number): string {
  const left = r.needed - r.sessionsDone;
  const hours = Math.max(1, Math.round((r.deadline - now) / 3600000));
  return `Life happens. Repair your ${r.lost}-day streak with ${left} more session${left === 1 ? '' : 's'} (${hours} h left).`;
}

export function daysSince(a: string, b: string) {
  return daysBetween(a, b);
}
