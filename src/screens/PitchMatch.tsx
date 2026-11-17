import { useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../audio';
import { playNote, type Timbre, type Voice } from '../audio/synth';
import { discardRecording, playRecording } from '../audio/recorder';
import { midiToName, noteToFreq } from '../lib/notes';
import { DEFAULT_RANGE, notesInRange, pickNote } from '../lib/range';
import { go } from '../lib/router';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { useEngineStatus } from '../lib/useEngine';
import { saveAttempt } from '../db/db';
import { initialState, leverValue, recordOutcome, type LeverDef } from '../engine/adaptive';
import type { AttemptLive } from '../pitch/attempt';
import type { AttemptScore, PitchSample } from '../pitch/scoring';
import { listen, sleep } from '../modules/listen';
import { useSingingMic } from '../modules/useSingingMic';
import { MicGate } from '../ui/MicGate';
import { useAutoStart, useEmbed } from '../lib/embed';
import { nextRun } from '../lib/bests';
import { weakness } from '../engine/weights';
import { TIMBRES } from '../audio/synth';
import { PitchTrace } from '../ui/PitchTrace';
import { CentsNeedle } from '../ui/CentsNeedle';
import { ResultCard } from '../ui/ResultCard';

// Pitch Match: a note plays → short gap → you sing it → score.

export const PM_LEVERS: LeverDef<unknown>[] = [
  { id: 'tol', label: 'Tolerance', steps: [50, 35, 25, 15] },
  { id: 'hold', label: 'Hold', steps: [500, 1000, 1500, 2000] },
  { id: 'gap', label: 'Memory gap', steps: [300, 1000, 2000, 3000] },
  { id: 'spread', label: 'Note spread', steps: [3, 5, 7, 12] },
  { id: 'timbres', label: 'Timbres', steps: [['bright'], ['bright', 'pure'], ['bright', 'pure', 'pad', 'organ', 'choir']] },
];

const DOUBLING_LEVELS = [0.35, 0.18, 0.08];

type Phase = 'ready' | 'hear' | 'gap' | 'sing' | 'result' | 'paused';

interface Trial {
  midi: number;
  timbre: Timbre;
  tol: number;
  hold: number;
  gap: number;
  earsOnly: boolean;
  doubling: number | null;
  newSound?: boolean;
}

interface Outcome {
  score: AttemptScore;
  samples: PitchSample[];
  recordingUrl: string | null;
  levelMsg: string | null;
}

const noteStat = (hist: boolean[] | undefined) => (hist ? { n: hist.length, ok: hist.filter(Boolean).length } : undefined);

export function PitchMatch() {
  const s = useSettings();
  const mic = useSingingMic();
  const status = useEngineStatus();
  const range = s.range ?? DEFAULT_RANGE;
  const pool = useMemo(() => notesInRange(range, ['chest', 'falsetto'], s.stretch), [range, s.stretch]);
  const [phase, setPhase] = useState<Phase>('ready');
  const [trial, setTrial] = useState<Trial | null>(null);
  const [live, setLive] = useState<AttemptLive | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [tally, setTally] = useState({ n: 0, ok: 0 });
  const abort = useRef<AbortController | null>(null);
  const prevNote = useRef<number | null>(null);
  const run = useRef(0);
  const embed = useEmbed();

  const adaptive = s.pitchMatch ?? initialState(PM_LEVERS);
  const tol = leverValue(PM_LEVERS, adaptive, 'tol') as number;
  const hold = leverValue(PM_LEVERS, adaptive, 'hold') as number;
  const gap = leverValue(PM_LEVERS, adaptive, 'gap') as number;

  // Pause on interruptions (call, Siri, lock screen).
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

  function makeTrial(): Trial {
    const st = getSettings();
    const ad = st.pitchMatch ?? initialState(PM_LEVERS);
    const spread = leverValue(PM_LEVERS, ad, 'spread') as number;
    const timbres = leverValue(PM_LEVERS, ad, 'timbres') as Timbre[];
    // Weak-spot targeting: notes you've missed come up more often.
    const midi = pickNote(pool, Math.random, prevNote.current, spread, (m) => weakness(noteStat(st.noteHistory[midiToName(m)])));
    prevNote.current = midi;
    const name = midiToName(midi);
    const hist = st.noteHistory[name] ?? [];
    const reliable = hist.length >= 3 && hist.slice(-3).every(Boolean);
    const earsOnly = embed?.bonus === 'ears-only' || (reliable && Math.random() < 0.35);
    let timbre = timbres[Math.floor(Math.random() * timbres.length)];
    let newSound = false;
    if (embed?.bonus === 'new-timbre') {
      const fresh = TIMBRES.map((x) => x.id as Timbre).filter((x) => !timbres.includes(x));
      if (fresh.length) {
        timbre = fresh[Math.floor(Math.random() * fresh.length)];
        newSound = true;
      }
    }
    const doubling = st.headphones && hist.length < DOUBLING_LEVELS.length ? DOUBLING_LEVELS[hist.length] : null;
    return {
      midi,
      timbre,
      newSound,
      tol: leverValue(PM_LEVERS, ad, 'tol') as number,
      hold: leverValue(PM_LEVERS, ad, 'hold') as number,
      gap: leverValue(PM_LEVERS, ad, 'gap') as number,
      earsOnly,
      doubling,
    };
  }

  function playTarget(t: Trial): Voice {
    return playNote(engine, t.midi, getSettings().a4, { timbre: t.timbre, duration: 1.2 });
  }

  async function runTrial() {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const t = makeTrial();
    setTrial(t);
    setOutcome(null);
    setLive(null);
    const a4 = getSettings().a4;
    const targetHz = noteToFreq(t.midi, a4);
    let doubler: Voice | null = null;
    try {
      setPhase('hear');
      const v = playTarget(t);
      await sleep(Math.max(0, ((v.endTime ?? engine.now + 1.4) - engine.now) * 1000), ac.signal);
      setPhase('gap');
      await sleep(t.gap, ac.signal);
      setPhase('sing');
      if (t.doubling != null) doubler = playNote(engine, t.midi, a4, { timbre: t.timbre, velocity: t.doubling, blocksMic: false, attack: 0.1 });
      const res = await listen(targetHz, {
        toleranceCents: t.tol,
        holdMs: t.hold,
        maxMs: t.hold + 4500,
        silenceEndMs: 800,
        record: true,
        signal: ac.signal,
        onUpdate: (st) => setLive(st),
      });
      doubler?.stop();
      if (res.aborted) return;
      const success = res.score.locked;
      const st = getSettings();
      const { state, change } = recordOutcome(st.pitchMatch ?? initialState(PM_LEVERS), PM_LEVERS, success);
      const name = midiToName(t.midi);
      updateSettings({
        pitchMatch: state,
        noteHistory: { ...st.noteHistory, [name]: [...(st.noteHistory[name] ?? []), success].slice(-10) },
      });
      void saveAttempt({
        ts: Date.now(),
        module: 'pitch-match',
        target: name,
        result: success ? 'success' : res.score.verdict,
        centsError: res.score.meanCents,
        octaveError: res.score.octave,
        settleMs: res.score.settleMs,
        stability: res.score.stability,
        difficulty: { tol: t.tol, hold: t.hold, gap: t.gap, timbre: t.timbre, earsOnly: t.earsOnly ? 1 : 0 },
      });
      setTally((x) => ({ n: x.n + 1, ok: x.ok + (success ? 1 : 0) }));
      const r = nextRun(run.current, success, 'run:pitch-match');
      run.current = r.run;
      embed?.report({ ok: success, best: r.best });
      const lever = change ? PM_LEVERS.find((l) => l.id === change.lever)!.label : null;
      setOutcome({
        score: res.score,
        samples: res.attempt.samples,
        recordingUrl: res.recordingUrl,
        levelMsg: r.best ?? (change && lever ? (change.dir > 0 ? `Getting harder: ${lever.toLowerCase()}` : `Easing off: ${lever.toLowerCase()}`) : null),
      });
      setPhase('result');
    } catch {
      doubler?.stop();
    }
  }

  const skip = () => {
    abort.current?.abort();
    void runTrial();
  };

  useAutoStart(mic.status === 'ready', () => void runTrial());
  useEffect(() => {
    if (embed && status === 'running' && phase === 'paused') void runTrial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const instruction =
    phase === 'hear' ? 'Listen…' : phase === 'gap' ? 'Remember it…' : phase === 'sing' ? `Sing it and hold ${(trial?.hold ?? hold) / 1000} s` : 'Hear a note, then sing it back.';

  return (
    <main className="screen">
      {!embed && (
        <header className="bar">
          <button className="btn ghost" onClick={() => go('/')}>
            ‹ Home
          </button>
          <h2>Pitch Match</h2>
          <span className="muted small push">{tally.n > 0 && `${tally.ok}/${tally.n}`}</span>
        </header>
      )}
      <MicGate status={mic.status} error={mic.error}>
        <div className="levels muted small">
          ±{tol}¢ · hold {hold / 1000}s · gap {gap / 1000}s{!s.range && ' · default range (run the range finder)'}
        </div>
        <section className="card">
          <p className="instruction" aria-live="polite">
            {instruction}
          </p>
          {phase === 'ready' && (
            <button className="btn-huge" onClick={() => void runTrial()}>
              Start
            </button>
          )}
          {phase === 'paused' && !embed && (
            <button className="btn-huge" onClick={() => void runTrial()}>
              Resume
            </button>
          )}
          {(phase === 'hear' || phase === 'gap' || phase === 'sing') && trial && (
            <>
              <div className="target-note">
                {phase === 'sing' && trial.earsOnly ? '?' : midiToName(trial.midi)}
                {trial.earsOnly && <span className="badge">ears only</span>}
                {trial.newSound && <span className="badge">new sound</span>}
              </div>
              <CentsNeedle state={phase === 'sing' ? live : null} toleranceCents={trial.tol} holdMs={trial.hold} hidden={trial.earsOnly} />
              {trial.earsOnly ? (
                <div className="trace hidden-trace" style={{ height: 200 }} />
              ) : (
                <PitchTrace a4={s.a4} targetHz={noteToFreq(trial.midi, s.a4)} toleranceCents={trial.tol} />
              )}
              <div className="row">
                {!embed && (
                  <button className="btn" onClick={() => (abort.current?.abort(), setPhase('paused'))}>
                    ❚❚ Pause
                  </button>
                )}
                <button className="btn grow" onClick={skip}>
                  Skip ›
                </button>
              </div>
            </>
          )}
          {phase === 'result' && outcome && trial && (
            <ResultCard
              score={outcome.score}
              samples={outcome.samples}
              targetHz={noteToFreq(trial.midi, s.a4)}
              toleranceCents={trial.tol}
              targetName={midiToName(trial.midi)}
              personalBest={outcome.levelMsg}
              onReplay={() => playTarget(trial)}
              onHear={outcome.recordingUrl ? () => playRecording(outcome.recordingUrl!) : null}
              onNext={() => void runTrial()}
            />
          )}
        </section>
      </MicGate>
    </main>
  );
}
