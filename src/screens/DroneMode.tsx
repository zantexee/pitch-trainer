import { useEffect, useMemo, useRef, useState } from 'react';
import { drone, engine, live } from '../audio';
import { playChime, TIMBRES, type Timbre } from '../audio/synth';
import type { DroneMode as Voicing } from '../audio/drone';
import { cents, midiToName, noteToFreq } from '../lib/notes';
import { DEFAULT_RANGE, fullSpan, notesInRange } from '../lib/range';
import { go } from '../lib/router';
import { updateSettings, useSettings } from '../lib/settings';
import { saveAttempt } from '../db/db';
import { LiveAttempt, type AttemptLive } from '../pitch/attempt';
import { median } from '../pitch/tracker';
import type { AttemptScore, PitchSample } from '../pitch/scoring';
import { listen, sleep } from '../modules/listen';
import { playRecording } from '../audio/recorder';
import { useSingingMic } from '../modules/useSingingMic';
import { MicGate } from '../ui/MicGate';
import { PitchTrace } from '../ui/PitchTrace';
import { CentsNeedle } from '../ui/CentsNeedle';
import { Keyboard } from '../ui/Keyboard';
import { ResultCard } from '../ui/ResultCard';

type Tab = 'free' | 'hold' | 'degree' | 'slide';
const HOLDS = [1000, 3000, 5000];
const DEGREES: { semis: number; name: string }[] = [
  { semis: 7, name: '5th' },
  { semis: 4, name: 'major 3rd' },
  { semis: 12, name: 'octave' },
  { semis: 5, name: '4th' },
  { semis: 9, name: 'major 6th' },
  { semis: 2, name: '2nd' },
  { semis: 3, name: 'minor 3rd' },
];
const FREE_TOL = 25;
const DUCK_EVERY_MS = 3000;

interface Outcome {
  score: AttemptScore;
  samples: PitchSample[];
  targetHz: number;
  targetName: string;
  extra?: string | null;
  recordingUrl?: string | null;
}

export function DroneMode() {
  const s = useSettings();
  const mic = useSingingMic();
  const range = s.range ?? DEFAULT_RANGE;
  const pool = useMemo(() => notesInRange(range, ['chest', 'falsetto', 'low'], s.stretch), [range, s.stretch]);
  const span = fullSpan(range);
  const [midi, setMidi] = useState(() => Math.round((range.chest.lo + range.chest.hi) / 2));
  const [tab, setTab] = useState<Tab>('free');
  const [playing, setPlaying] = useState(false);

  const droneOpts = { timbre: s.timbre, mode: s.droneMode, volume: s.droneVolume, a4: s.a4, headphones: s.headphones };

  useEffect(() => {
    if (playing) drone.start(midi, droneOpts);
    else drone.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, midi, s.timbre, s.droneMode, s.a4, s.headphones]);
  useEffect(() => drone.setVolume(s.droneVolume), [s.droneVolume]);
  useEffect(() => () => drone.stop(), []);

  const random = () => setMidi(pool[Math.floor(Math.random() * pool.length)]);

  return (
    <main className="screen">
      <header className="bar">
        <button className="btn ghost" onClick={() => go('/')}>
          ‹ Home
        </button>
        <h2>Drone</h2>
      </header>
      <MicGate status={mic.status} error={mic.error}>
        <section className="card">
          <div className="drone-top">
            <div className="note-name">
              <strong>{midiToName(midi)}</strong>
              <span className="muted small">drone</span>
            </div>
            <button className={`btn ${playing ? 'on' : 'primary'}`} onClick={() => setPlaying(!playing)}>
              {playing ? '■ Stop' : '∞ Play drone'}
            </button>
            <button className="btn" onClick={random} aria-label="Random note in range">
              🎲
            </button>
          </div>
          <Keyboard lo={span.lo - 2} hi={span.hi + 2} range={range} selected={midi} allowed={pool} onPick={setMidi} />
          <div className="chips">
            {TIMBRES.map((t) => (
              <button key={t.id} className={`chip ${s.timbre === t.id ? 'on' : ''}`} aria-pressed={s.timbre === t.id} onClick={() => updateSettings({ timbre: t.id as Timbre })}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="chips">
            {(['root', 'fifth', 'octave'] as Voicing[]).map((m) => (
              <button key={m} className={`chip ${s.droneMode === m ? 'on' : ''}`} aria-pressed={s.droneMode === m} onClick={() => updateSettings({ droneMode: m })}>
                {m === 'root' ? 'Root' : m === 'fifth' ? '+ 5th' : '+ octave'}
              </button>
            ))}
          </div>
          <label className="slider">
            <span>Volume</span>
            <input type="range" min={0} max={1} step={0.01} value={s.droneVolume} onChange={(e) => updateSettings({ droneVolume: Number(e.target.value) })} />
          </label>
          <label className="toggle">
            <input type="checkbox" checked={s.headphones} onChange={(e) => updateSettings({ headphones: e.target.checked })} />
            <span>I'm using headphones</span>
          </label>
        </section>

        <div className="tabs" role="tablist">
          {(
            [
              ['free', 'Free'],
              ['hold', 'Hold'],
              ['degree', 'Degrees'],
              ['slide', 'Slide'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'free' && <FreeMode key={`${midi}-${s.headphones}`} midi={midi} playing={playing} setPlaying={setPlaying} />}
        {tab !== 'free' && <Challenge key={tab} kind={tab} midi={midi} pool={pool} droneOpts={droneOpts} setPlaying={setPlaying} />}
      </MicGate>
    </main>
  );
}

// ---------------------------------------------------------------------------

function FreeMode({ midi, playing, setPlaying }: { midi: number; playing: boolean; setPlaying: (b: boolean) => void }) {
  const s = useSettings();
  const targetHz = noteToFreq(midi, s.a4);
  const [state, setState] = useState<AttemptLive | null>(null);
  const [checks, setChecks] = useState<number[]>([]);

  // Headphones: continuous needle; a new attempt starts each time you start singing.
  useEffect(() => {
    if (!s.headphones) return;
    let attempt = new LiveAttempt(targetHz, { toleranceCents: FREE_TOL, holdMs: 1000 });
    let silentSince: number | null = null;
    const unsub = live.subscribe((f) => {
      if (f.out.freq == null) {
        silentSince ??= f.t;
        if (f.t - silentSince > 400) {
          attempt = new LiveAttempt(targetHz, { toleranceCents: FREE_TOL, holdMs: 1000 });
          setState(null);
        }
        return;
      }
      silentSince = null;
      const st = attempt.push(f.t, f.out.freq);
      if (st.justLocked) playChime(engine);
      setState(st);
    });
    return unsub;
  }, [s.headphones, targetHz]);

  // No headphones: duck-and-check. Every 3 s the drone drops out for 0.6 s and we measure you in the gap.
  useEffect(() => {
    if (s.headphones || !playing) return;
    let gap: { from: number; to: number } | null = null;
    let collected: number[] = [];
    const unsub = live.subscribe((f) => {
      if (!gap || f.ignored || f.out.freq == null) return;
      const now = engine.now;
      if (now >= gap.from && now <= gap.to) collected.push(cents(f.out.freq, targetHz));
    });
    const id = setInterval(() => {
      const w = drone.duck(0.6, s.droneVolume);
      if (!w) return;
      engine.openListenWindow(w.listenFrom, w.listenTo);
      gap = { from: w.listenFrom, to: w.listenTo };
      collected = [];
      setTimeout(
        () => {
          if (collected.length >= 3) {
            const c = median(collected);
            setChecks((prev) => [...prev.slice(-5), c]);
            if (Math.abs(c) <= FREE_TOL) playChime(engine);
          }
          gap = null;
        },
        (w.listenTo - engine.now) * 1000 + 50,
      );
    }, DUCK_EVERY_MS);
    return () => {
      unsub();
      clearInterval(id);
      engine.openListenWindow(0, 0);
    };
  }, [s.headphones, playing, targetHz, s.droneVolume]);

  return (
    <section className="card">
      <p className="instruction">
        {s.headphones ? `Sing ${midiToName(midi)} with the drone and lock in.` : `Sing ${midiToName(midi)} with the drone. Every 3 s it drops out briefly to check you.`}
      </p>
      {!playing && (
        <button className="btn primary" onClick={() => setPlaying(true)}>
          ∞ Play drone
        </button>
      )}
      {s.headphones ? (
        <CentsNeedle state={state} toleranceCents={FREE_TOL} holdMs={1000} />
      ) : (
        <div className="checks" aria-live="polite">
          {checks.length === 0 && <span className="muted">Checks appear here…</span>}
          {checks.map((c, i) => (
            <span key={i} className={`check ${Math.abs(c) <= FREE_TOL ? 'in' : Math.abs(c) <= 2 * FREE_TOL ? 'close' : 'off'}`}>
              {Math.abs(c) <= FREE_TOL ? '✓' : c < 0 ? '↑' : '↓'} {c >= 0 ? '+' : '−'}
              {Math.abs(Math.round(c))}¢
            </span>
          ))}
        </div>
      )}
      <PitchTrace a4={s.a4} targetHz={targetHz} toleranceCents={FREE_TOL} />
    </section>
  );
}

// ---------------------------------------------------------------------------

interface ChallengeProps {
  kind: Exclude<Tab, 'free'>;
  midi: number;
  pool: number[];
  droneOpts: Parameters<typeof drone.start>[1];
  setPlaying: (b: boolean) => void;
}

function Challenge({ kind, midi, pool, droneOpts, setPlaying }: ChallengeProps) {
  const s = useSettings();
  const [phase, setPhase] = useState<'idle' | 'listen-drone' | 'sing' | 'result'>('idle');
  const [state, setState] = useState<AttemptLive | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [round, setRound] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const fromAbove = round % 2 === 0;

  // Which note to sing this round.
  const task = useMemo(() => {
    if (kind === 'degree') {
      const options = DEGREES.filter((d) => pool.includes(midi + d.semis));
      const d = options.length ? options[(round * 3 + midi) % options.length] : DEGREES[2];
      return { target: midi + d.semis, text: `Sing the ${d.name} above the drone (${midiToName(midi + d.semis)}).`, holdMs: 1000, tol: 35 };
    }
    if (kind === 'slide') {
      return { target: midi, text: `Start ${fromAbove ? 'above' : 'below'} ${midiToName(midi)} and slide ${fromAbove ? 'down' : 'up'} onto it.`, holdMs: 1000, tol: 30 };
    }
    const hold = HOLDS[Math.min(HOLDS.length - 1, s.droneHoldLevel)];
    return { target: midi, text: `Hold ${midiToName(midi)} steady for ${hold / 1000} s.`, holdMs: hold, tol: 30 };
  }, [kind, midi, pool, round, s.droneHoldLevel, fromAbove]);

  useEffect(() => () => abort.current?.abort(), []);

  // Auto-advance: start the next round once its task has been computed.
  const pendingRun = useRef(false);
  useEffect(() => {
    if (pendingRun.current) {
      pendingRun.current = false;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  async function run() {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setOutcome(null);
    setState(null);
    const targetHz = noteToFreq(task.target, s.a4);
    try {
      if (s.headphones) {
        setPlaying(true);
        setPhase('sing');
      } else {
        // Call and response: hear the drone, it fades, then you sing.
        setPlaying(true);
        setPhase('listen-drone');
        await sleep(2500, ac.signal);
        setPlaying(false);
        setPhase('sing');
      }
      const res = await listen(targetHz, {
        toleranceCents: task.tol,
        holdMs: task.holdMs,
        maxMs: task.holdMs + 8000,
        silenceEndMs: 900,
        record: true,
        signal: ac.signal,
        onUpdate: (st) => setState(st),
      });
      if (res.aborted) return;
      let extra: string | null = null;
      let success = res.score.locked;
      if (kind === 'slide') {
        const first = res.attempt.samples.filter((x) => x.freq != null).slice(0, 4);
        const startC = first.length ? median(first.map((x) => cents(x.freq!, targetHz))) : 0;
        const ok = fromAbove ? startC > 60 : startC < -60;
        if (!ok) {
          success = false;
          extra = `Start clearly ${fromAbove ? 'above' : 'below'} the note, then slide.`;
        } else if (res.score.locked) extra = 'Nice slide!';
      }
      if (kind === 'hold' && res.score.locked && s.droneHoldLevel < HOLDS.length - 1) {
        updateSettings({ droneHoldLevel: s.droneHoldLevel + 1 });
        extra = `Level up: next hold is ${HOLDS[s.droneHoldLevel + 1] / 1000} s`;
      }
      if (kind === 'hold' && !res.score.locked && res.score.longestHoldMs > 0) extra = `Longest steady: ${(res.score.longestHoldMs / 1000).toFixed(1)} s`;
      void saveAttempt({
        ts: Date.now(),
        module: `drone-${kind}`,
        target: midiToName(task.target),
        result: success ? 'success' : res.score.verdict,
        centsError: res.score.meanCents,
        octaveError: res.score.octave,
        settleMs: res.score.settleMs,
        stability: res.score.stability,
        difficulty: { holdMs: task.holdMs, tol: task.tol, drone: midiToName(midi) },
      });
      setOutcome({ score: res.score, samples: res.attempt.samples, targetHz, targetName: midiToName(task.target), extra, recordingUrl: res.recordingUrl });
      setPhase('result');
    } catch {
      /* aborted */
    }
  }

  const next = () => {
    setRound((r) => r + 1);
    setPhase('idle');
    setOutcome(null);
  };

  return (
    <section className="card">
      <p className="instruction">{task.text}</p>
      {kind === 'hold' && (
        <div className="chips">
          {HOLDS.map((h, i) => (
            <button key={h} className={`chip ${s.droneHoldLevel === i ? 'on' : ''}`} onClick={() => updateSettings({ droneHoldLevel: i })}>
              {h / 1000} s
            </button>
          ))}
        </div>
      )}
      {phase === 'idle' && (
        <button className="btn primary" onClick={() => void run()}>
          Go
        </button>
      )}
      {phase === 'listen-drone' && <div className="phase">Listen…</div>}
      {phase === 'sing' && (
        <>
          <div className="phase">Sing!</div>
          <CentsNeedle state={state} toleranceCents={task.tol} holdMs={task.holdMs} />
          <PitchTrace a4={s.a4} targetHz={noteToFreq(task.target, s.a4)} toleranceCents={task.tol} />
          <button className="btn ghost" onClick={() => (abort.current?.abort(), setPhase('idle'))}>
            Skip
          </button>
        </>
      )}
      {phase === 'result' && outcome && (
        <ResultCard
          score={outcome.score}
          samples={outcome.samples}
          targetHz={outcome.targetHz}
          toleranceCents={task.tol}
          targetName={outcome.targetName}
          personalBest={outcome.extra}
          onReplay={() => {
            drone.start(midi, droneOpts);
            setTimeout(() => drone.stop(), 1500);
          }}
          onHear={outcome.recordingUrl ? () => playRecording(outcome.recordingUrl!) : null}
          onNext={() => {
            pendingRun.current = true;
            next();
          }}
          autoNextMs={2500}
        />
      )}
    </section>
  );
}
