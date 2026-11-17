import { go } from '../lib/router';
import { useSettings } from '../lib/settings';
import { midiToName } from '../lib/notes';

export function Home() {
  const s = useSettings();
  const needsRange = !s.range;
  return (
    <main className="screen home">
      <header className="home-head">
        <h1>Pitch Trainer</h1>
        {s.range && (
          <p className="muted small">
            Chest {midiToName(s.range.chest.lo)}–{midiToName(s.range.chest.hi)} · Falsetto {midiToName(s.range.falsetto.lo)}–{midiToName(s.range.falsetto.hi)}
          </p>
        )}
      </header>
      {needsRange ? (
        <>
          <button className="btn-huge" onClick={() => go('/range')}>
            Find my range
          </button>
          <p className="muted small center">About a minute. Every exercise uses it.</p>
        </>
      ) : (
        <>
          <button className="btn-huge" onClick={() => go('/match')}>
            Start
          </button>
          <p className="muted small center">Starts Pitch Match for now. The mixed daily session arrives in M4.</p>
        </>
      )}
      <nav className="modes">
        <button className="mode" onClick={() => go('/match')}>
          <strong>Pitch Match</strong>
          <span className="muted small">Hear a note, sing it back</span>
        </button>
        <button className="mode" onClick={() => go('/octave')}>
          <strong>Octave Jump</strong>
          <span className="muted small">Same note, another register</span>
        </button>
        <button className="mode" onClick={() => go('/ladder')}>
          <strong>Scale Ladder</strong>
          <span className="muted small">Sing up and down the scale</span>
        </button>
        <button className="mode" onClick={() => go('/ear')}>
          <strong>Ear training</strong>
          <span className="muted small">Silent drills, no singing</span>
        </button>
        <button className="mode" onClick={() => go('/drone')}>
          <strong>Drone</strong>
          <span className="muted small">Sustained notes, holds, intervals, slides</span>
        </button>
        <button className="mode" onClick={() => go('/range')}>
          <strong>Voice range</strong>
          <span className="muted small">{needsRange ? 'Not measured yet' : 'Re-test monthly'}</span>
        </button>
        <button className="mode" onClick={() => go('/diagnostics')}>
          <strong>Diagnostics</strong>
          <span className="muted small">Sound lab and mic readout</span>
        </button>
      </nav>
      <footer className="muted small center">
        v{__APP_VERSION__} · {__BUILD_TIME__}
      </footer>
    </main>
  );
}
