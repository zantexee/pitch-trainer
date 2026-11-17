import { useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../audio';
import { playNote, type Voice } from '../audio/synth';
import { discardRecording, playRecording } from '../audio/recorder';
import { midiToName, noteToFreq } from '../lib/notes';
import { DEFAULT_RANGE, REGISTER_LABEL, REGISTERS, type Register } from '../lib/range';
import { go } from '../lib/router';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { useEngineStatus } from '../lib/useEngine';
import { saveAttempt } from '../db/db';
import { initialState, leverValue, recordOutcome, type LeverDef } from '../engine/adaptive';
import { OCTAVE_STAGES, pairKey, pickOctaveTask, tasksWithFallback, type OctaveTask } from '../engine/octave';
import type { AttemptLive } from '../pitch/attempt';
import type { AttemptScore, PitchSample } from '../pitch/scoring';
import { listen, sleep } from '../modules/listen';
import { useSingingMic } from '../modules/useSingingMic';
import { MicGate } from '../ui/MicGate';
import { PitchTrace } from '../ui/PitchTrace';
import { CentsNeedle } from '../ui/CentsNeedle';
import { ResultCard } from '../ui/ResultCard';

// Octave Jump: hear a note in one register, sing it in another without
// hearing it first. Pitch class and octave are scored separately, then the
// real target plays so your own ears confirm the result.

export const OJ_LEVERS: LeverDef<unknown>[] = [
  { id: 'stage', label: 'Stage', steps: [0, 1, 2, 3, 4, 5] },
  { id: 'tol', label: 'Tolerance', steps: [50, 35, 25] },
];

const HOLD_MS = 700;
type Phase = 'ready' | 'hear' | 'sing' | 'reveal' | 'result' | 'paused';

interface Outcome {
  score: AttemptScore;
  samples: PitchSample[];
  recordingUrl: string | null;
  pcOk: boolean;
  octOk: boolean;
  msg: string | null;
}

const regWord = (r: Register) => (r === 'low' ? 'low voice' : r === 'chest' ? 'chest voice' : 'falsetto');

function jumpWords(t: OctaveTask): string {
  const dir = t.jump > 0 ? 'up' : 'down';
  const a = Math.abs(t.jump);
  if (a === 12) return `one octave ${dir}`;
  if (a === 24) return `two octaves ${dir}`;
  const names: Record<number, string> = { 3: 'a minor 3rd', 4: 'a major 3rd', 5: 'a 4th', 7: 'a 5th' };
  return `an octave and ${names[a - 12] ?? `${a - 12} semitones`} ${dir}`;
}

export function OctaveJump() {
  const s = useSettings();
  const mic = useSingingMic();
  const status = useEngineStatus();
  const range = s.range ?? DEFAULT_RANGE;
  const [phase, setPhase] = useState<Phase>('ready');
  const [task, setTask] = useState<OctaveTask | null>(null);
  const [tol, setTol] = useState(50);
  const [liveState, setLiveState] = useState<AttemptLive | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [tally, setTally] = useState({ n: 0, ok: 0 });
  const abort = useRef<AbortController | null>(null);
  const prev = useRef<OctaveTask | null>(null);

  const adaptive = s.octaveJump ?? initialState(OJ_LEVERS);
  const stage = leverValue(OJ_LEVERS, adaptive, 'stage') as number;
  const effective = useMemo(() => tasksWithFallback(range, stage, s.stretch), [range, stage, s.stretch]);

  useEffect(() => {
    if (status !== 'running' && phase !== 'ready' && phase !== 'paused') {
      abort.current?.abort();
      setPhase('paused');
    }
  }, [status, phase]);

  useEffect(
    () => () => {
      abort.current?.abort();
      discardRecording();
    },
    [],
  );

  const play = (midi: number, dur = 1.2): Voice => playNote(engine, midi, getSettings().a4, { timbre: 'bright', duration: dur });

  async function runTrial() {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const st = getSettings();
    const ad = st.octaveJump ?? initialState(OJ_LEVERS);
    const { tasks } = tasksWithFallback(st.range ?? DEFAULT_RANGE, leverValue(OJ_LEVERS, ad, 'stage') as number, st.stretch);
    if (!tasks.length) return;
    const t = pickOctaveTask(tasks, Math.random, st.octaveStats, prev.current);
    prev.current = t;
    const trialTol = leverValue(OJ_LEVERS, ad, 'tol') as number;
    setTask(t);
    setTol(trialTol);
    setOutcome(null);
    setLiveState(null);
    const targetHz = noteToFreq(t.target, st.a4);
    try {
      setPhase('hear');
      const v = play(t.ref);
      await sleep(Math.max(0, ((v.endTime ?? engine.now + 1.4) - engine.now) * 1000), ac.signal);
      setPhase('sing');
      const res = await listen(targetHz, {
        toleranceCents: trialTol,
        holdMs: HOLD_MS,
        maxMs: HOLD_MS + 5000,
        silenceEndMs: 800,
        record: true,
        signal: ac.signal,
        onUpdate: (x) => setLiveState(x),
      });
      if (res.aborted) return;
      const sc = res.score;
      const octOk = sc.verdict !== 'unreadable' && sc.octave === 0;
      const pcOk = sc.pcAccuracy != null && sc.pcAccuracy <= 2 * trialTol;
      const success = sc.locked;
      // Reveal: play the real target so your ears confirm.
      setPhase('reveal');
      const rv = play(t.target);
      const st2 = getSettings();
      const { state, change } = recordOutcome(st2.octaveJump ?? initialState(OJ_LEVERS), OJ_LEVERS, success);
      const key = pairKey(t);
      const ps = st2.octaveStats[key] ?? { n: 0, ok: 0 };
      updateSettings({ octaveJump: state, octaveStats: { ...st2.octaveStats, [key]: { n: ps.n + 1, ok: ps.ok + (success ? 1 : 0) } } });
      void saveAttempt({
        ts: Date.now(),
        module: 'octave-jump',
        target: `${midiToName(t.ref)}→${midiToName(t.target)}`,
        result: success ? 'success' : sc.verdict,
        centsError: sc.meanCents,
        octaveError: sc.octave,
        settleMs: sc.settleMs,
        stability: sc.stability,
        difficulty: { stage: leverValue(OJ_LEVERS, ad, 'stage') as number, tol: trialTol, pair: key },
      });
      setTally((x) => ({ n: x.n + 1, ok: x.ok + (success ? 1 : 0) }));
      let msg: string | null = null;
      if (change?.lever === 'stage') msg = change.dir > 0 ? `New stage: ${OCTAVE_STAGES[change.to]}` : `Back to: ${OCTAVE_STAGES[change.to]}`;
      else if (change) msg = change.dir > 0 ? 'Getting harder: tolerance' : 'Easing off: tolerance';
      setOutcome({ score: sc, samples: res.attempt.samples, recordingUrl: res.recordingUrl, pcOk, octOk, msg });
      await sleep(Math.max(0, ((rv.endTime ?? engine.now + 1.4) - engine.now) * 1000), ac.signal);
      setPhase('result');
    } catch {
      /* aborted */
    }
  }

  const stats = s.octaveStats;
  const pairRows = Object.entries(stats).sort((a, b) => b[1].n - a[1].n);

  return (
    <main className="screen">
      <header className="bar">
        <button className="btn ghost" onClick={() => go('/')}>
          ‹ Home
        </button>
        <h2>Octave Jump</h2>
        <span className="muted small push">{tally.n > 0 && `${tally.ok}/${tally.n}`}</span>
      </header>
      <MicGate status={mic.status} error={mic.error}>
        <div className="levels muted small">
          Stage {effective.stage + 1}: {OCTAVE_STAGES[effective.stage]} · ±{leverValue(OJ_LEVERS, adaptive, 'tol') as number}¢
          {effective.stage < stage && ' (your range limits higher stages)'}
        </div>
        <section className="card">
          {phase === 'ready' || phase === 'paused' ? (
            <>
              <p className="instruction">Hear a note, then sing it in another register without hearing it first.</p>
              <button className="btn-huge" onClick={() => void runTrial()}>
                {phase === 'paused' ? 'Resume' : 'Start'}
              </button>
            </>
          ) : task ? (
            <>
              <div className="oj-pair">
                <div className={`oj-note ${phase === 'hear' ? 'active' : ''}`}>
                  <span className="muted small">Hear</span>
                  <strong>{midiToName(task.ref)}</strong>
                  <span className="muted small">{REGISTER_LABEL[task.refReg]}</span>
                </div>
                <div className="oj-arrow">{task.jump > 0 ? '↗' : '↘'}</div>
                <div className={`oj-note ${phase === 'sing' ? 'active' : ''}`}>
                  <span className="muted small">Sing</span>
                  <strong>{midiToName(task.target)}</strong>
                  <span className="muted small">{REGISTER_LABEL[task.targetReg]}</span>
                </div>
              </div>
              <p className="instruction center" aria-live="polite">
                {phase === 'hear' && 'Listen…'}
                {phase === 'sing' && `Sing ${midiToName(task.target)} in ${regWord(task.targetReg)}: ${jumpWords(task)}`}
                {phase === 'reveal' && `Here's the real ${midiToName(task.target)}`}
                {phase === 'result' && ' '}
              </p>
              {(phase === 'sing' || phase === 'hear') && (
                <>
                  <CentsNeedle state={phase === 'sing' ? liveState : null} toleranceCents={tol} holdMs={HOLD_MS} />
                  <PitchTrace a4={s.a4} targetHz={noteToFreq(task.target, s.a4)} toleranceCents={tol} />
                  <div className="row">
                    <button className="btn" onClick={() => (abort.current?.abort(), setPhase('paused'))}>
                      ❚❚ Pause
                    </button>
                    <button className="btn grow" onClick={() => void runTrial()}>
                      Skip ›
                    </button>
                  </div>
                </>
              )}
              {(phase === 'reveal' || phase === 'result') && outcome && (
                <div className="oj-verdict">
                  <span className={outcome.pcOk ? 'ok' : 'no'}>Note {outcome.pcOk ? '✓' : '✗'}</span>
                  <span className={outcome.octOk ? 'ok' : 'no'}>
                    Octave {outcome.octOk ? '✓' : `✗ (${Math.abs(outcome.score.octave) === 1 ? 'one octave' : `${Math.abs(outcome.score.octave)} octaves`} ${outcome.score.octave < 0 ? 'low' : 'high'})`}
                  </span>
                </div>
              )}
              {phase === 'result' && outcome && (
                <ResultCard
                  score={outcome.score}
                  samples={outcome.samples}
                  targetHz={noteToFreq(task.target, s.a4)}
                  toleranceCents={tol}
                  targetName={`${midiToName(task.ref)} → ${midiToName(task.target)}`}
                  personalBest={outcome.msg}
                  onReplay={() => play(task.target)}
                  onHear={outcome.recordingUrl ? () => playRecording(outcome.recordingUrl!) : null}
                  onNext={() => void runTrial()}
                  autoNextMs={2000}
                />
              )}
            </>
          ) : null}
        </section>
        {pairRows.length > 0 && (
          <section className="card">
            <h3>By register pair</h3>
            <dl className="kv">
              {pairRows.map(([k, v]) => {
                const [a, b] = k.split('→') as [Register, Register];
                const label = REGISTERS.includes(a) && REGISTERS.includes(b) ? `${REGISTER_LABEL[a]} → ${REGISTER_LABEL[b]}` : k;
                return (
                  <div key={k} className="kv-row">
                    <dt>{label}</dt>
                    <dd>
                      {v.ok}/{v.n} ({Math.round((100 * v.ok) / v.n)}%)
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        )}
      </MicGate>
    </main>
  );
}
