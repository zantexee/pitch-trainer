import type { AttemptLive } from '../pitch/attempt';

// Big direction readout: a horizontal meter (flat ← → sharp) with the
// tolerance zone in the middle, plus an arrow word. Direction is shown by
// position and by the arrow, not only by colour.

interface Props {
  state: AttemptLive | null;
  toleranceCents: number;
  holdMs: number;
  hidden?: boolean;
}

export function CentsNeedle({ state, toleranceCents, holdMs, hidden }: Props) {
  if (hidden) {
    return (
      <div className="needle">
        <div className="needle-word muted">Ears only. The result comes after.</div>
      </div>
    );
  }
  const range = toleranceCents * 3;
  const c = state?.cents ?? null;
  const octaveOff = state?.folded && state.folded.octave !== 0 && Math.abs(state.folded.pcCents) <= 2 * toleranceCents;
  // Position uses the pitch-class error when the octave is off, so the dot shows how close the note is.
  const shown = c == null ? null : octaveOff ? state!.folded!.pcCents : c;
  const pos = shown == null ? 50 : 50 + (Math.max(-range, Math.min(range, shown)) / range) * 50;
  const zoneW = (toleranceCents / range) * 50;

  let word = 'Sing';
  let cls = 'idle';
  if (state?.locked) {
    word = '✓ locked';
    cls = 'in';
  } else if (octaveOff) {
    word = state!.folded!.octave < 0 ? `Right note, ${state!.folded!.octave === -1 ? 'one octave' : `${-state!.folded!.octave} octaves`} low` : `Right note, ${state!.folded!.octave === 1 ? 'one octave' : `${state!.folded!.octave} octaves`} high`;
    cls = 'close';
  } else if (c != null) {
    if (state!.zone === 'in') {
      word = '● hold it';
      cls = 'in';
    } else {
      word = c < 0 ? '↑ higher' : '↓ lower';
      cls = state!.zone === 'close' ? 'close' : 'off';
    }
  }
  const progress = state && !state.locked ? Math.min(1, state.inTolMs / holdMs) : state?.locked ? 1 : 0;

  return (
    <div className={`needle ${cls}`}>
      <div className="needle-meter" aria-hidden="true">
        <div className="needle-zone2" style={{ left: `${50 - 2 * zoneW}%`, width: `${4 * zoneW}%` }} />
        <div className="needle-zone" style={{ left: `${50 - zoneW}%`, width: `${2 * zoneW}%` }} />
        <div className="needle-center" />
        {shown != null && <div className="needle-dot" style={{ left: `${pos}%` }} />}
        <span className="needle-end left">flat</span>
        <span className="needle-end right">sharp</span>
      </div>
      <div className={`needle-word ${state?.justLocked || state?.locked ? 'pop' : ''}`} aria-live="polite">
        {word}
        {c != null && !state?.locked && <span className="needle-cents">{fmtCents(octaveOff ? state!.folded!.pcCents : c)}</span>}
      </div>
      <div className="hold-bar" aria-label="Hold progress">
        <div style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}

function fmtCents(x: number): string {
  const r = Math.round(x);
  return ` ${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r)}¢`;
}
