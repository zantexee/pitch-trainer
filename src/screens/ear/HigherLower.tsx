import { useEffect, useRef, useState } from 'react';
import { engine } from '../../audio';
import { playFreq } from '../../audio/synth';
import { getSettings, updateSettings } from '../../lib/settings';
import { appendList, loadList, saveAttempt } from '../../db/db';
import { DEFAULT_STAIRCASE, newStaircase, stepStaircase, thresholdEstimate, type Staircase } from '../../engine/staircase';
import { useAutoStart } from '../../lib/embed';
import { recordBest } from '../../lib/bests';
import { Answers, EarShell, FeedbackLine, RoundPicker, RoundStatus, RoundSummaryCard, useLater, useRound, type Feedback } from './common';
import { HL_DIMS, hlTags } from '../../engine/roundStats';

// Two tones: is the second higher or lower? Adaptive staircase in cents.

type Dir = 'higher' | 'lower';
export interface Point {
  ts: number;
  threshold: number;
}

export function HigherLower() {
  const [sc, setSc] = useState<Staircase>(() => newStaircase(DEFAULT_STAIRCASE, getSettings().hlDelta ?? DEFAULT_STAIRCASE.start));
  const [trial, setTrial] = useState<{ base: number; dir: Dir; delta: number } | null>(null);
  const [fb, setFb] = useState<Feedback>(null);
  const [chosen, setChosen] = useState<Dir | null>(null);
  const [tally, setTally] = useState({ n: 0, ok: 0 });
  const [history, setHistory] = useState<Point[]>([]);
  const [pb, setPb] = useState<string | null>(null);
  const later = useLater();
  const round = useRound(HL_DIMS, 'ear-hl');
  const scRef = useRef(sc);
  scRef.current = sc;

  useEffect(() => {
    void loadList<Point>('hlHistory').then(setHistory);
    return () => {
      const est = thresholdEstimate(scRef.current);
      if (est != null) void appendList<Point>('hlHistory', { ts: Date.now(), threshold: est });
    };
  }, []);

  function play(t: { base: number; dir: Dir; delta: number }) {
    const second = t.base * Math.pow(2, ((t.dir === 'higher' ? 1 : -1) * t.delta) / 1200);
    const t0 = engine.now + 0.05;
    playFreq(engine, t.base, { timbre: 'pure', duration: 0.5, when: t0 });
    playFreq(engine, second, { timbre: 'pure', duration: 0.5, when: t0 + 0.8 });
  }

  useAutoStart(true, () => next());

  function next() {
    // base between A3 and E5, continuous so you can't learn the notes
    const base = 220 * Math.pow(2, Math.random() * 1.6);
    const t = { base, dir: (Math.random() < 0.5 ? 'higher' : 'lower') as Dir, delta: scRef.current.delta };
    setTrial(t);
    setFb(null);
    setChosen(null);
    play(t);
  }

  function answer(d: Dir) {
    if (!trial || chosen) return;
    const correct = d === trial.dir;
    setChosen(d);
    setFb({ correct, answer: trial.dir });
    const ns = stepStaircase(sc, correct);
    setSc(ns);
    updateSettings({ hlDelta: ns.delta });
    setTally((x) => ({ n: x.n + 1, ok: x.ok + (correct ? 1 : 0) }));
    void saveAttempt({ ts: Date.now(), module: 'ear-higher-lower', target: `${Math.round(trial.delta)}¢`, result: correct ? 'success' : 'miss', centsError: trial.delta, octaveError: 0, settleMs: null, stability: null, difficulty: { delta: trial.delta } });
    const finished = round.record({ correct, tags: hlTags(trial.delta, trial.dir, trial.base) });
    if (ns.trials % 15 === 0 || finished) {
      const est = thresholdEstimate(ns);
      if (est != null) {
        void appendList<Point>('hlHistory', { ts: Date.now(), threshold: est }).then(setHistory);
        if (recordBest('hlThreshold', Math.round(est * 10) / 10, 'min')) setPb(`New best threshold: ${est.toFixed(1)}¢`);
      }
    }
    if (!finished) later(next, correct ? 700 : 1400);
  }

  const again = () => {
    round.reset();
    next();
  };

  const est = thresholdEstimate(sc);

  return (
    <EarShell title="Higher or lower?" score={tally}>
      {round.summary ? (
        <RoundSummaryCard
          summary={round.summary}
          newBest={round.newBest}
          onAgain={again}
          extra={
            <>
              {pb && <div className="pb">★ {pb}</div>}
              {est != null && <p className="muted">Current threshold ≈ {est.toFixed(1)}¢ (lower is better)</p>}
            </>
          }
        />
      ) : (
      <section className="card">
        <p className="instruction">Two tones. Is the second one higher or lower?</p>
        <div className="ear-stat">
          {chosen && trial ? `That was ${trial.delta < 10 ? trial.delta.toFixed(1) : Math.round(trial.delta)}¢ ${trial.dir}. ` : ''}Next difference <strong>{sc.delta < 10 ? sc.delta.toFixed(1) : Math.round(sc.delta)}¢</strong>
          {est != null && <span className="muted"> · threshold ≈ {est.toFixed(1)}¢</span>}
        </div>
        {!trial ? (
          <>
            <RoundPicker />
            <button className="btn-huge" onClick={next}>
              Start
            </button>
          </>
        ) : (
          <>
            <RoundStatus round={round} />
            <Answers<Dir> options={['lower', 'higher']} label={(o) => (o === 'higher' ? '↑ Higher' : '↓ Lower')} onAnswer={answer} disabled={!!chosen} reveal={chosen ? { correct: trial.dir, chosen } : null} />
            <FeedbackLine fb={fb} />
            {pb && <div className="pb">★ {pb}</div>}
            <button className="btn" onClick={() => play(trial)}>
              ↻ Replay
            </button>
          </>
        )}
      </section>
      )}
      {history.length > 1 && <ThresholdChart points={history} />}
    </EarShell>
  );
}

export function ThresholdChart({ points }: { points: Point[] }) {
  const pts = points.slice(-30);
  const W = 300;
  const H = 120;
  // log scale: 1¢ … 200¢
  const ly = (c: number) => {
    const v = Math.log(Math.max(1, Math.min(200, c))) / Math.log(200);
    return H - 16 - v * (H - 28);
  };
  const x = (i: number) => 28 + (i * (W - 36)) / Math.max(1, pts.length - 1);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${ly(p.threshold).toFixed(1)}`).join('');
  return (
    <section className="card">
      <h3>Discrimination threshold</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" aria-label="Threshold over time, lower is better">
        {[2, 5, 10, 25, 50, 100].map((c) => (
          <g key={c}>
            <line x1={26} x2={W} y1={ly(c)} y2={ly(c)} stroke="var(--grid)" />
            <text x={0} y={ly(c) + 3} fontSize={9} fill="var(--muted)">
              {c}¢
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--blue)" strokeWidth={2} />
        {pts.map((p, i) => (
          <circle key={i} cx={x(i)} cy={ly(p.threshold)} r={2.5} fill="var(--blue)" />
        ))}
      </svg>
      <p className="muted small">Lower is better. Each point is a session estimate.</p>
    </section>
  );
}
