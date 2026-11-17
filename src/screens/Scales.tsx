import { useEffect, useMemo, useRef, useState } from 'react';
import { drone, engine } from '../audio';
import { playNote, type Voice } from '../audio/synth';
import { midiToName, noteToFreq } from '../lib/notes';
import { DEFAULT_RANGE, fullSpan } from '../lib/range';
import { go } from '../lib/router';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { useEngineStatus } from '../lib/useEngine';
import { saveAttempt } from '../db/db';
import { KEY_NAMES, SCALE_TYPES, scaleOffsets, SPEEDS, tonicFor, upDownOffsets, type ScaleType } from '../engine/scales';
import { degreeLabel } from '../engine/ladder';
import type { AttemptLive } from '../pitch/attempt';
import { listen, sleep } from '../modules/listen';
import { useSingingMic } from '../modules/useSingingMic';
import { MicGate } from '../ui/MicGate';
import { Keyboard } from '../ui/Keyboard';
import { CentsNeedle } from '../ui/CentsNeedle';
import { PitchTrace } from '../ui/PitchTrace';

// Scales menu: any major or minor scale. Tap its notes, let it play up and
// down, or sing it: each note plays, then waits until you match it.

type Tab = 'listen' | 'sing';
type Phase = 'idle' | 'playing' | 'hear' | 'match' | 'done';
type Mark = 'ok' | 'skip' | undefined;

const TOL = 35;
const HOLD_MS = 500;

export function Scales() {
  const s = useSettings();
  const status = useEngineStatus();
  const [tab, setTab] = useState<Tab>('listen');
  const [phase, setPhase] = useState<Phase>('idle');
  const [idx, setIdx] = useState<number | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [liveState, setLiveState] = useState<AttemptLive | null>(null);
  const [held, setHeld] = useState<number | null>(null);
  const mic = useSingingMic(tab === 'sing');

  const range = s.range ?? DEFAULT_RANGE;
  const type = s.scaleType as ScaleType;
  const tonic = tonicFor(s.scaleKey, range) + 12 * s.scaleOctave;
  const seq = useMemo(() => upDownOffsets(type).map((o) => tonic + o), [type, tonic]);
  const allowed = useMemo(() => scaleOffsets(type).map((o) => tonic + o), [type, tonic]);
  const span = fullSpan(range);
  const kbLo = Math.min(span.lo, tonic) - 1;
  const kbHi = Math.max(span.hi, tonic + 12) + 1;

  const run = useRef<AbortController | null>(null);
  const noteAc = useRef<AbortController | null>(null);
  const voices = useRef<Voice[]>([]);
  const busy = phase !== 'idle' && phase !== 'done';

  const stopVoices = () => {
    voices.current.forEach((v) => v.stop());
    voices.current = [];
    setHeld(null);
  };

  const stopAll = () => {
    run.current?.abort();
    noteAc.current?.abort();
    stopVoices();
    drone.stop();
    setPhase('idle');
    setIdx(null);
    setLiveState(null);
  };

  // Leaving, changing scale or an interruption stops everything.
  useEffect(() => () => stopAll(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => stopAll(), [s.scaleKey, s.scaleType, s.scaleOctave, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (status !== 'running' && busy) stopAll();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Root drone toggle (background hum on the tonic).
  const droneOn = s.scaleRootDrone;
  useEffect(() => {
    if (droneOn && (tab === 'listen' || phase !== 'idle')) startRootDrone();
    else drone.stop();
  }, [droneOn, tonic, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  function startRootDrone() {
    const st = getSettings();
    drone.start(tonic, {
      timbre: 'pad',
      mode: 'root',
      volume: st.droneVolume * 0.7,
      a4: st.a4,
      headphones: st.headphones,
    });
  }

  /** Play one note as a short tone, or sustain it (drone) until the next note or Stop. */
  function sound(midi: number, toneSecs = 1.0, blocksMic = true): Voice {
    const st = getSettings();
    stopVoices();
    const sustain = st.scaleNoteSound === 'drone';
    const v = playNote(engine, midi, st.a4, {
      timbre: st.timbre,
      duration: sustain ? undefined : toneSecs,
      blocksMic,
      velocity: 0.6,
    });
    if (sustain) {
      voices.current = [v];
      setHeld(midi);
    }
    return v;
  }

  function tap(midi: number) {
    if (tab === 'sing' && busy) return;
    if (held === midi) return stopVoices(); // tap a sustained note again to stop it
    sound(midi);
  }

  async function playScale() {
    stopAll();
    const ac = new AbortController();
    run.current = ac;
    setPhase('playing');
    if (getSettings().scaleRootDrone) startRootDrone();
    try {
      for (;;) {
        const ms = SPEEDS.find((x) => x.id === getSettings().scaleSpeed)!.ms;
        for (let i = 0; i < seq.length; i++) {
          setIdx(i);
          sound(seq[i], (ms * 0.9) / 1000);
          await sleep(ms, ac.signal);
        }
        await sleep(ms, ac.signal); // breath before looping
      }
    } catch {
      /* stopped */
    }
  }

  async function singScale() {
    stopAll();
    const ac = new AbortController();
    run.current = ac;
    const st = getSettings();
    const out: Mark[] = [];
    setMarks([]);
    const constant = st.headphones && st.scaleNoteSound === 'drone';
    if (constant && st.scaleRootDrone) startRootDrone();
    try {
      for (let i = 0; i < seq.length; i++) {
        setIdx(i);
        setLiveState(null);
        if (constant) {
          // Headphones + Drone: the note sounds the whole time; you sing over it
          // and it moves to the next note as soon as you match.
          sound(seq[i], 1.0, false);
        } else {
          // hear it (the root drone pauses on the speaker so the mic can hear you)
          setPhase('hear');
          if (st.scaleRootDrone) startRootDrone();
          const v = sound(seq[i], 1.0, !st.headphones);
          const hearMs = st.scaleNoteSound === 'drone' && !st.headphones ? 1500 : 1100;
          await sleep(hearMs, ac.signal);
          if (!st.headphones) {
            v.stop();
            stopVoices();
            if (st.scaleRootDrone) drone.stop();
            while (engine.isSounding()) await sleep(50, ac.signal);
          }
        }
        // wait until you match it
        setPhase('match');
        const nac = new AbortController();
        noteAc.current = nac;
        const onMain = () => nac.abort();
        ac.signal.addEventListener('abort', onMain);
        const t0 = performance.now();
        const res = await listen(noteToFreq(seq[i], st.a4), {
          toleranceCents: TOL,
          holdMs: HOLD_MS,
          maxMs: 10 * 60_000,
          silenceEndMs: 10 * 60_000,
          afterLockMs: 0,
          signal: nac.signal,
          onUpdate: (x) => setLiveState(x),
        });
        ac.signal.removeEventListener('abort', onMain);
        if (ac.signal.aborted) return;
        const ok = !res.aborted && res.score.locked;
        out.push(ok ? 'ok' : 'skip');
        setMarks([...out]);
        void saveAttempt({
          ts: Date.now(),
          module: 'scales',
          target: `${KEY_NAMES[st.scaleKey]} ${type} ${degreeLabel(seq[i] - tonic)} ${midiToName(seq[i])}`,
          result: ok ? 'success' : 'skipped',
          centsError: res.score.meanCents,
          octaveError: res.score.octave,
          settleMs: ok ? performance.now() - t0 : null,
          stability: res.score.stability,
          difficulty: { scale: type, key: KEY_NAMES[st.scaleKey] },
        });
        if (!ok) stopVoices();
      }
      stopVoices();
      drone.stop();
      setPhase('done');
      setIdx(null);
    } catch {
      /* stopped */
    }
  }

  const replay = () => idx != null && sound(seq[idx], 1.0, !getSettings().headphones);
  const skipNote = () => noteAc.current?.abort();

  const name = `${KEY_NAMES[s.scaleKey]} ${SCALE_TYPES.find((x) => x.id === type)!.label.toLowerCase()}`;
  const okCount = marks.filter((m) => m === 'ok').length;
  const cur = idx != null ? seq[idx] : null;
  // while singing, fold the setup away so the pitch display fits on screen
  const singing = tab === 'sing' && busy;
  // headphones + Drone: the note sounds continuously and advances on a match
  const constantMode = s.headphones && s.scaleNoteSound === 'drone';

  return (
    <main className="screen">
      <header className="bar">
        <button className="btn ghost" onClick={() => go('/')}>
          ‹ Home
        </button>
        <h2>Scales</h2>
      </header>

      <section className="card">
        {singing ? (
          <div className="octave-row">
            <strong>{name}</strong>
            <span className="muted small">
              {midiToName(tonic)}–{midiToName(tonic + 12)}
            </span>
          </div>
        ) : (
          <>
            <div className="key-grid" role="radiogroup" aria-label="Key">
              {KEY_NAMES.map((k, pc) => (
                <button key={k} role="radio" aria-checked={s.scaleKey === pc} className={`chip ${s.scaleKey === pc ? 'on' : ''}`} onClick={() => updateSettings({ scaleKey: pc, scaleOctave: 0 })}>
                  {k}
                </button>
              ))}
            </div>
            <div className="chips" role="radiogroup" aria-label="Scale">
              {SCALE_TYPES.map((t) => (
                <button key={t.id} role="radio" aria-checked={type === t.id} className={`chip ${type === t.id ? 'on' : ''}`} onClick={() => updateSettings({ scaleType: t.id })}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="octave-row">
              <button
                className="btn small"
                onClick={() =>
                  updateSettings({
                    scaleOctave: Math.max(-2, s.scaleOctave - 1),
                  })
                }
                aria-label="Octave down"
              >
                − Oct
              </button>
              <strong>
                {midiToName(tonic)}–{midiToName(tonic + 12)}
              </strong>
              <button
                className="btn small"
                onClick={() =>
                  updateSettings({
                    scaleOctave: Math.min(2, s.scaleOctave + 1),
                  })
                }
                aria-label="Octave up"
              >
                + Oct
              </button>
            </div>
            <div className="sound-row">
              <div className="seg-toggle" role="radiogroup" aria-label="Note sound">
                <button
                  role="radio"
                  aria-checked={s.scaleNoteSound === 'tone'}
                  className={s.scaleNoteSound === 'tone' ? 'on' : ''}
                  onClick={() => (stopVoices(), updateSettings({ scaleNoteSound: 'tone' }))}
                >
                  Tone
                </button>
                <button role="radio" aria-checked={s.scaleNoteSound === 'drone'} className={s.scaleNoteSound === 'drone' ? 'on' : ''} onClick={() => updateSettings({ scaleNoteSound: 'drone' })}>
                  Drone
                </button>
              </div>
              <label className="toggle compact">
                <input type="checkbox" checked={s.scaleRootDrone} onChange={(e) => updateSettings({ scaleRootDrone: e.target.checked })} />
                <span>Root drone</span>
              </label>
            </div>
            <p className="muted small">
              {s.scaleNoteSound === 'tone' ? 'Tone: each note is short and fades out.' : 'Drone: each note keeps sounding until the next note or Stop.'} Root drone hums the tonic underneath.
            </p>
            <Keyboard lo={kbLo} hi={kbHi} range={range} allowed={allowed} selected={cur ?? held} onPick={tap} />
          </>
        )}
        <div className="scale-notes" aria-label={`${name} notes`}>
          {seq.slice(0, 8).map((m, i) => (
            <span key={m} className={`sn ${tab === 'sing' && idx != null && seq[idx] === m ? 'cur' : ''} ${tab === 'listen' && cur === m ? 'cur' : ''}`}>
              <b>{midiToName(m).replace(/-?\d+$/, '')}</b>
              <small>{degreeLabel(scaleOffsetsFor(type, i))}</small>
            </span>
          ))}
        </div>
      </section>

      <div className="tabs" role="tablist">
        {(
          [
            ['listen', 'Play'],
            ['sing', 'Sing it'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'listen' && (
        <section className="card">
          <div className="chips" role="radiogroup" aria-label="Speed">
            {SPEEDS.map((x) => (
              <button key={x.id} role="radio" aria-checked={s.scaleSpeed === x.id} className={`chip ${s.scaleSpeed === x.id ? 'on' : ''}`} onClick={() => updateSettings({ scaleSpeed: x.id })}>
                {x.label}
              </button>
            ))}
          </div>
          {phase === 'playing' ? (
            <p className="instruction center">Playing {name} up and down…</p>
          ) : (
            <p className="instruction">Tap any highlighted key, or play the whole scale up and down on a loop.</p>
          )}
          <div className="row">
            {phase !== 'playing' && (
              <button className="btn primary grow big" onClick={() => void playScale()}>
                ▶ Play scale
              </button>
            )}
            <button className="btn grow big stop" onClick={stopAll}>
              ■ Stop
            </button>
          </div>
        </section>
      )}

      {tab === 'sing' && (
        <MicGate status={mic.status} error={mic.error}>
          <section className="card">
            {phase === 'idle' && (
              <>
                <p className="instruction">
                  {constantMode
                    ? 'Each note sounds the whole time. Sing along and hold it; as soon as you match, it moves to the next note.'
                    : 'Each note plays, then waits until you sing it and hold it.'}{' '}
                  Up the scale and back down.
                </p>
                <label className="toggle">
                  <input type="checkbox" checked={s.headphones} onChange={(e) => updateSettings({ headphones: e.target.checked })} />
                  <span>I'm using headphones</span>
                </label>
                {s.headphones && s.scaleNoteSound !== 'drone' && (
                  <button className="btn ghost small" onClick={() => updateSettings({ scaleNoteSound: 'drone' })}>
                    Tip: switch to Drone to hear each note the whole time while you sing
                  </button>
                )}
                <button className="btn-huge" onClick={() => void singScale()}>
                  Sing {name}
                </button>
              </>
            )}
            {(phase === 'hear' || phase === 'match') && cur != null && (
              <>
                <div className="target-note">
                  {midiToName(cur)} <span className="muted small">({degreeLabel(cur - tonic)})</span>
                </div>
                <p className="instruction center" aria-live="polite">
                  {phase === 'hear' ? 'Listen…' : constantMode ? 'Sing along and hold: it moves on when you match' : 'Your turn: sing it and hold'}
                </p>
                <CentsNeedle state={phase === 'match' ? liveState : null} toleranceCents={TOL} holdMs={HOLD_MS} />
                <PitchTrace a4={s.a4} targetHz={noteToFreq(cur, s.a4)} toleranceCents={TOL} height={160} />
                <div className="sing-progress" aria-label={`Note ${idx! + 1} of ${seq.length}`}>
                  {seq.map((_m, i) => (
                    <span key={i} className={marks[i] === 'ok' ? 'ok' : marks[i] === 'skip' ? 'skip' : i === idx ? 'cur' : ''} />
                  ))}
                </div>
                <div className="row">
                  {!constantMode && (
                    <button className="btn" onClick={replay}>
                      ↻ Hear it
                    </button>
                  )}
                  <button className="btn" onClick={skipNote}>
                    Skip note
                  </button>
                  <button className="btn grow stop" onClick={stopAll}>
                    ■ Stop
                  </button>
                </div>
              </>
            )}
            {phase === 'done' && (
              <>
                <div className="summary-head">
                  <div className="summary-pct">
                    {okCount}/{marks.length}
                  </div>
                  <div>
                    <strong>{okCount === marks.length ? 'Every note matched!' : 'Scale done'}</strong>
                    <div className="muted small">{name}, up and down</div>
                  </div>
                </div>
                <div className="row">
                  <button className="btn primary grow" onClick={() => void singScale()}>
                    Again
                  </button>
                  <button
                    className="btn"
                    onClick={() => (
                      updateSettings({
                        scaleKey: (s.scaleKey + 7) % 12,
                        scaleOctave: 0,
                      }),
                      setPhase('idle')
                    )}
                  >
                    Next key ({KEY_NAMES[(s.scaleKey + 7) % 12]})
                  </button>
                </div>
              </>
            )}
          </section>
        </MicGate>
      )}
    </main>
  );
}

function scaleOffsetsFor(type: ScaleType, i: number): number {
  return SCALE_TYPES.find((x) => x.id === type)!.up[i];
}
