// Adaptive difficulty ("85% rule" heuristic, tunable).
// Each skill has a few difficulty levers, each a list of steps from easy to
// hard. Over a rolling window of recent attempts: above `raiseAbove` success,
// raise one lever one step; below `lowerBelow`, lower one. Levers are raised
// round-robin so difficulty grows along every dimension, and the most
// recently raised lever is the first to come back down.

export interface LeverDef<T = number> {
  id: string;
  label: string;
  /** easy → hard */
  steps: T[];
}

export interface AdaptiveState {
  /** current step index per lever */
  levels: Record<string, number>;
  /** recent outcomes since the last change, newest last */
  recent: boolean[];
  /** order in which levers were raised (stack) */
  raised: string[];
  /** round-robin pointer */
  next: number;
}

export interface AdaptiveConfig {
  window: number;
  /** minimum attempts in the window before a change */
  minAttempts: number;
  raiseAbove: number;
  lowerBelow: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveConfig = { window: 12, minAttempts: 8, raiseAbove: 0.9, lowerBelow: 0.7 };

export interface AdaptiveChange {
  lever: string;
  dir: 1 | -1;
  from: number;
  to: number;
}

export function initialState(levers: LeverDef<unknown>[], start: Record<string, number> = {}): AdaptiveState {
  const levels: Record<string, number> = {};
  for (const l of levers) levels[l.id] = Math.min(l.steps.length - 1, Math.max(0, start[l.id] ?? 0));
  return { levels, recent: [], raised: [], next: 0 };
}

export function successRate(recent: boolean[]): number {
  return recent.length ? recent.filter(Boolean).length / recent.length : 0;
}

export function recordOutcome(
  state: AdaptiveState,
  levers: LeverDef<unknown>[],
  success: boolean,
  cfg: AdaptiveConfig = DEFAULT_ADAPTIVE,
): { state: AdaptiveState; change: AdaptiveChange | null } {
  const recent = [...state.recent, success].slice(-cfg.window);
  const s: AdaptiveState = { ...state, levels: { ...state.levels }, recent, raised: [...state.raised] };
  if (recent.length < cfg.minAttempts) return { state: s, change: null };
  const rate = successRate(recent);

  if (rate > cfg.raiseAbove) {
    for (let k = 0; k < levers.length; k++) {
      const idx = (s.next + k) % levers.length;
      const l = levers[idx];
      const cur = s.levels[l.id];
      if (cur < l.steps.length - 1) {
        s.levels[l.id] = cur + 1;
        s.raised.push(l.id);
        s.next = (idx + 1) % levers.length;
        s.recent = [];
        return { state: s, change: { lever: l.id, dir: 1, from: cur, to: cur + 1 } };
      }
    }
    return { state: s, change: null }; // maxed out
  }

  if (rate < cfg.lowerBelow) {
    // undo the most recent raise first, else any lever above its minimum
    let target: string | undefined;
    while (s.raised.length && !target) {
      const id = s.raised.pop()!;
      if (s.levels[id] > 0) target = id;
    }
    target ??= levers.find((l) => s.levels[l.id] > 0)?.id;
    if (target) {
      const cur = s.levels[target];
      s.levels[target] = cur - 1;
      s.recent = [];
      return { state: s, change: { lever: target, dir: -1, from: cur, to: cur - 1 } };
    }
  }
  return { state: s, change: null };
}

export function leverValue<T>(levers: LeverDef<T>[], state: AdaptiveState, id: string): T {
  const l = levers.find((x) => x.id === id)!;
  return l.steps[state.levels[id] ?? 0];
}
