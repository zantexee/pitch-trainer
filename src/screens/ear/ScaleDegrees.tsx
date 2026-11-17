import { useRef, useState } from 'react';
import { getSettings, updateSettings, useSettings } from '../../lib/settings';
import { midiToName } from '../../lib/notes';
import { saveAttempt } from '../../db/db';
import { initialState, leverValue, recordOutcome } from '../../engine/adaptive';
import { cadence } from '../../engine/ladder';
import { DEGREE_LEVELS, DEGREE_NAMES, degreeSet, resolution } from '../../engine/ear';
import { solfege } from '../../engine/ladder';
import { Answers, EAR_ADAPTIVE, EarShell, FeedbackLine, LEVEL_LEVER, playSeq, RoundPicker, RoundStatus, RoundSummaryCard, useLater, useRound, type Feedback } from './common';
import type { Dimension } from '../../engine/roundStats';

// Functional ear training: a cadence sets the key, one note plays, you tap
// its degree, then it resolves to the tonic.

const DIMS: Dimension[] = [{ key: 'degree', label: 'Degree', order: ['1', '2', '3', '4', '5', '6', '7'] }];
const LEVERS = LEVEL_LEVER(DEGREE_LEVELS);
const KEY_EVERY = 5;

export function ScaleDegrees() {
  const s = useSettings();
  const ad = s.earDegree ?? initialState(LEVERS);
  const level = leverValue(LEVERS, ad, 'level') as number;
  const set = degreeSet(level);
  const [tonic, setTonic] = useState<number | null>(null);
  const [deg, setDeg] = useState<number | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [fb, setFb] = useState<Feedback>(null);
  const [tally, setTally] = useState({ n: 0, ok: 0 });
  const [msg, setMsg] = useState<string | null>(null);
  const count = useRef(0);
  const later = useLater();
  const round = useRound(DIMS);

  function cadenceSeq(t: number) {
    return cadence('major').map((ch) => ch.map((o) => t + o));
  }

  function next() {
    const st = getSettings();
    const lv = leverValue(LEVERS, st.earDegree ?? initialState(LEVERS), 'level') as number;
    const degrees = degreeSet(lv);
    let t = tonic;
    let lead = 0;
    if (t == null || count.current % KEY_EVERY === 0) {
      t = 55 + Math.floor(Math.random() * 12); // G3..F#4
      setTonic(t);
      lead = playSeq(cadenceSeq(t), { timbre: 'organ', dur: 0.5, gap: 0.08 });
    } else {
      lead = playSeq([[t - 12, t, t + 4, t + 7]], { timbre: 'organ', dur: 0.6 });
    }
    count.current++;
    const d = degrees[Math.floor(Math.random() * degrees.length)];
    setDeg(d);
    setChosen(null);
    setFb(null);
    playSeq([t + d], { timbre: 'bright', dur: 0.9, start: lead + 0.25 });
  }

  function answer(d: number) {
    if (deg == null || tonic == null || chosen != null) return;
    const correct = d === deg;
    setChosen(d);
    setFb({ correct, answer: DEGREE_NAMES[deg] });
    // learn it musically: resolve to the tonic
    const secs = playSeq(resolution(deg).map((o) => tonic + o), { timbre: 'pure', dur: 0.32, gap: 0.04 });
    const st = getSettings();
    const { state, change } = recordOutcome(st.earDegree ?? initialState(LEVERS), LEVERS, correct, EAR_ADAPTIVE);
    updateSettings({ earDegree: state });
    setMsg(change ? (change.dir > 0 ? `New degree added: ${DEGREE_NAMES[degreeSet(change.to).slice(-1)[0]]}` : 'Back to fewer degrees') : null);
    setTally((x) => ({ n: x.n + 1, ok: x.ok + (correct ? 1 : 0) }));
    void saveAttempt({ ts: Date.now(), module: 'ear-degree', target: DEGREE_NAMES[deg], result: correct ? 'success' : `chose ${DEGREE_NAMES[d]}`, centsError: null, octaveError: 0, settleMs: null, stability: null, difficulty: { level, key: midiToName(tonic) } });
    const finished = round.record({ correct, tags: { degree: DEGREE_NAMES[deg] }, expected: DEGREE_NAMES[deg], answer: DEGREE_NAMES[d] }, secs * 1000);
    if (!finished) later(next, secs * 1000 + (correct ? 300 : 900));
  }

  return (
    <EarShell title="Scale degrees" score={tally}>
      {round.summary ? (
        <RoundSummaryCard summary={round.summary} onAgain={() => (round.reset(), next())}
          confusionLabel={(e, a) => `Heard ${e} as ${a}`} />
      ) : (
      <>
      <section className="card">
        <p className="instruction">The chords set the key. Which degree is the note?</p>
        <div className="ear-stat muted">
          Degrees: {set.map((d) => DEGREE_NAMES[d]).join(' · ')}
          {tonic != null && ` · key of ${midiToName(tonic).replace(/-?\d+$/, '')}`}
        </div>
        {msg && <div className="pb">★ {msg}</div>}
        {deg == null ? (
          <>
            <RoundPicker />
            <button className="btn-huge" onClick={next}>
              Start
            </button>
          </>
        ) : (
          <>
            <RoundStatus round={round} />
            <Answers<number>
              options={[...set].sort((a, b) => a - b)}
              label={(o) => (
                <>
                  <strong>{DEGREE_NAMES[o]}</strong>
                  <span className="muted small">{solfege(o)}</span>
                </>
              )}
              onAnswer={answer}
              disabled={chosen != null}
              reveal={chosen != null ? { correct: deg, chosen } : null}
            />
            <FeedbackLine fb={fb} />
            <div className="row">
              <button className="btn" onClick={() => tonic != null && playSeq([tonic + deg], { timbre: 'bright', dur: 0.9 })}>
                ↻ Note
              </button>
              <button className="btn" onClick={() => tonic != null && playSeq(cadenceSeq(tonic), { timbre: 'organ', dur: 0.5, gap: 0.08 })}>
                ↻ Key
              </button>
            </div>
          </>
        )}
      </section>
      </>
      )}
    </EarShell>
  );
}
