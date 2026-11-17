import { useEffect, useState, type ReactNode } from 'react';
import { engine } from '../../audio';
import { playNote, type NoteOptions } from '../../audio/synth';
import { getSettings } from '../../lib/settings';
import { go } from '../../lib/router';
import type { LeverDef } from '../../engine/adaptive';

// Shared bits for the listening-only drills. No mic here: audio session stays "playback".

export const LEVEL_LEVER = (n: number): LeverDef<unknown>[] => [{ id: 'level', label: 'Level', steps: Array.from({ length: n }, (_, i) => i) }];
export const EAR_ADAPTIVE = { window: 12, minAttempts: 10, raiseAbove: 0.85, lowerBelow: 0.6 };

/** Play a sequence of notes (MIDI, or arrays for chords). Returns seconds until it has finished. */
export function playSeq(seq: (number | number[])[], o: { dur?: number; gap?: number; start?: number } & NoteOptions = {}): number {
  const dur = o.dur ?? 0.5;
  const gap = o.gap ?? 0.1;
  const t0 = engine.now + (o.start ?? 0.05);
  const a4 = getSettings().a4;
  seq.forEach((item, i) => {
    const notes = Array.isArray(item) ? item : [item];
    for (const m of notes) playNote(engine, m, a4, { ...o, duration: dur, when: t0 + i * (dur + gap), velocity: (o.velocity ?? 0.7) / Math.sqrt(notes.length) });
  });
  return (o.start ?? 0.05) + seq.length * (dur + gap) + 0.2;
}

export function EarShell({ title, score, children }: { title: string; score?: { n: number; ok: number }; children: ReactNode }) {
  return (
    <main className="screen">
      <header className="bar">
        <button className="btn ghost" onClick={() => go('/ear')}>
          ‹ Ear
        </button>
        <h2>{title}</h2>
        <span className="muted small push">{score && score.n > 0 ? `${score.ok}/${score.n}` : ''}</span>
      </header>
      {children}
    </main>
  );
}

export type Feedback = { correct: boolean; answer: string } | null;

export function FeedbackLine({ fb }: { fb: Feedback }) {
  if (!fb) return <div className="ear-fb" />;
  return <div className={`ear-fb ${fb.correct ? 'ok' : 'no'}`}>{fb.correct ? '✓ Right' : `✗ It was ${fb.answer}`}</div>;
}

/** Answer buttons in a grid; the correct one is highlighted after answering. */
export function Answers<T extends string | number>({
  options,
  label,
  onAnswer,
  disabled,
  reveal,
}: {
  options: T[];
  label: (o: T) => ReactNode;
  onAnswer: (o: T) => void;
  disabled?: boolean;
  reveal?: { correct: T; chosen: T } | null;
}) {
  return (
    <div className={`answers n${Math.min(options.length, 4)}`}>
      {options.map((o) => (
        <button
          key={String(o)}
          className={`answer ${reveal && reveal.correct === o ? 'right' : ''} ${reveal && reveal.chosen === o && reveal.chosen !== reveal.correct ? 'wrong' : ''}`}
          disabled={disabled}
          onClick={() => onAnswer(o)}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}

/** Calls fn after ms, cancelled on unmount or when deps change. */
export function useLater() {
  const [timers] = useState<Set<ReturnType<typeof setTimeout>>>(() => new Set());
  useEffect(() => () => timers.forEach(clearTimeout), [timers]);
  return (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
}
