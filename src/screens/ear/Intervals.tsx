import { useState } from 'react';
import { getSettings, updateSettings, useSettings } from '../../lib/settings';
import { saveAttempt } from '../../db/db';
import { initialState, leverValue, recordOutcome } from '../../engine/adaptive';
import { INTERVAL_LEVELS, INTERVAL_NAMES, type IntervalDir } from '../../engine/ear';
import type { Timbre } from '../../audio/synth';
import { Answers, EAR_ADAPTIVE, EarShell, FeedbackLine, LEVEL_LEVER, playSeq, useLater, type Feedback } from './common';

// Intervals, interleaved from the start. Ascending → + descending → + harmonic.

const LEVERS = LEVEL_LEVER(INTERVAL_LEVELS.length);
const TIMBRES: Timbre[] = ['pure', 'bright', 'organ', 'pad'];
const DIR_LABEL: Record<IntervalDir, string> = { up: 'ascending', down: 'descending', harmonic: 'together' };

interface Q {
  base: number;
  semis: number;
  dir: IntervalDir;
  timbre: Timbre;
}

export function Intervals() {
  const s = useSettings();
  const ad = s.earInterval ?? initialState(LEVERS);
  const lv = INTERVAL_LEVELS[leverValue(LEVERS, ad, 'level') as number];
  const [q, setQ] = useState<Q | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [fb, setFb] = useState<Feedback>(null);
  const [tally, setTally] = useState({ n: 0, ok: 0 });
  const [msg, setMsg] = useState<string | null>(null);
  const later = useLater();

  function play(x: Q) {
    const top = x.base + x.semis;
    if (x.dir === 'harmonic') playSeq([[x.base, top]], { timbre: x.timbre, dur: 1.3 });
    else playSeq(x.dir === 'up' ? [x.base, top] : [top, x.base], { timbre: x.timbre, dur: 0.6, gap: 0.12 });
  }

  function next() {
    const st = getSettings();
    const level = INTERVAL_LEVELS[leverValue(LEVERS, st.earInterval ?? initialState(LEVERS), 'level') as number];
    const semis = level.intervals[Math.floor(Math.random() * level.intervals.length)];
    const dir = level.dirs[Math.floor(Math.random() * level.dirs.length)];
    const base = 50 + Math.floor(Math.random() * Math.max(1, 79 - 50 - semis));
    const x: Q = { base, semis, dir, timbre: TIMBRES[Math.floor(Math.random() * TIMBRES.length)] };
    setQ(x);
    setChosen(null);
    setFb(null);
    play(x);
  }

  function answer(semis: number) {
    if (!q || chosen != null) return;
    const correct = semis === q.semis;
    setChosen(semis);
    setFb({ correct, answer: INTERVAL_NAMES[q.semis] });
    if (!correct) later(() => play(q), 250); // hear it again knowing the answer
    const st = getSettings();
    const { state, change } = recordOutcome(st.earInterval ?? initialState(LEVERS), LEVERS, correct, EAR_ADAPTIVE);
    updateSettings({ earInterval: state });
    if (change) {
      const a = INTERVAL_LEVELS[change.from];
      const b = INTERVAL_LEVELS[change.to];
      const added = b.intervals.find((i) => !a.intervals.includes(i));
      const addedDir = b.dirs.find((d) => !a.dirs.includes(d));
      setMsg(change.dir > 0 ? `New: ${added ? INTERVAL_NAMES[added] : `${DIR_LABEL[addedDir!]} intervals`}` : 'Easing off a step');
    } else setMsg(null);
    setTally((x) => ({ n: x.n + 1, ok: x.ok + (correct ? 1 : 0) }));
    void saveAttempt({ ts: Date.now(), module: 'ear-interval', target: `${INTERVAL_NAMES[q.semis]} ${q.dir}`, result: correct ? 'success' : `chose ${INTERVAL_NAMES[semis]}`, centsError: null, octaveError: 0, settleMs: null, stability: null, difficulty: { level: leverValue(LEVERS, ad, 'level') as number } });
    later(next, correct ? 900 : 2600);
  }

  return (
    <EarShell title="Intervals" score={tally}>
      <section className="card">
        <p className="instruction">Name the interval.</p>
        <div className="ear-stat muted">
          {lv.intervals.length} intervals · {lv.dirs.map((d) => DIR_LABEL[d]).join(', ')}
          {q && <> · this one: {DIR_LABEL[q.dir]}</>}
        </div>
        {msg && <div className="pb">★ {msg}</div>}
        {!q ? (
          <button className="btn-huge" onClick={next}>
            Start
          </button>
        ) : (
          <>
            <Answers<number> options={lv.intervals} label={(o) => INTERVAL_NAMES[o]} onAnswer={answer} disabled={chosen != null} reveal={chosen != null ? { correct: q.semis, chosen } : null} />
            <FeedbackLine fb={fb} />
            <button className="btn" onClick={() => play(q)}>
              ↻ Replay
            </button>
          </>
        )}
      </section>
    </EarShell>
  );
}
