import { useEffect, useState } from 'react';
import { go } from '../lib/router';
import { updateSettings, useSettings } from '../lib/settings';
import { midiToName } from '../lib/notes';
import { DEFAULT_RANGE, notesInRange, REGISTER_LABEL, REGISTERS, type Register } from '../lib/range';
import { streakNow, usePractice } from '../lib/practice';
import { MODULE_LABEL, weeklySummary, type WeeklySummary } from '../lib/weekly';
import { db, loadList, loadRangeHistory, type Attempt, type RangeRecord } from '../db/db';
import { addDays, dateKey, startOfDayMs, weekStart } from '../engine/dates';
import { MIN_SECONDS, repairText } from '../engine/streaks';
import { DEGREE_NAMES, DEGREE_ORDER, INTERVAL_NAMES } from '../engine/ear';
import { ThresholdChart, type Point } from './ear/HigherLower';
import { RangeHistory } from './RangeFinder';

// Everything you've done, at a glance. All computed locally.

const WEEKS = 16;

export function Progress() {
  const s = useSettings();
  const practice = usePractice();
  const streak = streakNow(practice);
  const [week, setWeek] = useState<WeeklySummary | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [hl, setHl] = useState<Point[]>([]);
  const [ranges, setRanges] = useState<RangeRecord[]>([]);

  useEffect(() => {
    void weeklySummary(practice.log).then(setWeek);
    void db.attempts
      .where('ts')
      .aboveOrEqual(Date.now() - 120 * 86400e3)
      .toArray()
      .then(setAttempts)
      .catch(() => {});
    void loadList<Point>('hlHistory').then(setHl);
    void loadRangeHistory().then(setRanges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="screen">
      <header className="bar">
        <button className="btn ghost" onClick={() => go('/')}>
          ‹ Home
        </button>
        <h2>Progress</h2>
      </header>

      <section className="card">
        <div className="streak-big">
          <div>
            <div className="streak-num">🔥 {streak.current}</div>
            <div className="muted small">{streak.mode === 'daily' ? 'day streak' : `week streak (${streak.weeklyGoal} days a week)`}</div>
          </div>
          <dl className="kv compact">
            <div className="kv-row">
              <dt>Best</dt>
              <dd>{streak.best}</dd>
            </div>
            <div className="kv-row">
              <dt>Freezes</dt>
              <dd>{streak.mode === 'daily' ? `${'❄'.repeat(streak.freezes) || '0'}` : '—'}</dd>
            </div>
            <div className="kv-row">
              <dt>Practice days</dt>
              <dd>{streak.totalDays}</dd>
            </div>
          </dl>
        </div>
        {streak.repair && <p className="repair">{repairText(streak.repair, Date.now())}</p>}
        {streak.mode === 'weekly' && (
          <p className="muted small">
            This week: {streak.weekDays} of {streak.weeklyGoal} days
          </p>
        )}
        <p className="muted small">A day counts at 2 minutes. You earn a freeze every 5 practice days (up to 2); it covers a missed day automatically.</p>
        <div className="chips">
          <button className={`chip ${s.streakMode === 'daily' ? 'on' : ''}`} onClick={() => updateSettings({ streakMode: 'daily' })}>
            Daily
          </button>
          <button className={`chip ${s.streakMode === 'weekly' ? 'on' : ''}`} onClick={() => updateSettings({ streakMode: 'weekly' })}>
            Weekly goal
          </button>
          {s.streakMode === 'weekly' &&
            [3, 4, 5].map((g) => (
              <button key={g} className={`chip ${s.weeklyGoal === g ? 'on' : ''}`} onClick={() => updateSettings({ weeklyGoal: g })}>
                {g} days
              </button>
            ))}
        </div>
      </section>

      <Calendar log={practice.log} frozen={streak.frozenDays} repaired={streak.repairedDays} />

      {week && <WeekCard week={week} />}

      <NoteHeatmap attempts={attempts} />
      <StatGrid title="Scale degrees" order={DEGREE_ORDER.slice().sort((a, b) => a - b).map((d) => DEGREE_NAMES[d])} stats={s.degreeStats} />
      <StatGrid title="Intervals" order={Object.values(INTERVAL_NAMES).filter((n) => s.intervalStats[n])} stats={s.intervalStats} />
      <OctavePairs stats={s.octaveStats} />
      {hl.length > 1 && <ThresholdChart points={hl} />}
      <SettleTrend attempts={attempts} />
      <Bests bests={s.bests} />
      {ranges.length > 0 && <RangeHistory history={ranges} />}
    </main>
  );
}

function Calendar({ log, frozen, repaired }: { log: Record<string, number>; frozen: string[]; repaired: string[] }) {
  const today = dateKey();
  const first = addDays(weekStart(today), -7 * (WEEKS - 1));
  const cols = Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));
  const level = (secs: number) => (secs <= 0 ? 0 : secs < MIN_SECONDS ? 1 : secs < 300 ? 2 : secs < 600 ? 3 : 4);
  const total = Object.values(log).reduce((a, b) => a + b, 0);
  return (
    <section className="card">
      <h3>Calendar</h3>
      <div className="cal" role="img" aria-label="Practice calendar, last 16 weeks">
        <div className="cal-days muted">
          {['M', '', 'W', '', 'F', '', 'S'].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        {cols.map((col, w) => (
          <div key={w} className="cal-col">
            {col.map((k) => {
              const secs = log[k] ?? 0;
              const cls = k > today ? 'future' : frozen.includes(k) ? 'frozen' : repaired.includes(k) ? 'repaired' : `l${level(secs)}`;
              return <span key={k} className={`cal-cell ${cls} ${k === today ? 'today' : ''}`} title={`${k}: ${Math.round(secs / 60)} min`} />;
            })}
          </div>
        ))}
      </div>
      <div className="cal-legend muted small">
        <span className="cal-cell l1" /> &lt;2 min <span className="cal-cell l2" /> 2+ <span className="cal-cell l4" /> 10+ <span className="cal-cell frozen" /> freeze
        <span className="push">{Math.round(total / 60)} min total</span>
      </div>
    </section>
  );
}

function WeekCard({ week }: { week: WeeklySummary }) {
  const row = (label: string, a: string | number, b: string | number) => (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd>
        {a} <span className="muted small">(last week {b})</span>
      </dd>
    </div>
  );
  return (
    <section className="card">
      <h3>This week</h3>
      <dl className="kv">
        {row('Days', week.thisWeek.days, week.lastWeek.days)}
        {row('Minutes', week.thisWeek.minutes, week.lastWeek.minutes)}
        {row('Attempts', week.thisWeek.attempts, week.lastWeek.attempts)}
        {row('Right', week.thisWeek.pct != null ? `${week.thisWeek.pct}%` : '—', week.lastWeek.pct != null ? `${week.lastWeek.pct}%` : '—')}
      </dl>
      {week.improved && (
        <p className="muted small">
          Most improved: {MODULE_LABEL[week.improved.module] ?? week.improved.module}, {week.improved.from}% → {week.improved.to}%
        </p>
      )}
    </section>
  );
}

const rateClass = (p: number) => (p >= 0.8 ? 'good' : p >= 0.6 ? 'mid' : 'low');

function NoteHeatmap({ attempts }: { attempts: Attempt[] }) {
  const s = useSettings();
  const range = s.range ?? DEFAULT_RANGE;
  const notes = notesInRange(range, ['chest', 'falsetto'], false);
  const by: Record<string, { n: number; ok: number }> = {};
  for (const a of attempts) {
    if (a.module !== 'pitch-match') continue;
    const x = (by[a.target] ??= { n: 0, ok: 0 });
    x.n++;
    if (a.result === 'success') x.ok++;
  }
  if (!Object.keys(by).length) return null;
  const weakest = Object.entries(by)
    .filter(([, v]) => v.n >= 3)
    .sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n)
    .slice(0, 3);
  return (
    <section className="card">
      <h3>Pitch Match by note</h3>
      <div className="note-grid">
        {notes.map((m) => {
          const name = midiToName(m);
          const v = by[name];
          return (
            <div key={m} className={`note-cell ${v ? rateClass(v.ok / v.n) : 'none'} ${name.includes('#') ? 'sharp' : ''}`} title={v ? `${name}: ${v.ok}/${v.n}` : `${name}: no tries yet`}>
              <span>{name}</span>
              {v && <small>{Math.round((100 * v.ok) / v.n)}%</small>}
            </div>
          );
        })}
      </div>
      {weakest.length > 0 && <p className="muted small">Weakest: {weakest.map(([k, v]) => `${k} (${v.ok}/${v.n})`).join(', ')}. These come up more often.</p>}
    </section>
  );
}

function StatGrid({ title, order, stats }: { title: string; order: string[]; stats: Record<string, { n: number; ok: number }> }) {
  if (!order.some((k) => stats[k])) return null;
  return (
    <section className="card">
      <h3>{title}</h3>
      <div className="breakdown">
        {order.map((k) => {
          const v = stats[k];
          const pct = v ? Math.round((100 * v.ok) / v.n) : 0;
          return (
            <div key={k} className="bd-row">
              <span className="bd-label">{k}</span>
              <div className="bd-bar">{v && <div style={{ width: `${pct}%` }} className={rateClass(pct / 100)} />}</div>
              <span className="bd-num">{v ? `${v.ok}/${v.n}` : '—'}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function OctavePairs({ stats }: { stats: Record<string, { n: number; ok: number }> }) {
  const rows = Object.entries(stats).filter(([k]) => {
    const [a, b] = k.split('→') as Register[];
    return REGISTERS.includes(a) && REGISTERS.includes(b);
  });
  if (!rows.length) return null;
  const order = rows.map(([k]) => k);
  const named: Record<string, { n: number; ok: number }> = {};
  const label = (k: string) => {
    const [a, b] = k.split('→') as Register[];
    return `${REGISTER_LABEL[a]} → ${REGISTER_LABEL[b]}`;
  };
  for (const [k, v] of rows) named[label(k)] = v;
  return <StatGrid title="Octave Jump by register" order={order.map(label)} stats={named} />;
}

function SettleTrend({ attempts }: { attempts: Attempt[] }) {
  const today = dateKey();
  const weeks: { ws: string; ms: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const ws = addDays(weekStart(today), -7 * i);
    const t0 = startOfDayMs(ws);
    const t1 = startOfDayMs(addDays(ws, 7));
    const xs = attempts
      .filter((a) => a.ts >= t0 && a.ts < t1 && a.result === 'success' && a.settleMs != null && (a.module === 'pitch-match' || a.module === 'octave-jump'))
      .map((a) => a.settleMs!)
      .sort((a, b) => a - b);
    if (xs.length >= 3) weeks.push({ ws, ms: xs[Math.floor(xs.length / 2)] });
  }
  if (weeks.length < 2) return null;
  const W = 300;
  const H = 120;
  const max = Math.max(...weeks.map((w) => w.ms)) * 1.15;
  const x = (i: number) => 30 + (i * (W - 40)) / Math.max(1, weeks.length - 1);
  const y = (ms: number) => H - 18 - (ms / max) * (H - 30);
  return (
    <section className="card">
      <h3>Time to lock on</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" aria-label="Median settle time per week, lower is better">
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f}>
            <line x1={28} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="var(--grid)" />
            <text x={0} y={y(max * f) + 3} fontSize={9} fill="var(--muted)">
              {((max * f) / 1000).toFixed(1)}s
            </text>
          </g>
        ))}
        <path d={weeks.map((w, i) => `${i ? 'L' : 'M'}${x(i)},${y(w.ms)}`).join('')} fill="none" stroke="var(--chart)" strokeWidth={2} />
        {weeks.map((w, i) => (
          <g key={w.ws}>
            <circle cx={x(i)} cy={y(w.ms)} r={2.5} fill="var(--chart)" />
            <text x={x(i)} y={H - 2} fontSize={8} fill="var(--muted)" textAnchor={i === weeks.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}>
              {new Date(startOfDayMs(w.ws)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </text>
          </g>
        ))}
      </svg>
      <p className="muted small">Median time from your first sound to a steady match, per week. Lower is better.</p>
    </section>
  );
}

const BEST_LABEL: Record<string, (v: number) => string> = {
  hold: (v) => `Longest steady hold: ${v.toFixed(1)} s`,
  hlThreshold: (v) => `Finest pitch difference heard: ${v.toFixed(1)}¢`,
  'run:pitch-match': (v) => `Pitch Match: ${v} in a row`,
  'run:octave-jump': (v) => `Octave Jump: ${v} in a row`,
  'run:ladder-steps': (v) => `Scale Ladder: ${v} steps in a row`,
  'run:ear-hl': (v) => `Higher or lower: ${v} in a row`,
  'run:ear-degrees': (v) => `Scale degrees: ${v} in a row`,
  'run:ear-intervals': (v) => `Intervals: ${v} in a row`,
  'run:ear-octave': (v) => `Which octave: ${v} in a row`,
};

function Bests({ bests }: { bests: Record<string, number> }) {
  const rows = Object.entries(bests).filter(([k]) => BEST_LABEL[k]);
  if (!rows.length) return null;
  return (
    <section className="card">
      <h3>Personal bests</h3>
      <ul className="problems">
        {rows.map(([k, v]) => (
          <li key={k}>
            <span>★ {BEST_LABEL[k](v)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
