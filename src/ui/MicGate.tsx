import { useEffect, useState, type ReactNode } from 'react';
import type { MicStatus } from '../modules/useSingingMic';

const CALIBRATE_S = 2;

// While the mic measures room noise: a ring that fills over 2 s with a
// countdown number, so "stay quiet" has a visible end. With reduced motion
// the ring is static and only the number changes.
function QuietCountdown() {
  const [left, setLeft] = useState(CALIBRATE_S);
  useEffect(() => {
    const id = setInterval(() => setLeft((n) => Math.max(1, n - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="quiet-ring" role="timer" aria-label={`Stay quiet, ${left} second${left === 1 ? '' : 's'}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="44" className="track" />
        <circle cx="50" cy="50" r="44" className="fill" style={{ animationDuration: `${CALIBRATE_S}s` }} />
      </svg>
      <span aria-hidden="true">{left}</span>
    </div>
  );
}

export function MicGate({ status, error, children }: { status: MicStatus; error: string | null; children: ReactNode }) {
  if (status === 'ready') return <>{children}</>;
  return (
    <div className="card center">
      {status === 'starting' && <p>Opening the mic…</p>}
      {status === 'calibrating' && (
        <>
          <QuietCountdown />
          <p>
            <strong>Stay quiet</strong>
          </p>
          <p className="muted small">Measuring background noise. Only happens once.</p>
        </>
      )}
      {status === 'error' && (
        <>
          <p>
            <strong>The mic is off</strong>
          </p>
          <ol className="fix-steps">
            <li>Open the iPhone Settings app</li>
            <li>Apps → Safari → Microphone</li>
            <li>Choose Allow (or Ask), then come back</li>
          </ol>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Try again
          </button>
          {error && <p className="muted small">{error}</p>}
        </>
      )}
    </div>
  );
}
