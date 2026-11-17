import { useState, type ReactNode } from 'react';
import { engine } from '../audio';
import { useEngineStatus } from '../lib/useEngine';
import { requestPersistence } from '../db/db';

// iOS only lets an AudioContext start inside a tap. Screens that make sound
// render behind this gate. It also shows the "Tap to resume audio" overlay
// when iOS leaves audio dead after backgrounding.

export function AudioGate({ children }: { children: ReactNode }) {
  const status = useEngineStatus();
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    await engine.start();
    void requestPersistence();
    setBusy(false);
  };

  if (status === 'idle') {
    return (
      <div className="gate">
        <button className="btn-huge" onClick={start} disabled={busy}>
          {busy ? 'Starting…' : 'Tap to start'}
        </button>
        <p className="muted small">Turns on sound. Nothing is recorded or uploaded.</p>
      </div>
    );
  }

  return (
    <>
      {children}
      {(status === 'needs-tap' || status === 'interrupted' || status === 'suspended') && (
        <div className="overlay" role="dialog" aria-label="Resume audio">
          <button className="btn-huge" onClick={() => void engine.tapResume()}>
            Tap to resume audio
          </button>
          <p className="muted small">
            {status === 'interrupted' ? 'Audio was interrupted (call, Siri or lock screen).' : 'Audio paused while the app was in the background.'}
          </p>
        </div>
      )}
    </>
  );
}
