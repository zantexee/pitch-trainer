import { useEffect, useState, type ReactNode } from 'react';
import { engine } from '../../audio';
import { playNote, type NoteOptions } from '../../audio/synth';
import { getSettings, updateSettings, useSettings } from '../../lib/settings';
import { summarizeRound, currentStreak, type Dimension, type RoundSummary, type TrialRecord } from '../../engine/roundStats';
import { go } from '../../lib/router';
import type { LeverDef } from '../../engine/adaptive';
import { useEmbed } from '../../lib/embed';
import { recordBest } from '../../lib/bests';

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
  const embed = useEmbed();
  if (embed) return <main className="screen">{children}</main>;
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
  if (!fb) return <div className="ear-fb" aria-live="polite" />;
  return <div className={`ear-fb ${fb.correct ? 'ok' : 'no'}`} aria-live="polite">{fb.correct ? '✓ Right' : `✗ It was ${fb.answer}`}</div>;
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

// ---------- rounds: 10 / 20 / 50 / unlimited, with a summary at the end ----------


export const ROUND_LENGTHS = [10, 20, 50, 0];

export function useRound(dims: Dimension[], id: string) {
  const s = useSettings();
  const embed = useEmbed();
  const [trials, setTrials] = useState<TrialRecord[]>([]);
  const [summary, setSummary] = useState<RoundSummary | null>(null);
  const [newBest, setNewBest] = useState<number | null>(null);
  // In a Daily Mix the runner's clock ends the round.
  const len = embed ? 0 : s.earRoundLength;
  return {
    len,
    trials,
    summary,
    newBest,
    embedded: !!embed,
    streak: currentStreak(trials),
    /** Record a trial. Returns true if this trial ends the round. */
    record(t: TrialRecord, delayMs = 900): boolean {
      const next = [...trials, t];
      setTrials(next);
      const run = currentStreak(next);
      let best: string | null = null;
      if (t.correct && run >= 3 && recordBest(`run:${id}`, run)) {
        setNewBest(run);
        best = `New best: ${run} in a row`;
      }
      embed?.report({ ok: t.correct, best });
      if (len && next.length >= len) {
        setTimeout(() => setSummary(summarizeRound(next, dims)), delayMs);
        return true;
      }
      return false;
    },
    end() {
      if (trials.length) setSummary(summarizeRound(trials, dims));
    },
    reset() {
      setTrials([]);
      setSummary(null);
      setNewBest(null);
    },
  };
}

export function RoundPicker() {
  const s = useSettings();
  if (useEmbed()) return null;
  return (
    <div className="chips center-chips" role="radiogroup" aria-label="Round length">
      {ROUND_LENGTHS.map((n) => (
        <button key={n} role="radio" aria-checked={s.earRoundLength === n} className={`chip ${s.earRoundLength === n ? 'on' : ''}`} onClick={() => updateSettings({ earRoundLength: n })}>
          {n === 0 ? '∞' : n}
        </button>
      ))}
    </div>
  );
}

export function RoundStatus({ round }: { round: ReturnType<typeof useRound> }) {
  return (
    <div className="round-status">
      <span className="muted">{round.len ? `${round.trials.length} / ${round.len}` : `${round.trials.length} so far`}</span>
      {round.streak >= 3 && <span className="streak-pill">{round.newBest === round.streak ? `★ ${round.streak} in a row, new best` : `${round.streak} in a row`}</span>}
      {!round.len && !round.embedded && round.trials.length > 0 && (
        <button className="btn ghost small" onClick={round.end}>
          End round
        </button>
      )}
      {round.len > 0 && (
        <div className="round-bar" aria-hidden="true">
          <div style={{ width: `${(100 * round.trials.length) / round.len}%` }} />
        </div>
      )}
    </div>
  );
}

export function RoundSummaryCard({
  summary,
  extra,
  onAgain,
  confusionLabel,
  newBest,
}: {
  summary: RoundSummary;
  extra?: ReactNode;
  onAgain: () => void;
  confusionLabel?: (expected: string, answer: string) => string;
  newBest?: number | null;
}) {
  const verdict = summary.pct >= 90 ? 'Excellent' : summary.pct >= 75 ? 'Solid' : summary.pct >= 60 ? 'Getting there' : 'Tough round';
  return (
    <section className="card summary">
      <div className="summary-head">
        <div className="summary-pct">{summary.pct}%</div>
        <div>
          <strong>{verdict}</strong>
          <div className="muted small">
            {summary.ok} of {summary.n} right · best run {summary.bestStreak}
          </div>
        </div>
      </div>
      {newBest != null && <div className="pb">★ New best run: {newBest} in a row</div>}
      {extra}
      <div>
        <h4>Where the problems were</h4>
        {summary.problems.length === 0 ? (
          <p className="muted small">No clear weak spot: misses were spread out.</p>
        ) : (
          <ul className="problems">
            {summary.problems.map((p) => (
              <li key={p.dimension + p.value}>
                <span>
                  {p.dimension}: <strong>{p.value}</strong>
                </span>
                <span className="muted">
                  {p.n - p.misses}/{p.n} right
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {summary.confusions.length > 0 && (
        <div>
          <h4>Most common mix-ups</h4>
          <ul className="problems">
            {summary.confusions.map((c) => (
              <li key={c.expected + c.answer}>
                <span>{confusionLabel ? confusionLabel(c.expected, c.answer) : `${c.expected} heard as ${c.answer}`}</span>
                <span className="muted">{c.count}×</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.dims.map((d) =>
        d.groups.length > 1 ? (
          <div key={d.key} className="breakdown">
            <h4>{d.label}</h4>
            {d.groups.map((g) => (
              <div key={g.value} className="bd-row">
                <span className="bd-label">{g.value}</span>
                <div className="bd-bar">
                  <div style={{ width: `${g.pct}%` }} className={g.pct >= 80 ? 'good' : g.pct >= 60 ? 'mid' : 'low'} />
                </div>
                <span className="bd-num">
                  {g.ok}/{g.n}
                </span>
              </div>
            ))}
          </div>
        ) : null,
      )}
      <div className="row">
        <button className="btn primary grow" onClick={onAgain}>
          Another round
        </button>
        <button className="btn" onClick={() => go('/ear')}>
          Done
        </button>
      </div>
    </section>
  );
}
