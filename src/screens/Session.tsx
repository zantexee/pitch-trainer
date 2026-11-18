import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { engine } from '../audio';
import { playChime } from '../audio/synth';
import { go } from '../lib/router';
import { getSettings, updateSettings } from '../lib/settings';
import { useEngineStatus } from '../lib/useEngine';
import { EmbedCtx, type Embed, type TrialReport } from '../lib/embed';
import { streakNow, todaySeconds, usePractice } from '../lib/practice';
import { dateKey } from '../engine/dates';
import { MIN_SECONDS } from '../engine/streaks';
import { BONUS_LABEL, buildSession, DRONE_VARIANTS, extraRound, isEar, ROUND_LABEL, THEME_LABEL, type Round, type RoundResult, type RoundType, type SavedSession, type SessionPlan } from '../engine/session';
import { useSingingMic } from '../modules/useSingingMic';
import { PitchMatch } from './PitchMatch';
import { OctaveJump } from './OctaveJump';
import { ScaleLadder } from './ScaleLadder';
import { DroneMode } from './DroneMode';
import { HigherLower } from './ear/HigherLower';
import { ScaleDegrees } from './ear/ScaleDegrees';
import { Intervals } from './ear/Intervals';
import { WhichOctave } from './ear/WhichOctave';
import { NoteOfDay } from './ear/NoteOfDay';
import { WarmUp } from './WarmUp';

// Daily Mix runner: a sequence of short rounds, each a different exercise,
// with a countdown. Time-up waits for the current trial to finish so you're
// never cut off mid-note.

type Intent = { kind: 'new'; minutes: number; silent: boolean } | { kind: 'resume' };
let intent: Intent | null = null;
export function startSession(minutes: number, silent: boolean) {
  intent = { kind: 'new', minutes, silent };
  go('/session');
}
export function resumeSession() {
  intent = { kind: 'resume' };
  go('/session');
}

const BONUS_ICON = '🎁';
const INTRO_MS = 2200;
// The very first round gets a quick title flash so sound starts within ~3 s of tapping Start.
const FIRST_INTRO_MS = 600;
const introMs = (i: number) => (i === 0 ? FIRST_INTRO_MS : INTRO_MS);
const UNDO_MS = 5000;
const WRAP_MAX_MS: Record<'ear' | 'sing', number> = { ear: 6000, sing: 12000 };

const DESCRIBE: Record<RoundType, string> = {
  match: 'Hear a note, sing it back',
  octave: 'Same note, another register',
  ladder: 'Sing up and down the scale',
  drone: 'Sing against a drone',
  'ear-degrees': 'Which scale degree?',
  'ear-hl': 'Is the second tone higher or lower?',
  'ear-intervals': 'Name the interval',
  'ear-octave': 'Which octave was it?',
  warmup: 'Gentle sirens to get your voice going. No scoring.',
};

const DRONE_TEXT: Record<string, string> = { hold: 'Hold steady on the drone', degree: 'Sing intervals over the drone', slide: 'Slide onto the drone note' };

function roundEl(r: Round): ReactNode {
  if (r.bonus === 'note-of-day') return <NoteOfDay />;
  switch (r.type) {
    case 'match':
      return <PitchMatch />;
    case 'octave':
      return <OctaveJump />;
    case 'ladder':
      return <ScaleLadder />;
    case 'drone':
      return <DroneMode />;
    case 'ear-hl':
      return <HigherLower />;
    case 'ear-degrees':
      return <ScaleDegrees />;
    case 'ear-intervals':
      return <Intervals />;
    case 'ear-octave':
      return <WhichOctave />;
    case 'warmup':
      return <WarmUp />;
  }
}

function initial(): SavedSession {
  const st = getSettings();
  const today = dateKey();
  const saved = st.activeSession && st.activeSession.date === today ? st.activeSession : null;
  const it = intent;
  intent = null;
  if ((it?.kind === 'resume' || !it) && saved) return saved;
  const minutes = it?.kind === 'new' ? it.minutes : st.sessionMinutes;
  const silent = it?.kind === 'new' ? it.silent : st.silentMode;
  const ndPending = !!(st.noteOfDay?.date === today && st.noteOfDay.memorisedAt && !st.noteOfDay.result && Date.now() - st.noteOfDay.memorisedAt > 3600e3);
  const plan = buildSession({ minutes, dateKey: today, rand: Math.random, silent, noteOfDayPending: ndPending, warmup: st.warmup });
  return { date: today, plan, index: 0, remaining: plan.rounds[0].seconds, results: [] };
}

type Phase = 'intro' | 'round' | 'paused' | 'summary';

export function Session() {
  const [init] = useState(initial);
  const [plan, setPlan] = useState<SessionPlan>(init.plan);
  const [index, setIndex] = useState(init.index);
  const [remaining, setRemaining] = useState(init.remaining);
  const [results, setResults] = useState<RoundResult[]>(init.results);
  const [phase, setPhase] = useState<Phase>('intro');
  const [wrap, setWrap] = useState(false);
  const [variant, setVariant] = useState<string>(() => DRONE_VARIANTS[Math.floor(Math.random() * DRONE_VARIANTS.length)]);
  const [ended, setEnded] = useState(false);
  const status = useEngineStatus();
  const practice = usePractice();
  const startToday = useRef(todaySeconds());

  const round = plan.rounds[index] as Round | undefined;
  const needsMic = !plan.silent && plan.rounds.some((r) => !isEar(r.type));
  // Hold the mic for the whole session so it doesn't blink between rounds.
  useSingingMic(needsMic && phase !== 'summary');

  // the current round's tally lives in a ref (reports arrive from the round)
  const cur = useRef<RoundResult | null>(null);
  const wrapRef = useRef(false);
  wrapRef.current = wrap;

  // Persist progress so "End" (or closing the app) can continue later today.
  useEffect(() => {
    if (phase === 'summary') return;
    const partial = cur.current && cur.current.n > 0 ? [...results] : results;
    updateSettings({ activeSession: { date: init.date, plan, index, remaining, results: partial } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, phase, Math.floor(remaining / 10)]);

  // Intro card → round.
  useEffect(() => {
    if (phase !== 'intro') return;
    const id = setTimeout(() => beginRound(), introMs(index));
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index]);

  // Countdown: only while the round is live, visible and audio is running.
  useEffect(() => {
    if (phase !== 'round') return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible' || engine.status !== 'running') return;
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase === 'round' && remaining === 0 && !wrap) {
      if (round?.type === 'warmup') finishRound();
      else setWrap(true);
    }
  }, [phase, remaining, wrap]);

  // Time's up: let the current trial finish, but don't wait forever.
  useEffect(() => {
    if (!wrap || !round) return;
    const id = setTimeout(() => finishRound(), WRAP_MAX_MS[isEar(round.type) ? 'ear' : 'sing']);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrap]);

  function beginRound() {
    if (!round) return;
    cur.current = { type: round.type, bonus: round.bonus, n: 0, ok: 0, bests: [], seconds: 0 };
    setVariant(DRONE_VARIANTS[Math.floor(Math.random() * DRONE_VARIANTS.length)]);
    setWrap(false);
    setPhase('round');
  }

  function finishRound(skipped = false) {
    const r = cur.current;
    if (!r) return; // already finished (time-up and a late report can both land)
    cur.current = null;
    const res = { ...r, seconds: plan.rounds[index].seconds - remaining };
    const nextResults = res.n > 0 || !skipped ? [...results, res] : results;
    setResults(nextResults);
    setWrap(false);
    if (index + 1 < plan.rounds.length) {
      setIndex(index + 1);
      setRemaining(plan.rounds[index + 1].seconds);
      setPhase('intro');
    } else {
      endSession(nextResults, true);
    }
  }

  function endSession(final: RoundResult[], complete: boolean) {
    setResults(final);
    setPhase('summary');
    setEnded(!complete);
    if (complete) updateSettings({ activeSession: null });
    if (complete) playChime(engine);
  }

  // Ending never asks "are you sure?": it ends at once and offers Undo for a few seconds.
  const undoSnap = useRef<{ results: RoundResult[]; index: number; remaining: number; cur: RoundResult | null } | null>(null);
  const [undoable, setUndoable] = useState(false);
  useEffect(() => {
    if (!undoable) return;
    const id = setTimeout(() => setUndoable(false), UNDO_MS);
    return () => clearTimeout(id);
  }, [undoable]);

  function undoEnd() {
    const snap = undoSnap.current;
    if (!snap) return;
    undoSnap.current = null;
    setUndoable(false);
    cur.current = snap.cur;
    setResults(snap.results);
    setIndex(snap.index);
    setRemaining(snap.remaining);
    setEnded(false);
    setWrap(false);
    setPhase(snap.cur ? 'round' : 'intro');
  }

  function endEarly() {
    undoSnap.current = { results, index, remaining, cur: cur.current ? { ...cur.current, bests: [...cur.current.bests] } : null };
    setUndoable(true);
    const r = cur.current;
    cur.current = null;
    const final = r && r.n > 0 ? [...results, { ...r, seconds: plan.rounds[index].seconds - remaining }] : results;
    // continue later from the next round if this one had any work in it
    const nextIndex = r && r.n > 0 ? index + 1 : index;
    if (nextIndex >= plan.rounds.length) return endSession(final, true);
    setResults(final);
    setPhase('summary');
    setEnded(true);
    updateSettings({ activeSession: { date: init.date, plan, index: nextIndex, remaining: plan.rounds[nextIndex].seconds, results: final } });
  }

  function oneMore() {
    const extra = extraRound(plan, Math.random);
    const p = { ...plan, rounds: [...plan.rounds, extra] };
    setPlan(p);
    setIndex(p.rounds.length - 1);
    setRemaining(extra.seconds);
    setEnded(false);
    setPhase('intro');
  }

  const embed: Embed = useMemo(
    () => ({
      bonus: round?.bonus,
      variant: round?.type === 'drone' ? variant : undefined,
      report(t: TrialReport) {
        const c = cur.current;
        if (!c) return;
        c.n++;
        if (t.ok) c.ok++;
        if (t.best) c.bests.push(t.best);
        if (wrapRef.current) finishRoundRef.current();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, variant, round?.bonus, round?.type],
  );
  const finishRoundRef = useRef(() => {});
  // ear rounds: finish once the answer feedback has shown; singing: after the result card
  finishRoundRef.current = () => setTimeout(() => finishRound(), round && isEar(round.type) ? 1200 : 2200);

  // Pause automatically on interruptions.
  useEffect(() => {
    if (status !== 'running' && phase === 'round') setPhase('paused');
  }, [status, phase]);

  if (phase === 'summary')
    return (
      <>
        <Summary plan={plan} results={results} ended={ended} startToday={startToday.current} practiceToday={practice.log[dateKey()] ?? 0} onOneMore={oneMore} />
        {undoable && ended && (
          <div className="toast bottom action" role="status">
            <span>Session ended</span>
            <button className="toast-btn" onClick={undoEnd}>
              Undo
            </button>
          </div>
        )}
      </>
    );

  const total = plan.rounds.length;
  const label = round ? (round.bonus ? `${BONUS_ICON} ${BONUS_LABEL[round.bonus]}` : ROUND_LABEL[round.type]) : '';
  const showTimer = getSettings().showTimer;
  const mm = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

  return (
    <main className="screen session">
      <header className="session-bar">
        <button className="btn ghost icon" onClick={endEarly} aria-label="End session">
          ✕
        </button>
        <div className="session-title">
          <strong>{label}</strong>
          <span className="sr-only">
            Round {index + 1} of {total}
          </span>
        </div>
        <span className={`session-time ${wrap ? 'wrap' : ''}`} aria-live="off">
          {wrap ? 'last one' : showTimer ? mm : ''}
        </span>
      </header>
      <div className="session-progress" aria-hidden="true">
        {plan.rounds.map((r, i) => (
          <div key={i} className={`seg ${i < index ? 'done' : ''} ${r.bonus ? 'bonus' : ''}`} style={{ flexGrow: r.seconds }}>
            {i === index && <div className="fill" style={{ width: `${phase === 'intro' ? 0 : (100 * (r.seconds - remaining)) / r.seconds}%` }} />}
          </div>
        ))}
      </div>

      {phase === 'intro' && round && (
        <section className={`card intro ${round.bonus ? 'bonus' : ''}`} onClick={beginRound}>
          {index === 0 && <div className="theme-chip">{THEME_LABEL[plan.theme]}</div>}
          {round.bonus && <div className="bonus-tag">{BONUS_ICON} Bonus round</div>}
          <h2>{round.bonus ? BONUS_LABEL[round.bonus] : ROUND_LABEL[round.type]}</h2>
          <p className="muted">{round.type === 'drone' && !round.bonus ? DRONE_TEXT[variant] : DESCRIBE[round.type]}</p>
          <p className="muted small">{Math.round(round.seconds)} s</p>
          <button className="btn primary">
            Go
            <span className="auto-bar" style={{ animationDuration: `${introMs(index)}ms` }} />
          </button>
        </section>
      )}

      {phase === 'round' && round && (
        <EmbedCtx.Provider value={embed}>
          <div key={index} className="session-round">
            {roundEl(round)}
          </div>
        </EmbedCtx.Provider>
      )}

      {phase === 'paused' && (
        <section className="card center">
          <h3>Paused</h3>
          <p className="muted">{mm} left in this round.</p>
          <button className="btn-huge" onClick={() => (status === 'running' ? setPhase('round') : void engine.tapResume().then(() => setPhase('round')))}>
            Resume
          </button>
          <button className="btn" onClick={endEarly}>
            End for now
          </button>
        </section>
      )}

      {phase === 'round' && (
        <div className="row session-controls">
          <button className="btn" onClick={() => setPhase('paused')} aria-label="Pause">
            ❚❚ Pause
          </button>
          <button className="btn grow" onClick={() => finishRound(true)}>
            Next round ›
          </button>
        </div>
      )}
      {todaySeconds(practice) >= MIN_SECONDS && startToday.current < MIN_SECONDS && phase === 'round' && <div className="toast bottom">✓ Today counts</div>}
    </main>
  );
}

function Summary({ plan, results, ended, practiceToday, onOneMore }: { plan: SessionPlan; results: RoundResult[]; ended: boolean; startToday: number; practiceToday: number; onOneMore: () => void }) {
  const streak = streakNow();
  results = results.filter((r) => r.type !== 'warmup');
  const n = results.reduce((a, r) => a + r.n, 0);
  const ok = results.reduce((a, r) => a + r.ok, 0);
  const secs = results.reduce((a, r) => a + r.seconds, 0);
  // one message per round: the last (biggest) best
  const bests = results.map((r) => r.bests[r.bests.length - 1]).filter((b): b is string => !!b);
  const pct = n ? Math.round((100 * ok) / n) : null;
  const left = plan.rounds.length - results.length;
  const needMin = Math.ceil(Math.max(0, MIN_SECONDS - practiceToday) / 60);
  const best = [...results].filter((r) => r.n >= 3).sort((a, b) => b.ok / b.n - a.ok / a.n)[0];
  const weak = [...results].filter((r) => r.n >= 3).sort((a, b) => a.ok / a.n - b.ok / b.n)[0];

  return (
    <main className="screen">
      <section className="card summary">
        <div className="summary-head">
          <div className="summary-pct">{pct != null ? `${pct}%` : '✓'}</div>
          <div>
            <strong>{ended ? 'Nice work, saved for later' : 'Session done'}</strong>
            <div className="muted small">
              {Math.max(1, Math.round(secs / 60))} min · {results.length} round{results.length === 1 ? '' : 's'} · {ok}/{n} right
            </div>
          </div>
        </div>
        <div className="streak-line">
          {streak.mode === 'daily' ? (
            streak.todayDone ? (
              <>
                🔥 <strong>{streak.current}-day streak</strong>
                {streak.freezes > 0 && <span className="muted"> · {streak.freezes} freeze{streak.freezes > 1 ? 's' : ''} banked</span>}
              </>
            ) : (
              <span className="muted">{needMin} more minute{needMin === 1 ? '' : 's'} today keeps your streak going.</span>
            )
          ) : (
            <>
              🔥 {streak.weekDays}/{streak.weeklyGoal} days this week · {streak.current}-week streak
            </>
          )}
        </div>
        {bests.length > 0 && (
          <div>
            {[...new Set(bests)].map((b) => (
              <div key={b} className="pb">
                ★ {b}
              </div>
            ))}
          </div>
        )}
        <ul className="problems">
          {results.map((r, i) => (
            <li key={i}>
              <span>
                {r.bonus ? `${BONUS_ICON} ${BONUS_LABEL[r.bonus]}` : ROUND_LABEL[r.type]}
              </span>
              <span className="muted">{r.n ? `${r.ok}/${r.n} (${Math.round((100 * r.ok) / r.n)}%)` : '—'}</span>
            </li>
          ))}
        </ul>
        {best && weak && best !== weak && (
          <p className="muted small">
            Strongest: {ROUND_LABEL[best.type]}. Most room to grow: {ROUND_LABEL[weak.type]}, so it'll come up a bit more.
          </p>
        )}
        {ended && left > 0 && <p className="muted small">{left} round{left === 1 ? '' : 's'} left. Continue from Home any time today.</p>}
        <div className="row">
          <button className="btn primary grow" onClick={onOneMore}>
            One more round?
          </button>
          <button className="btn" onClick={() => go('/')}>
            Done
          </button>
        </div>
      </section>
    </main>
  );
}
