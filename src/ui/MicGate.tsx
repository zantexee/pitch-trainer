import type { ReactNode } from 'react';
import type { MicStatus } from '../modules/useSingingMic';

export function MicGate({ status, error, children }: { status: MicStatus; error: string | null; children: ReactNode }) {
  if (status === 'ready') return <>{children}</>;
  return (
    <div className="card center">
      {status === 'starting' && <p>Opening the mic…</p>}
      {status === 'calibrating' && (
        <>
          <p>
            <strong>Stay quiet for 2 seconds</strong>
          </p>
          <p className="muted small">Measuring the room's background noise. This only happens once.</p>
        </>
      )}
      {status === 'error' && (
        <>
          <p className="warn">The mic didn't start.</p>
          <p className="muted small">{error}</p>
          <p className="muted small">Check Settings → Safari → Microphone, then reopen this screen.</p>
        </>
      )}
    </div>
  );
}
