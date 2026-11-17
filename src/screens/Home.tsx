import { useEffect, useState } from 'react';
import { engine } from '../audio';
import { go } from '../lib/router';
import { updateSettings, useSettings } from '../lib/settings';
import { midiToName } from '../lib/notes';
import { streakNow, usePractice } from '../lib/practice';
import { weeklySummary, MODULE_LABEL, type WeeklySummary } from '../lib/weekly';
import { dateKey } from '../engine/dates';
import { repairText } from '../engine/streaks';
import { THEME_LABEL, themeFor } from '../engine/session';
import { resumeSession, startSession } from './Session';

const MINUTES = [2, 5, 10];

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

  useEffect(() => {
    void weeklySummary(practice.log).then(setWeek);
    // only on visit; the log ticks every few seconds while training
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <div className="theme-chip center-self">{THEME_LABEL[theme]}</div>
          <button className="btn-huge" onClick={() => void start(false)}>
            Start
            <span className="btn-sub">
              {s.sessionMinutes} min{s.silentMode ? ' · silent' : ''}
            </span>
          </button>
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
          {saved && left > 0 && (
            <button className="btn" onClick={() => void start(true)}>
              Continue today's session ({left} round{left === 1 ? '' : 's'} left)
            </button>
          )}
          {streak.repair && <p className="repair">{repairText(streak.repair, Date.now())}</p>}
          {streak.mode === 'daily' && !streak.todayDone && streak.current > 0 && !streak.repair && (
            <p className="muted small center">2 minutes today keeps your {streak.current}-day streak.</p>
          )}
        </>
      )}
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
        <button className="mode" onClick={() => go('/scales')}>
          <strong>Scales</strong>
          <span className="muted small">Every major and minor scale: play or sing</span>
        </button>
        <button className="mode" onClick={() => go('/ear')}>
          <strong>Ear training</strong>
          <span className="muted small">Silent drills, no singing</span>
        </button>
        <button className="mode" onClick={() => go('/drone')}>
          <strong>Drone</strong>
          <span className="muted small">Sustained notes, holds, intervals, slides</span>
        </button>
        <button className="mode" onClick={() => go('/progress')}>
          <strong>Progress</strong>
          <span className="muted small">Streak, calendar, weak spots</span>
        </button>
        <button className="mode" onClick={() => go('/range')}>
          <strong>Voice range</strong>
          <span className="muted small">{needsRange ? 'Not measured yet' : 'Re-test monthly'}</span>
        </button>
        <button className="mode" onClick={() => go('/settings')}>
          <strong>Settings</strong>
          <span className="muted small">Headphones, voice care, backup</span>
        </button>
      </nav>
      <footer className="muted small center">
        v{__APP_VERSION__} · {__BUILD_TIME__}
      </footer>
    </main>
  );
}
