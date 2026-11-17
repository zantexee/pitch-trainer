import { useEffect, useRef, useState } from 'react';
import { Mic } from '../audio/mic';
import { go } from '../lib/router';
import { updateSettings, useSettings } from '../lib/settings';
import { A4_MAX, A4_MIN } from '../lib/notes';
import { describeBackup, exportBackup, parseBackup, resetAll, restoreBackup, type Backup } from '../lib/backup';
import { requestPersistence } from '../db/db';

const MINUTES = [2, 5, 10];
const BREAKS = [0, 15, 20, 30];

export function Settings() {
  const s = useSettings();
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void Mic.listInputs().then(setInputs).catch(() => {});
    void requestPersistence().then(setPersisted);
  }, []);

  const labelled = inputs.some((d) => d.label);

  async function onExport() {
    setMsg(null);
    try {
      const r = await exportBackup();
      if (r !== 'cancelled') setMsg(r === 'shared' ? 'Backup ready. Pick "Save to Files" to keep it.' : 'Backup downloaded.');
    } catch (e) {
      setMsg(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setMsg(null);
    try {
      setPending(parseBackup(await f.text()));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function doRestore() {
    if (!pending) return;
    try {
      await restoreBackup(pending);
      location.reload();
    } catch (e) {
      setMsg(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function doReset() {
    await resetAll();
    location.hash = '#/';
    location.reload();
  }

  return (
    <main className="screen">
      <header className="bar">
        <button className="btn ghost" onClick={() => go('/')}>
          ‹ Home
        </button>
        <h2>Settings</h2>
      </header>

      <section className="card">
        <h3>Sound</h3>
        <label className="toggle">
          <input type="checkbox" checked={s.headphones} onChange={(e) => updateSettings({ headphones: e.target.checked })} />
          <span>I'm using headphones</span>
        </label>
        <p className="muted small">With headphones the mic listens while the drone plays. Wired headphones are the safest choice: AirPods can switch iPhone into low-quality call audio when the mic opens.</p>
        {inputs.length > 1 && (
          <label className="select">
            <span>Microphone</span>
            <select value={s.inputDeviceId ?? ''} onChange={(e) => updateSettings({ inputDeviceId: e.target.value || null })}>
              <option value="">Default</option>
              {inputs.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Input ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}
        {inputs.length > 1 && !labelled && <p className="muted small">Mic names show up after you've allowed the mic once (any singing screen).</p>}
        <label className="slider">
          <span>Tuning: A4 = {s.a4} Hz</span>
          <input type="range" min={A4_MIN} max={A4_MAX} step={1} value={s.a4} onChange={(e) => updateSettings({ a4: Number(e.target.value) })} aria-label="Tuning, A4 in hertz" />
        </label>
        <div className="row">
          <button className="btn" onClick={() => updateSettings({ a4: 440 })} disabled={s.a4 === 440}>
            Reset to 440
          </button>
          <button className="btn" onClick={() => (updateSettings({ noiseGate: null }), setMsg('Background noise will be measured next time the mic opens (stay quiet for 2 s).'))}>
            Re-measure background noise
          </button>
        </div>
        <p className="muted small">No sound? Check the silent switch on the side of the iPhone and the volume.</p>
      </section>

      <section className="card">
        <h3>Practice</h3>
        <div className="setting-row">
          <span>Session length</span>
          <div className="chips">
            {MINUTES.map((m) => (
              <button key={m} className={`chip ${s.sessionMinutes === m ? 'on' : ''}`} aria-pressed={s.sessionMinutes === m} onClick={() => updateSettings({ sessionMinutes: m })}>
                {m} min
              </button>
            ))}
          </div>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={s.silentMode} onChange={(e) => updateSettings({ silentMode: e.target.checked })} />
          <span>Silent sessions (ear drills only)</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={s.stretch} onChange={(e) => updateSettings({ stretch: e.target.checked })} />
          <span>Stretch: allow notes up to 2 semitones beyond my range</span>
        </label>
        <div className="setting-row">
          <span>Streak</span>
          <div className="chips">
            <button className={`chip ${s.streakMode === 'daily' ? 'on' : ''}`} aria-pressed={s.streakMode === 'daily'} onClick={() => updateSettings({ streakMode: 'daily' })}>
              Daily
            </button>
            {[3, 4, 5].map((g) => (
              <button key={g} className={`chip ${s.streakMode === 'weekly' && s.weeklyGoal === g ? 'on' : ''}`} aria-pressed={s.streakMode === 'weekly' && s.weeklyGoal === g} onClick={() => updateSettings({ streakMode: 'weekly', weeklyGoal: g })}>
                {g} days/week
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <span>Scale Ladder labels</span>
          <div className="chips">
            {(['names', 'degrees', 'solfege'] as const).map((m) => (
              <button key={m} className={`chip ${s.labelMode === m ? 'on' : ''}`} aria-pressed={s.labelMode === m} onClick={() => updateSettings({ labelMode: m })}>
                {m === 'names' ? 'C D E' : m === 'degrees' ? '1 2 3' : 'do re mi'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Voice care</h3>
        <label className="toggle">
          <input type="checkbox" checked={s.warmup} onChange={(e) => updateSettings({ warmup: e.target.checked })} />
          <span>60-second warm-up at the start of singing sessions</span>
        </label>
        <div className="setting-row">
          <span>"Voice break?" after</span>
          <div className="chips">
            {BREAKS.map((m) => (
              <button key={m} className={`chip ${s.voiceBreakMin === m ? 'on' : ''}`} aria-pressed={s.voiceBreakMin === m} onClick={() => updateSettings({ voiceBreakMin: m })}>
                {m === 0 ? 'Off' : `${m} min`}
              </button>
            ))}
          </div>
        </div>
        <p className="muted small">Minutes of singing in a day. Stop if it hurts or you get hoarse.</p>
      </section>

      <section className="card">
        <h3>Your data</h3>
        <p className="muted small">
          Everything stays on this phone. Nothing is uploaded.
          {persisted === true && ' Storage is marked persistent.'}
          {persisted === false && ' The browser may clear it if space runs low, so keep a backup. Adding the app to your Home Screen helps.'}
        </p>
        <div className="row">
          <button className="btn primary grow" onClick={() => void onExport()}>
            Export backup
          </button>
          <button className="btn grow" onClick={() => fileRef.current?.click()}>
            Import backup
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        {pending && (
          <div className="confirm" role="alertdialog" aria-label="Replace data">
            <p>
              Replace everything on this phone with this backup?
              <br />
              <span className="muted small">{describeBackup(pending)}</span>
            </p>
            <div className="row">
              <button className="btn primary grow" onClick={() => void doRestore()}>
                Replace
              </button>
              <button className="btn" onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {!confirmReset ? (
          <button className="btn ghost danger" onClick={() => setConfirmReset(true)}>
            Erase all data…
          </button>
        ) : (
          <div className="confirm" role="alertdialog" aria-label="Erase all data">
            <p>Erase your range, history, streak and settings? This can't be undone. Export a backup first if you might want it.</p>
            <div className="row">
              <button className="btn danger grow" onClick={() => void doReset()}>
                Erase everything
              </button>
              <button className="btn" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {msg && (
          <p className="muted small" role="status">
            {msg}
          </p>
        )}
      </section>

      <section className="card">
        <h3>More</h3>
        <div className="row">
          <button className="btn" onClick={() => go('/diagnostics')}>
            Diagnostics
          </button>
          <button className="btn" onClick={() => (updateSettings({ onboarded: false }), go('/welcome'))}>
            Replay intro
          </button>
        </div>
        <p className="muted small">
          Version {__APP_VERSION__} · built {__BUILD_TIME__}
        </p>
      </section>
    </main>
  );
}
