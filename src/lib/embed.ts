import { createContext, useContext, useEffect, useRef } from 'react';
import type { Bonus } from '../engine/session';

// When a mode runs inside a Daily Mix session it is "embedded": no header,
// no setup controls, it starts by itself and reports each trial to the runner.

export interface TrialReport {
  ok: boolean;
  /** a personal-best message earned on this trial */
  best?: string | null;
}

export interface Embed {
  bonus?: Bonus;
  /** a sub-variant picked by the runner (e.g. which drone challenge) */
  variant?: string;
  report(r: TrialReport): void;
}

export const EmbedCtx = createContext<Embed | null>(null);
export const useEmbed = () => useContext(EmbedCtx);

/** Run `start` once when `ready` first becomes true, only when embedded. */
export function useAutoStart(ready: boolean, start: () => void) {
  const embed = useEmbed();
  const done = useRef(false);
  const fn = useRef(start);
  fn.current = start;
  useEffect(() => {
    if (!embed || !ready || done.current) return;
    done.current = true;
    const id = setTimeout(() => fn.current(), 250);
    return () => clearTimeout(id);
  }, [embed, ready]);
}
