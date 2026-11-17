import { useState } from 'react';
import { engine } from '../audio';
import { playNote } from '../audio/synth';
import { go } from '../lib/router';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { requestPersistence } from '../db/db';

// First run, about 30 seconds: turn sound on, check it's audible (silent
// switch), headphones or speaker, one voice-care tip, then the range finder.

type Step = 'welcome' | 'sound' | 'listen' | 'care' | 'range';
const ORDER: Step[] = ['welcome', 'sound', 'listen', 'care', 'range'];

function tone() {
  const a4 = getSettings().a4;
  const t = engine.now + 0.05;
  [48, 55, 60, 64].forEach((m) => playNote(engine, m, a4, { timbre: 'pad', duration: 1.6, when: t, velocity: 0.45 }));
}

export function Onboarding() {
  const s = useSettings();
  const [step, setStep] = useState<Step>('welcome');
  const [noSound, setNoSound] = useState(false);

  const finish = (toRange: boolean) => {
    updateSettings({ onboarded: true, healthTipShown: true });
    go(toRange ? '/range' : '/');
  };

  return (
    <main className="screen onboarding">
      <div className="dots" aria-label={`Step ${ORDER.indexOf(step) + 1} of ${ORDER.length}`}>
        {ORDER.map((x) => (
          <span key={x} className={x === step ? 'on' : ORDER.indexOf(x) < ORDER.indexOf(step) ? 'done' : ''} />
        ))}
      </div>

      {step === 'welcome' && (
        <section className="card ob">
          <h1>Pitch Trainer</h1>
          <ul className="ob-list">
            <li>Short, varied practice to sing in tune: 2 to 10 minutes a day.</li>
            <li>Instant feedback on every note.</li>
            <li>Everything stays on this phone. Nothing is uploaded.</li>
          </ul>
          <button
            className="btn-huge"
            onClick={async () => {
              await engine.start(); // inside the tap, as iOS requires
              void requestPersistence();
              tone();
              setStep('sound');
            }}
          >
            Let's go
          </button>
        </section>
      )}

      {step === 'sound' && (
        <section className="card ob">
          <h2>Can you hear the chord?</h2>
          {noSound && (
            <p className="hint">
              Check the <strong>silent switch</strong> on the side of the iPhone (orange showing means silent) and turn the volume up. Then play it again.
            </p>
          )}
          <div className="stack">
            <button className="btn primary big" onClick={() => setStep('listen')}>
              Yes
            </button>
            <button className="btn big" onClick={() => (setNoSound(true), tone())}>
              {noSound ? 'Play again' : 'No'}
            </button>
            {noSound && (
              <button className="btn ghost" onClick={() => setStep('listen')}>
                Continue anyway
              </button>
            )}
          </div>
        </section>
      )}

      {step === 'listen' && (
        <section className="card ob">
          <h2>How are you listening?</h2>
          <div className="stack">
            <button className="btn big" onClick={() => (updateSettings({ headphones: false }), setStep('care'))}>
              Phone speaker
            </button>
            <button className="btn big" onClick={() => (updateSettings({ headphones: true }), setStep('care'))}>
              Wired headphones
            </button>
            <button className="btn big" onClick={() => (updateSettings({ headphones: true }), setStep('care'))}>
              AirPods / Bluetooth
            </button>
          </div>
          <p className="muted small">The speaker works for everything: the app plays, then listens. You can change this in Settings. AirPods may sound worse while the mic is on.</p>
        </section>
      )}

      {step === 'care' && (
        <section className="card ob">
          <h2>Look after your voice</h2>
          <p className="hint">Stop if it hurts or you get hoarse. Singing should feel easy.</p>
          <label className="toggle">
            <input type="checkbox" checked={s.warmup} onChange={(e) => updateSettings({ warmup: e.target.checked })} />
            <span>Start singing sessions with a 60-second warm-up (lip trills or "oo" through a straw)</span>
          </label>
          <p className="muted small">After {s.voiceBreakMin || 20} minutes of singing in a day, the app suggests a break.</p>
          <button className="btn primary big" onClick={() => setStep('range')}>
            Next
          </button>
        </section>
      )}

      {step === 'range' && (
        <section className="card ob">
          <h2>Last step: your range</h2>
          <p>Glide from your lowest to your highest note, so every exercise fits your voice. About a minute.</p>
          <button className="btn-huge" onClick={() => finish(true)}>
            Find my range
          </button>
          <button className="btn ghost" onClick={() => finish(false)}>
            Later
          </button>
        </section>
      )}
    </main>
  );
}
