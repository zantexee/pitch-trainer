import { useEffect, useRef, useState } from 'react';
import { engine, mic, drone, live } from '../audio';
import { Mic, REQUESTED_CONSTRAINTS, type MicInfo } from '../audio/mic';
import { playChime, playNote, TIMBRES, LOW_NOTE_MIDI, type Timbre } from '../audio/synth';
import type { DroneMode } from '../audio/drone';
import { calibrateNoiseGate, rms, DEFAULT_DETECTOR_SETTINGS } from '../pitch/detector';
import { foldError, midiToName, nearestNote, noteToFreq, A4_MIN, A4_MAX } from '../lib/notes';
import { go } from '../lib/router';
import { updateSettings, useSettings } from '../lib/settings';
import { useEngineTick } from '../lib/useEngine';
import { keepAwake, wakeLockActive, wakeLockSupported } from '../lib/wakeLock';
import { PitchTrace } from '../ui/PitchTrace';
import type { LiveFrame } from '../pitch/live';

const fmt = (n: number | null | undefined, d = 1) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(d));
const signed = (n: number, d = 0) => {
  const r = Number(n.toFixed(d));
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toFixed(d)}`;
};

type WindowChoice = 'auto' | '2048' | '4096';

export function Diagnostics() {
  useEngineTick();
  const s = useSettings();
  const [midi, setMidi] = useState(60);
  const [droneOn, setDroneOn] = useState(false);
  const [micInfo, setMicInfo] = useState<MicInfo | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [calibrating, setCalibrating] = useState(false);
  const [useTarget, setUseTarget] = useState(false);
  const [win, setWin] = useState<WindowChoice>('auto');
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<string>('…');
  const latest = useRef<LiveFrame | null>(null);

  const targetHz = noteToFreq(midi, s.a4);

  // Push settings into the detector.
  useEffect(() => {
    live.detector.settings.noiseGate = s.noiseGate ?? DEFAULT_DETECTOR_SETTINGS.noiseGate;
    live.ignoreWhileSounding = !s.headphones;
  }, [s.noiseGate, s.headphones]);

  useEffect(() => {
    live.target = useTarget ? targetHz : null;
  }, [useTarget, targetHz]);

  useEffect(() => {
    live.windowOverride = win === 'auto' ? null : (Number(win) as 2048 | 4096);
  }, [win]);

  // Live readout, throttled to ~15 fps for React (the trace canvas runs at full rate).
  useEffect(() => {
    const unsub = live.subscribe((f) => (latest.current = f));
    const id = setInterval(() => setFrame(latest.current), 66);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    navigator.storage?.persisted?.().then((p) => setPersisted(p ? 'yes' : 'no'), () => setPersisted('unknown'));
  }, []);

  // Restart the drone when its parameters change.
  useEffect(() => {
    if (!droneOn) return;
    drone.start(midi, { timbre: s.timbre, mode: s.droneMode, volume: s.droneVolume, a4: s.a4, headphones: s.headphones });
    maybeLowTip(midi);
    // volume is handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droneOn, midi, s.timbre, s.droneMode, s.a4, s.headphones]);

  useEffect(() => {
    drone.setVolume(s.droneVolume);
  }, [s.droneVolume]);

  useEffect(() => () => drone.stop(), []);

  function maybeLowTip(m: number) {
    if (m < LOW_NOTE_MIDI && !s.lowNoteTipShown) {
      setTip('Low notes sound best with headphones. A phone speaker can barely play them.');
      updateSettings({ lowNoteTipShown: true });
    }
  }

  const play = () => {
    const v = playNote(engine, midi, s.a4, { timbre: s.timbre, duration: 1.2 });
    maybeLowTip(midi);
    if (v.swapped) setTip(`Low note: switched to a brighter sound so the pitch is audible.`);
  };

  const startMic = async () => {
    setMicError(null);
    try {
      const info = await mic.start(s.inputDeviceId ?? undefined);
      setMicInfo(info);
      setInputs(await Mic.listInputs());
      live.start();
      void keepAwake(true);
      if (s.noiseGate == null) void calibrate();
    } catch (e) {
      setMicError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  };

  const stopMic = () => {
    live.stop();
    mic.stop();
    setMicInfo(null);
    void keepAwake(false);
  };

  const calibrate = async () => {
    setCalibrating(true);
    const levels: number[] = [];
    const t0 = performance.now();
    await new Promise<void>((res) => {
      const id = setInterval(() => {
        const buf = mic.read();
        if (buf) levels.push(rms(buf, buf.length - 2048));
        if (performance.now() - t0 > 2000) {
          clearInterval(id);
          res();
        }
      }, 25);
    });
    const gate = calibrateNoiseGate(levels);
    updateSettings({ noiseGate: gate });
    setCalibrating(false);
  };

  const pickInput = async (id: string) => {
    updateSettings({ inputDeviceId: id || null });
    if (mic.active) {
      try {
        setMicInfo(await mic.start(id || undefined));
      } catch (e) {
        setMicError(String(e));
      }
    }
  };

  const f = frame;
  const smoothHz = f?.out.freq ?? null;
  const near = smoothHz ? nearestNote(smoothHz, s.a4) : null;
  const vsTarget = smoothHz ? foldError(smoothHz, targetHz) : null;
  const ctx = engine.ctx;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return (
    <main className="screen diag">
      <header className="bar">
        <button className="btn ghost" onClick={() => go('/')} aria-label="Back">
          ‹ Home
        </button>
        <h2>Diagnostics</h2>
      </header>

      {tip && (
        <div className="tip" role="status">
          <span>{tip}</span>
          <button className="btn ghost small" onClick={() => setTip(null)} aria-label="Dismiss tip">
            ✕
          </button>
        </div>
      )}

      {/* ---------- Sound ---------- */}
      <section className="card">
        <h3>Sound</h3>
        <div className="note-picker" aria-label="Note">
          <button className="btn" onClick={() => setMidi((m) => Math.max(33, m - 12))}>
            −8va
          </button>
          <button className="btn" onClick={() => setMidi((m) => Math.max(33, m - 1))}>
            −
          </button>
          <div className="note-name">
            <strong>{midiToName(midi)}</strong>
            <span className="muted small">{targetHz.toFixed(2)} Hz</span>
          </div>
          <button className="btn" onClick={() => setMidi((m) => Math.min(96, m + 1))}>
            +
          </button>
          <button className="btn" onClick={() => setMidi((m) => Math.min(96, m + 12))}>
            +8va
          </button>
        </div>

        <div className="chips" role="radiogroup" aria-label="Timbre">
          {TIMBRES.map((t) => (
            <button key={t.id} role="radio" aria-checked={s.timbre === t.id} className={`chip ${s.timbre === t.id ? 'on' : ''}`} onClick={() => updateSettings({ timbre: t.id as Timbre })}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="row">
          <button className="btn primary" onClick={play}>
            ▶ Play 1.2 s
          </button>
          <button className={`btn ${droneOn ? 'on' : ''}`} aria-pressed={droneOn} onClick={() => (droneOn ? (drone.stop(), setDroneOn(false)) : setDroneOn(true))}>
            {droneOn ? '■ Stop drone' : '∞ Drone'}
          </button>
          <button className="btn" onClick={() => playChime(engine)}>
            ♪ Chime
          </button>
        </div>

        <div className="chips" role="radiogroup" aria-label="Drone voicing">
          {(['root', 'fifth', 'octave'] as DroneMode[]).map((m) => (
            <button key={m} role="radio" aria-checked={s.droneMode === m} className={`chip ${s.droneMode === m ? 'on' : ''}`} onClick={() => updateSettings({ droneMode: m })}>
              {m === 'root' ? 'Root' : m === 'fifth' ? 'Root + 5th' : 'Root + octave'}
            </button>
          ))}
        </div>

        <label className="slider">
          <span>Drone volume</span>
          <input type="range" min={0} max={1} step={0.01} value={s.droneVolume} onChange={(e) => updateSettings({ droneVolume: Number(e.target.value) })} />
        </label>
        <label className="slider">
          <span>A4 = {s.a4} Hz</span>
          <input type="range" min={A4_MIN} max={A4_MAX} step={1} value={s.a4} onChange={(e) => updateSettings({ a4: Number(e.target.value) })} />
        </label>
        <p className="muted small">Hear nothing? Turn the silent switch off and the volume up. Low notes (below E3) need headphones.</p>
      </section>

      {/* ---------- Mic ---------- */}
      <section className="card">
        <h3>Microphone</h3>
        <div className="row">
          {micInfo ? (
            <button className="btn on" onClick={stopMic}>
              ■ Stop mic
            </button>
          ) : (
            <button className="btn primary" onClick={startMic}>
              🎤 Start mic
            </button>
          )}
          <button className="btn" onClick={calibrate} disabled={!micInfo || calibrating}>
            {calibrating ? 'Stay quiet… 2 s' : 'Calibrate silence'}
          </button>
        </div>
        {micError && <p className="warn small">Mic error: {micError}</p>}

        <label className="toggle">
          <input type="checkbox" checked={s.headphones} onChange={(e) => updateSettings({ headphones: e.target.checked })} />
          <span>I'm using headphones (keep listening while the app plays)</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={useTarget} onChange={(e) => setUseTarget(e.target.checked)} />
          <span>Use {midiToName(midi)} as the target</span>
        </label>

        {inputs.length > 1 && (
          <label className="select">
            <span>Input</span>
            <select value={s.inputDeviceId ?? ''} onChange={(e) => void pickInput(e.target.value)}>
              <option value="">Default</option>
              {inputs.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Input ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="readout" aria-live="off">
          <div className="big-note">
            {f?.ignored ? <span className="muted">app sounding…</span> : near ? near.name : f?.unreadable ? <span className="muted small">Can't read this sound. Try a steadier tone.</span> : '—'}
          </div>
          <div className="big-cents">{near ? `${signed(near.cents)}¢` : ''}</div>
          {useTarget && vsTarget && (
            <div className="vs-target">
              vs {midiToName(midi)}: {vsTarget.octave !== 0 ? `${signed(vsTarget.octave)} oct, ` : ''}
              {signed(vsTarget.pcCents)}¢
            </div>
          )}
        </div>

        <PitchTrace a4={s.a4} targetHz={useTarget ? targetHz : null} toleranceCents={25} />

        <dl className="kv">
          <dt>Pitch (smoothed)</dt>
          <dd>{fmt(smoothHz, 2)} Hz</dd>
          <dt>Pitch (raw frame)</dt>
          <dd>
            {fmt(f?.frame?.rawFreq || null, 2)} Hz {f?.frame?.reject ? <span className="muted">({f.frame.reject})</span> : null}
          </dd>
          <dt>Clarity</dt>
          <dd>{fmt(f?.frame?.clarity, 3)}</dd>
          <dt>RMS</dt>
          <dd>
            {fmt(f?.frame?.rms, 4)} ({f?.frame?.rms ? `${(20 * Math.log10(f.frame.rms)).toFixed(1)} dBFS` : '—'})
          </dd>
          <dt>Noise gate</dt>
          <dd>{s.noiseGate != null ? `${s.noiseGate.toFixed(4)} (calibrated)` : `${DEFAULT_DETECTOR_SETTINGS.noiseGate} (default)`}</dd>
          <dt>Window</dt>
          <dd>
            <select value={win} onChange={(e) => setWin(e.target.value as WindowChoice)} aria-label="Analysis window">
              <option value="auto">auto</option>
              <option value="2048">2048</option>
              <option value="4096">4096</option>
            </select>{' '}
            using {f?.frame?.windowSize ?? '—'}
          </dd>
          <dt>Octave jump pending</dt>
          <dd>{f?.out.octavePending ? 'yes' : 'no'}</dd>
          <dt>Input device</dt>
          <dd>{micInfo?.label ?? '—'}</dd>
        </dl>

        <h4>Mic constraints</h4>
        <table className="constraints">
          <thead>
            <tr>
              <th>Constraint</th>
              <th>Asked</th>
              <th>Applied</th>
            </tr>
          </thead>
          <tbody>
            {(['echoCancellation', 'noiseSuppression', 'autoGainControl', 'channelCount', 'sampleRate', 'sampleSize', 'latency'] as const).map((k) => {
              const asked = k in REQUESTED_CONSTRAINTS ? String(REQUESTED_CONSTRAINTS[k as keyof typeof REQUESTED_CONSTRAINTS]) : k === 'channelCount' ? '1' : '—';
              const got = micInfo ? (micInfo.settings as Record<string, unknown>)[k] : undefined;
              const mismatch = micInfo && asked !== '—' && got !== undefined && String(got) !== asked;
              return (
                <tr key={k} className={mismatch ? 'mismatch' : ''}>
                  <td>{k}</td>
                  <td>{asked}</td>
                  <td>{micInfo ? (got === undefined ? 'not reported' : String(got)) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ---------- System ---------- */}
      <section className="card">
        <h3>Audio system</h3>
        <dl className="kv">
          <dt>Context state</dt>
          <dd>
            {ctx?.state ?? '—'} <span className="muted">({engine.status})</span>
          </dd>
          <dt>Sample rate</dt>
          <dd>{ctx ? `${ctx.sampleRate} Hz` : '—'}</dd>
          <dt>Latency (base / output)</dt>
          <dd>
            {fmt(ctx ? ctx.baseLatency * 1000 : null, 1)} / {fmt(ctx && 'outputLatency' in ctx ? ctx.outputLatency * 1000 : null, 1)} ms
          </dd>
          <dt>audioSession type</dt>
          <dd>{engine.sessionType}</dd>
          <dt>Context recreated</dt>
          <dd>{engine.recreations}×</dd>
          <dt>Wake lock</dt>
          <dd>{wakeLockSupported() ? (wakeLockActive() ? 'on' : 'off') : 'not supported'}</dd>
          <dt>Persistent storage</dt>
          <dd>{persisted}</dd>
          <dt>Home-screen app</dt>
          <dd>{standalone ? 'yes' : 'no (browser tab)'}</dd>
          <dt>Last audio error</dt>
          <dd>{engine.lastError ?? 'none'}</dd>
        </dl>
        <div className="row">
          <button className="btn" onClick={() => void engine.recreate()}>
            Recreate audio context
          </button>
        </div>
        <p className="muted small break">{navigator.userAgent}</p>
      </section>
    </main>
  );
}
