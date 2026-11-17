import { useEffect, useRef, useState } from 'react';
import { drone, engine, live } from '../audio';
import { playNote } from '../audio/synth';
import { midiToName, noteToFreq } from '../lib/notes';
import { DEFAULT_RANGE } from '../lib/range';
import { go } from '../lib/router';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { useEngineStatus } from '../lib/useEngine';
import { saveAttempt } from '../db/db';
import { initialState, leverValue, recordOutcome, type LeverDef } from '../engine/adaptive';
import { buildLadder, cadence, degreeLabel, LADDER_STAGES, solfege, type LadderPlan } from '../engine/ladder';
import { LiveAttempt, type AttemptLive } from '../pitch/attempt';
import { scoreAttempt } from '../pitch/scoring';
import { listen, sleep } from '../modules/listen';
import { useSingingMic } from '../modules/useSingingMic';
import { MicGate } from '../ui/MicGate';
import { PitchTrace } from '../ui/PitchTrace';
import { CentsNeedle } from '../ui/CentsNeedle';
import { useAutoStart, useEmbed } from '../lib/embed';
import { nextRun } from '../lib/bests';

// Scale Ladder: a cadence or tonic drone sets the key, then you sing the
// steps. Relaxed mode: each step must lock before the next appears.
// Timed mode: steps advance on a beat.

export const SL_LEVERS: LeverDef<unknown>[] = [{ id: 'stage', label: 'Stage', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8] }];

const TOL = 35;
const STEP_HOLD_MS = 400;
const STEP_MAX_MS = 8000;
const BEAT_MS = 1300;

type Phase = 'ready' | 'key' | 'steps' | 'done' | 'paused';
type StepResult = { ok: boolean; cents: number | null; ms: number };

export function ScaleLadder() {
  const s = useSettings();
  const mic = useSingingMic();
  const status = useEngineStatus();
  const [phase, setPhase] = useState<Phase>('ready');
  const [ladder, setLadder] = useState<{ plan: LadderPlan; tonic: number } | null>(null);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<StepResult[]>([]);
  const [liveState, setLiveState] = useState<AttemptLive | null>(null);
  const [beat, setBeat] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const embed = useEmbed();
  const stepRun = useRef(0);
  const runBest = useRef<string | null>(null);

  const adaptive = s.ladder ?? initialState(SL_LEVERS);
  const stage = leverValue(SL_LEVERS, adaptive, 'stage') as number;

  useEffect(() => {
    if (status !== 'running' && (phase === 'key' || phase === 'steps')) {
      abort.current?.abort();
      drone.stop();
      setPhase('paused');
    }
  }, [status, phase]);

  useEffect(
    () => () => {
      abort.current?.abort();
      drone.stop();
    },
    [],
  );

  // Auto-advance to the next ladder after the summary.
  useEffect(() => {
    if (phase !== 'done') return;
    const id = setTimeout(() => void run(), 3000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const label = (offset: number, tonic: number) => (s.labelMode === 'degrees' ? degreeLabel(offset) : s.labelMode === 'solfege' ? solfege(offset) : midiToName(tonic + offset));

  async function setKey(plan: LadderPlan, tonic: number, signal: AbortSignal) {
    const st = getSettings();
    if (st.ladderKey === 'cadence') {
      const t0 = engine.now + 0.05;
      cadence(plan.scale).forEach((chord, i) => {
        chord.forEach((o) => playNote(engine, tonic + o, st.a4, { timbre: 'organ', duration: 0.5, velocity: 0.45, when: t0 + i * 0.6 }));
      });
      playNote(engine, tonic, st.a4, { timbre: 'pad', duration: 0.9, velocity: 0.6, when: t0 + 4 * 0.6 + 0.1 });
      await sleep((4 * 0.6 + 1.2) * 1000, signal);
      if (st.headphones) drone.start(tonic, { timbre: 'pad', mode: 'root', volume: st.droneVolume * 0.6, a4: st.a4, headphones: true });
    } else {
      drone.start(tonic, { timbre: 'pad', mode: 'fifth', volume: st.droneVolume, a4: st.a4, headphones: st.headphones });
      await sleep(2500, signal);
      if (!st.headphones) drone.stop();
    }
    // wait out the release tail so the mic isn't ignored at the first step
    while (!st.headphones && engine.isSounding()) await sleep(50, signal);
  }

  async function run() {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const st = getSettings();
    const ad = st.ladder ?? initialState(SL_LEVERS);
    let built = buildLadder(leverValue(SL_LEVERS, ad, 'stage') as number, st.range ?? DEFAULT_RANGE, st.stretch, Math.random);
    if (!built) return;
    if (embed?.bonus === 'reverse-scale') built = { ...built, plan: { ...built.plan, title: `${built.plan.title} (reversed)`, steps: [...built.plan.steps].reverse() } };
    runBest.current = null;
    setLadder(built);
    setIdx(0);
    setResults([]);
    setMsg(null);
    setLiveState(null);
    const { plan, tonic } = built;
    try {
      setPhase('key');
      await setKey(plan, tonic, ac.signal);
      setPhase('steps');
      const out: StepResult[] = [];
      for (let i = 0; i < plan.steps.length; i++) {
        setIdx(i);
        setLiveState(null);
        const targetHz = noteToFreq(tonic + plan.steps[i].offset, st.a4);
        const r = st.ladderTimed ? await timedStep(targetHz, ac.signal) : await relaxedStep(targetHz, ac.signal);
        if (ac.signal.aborted) return;
        out.push(r);
        setResults([...out]);
        reportStep(r.ok);
        void saveAttempt({
          ts: Date.now(),
          module: 'scale-ladder',
          target: `${degreeLabel(plan.steps[i].offset)} ${midiToName(tonic + plan.steps[i].offset)}`,
          result: r.ok ? 'success' : 'miss',
          centsError: r.cents,
          octaveError: 0,
          settleMs: r.ms,
          stability: null,
          difficulty: { stage: plan.stage, timed: st.ladderTimed ? 1 : 0, scale: plan.scale },
        });
      }
      drone.stop();
      const rate = out.filter((x) => x.ok).length / out.length;
      const { state, change } = recordOutcome(getSettings().ladder ?? initialState(SL_LEVERS), SL_LEVERS, rate >= 0.8, { window: 6, minAttempts: 3, raiseAbove: 0.85, lowerBelow: 0.5 });
      updateSettings({ ladder: state });
      if (runBest.current) setMsg(runBest.current);
      else if (change) setMsg(change.dir > 0 ? `Next up: ${LADDER_STAGES[change.to]}` : `Back to: ${LADDER_STAGES[change.to]}`);
      setPhase('done');
    } catch {
      drone.stop();
    }
  }

  function reportStep(ok: boolean) {
    const r = nextRun(stepRun.current, ok, 'run:ladder-steps');
    stepRun.current = r.run;
    if (r.best) runBest.current = `New best: ${r.run} steps in a row`;
    embed?.report({ ok, best: r.best ? runBest.current : null });
  }

  async function relaxedStep(targetHz: number, signal: AbortSignal): Promise<StepResult> {
    const t0 = performance.now();
    const res = await listen(targetHz, {
      toleranceCents: TOL,
      holdMs: STEP_HOLD_MS,
      maxMs: STEP_MAX_MS,
      silenceEndMs: 60_000, // breathing between steps is fine
      afterLockMs: 0,
      chime: false,
      signal,
      onUpdate: (x) => setLiveState(x),
    });
    return { ok: res.score.locked, cents: res.score.meanCents, ms: performance.now() - t0 };
  }

  async function timedStep(targetHz: number, signal: AbortSignal): Promise<StepResult> {
    const attempt = new LiveAttempt(targetHz, { toleranceCents: TOL, holdMs: BEAT_MS * 0.35 });
    live.target = targetHz;
    const t0 = performance.now();
    const unsub = live.subscribe((f) => {
      if (f.ignored) return;
      setLiveState(attempt.push(f.t, f.out.freq));
      setBeat(Math.min(1, (performance.now() - t0) / BEAT_MS));
    });
    try {
      await sleep(BEAT_MS, signal);
    } finally {
      unsub();
      live.target = null;
    }
    // Score the back 70% of the beat (the start is the move from the last note).
    const late = attempt.samples.filter((x) => x.t >= BEAT_MS * 0.3);
    const sc = scoreAttempt(late, targetHz, { toleranceCents: TOL, holdMs: BEAT_MS * 0.3, scoopMs: 0 });
    return { ok: sc.accuracy != null && sc.accuracy <= TOL, cents: sc.meanCents, ms: BEAT_MS };
  }

  const skipStep = () => {
    // relaxed mode: end the current listen early (counts as a miss)
    abort.current?.abort();
    const st = getSettings();
    if (!ladder) return;
    // restart from the next step with a fresh controller
    const ac = new AbortController();
    abort.current = ac;
    const from = idx + 1;
    const prior = [...results, { ok: false, cents: null, ms: STEP_MAX_MS }];
    setResults(prior);
    void (async () => {
      try {
        const out = prior;
        for (let i = from; i < ladder.plan.steps.length; i++) {
          setIdx(i);
          setLiveState(null);
          const targetHz = noteToFreq(ladder.tonic + ladder.plan.steps[i].offset, st.a4);
          const r = st.ladderTimed ? await timedStep(targetHz, ac.signal) : await relaxedStep(targetHz, ac.signal);
          if (ac.signal.aborted) return;
          out.push(r);
          setResults([...out]);
          reportStep(r.ok);
        }
        drone.stop();
        setPhase('done');
      } catch {
        /* aborted */
      }
    })();
  };

  const playTonic = () => ladder && playNote(engine, ladder.tonic, s.a4, { timbre: 'pad', duration: 0.8 });

  const rungs = ladder ? [...new Set(ladder.plan.steps.map((x) => x.offset))].sort((a, b) => b - a) : [];
  const cur = ladder?.plan.steps[idx];
  const okCount = results.filter((r) => r.ok).length;

  useAutoStart(mic.status === 'ready', () => void run());
  useEffect(() => {
    if (embed && status === 'running' && phase === 'paused') void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <main className="screen">
      {!embed && (
        <header className="bar">
          <button className="btn ghost" onClick={() => go('/')}>
            ‹ Home
          </button>
          <h2>Scale Ladder</h2>
        </header>
      )}
      <MicGate status={mic.status} error={mic.error}>
        <div className="levels muted small">
          Stage {stage + 1}: {LADDER_STAGES[stage]}
        </div>
        <section className="card">
          <div className="chips">
            {(['names', 'degrees', 'solfege'] as const).map((m) => (
              <button key={m} className={`chip ${s.labelMode === m ? 'on' : ''}`} aria-pressed={s.labelMode === m} onClick={() => updateSettings({ labelMode: m })}>
                {m === 'names' ? 'C D E' : m === 'degrees' ? '1 2 3' : 'do re mi'}
              </button>
            ))}
          </div>
          {(phase === 'ready' || phase === 'paused') && !embed && (
            <>
              <div className="chips">
                <button className={`chip ${!s.ladderTimed ? 'on' : ''}`} onClick={() => updateSettings({ ladderTimed: false })}>
                  Relaxed
                </button>
                <button className={`chip ${s.ladderTimed ? 'on' : ''}`} onClick={() => updateSettings({ ladderTimed: true })}>
                  Timed
                </button>
                <button className={`chip ${s.ladderKey === 'cadence' ? 'on' : ''}`} onClick={() => updateSettings({ ladderKey: 'cadence' })}>
                  Cadence
                </button>
                <button className={`chip ${s.ladderKey === 'drone' ? 'on' : ''}`} onClick={() => updateSettings({ ladderKey: 'drone' })}>
                  Tonic drone
                </button>
              </div>
              <p className="instruction">{s.ladderTimed ? 'Sing each step on the beat.' : 'Sing each step; the next appears when you lock it.'}</p>
              <button className="btn-huge" onClick={() => void run()}>
                {phase === 'paused' ? 'Resume' : 'Start'}
              </button>
            </>
          )}

          {ladder && (phase === 'key' || phase === 'steps' || phase === 'done') && (
            <>
              <p className="instruction center" aria-live="polite">
                {phase === 'key' && `Key of ${midiToName(ladder.tonic).replace(/-?\d+$/, '')} ${ladder.plan.scale}: listen…`}
                {phase === 'steps' && cur && (
                  <>
                    Sing <strong>{label(cur.offset, ladder.tonic)}</strong>
                    {s.labelMode !== 'names' && <span className="muted"> ({midiToName(ladder.tonic + cur.offset)})</span>}
                    {cur.register && <span className="badge">{cur.register}</span>}
                  </>
                )}
                {phase === 'done' && `${ladder.plan.title}: ${okCount}/${results.length} steps`}
              </p>
              <div className="ladder-wrap">
                <ol className="ladder" aria-label="Scale steps">
                  {rungs.map((o) => {
                    const isCur = phase === 'steps' && cur?.offset === o;
                    const doneHere = results.some((_r, i) => ladder.plan.steps[i].offset === o);
                    const okHere = results.some((r, i) => r.ok && ladder.plan.steps[i].offset === o);
                    return (
                      <li key={o} className={`rung ${isCur ? 'cur' : ''} ${doneHere ? (okHere ? 'ok' : 'miss') : ''}`}>
                        <span>{label(o, ladder.tonic)}</span>
                        {doneHere && <span className="rung-mark">{okHere ? '✓' : '·'}</span>}
                      </li>
                    );
                  })}
                </ol>
                <div className="ladder-side">
                  {phase === 'steps' && cur && (
                    <>
                      <CentsNeedle state={liveState} toleranceCents={TOL} holdMs={s.ladderTimed ? BEAT_MS * 0.35 : STEP_HOLD_MS} />
                      {s.ladderTimed && (
                        <div className="hold-bar beat">
                          <div style={{ width: `${beat * 100}%` }} />
                        </div>
                      )}
                    </>
                  )}
                  <div className="muted small">
                    Step {Math.min(idx + 1, ladder.plan.steps.length)} / {ladder.plan.steps.length}
                  </div>
                </div>
              </div>
              {phase === 'steps' && cur && <PitchTrace a4={s.a4} targetHz={noteToFreq(ladder.tonic + cur.offset, s.a4)} toleranceCents={TOL} height={160} />}
              {phase === 'steps' && (
                <div className="row">
                  <button className="btn" onClick={playTonic}>
                    ♪ Tonic
                  </button>
                  {!s.ladderTimed && (
                    <button className="btn" onClick={skipStep}>
                      Skip step
                    </button>
                  )}
                  {!embed && (
                    <button className="btn grow" onClick={() => (abort.current?.abort(), drone.stop(), setPhase('paused'))}>
                      ❚❚ Pause
                    </button>
                  )}
                </div>
              )}
              {phase === 'done' && (
                <>
                  {msg && <div className="pb">★ {msg}</div>}
                  <button className="btn primary" onClick={() => void run()}>
                    Next ladder
                    <span className="auto-bar" style={{ animationDuration: '3000ms' }} />
                  </button>
                </>
              )}
            </>
          )}
        </section>
      </MicGate>
    </main>
  );
}
