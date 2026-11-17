import { Component, type ReactNode } from 'react';

// A crash in one screen shouldn't leave a blank page.

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="screen">
        <section className="card">
          <h2>Something went wrong</h2>
          <p className="muted">Your progress is saved. Go back home and try again.</p>
          <pre className="err">{String(this.state.error.message || this.state.error)}</pre>
          <div className="row">
            <button className="btn primary grow" onClick={() => (location.hash = '#/')}>
              Home
            </button>
            <button className="btn" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </section>
      </main>
    );
  }
}
