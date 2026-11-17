import { go } from '../../lib/router';
import { useSettings } from '../../lib/settings';
import { localDateKey } from '../../engine/ear';

export function EarHub() {
  const s = useSettings();
  const nd = s.noteOfDay?.date === localDateKey() ? s.noteOfDay : null;
  const notdState = !nd?.memorisedAt ? 'Hear today’s note' : !nd.result ? 'Sing it from memory' : 'Done for today';
  return (
    <main className="screen">
      <header className="bar">
        <button className="btn ghost" onClick={() => go('/')}>
          ‹ Home
        </button>
        <h2>Ear training</h2>
      </header>
      <p className="muted small">Listening only, no singing. Works on a bus or in bed (with headphones).</p>
      <nav className="modes one">
        <button className="mode" onClick={() => go('/ear/degrees')}>
          <strong>Scale degrees</strong>
          <span className="muted small">Hear a note in a key, name its degree</span>
        </button>
        <button className="mode" onClick={() => go('/ear/higher-lower')}>
          <strong>Higher or lower?</strong>
          <span className="muted small">Find your pitch-difference threshold</span>
        </button>
        <button className="mode" onClick={() => go('/ear/intervals')}>
          <strong>Intervals</strong>
          <span className="muted small">Name the distance between two notes</span>
        </button>
        <button className="mode" onClick={() => go('/ear/octave')}>
          <strong>Which octave?</strong>
          <span className="muted small">Same note or not, C3 or C4</span>
        </button>
        <button className="mode" onClick={() => go('/ear/note-of-day')}>
          <strong>
            Note of the day <span className="badge">experimental</span>
          </strong>
          <span className="muted small">{notdState}</span>
        </button>
      </nav>
    </main>
  );
}
