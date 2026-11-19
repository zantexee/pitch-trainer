import { useState } from 'react';
import { getSettings, updateSettings, useSettings } from '../../lib/settings';
import { saveAttempt } from '../../db/db';
import { initialState, leverValue, recordOutcome } from '../../engine/adaptive';
import { INTERVAL_LEVELS, INTERVAL_NAMES, type IntervalDir } from '../../engine/ear';
import { INTERVAL_INFO } from '../../engine/intervalInfo';
import type { Timbre } from '../../audio/synth';
import { useAutoStart } from '../../lib/embed';
import { bump, weakness, weightedPick } from '../../engine/weights';
import { Answers, EAR_ADAPTIVE, EarShell, FeedbackLine, LEVEL_LEVER, playSeq, RoundPicker, RoundStatus, RoundSummaryCard, useLater, useRound, type Feedback } from './common';
import type { Dimension } from '../../engine/roundStats';

// Intervals, interleaved from the start. Ascending → + descending → + harmonic.

const DIMS: Dimension[] = [
  { key: 'interval', label: 'Interval' },
  { key: 'dir', label: 'Direction', order: ['ascending', 'descending', 'together'] },
];
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
  const round = useRound(DIMS, 'ear-intervals');

  useAutoStart(true, () => next());

  function play(x: Q) {
    const top = x.base + x.semis;
    if (x.dir === 'harmonic') playSeq([[x.base, top]], { timbre: x.timbre, dur: 1.3 });
    else playSeq(x.dir === 'up' ? [x.base, top] : [top, x.base], { timbre: x.timbre, dur: 0.6, gap: 0.12 });
  }

  function next() {
    const st = getSettings();
    const level = INTERVAL_LEVELS[leverValue(LEVERS, st.earInterval ?? initialState(LEVERS), 'level') as number];
    const semis = weightedPick(level.intervals, (x) => weakness(st.intervalStats[INTERVAL_NAMES[x]]), Math.random);
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
    updateSettings({ earInterval: state, intervalStats: bump(st.intervalStats, INTERVAL_NAMES[q.semis], correct) });
    if (change) {
      const a = INTERVAL_LEVELS[change.from];
      const b = INTERVAL_LEVELS[change.to];
      const added = b.intervals.find((i) => !a.intervals.includes(i));
      const addedDir = b.dirs.find((d) => !a.dirs.includes(d));
      setMsg(change.dir > 0 ? `New: ${added ? INTERVAL_NAMES[added] : `${DIR_LABEL[addedDir!]} intervals`}` : 'Easing off a step');
    } else setMsg(null);
    setTally((x) => ({ n: x.n + 1, ok: x.ok + (correct ? 1 : 0) }));
    void saveAttempt({ ts: Date.now(), module: 'ear-interval', target: `${INTERVAL_NAMES[q.semis]} ${q.dir}`, result: correct ? 'success' : `chose ${INTERVAL_NAMES[semis]}`, centsError: null, octaveError: 0, settleMs: null, stability: null, difficulty: { level: leverValue(LEVERS, ad, 'level') as number } });
    const finished = round.record({ correct, tags: { interval: INTERVAL_NAMES[q.semis], dir: DIR_LABEL[q.dir] }, expected: INTERVAL_NAMES[q.semis], answer: INTERVAL_NAMES[semis] }, 2400);
    if (!finished) later(next, correct ? 900 : 4200); // time to read the explanation
  }

  return (
    <EarShell title="Intervals" score={tally}>
      {round.summary ? (
        <RoundSummaryCard summary={round.summary} newBest={round.newBest} onAgain={() => (round.reset(), next())}
          confusionLabel={(e, a) => `${e} heard as ${a}`} />
      ) : (
      <>
      <section className="card">
        <p className="instruction">Name the interval.</p>
        <div className="ear-stat muted">
          {lv.intervals.length} intervals · {lv.dirs.map((d) => DIR_LABEL[d]).join(', ')}
          {q && <> · this one: {DIR_LABEL[q.dir]}</>}
        </div>
        {msg && <div className="pb">★ {msg}</div>}
        {!q ? (
          <>
            <RoundPicker />
            <button className="btn-huge" onClick={next}>
              Start
            </button>
          </>
        ) : (
          <>
            <RoundStatus round={round} />
            <Answers<number> options={lv.intervals} label={(o) => INTERVAL_NAMES[o]} onAnswer={answer} disabled={chosen != null} reveal={chosen != null ? { correct: q.semis, chosen } : null} />
            <FeedbackLine fb={fb} />
            {chosen != null && chosen !== q.semis && (
              <div className="iv-explain">
                <IntervalCard semis={q.semis} dir={q.dir} onPlay={() => play(q)} />
                <IntervalCard semis={chosen} dir={q.dir} yours onPlay={() => play({ ...q, semis: chosen })} />
              </div>
            )}
            <button className="btn" onClick={() => play(q)}>
              ↻ Replay
            </button>
          </>
        )}
      </section>
      <IntervalGuide highlight={lv.intervals} />
      </>
      )}
    </EarShell>
  );
}

const fmtSemis = (n: number) => (n === 1 ? '1 semitone' : `${n} semitones`);

/** One interval explained: name, size, how it feels, and a tune that starts with it. */
function IntervalCard({ semis, dir, yours, onPlay }: { semis: number; dir?: IntervalDir; yours?: boolean; onPlay: () => void }) {
  const info = INTERVAL_INFO[semis];
  const short = INTERVAL_NAMES[semis];
  const showUp = dir !== 'down';
  const showDown = dir !== 'up';
  return (
    <div className={`iv-card${yours ? ' yours' : ''}`}>
      <div className="iv-head">
        <button className="iv-play" onClick={onPlay} aria-label={`Play ${info.full}`}>
          ▶
        </button>
        <div>
          {yours && <div className="iv-tag">Your answer</div>}
          <div className="iv-name">{info.full}</div>
          <div className="muted iv-size">
            {short !== info.full && <span translate="no">{short} · </span>}
            <span>{fmtSemis(semis)}</span>
          </div>
        </div>
      </div>
      <p className="iv-feel">{info.feel}</p>
      <div className="iv-songs muted">
        {showUp && (
          <div>
            <span>Going up</span>: <i translate="no">{info.up}</i>
          </div>
        )}
        {showDown && (
          <div>
            <span>Going down</span>: <i translate="no">{info.down}</i>
          </div>
        )}
      </div>
    </div>
  );
}

/** Fold-out reference of every interval, with a play button for each. */
function IntervalGuide({ highlight }: { highlight: number[] }) {
  const all = Object.keys(INTERVAL_INFO).map(Number);
  return (
    <details className="result-details iv-guide card">
      <summary>About the intervals</summary>
      <p className="muted">Tip: hum the start of the tune in your head, then compare. Intervals you are practising now are marked ●.</p>
      <div className="iv-list">
        {all.map((n) => (
          <div key={n} className={highlight.includes(n) ? 'iv-on' : undefined}>
            {highlight.includes(n) && <span className="iv-dot" aria-hidden="true">●</span>}
            <IntervalCard semis={n} onPlay={() => playSeq([60, 60 + n, [60, 60 + n]], { dur: 0.6, gap: 0.12 })} />
          </div>
        ))}
      </div>
    </details>
  );
}
