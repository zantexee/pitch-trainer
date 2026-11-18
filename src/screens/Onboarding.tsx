import { useState } from 'react';
import { engine } from '../audio';
import { playNote } from '../audio/synth';
import { go } from '../lib/router';
import { getSettings, updateSettings } from '../lib/settings';
import { requestPersistence } from '../db/db';

// First run, two screens: turn sound on, then check it's audible (silent
// switch) and pick speaker or headphones. The range finder is offered on Home.

type Step = 'welcome' | 'setup';
const ORDER: Step[] = ['welcome', 'setup'];

function tone() {
  const a4 = getSettings().a4;
  const t = engine.now + 0.05;
  [48, 55, 60, 64].forEach((m) => playNote(engine, m, a4, { timbre: 'pad', duration: 1.6, when: t, velocity: 0.45 }));
}

export function Onboarding() {
  const [step, setStep] = useState<Step>('welcome');
  const [noSound, setNoSound] = useState(false);

  // Practice can start straight away with a default range; Home offers the range finder.
  const finish = () => {
    updateSettings({ onboarded: true, healthTipShown: true });
    go('/');
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
              setStep('setup');
            }}
          >
            Let's go
          </button>
        </section>
      )}

      {step === 'setup' && (
        <section className="card ob">
          <h2>Hear the chord?</h2>
          {noSound && (
            <p className="hint">
              Check the <strong>silent switch</strong> on the side (orange showing means silent) and turn the volume up.
            </p>
          )}
          <button className="btn" onClick={() => (setNoSound(true), tone())}>
            🔊 {noSound ? 'Play again' : "No, play again"}
          </button>
          <h2>Then pick how you listen</h2>
          <div className="stack">
            <button className="btn primary big" onClick={() => (updateSettings({ headphones: false }), finish())}>
              Phone speaker
            </button>
            <button className="btn primary big" onClick={() => (updateSettings({ headphones: true }), finish())}>
              Headphones / AirPods
            </button>
          </div>
          <p className="muted small">Stop if singing ever hurts. You can change everything in Settings.</p>
        </section>
      )}
    </main>
  );
}
