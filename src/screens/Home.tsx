import { useEffect, useState } from 'react';
import { engine } from '../audio';
import { go } from '../lib/router';
import { updateSettings, useSettings } from '../lib/settings';
import { streakNow, usePractice } from '../lib/practice';
import { weeklySummary, MODULE_LABEL, type WeeklySummary } from '../lib/weekly';
import { dateKey } from '../engine/dates';
import { repairText } from '../engine/streaks';
import { THEME_LABEL, themeFor } from '../engine/session';
import { resumeSession, startSession } from './Session';

const MINUTES = [2, 5, 10];

// Three big doors on Home; everything else lives under "More".
const TILES = [
  { path: '/scales', icon: '🎼', label: 'Scales & Drone' },
  { path: '/ear', icon: '👂', label: 'Ear training' },
  { path: '/match', icon: '🎯', label: 'Pitch Match' },
];
const MORE = [
  { path: '/octave', label: 'Octave Jump', sub: 'Same note, another register' },
  { path: '/ladder', label: 'Scale Ladder', sub: 'Sing up and down the scale' },
  { path: '/drone', label: 'Drone', sub: 'Holds, intervals, slides' },
  { path: '/progress', label: 'Progress', sub: 'Streak, calendar, weak spots' },
  { path: '/range', label: 'Voice range', sub: 'Re-test monthly' },
];

export function Home() {
  const s = useSettings();
  const practice = usePractice();
  const [week, setWeek] = useState<WeeklySummary | null>(null);
  const needsRange = !s.range;
  const today = dateKey();
  const streak = streakNow(practice);
  const theme = themeFor(today);
  const saved = s.activeSession?.date === today ? s.activeSession : null;
  const left = saved ? saved.plan.rounds.length - saved.index : 0;
  const resumable = !!saved && left > 0;
  const [more, setMore] = useState(false);

  useEffect(() => {
    void weeklySummary(practice.log).then(setWeek);
    // only on visit; the log ticks every few seconds while training
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMore(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [more]);

  const start = async (resume: boolean) => {
    await engine.start(); // inside the tap: iOS needs this
    if (resume) resumeSession();
    else startSession(s.sessionMinutes, s.silentMode);
  };

  return (
    <main className="screen home">
      <header className="home-head">
        <div className="home-title">
          <h1>Pitch Trainer</h1>
          <span className="push" />
          {streak.current > 0 && (
            <button className="streak-pill big" onClick={() => go('/progress')} aria-label={`${streak.current} ${streak.mode === 'daily' ? 'day' : 'week'} streak`}>
              🔥 {streak.current}
            </button>
          )}
          <button className="btn ghost icon" onClick={() => go('/settings')} aria-label="Settings">
            ⚙︎
          </button>
        </div>
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
          <div className="theme-chip center-self">{THEME_LABEL[theme]}</div>
          {resumable ? (
            <button className="btn-huge" onClick={() => void start(true)}>
              Continue
              <span className="btn-sub">
                {left} round{left === 1 ? '' : 's'} left
              </span>
            </button>
          ) : (
            <button className="btn-huge" onClick={() => void start(false)}>
              Start
              <span className="btn-sub">
                {s.sessionMinutes} min{s.silentMode ? ' · silent' : ''}
              </span>
            </button>
          )}
          <div className="chips center-chips">
            {MINUTES.map((m) => (
              <button key={m} className={`chip ${s.sessionMinutes === m ? 'on' : ''}`} aria-pressed={s.sessionMinutes === m} onClick={() => updateSettings({ sessionMinutes: m })}>
                {m} min
              </button>
            ))}
            <button className={`chip ${s.silentMode ? 'on' : ''}`} aria-pressed={s.silentMode} onClick={() => updateSettings({ silentMode: !s.silentMode })} title="Ear drills only, no singing">
              🤫 Silent
            </button>
          </div>
          {resumable && (
            <button className="btn ghost" onClick={() => void start(false)}>
              Start a new {s.sessionMinutes} min session instead
            </button>
          )}
          {streak.repair && <p className="repair">{repairText(streak.repair, Date.now())}</p>}
          {streak.mode === 'daily' && !streak.todayDone && streak.current > 0 && !streak.repair && (
            <p className="muted small center">2 minutes today keeps your {streak.current}-day streak.</p>
          )}
        </>
      )}
      <nav className="tiles" aria-label="Practice">
        {TILES.map((t) => (
          <button key={t.path} className="tile" onClick={() => go(t.path)}>
            <span className="tile-icon" aria-hidden="true">
              {t.icon}
            </span>
            <strong>{t.label}</strong>
          </button>
        ))}
      </nav>
      <button className="btn ghost more-btn" onClick={() => setMore(true)} aria-haspopup="dialog">
        More exercises ›
      </button>
      {week && (week.thisWeek.minutes > 0 || week.lastWeek.minutes > 0) && (
        <button className="card week-card" onClick={() => go('/progress')}>
          <div className="week-row">
            <span>
              <strong>This week</strong>
            </span>
            <span className="muted small">Progress ›</span>
          </div>
          <div className="week-stats">
            <span>
              <strong>{week.thisWeek.days}</strong> day{week.thisWeek.days === 1 ? '' : 's'}
            </span>
            <span>
              <strong>{week.thisWeek.minutes}</strong> min
            </span>
            {week.thisWeek.pct != null && (
              <span>
                <strong>{week.thisWeek.pct}%</strong> right
                {week.lastWeek.pct != null && week.thisWeek.pct !== week.lastWeek.pct && (
                  <span className={week.thisWeek.pct > week.lastWeek.pct ? 'up' : 'down'}> {week.thisWeek.pct > week.lastWeek.pct ? '↑' : '↓'}{Math.abs(week.thisWeek.pct - week.lastWeek.pct)}</span>
                )}
              </span>
            )}
          </div>
          {week.improved && (
            <div className="muted small">
              Most improved: {MODULE_LABEL[week.improved.module] ?? week.improved.module} {week.improved.from}% → {week.improved.to}%
            </div>
          )}
        </button>
      )}
      {more && (
        <div className="sheet-backdrop" onClick={() => setMore(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="More exercises" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <strong>More</strong>
              <button className="btn ghost icon" onClick={() => setMore(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <nav className="sheet-list">
              {MORE.map((m) => (
                <button key={m.path} className="mode row-mode" onClick={() => go(m.path)}>
                  <strong>{m.label}</strong>
                  <span className="muted small">{m.path === '/range' && needsRange ? 'Not measured yet' : m.sub}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}
      <footer className="muted small center">
        v{__APP_VERSION__} · {__BUILD_TIME__}
      </footer>
    </main>
  );
}
