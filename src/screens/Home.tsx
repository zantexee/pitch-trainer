import { go } from '../lib/router';

export function Home() {
  return (
    <main className="screen home">
      <header className="home-head">
        <h1>Pitch Trainer</h1>
        <p className="muted">Milestone 0 · audio foundation</p>
      </header>
      <button className="btn-huge" disabled aria-disabled="true">
        Start
      </button>
      <p className="muted small center">One-tap daily practice arrives in M4.</p>
      <nav className="stack">
        <button className="btn" onClick={() => go('/diagnostics')}>
          Diagnostics &amp; sound lab
        </button>
      </nav>
      <footer className="muted small center">v{__APP_VERSION__} · {__BUILD_TIME__}</footer>
    </main>
  );
}
