import { useEffect, useSyncExternalStore } from 'react';
import { db } from '../db/db';
import { engine, mic } from '../audio';
import { dateKey } from '../engine/dates';
import { computeStreak, MIN_SECONDS, type PracticeLog, type StreakState } from '../engine/streaks';
import { getSettings } from './settings';

// Practice time, counted while a training screen is open, visible and its
// audio is running. A visit of 2+ minutes also counts as a "session"
// (used to repair a broken streak).

interface PracticeData {
  log: PracticeLog;
  sessions: number[];
  /** seconds with the mic open, per day (for the voice-break prompt) */
  singing: PracticeLog;
}

let data: PracticeData = { log: {}, sessions: [], singing: {} };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const practiceReady = (async () => {
  try {
    const [log, sessions, singing] = await Promise.all([db.kv.get('practiceLog'), db.kv.get('sessions'), db.kv.get('singingLog')]);
    data = { log: (log?.value as PracticeLog) ?? {}, sessions: (sessions?.value as number[]) ?? [], singing: (singing?.value as PracticeLog) ?? {} };
    emit();
  } catch {
    /* private mode etc. */
  }
})();

function save() {
  void db.kv.put({ key: 'practiceLog', value: data.log }).catch(() => {});
  void db.kv.put({ key: 'sessions', value: data.sessions }).catch(() => {});
  void db.kv.put({ key: 'singingLog', value: data.singing }).catch(() => {});
}

export function addPractice(seconds: number, now = Date.now(), singing = false) {
  const k = dateKey(new Date(now));
  data = { ...data, log: { ...data.log, [k]: (data.log[k] ?? 0) + seconds } };
  if (singing) data.singing = { ...data.singing, [k]: (data.singing[k] ?? 0) + seconds };
  save();
  emit();
}

export function addSession(now = Date.now()) {
  data = { ...data, sessions: [...data.sessions, now].slice(-200) };
  save();
  emit();
}

export const getPractice = () => data;

export function usePractice(): PracticeData {
  return useSyncExternalStore((fn) => (listeners.add(fn), () => listeners.delete(fn)), getPractice);
}

export function streakNow(p: PracticeData = data): StreakState {
  const s = getSettings();
  return computeStreak({ log: p.log, sessions: p.sessions, today: dateKey(), now: Date.now(), mode: s.streakMode, weeklyGoal: s.weeklyGoal });
}

export const todaySeconds = (p: PracticeData = data) => p.log[dateKey()] ?? 0;
export const singingToday = (p: PracticeData = data) => p.singing[dateKey()] ?? 0;

const TICK_S = 5;

/** Counts practice time while `active`. */
export function usePracticeClock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let visit = 0;
    let counted = false;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible' || engine.status !== 'running') return;
      visit += TICK_S;
      addPractice(TICK_S, Date.now(), mic.active);
      if (!counted && visit >= MIN_SECONDS) {
        counted = true;
        addSession();
      }
    }, TICK_S * 1000);
    return () => clearInterval(id);
  }, [active]);
}
