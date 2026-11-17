import { useState } from 'react';
import { getSettings, updateSettings, useSettings } from '../../lib/settings';
import { midiToName } from '../../lib/notes';
import { saveAttempt } from '../../db/db';
import { initialState, leverValue, recordOutcome } from '../../engine/adaptive';
import { OCTAVE_LEVELS, octaveQuestion, type OctaveQuestion } from '../../engine/ear';
import { LOW_NOTE_MIDI, type Timbre } from '../../audio/synth';
import { Answers, EAR_ADAPTIVE, EarShell, FeedbackLine, LEVEL_LEVER, playSeq, RoundPicker, RoundStatus, RoundSummaryCard, useLater, useRound, type Feedback } from './common';
import type { Dimension } from '../../engine/roundStats';

// Which octave? Same note in two octaves vs a different note, and "is this C3 or C4?" across timbres.

const DIMS: Dimension[] = [
  { key: 'kind', label: 'Question', order: ['Same or different', 'Which octave'] },
  { key: 'timbre', label: 'Sound' },
  { key: 'detail', label: 'Detail' },
];
const LEVERS = LEVEL_LEVER(OCTAVE_LEVELS);
const TIMBRES: Timbre[] = ['pure', 'bright', 'organ', 'pad', 'choir'];

export function WhichOctave() {
  const s = useSettings();
  const level = leverValue(LEVERS, s.earOctave ?? initialState(LEVERS), 'level') as number;
  const [q, setQ] = useState<(OctaveQuestion & { timbre: Timbre }) | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [fb, setFb] = useState<Feedback>(null);
  const [tally, setTally] = useState({ n: 0, ok: 0 });
  const [tip, setTip] = useState<string | null>(null);
  const later = useLater();
  const round = useRound(DIMS);

  function play(x: OctaveQuestion & { timbre: Timbre }) {
    if (x.kind === 'same') playSeq([x.a, x.b], { timbre: x.timbre, dur: 0.8, gap: 0.2 });
    else playSeq([x.note], { timbre: x.timbre, dur: 1.2 });
  }

  function next() {
    const st = getSettings();
    const lv = leverValue(LEVERS, st.earOctave ?? initialState(LEVERS), 'level') as number;
    const x = { ...octaveQuestion(lv, Math.random), timbre: TIMBRES[Math.floor(Math.random() * TIMBRES.length)] };
    const lowest = x.kind === 'same' ? Math.min(x.a, x.b) : x.note;
    if (lowest < LOW_NOTE_MIDI && !st.lowNoteTipShown) {
      setTip('Low notes sound best with headphones.');
      updateSettings({ lowNoteTipShown: true });
    }
    setQ(x);
    setChosen(null);
    setFb(null);
    play(x);
  }

  const correctKey = (x: OctaveQuestion) => (x.kind === 'same' ? (x.same ? 'same' : 'different') : midiToName(x.note));

  function answer(a: string) {
    if (!q || chosen) return;
    const right = correctKey(q);
    const correct = a === right;
    setChosen(a);
    setFb({ correct, answer: right === 'same' ? 'the same note' : right === 'different' ? 'a different note' : right });
    if (!correct) later(() => play(q), 300);
    const st = getSettings();
    const { state } = recordOutcome(st.earOctave ?? initialState(LEVERS), LEVERS, correct, EAR_ADAPTIVE);
    updateSettings({ earOctave: state });
    setTally((x) => ({ n: x.n + 1, ok: x.ok + (correct ? 1 : 0) }));
    void saveAttempt({ ts: Date.now(), module: 'ear-octave', target: q.kind === 'same' ? `${midiToName(q.a)}/${midiToName(q.b)}` : midiToName(q.note), result: correct ? 'success' : `chose ${a}`, centsError: null, octaveError: 0, settleMs: null, stability: null, difficulty: { level, timbre: q.timbre } });
    const detail = q.kind === 'same' ? (q.same ? 'really the same' : `off by ${Math.abs(Math.abs(q.b - q.a) - 12)} semitone${Math.abs(Math.abs(q.b - q.a) - 12) > 1 ? 's' : ''}`) : `${midiToName(q.note)}`;
    const finished = round.record({ correct, tags: { kind: q.kind === 'same' ? 'Same or different' : 'Which octave', timbre: q.timbre, detail }, expected: q.kind === 'which' ? right : undefined, answer: q.kind === 'which' ? a : undefined }, 2400);
    if (!finished) later(next, correct ? 900 : 2600);
  }

  const options = !q ? [] : q.kind === 'same' ? ['same', 'different'] : q.options.map((m) => midiToName(m));

  return (
    <EarShell title="Which octave?" score={tally}>
      {round.summary ? (
        <RoundSummaryCard summary={round.summary} onAgain={() => (round.reset(), next())}
          confusionLabel={(e, a) => `${e} heard as ${a}`} />
      ) : (
      <>
      {tip && <div className="tip">{tip}</div>}
      <section className="card">
        <p className="instruction">{!q ? 'Octave or not, and which octave.' : q.kind === 'same' ? 'Same note an octave apart, or a different note?' : 'Which note is this?'}</p>
        <div className="ear-stat muted">
          Level {level + 1} of {OCTAVE_LEVELS}
          {q && ` · ${q.timbre}`}
        </div>
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
            <Answers<string> options={options} label={(o) => (o === 'same' ? 'Same note' : o === 'different' ? 'Different note' : o)} onAnswer={answer} disabled={!!chosen} reveal={chosen ? { correct: correctKey(q), chosen } : null} />
            <FeedbackLine fb={fb} />
            <button className="btn" onClick={() => play(q)}>
              ↻ Replay
            </button>
          </>
        )}
      </section>
      </>
      )}
    </EarShell>
  );
}
