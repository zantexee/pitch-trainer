import { useEffect, useRef, useState } from 'react';
import { live } from '../audio';
import { freqToMidi, midiToName } from '../lib/notes';
import { DEFAULT_RANGE, REGISTER_LABEL, steadyExtremes, type MidiSample, type Register, type Span, type VoiceRange } from '../lib/range';
import { go } from '../lib/router';
import { updateSettings, useSettings } from '../lib/settings';
import { addRangeRecord, loadRangeHistory, type RangeRecord } from '../db/db';
import { useSingingMic } from '../modules/useSingingMic';
import { MicGate } from '../ui/MicGate';
import { PitchTrace } from '../ui/PitchTrace';
import { Keyboard, REGISTER_COLORS } from '../ui/Keyboard';

const STEPS: { reg: Register; title: string; text: string; experimental?: boolean }[] = [
  { reg: 'chest', title: 'Normal voice', text: 'Glide on "oo" from your lowest to your highest note. Pause for a second at the bottom and at the top.' },
  { reg: 'falsetto', title: 'Falsetto', text: 'Same glide in falsetto (light, airy voice). Pause at the bottom and the top.' },
  { reg: 'low', title: 'Low "bassy" voice', text: 'Go as low as you can and hold the bottom note steady.', experimental: true },
];

const MAX_MS = 15000;

export function RangeFinder() {
  const s = useSettings();
  const mic = useSingingMic();
  const [step, setStep] = useState(0);
  const [recording, setRecording] = useState(false);
  const [found, setFound] = useState<Partial<Record<Register, Span | null>>>({});
  const [live_, setLive] = useState<Span | null>(null);
  const [draft, setDraft] = useState<VoiceRange | null>(null);
  const [history, setHistory] = useState<RangeRecord[]>([]);
  const samples = useRef<MidiSample[]>([]);
  const a4 = useRef(s.a4);
  a4.current = s.a4;

  useEffect(() => {
    void loadRangeHistory().then(setHistory);
  }, []);

  useEffect(() => {
    if (!recording) return;
    samples.current = [];
    const unsub = live.subscribe((f) => {
      samples.current.push({ t: f.t, midi: f.out.freq ? freqToMidi(f.out.freq, a4.current) : null });
    });
    const tick = setInterval(() => setLive(steadyExtremes(samples.current)), 200);
    const stopAt = setTimeout(() => finishStep(), MAX_MS);
    return () => {
      unsub();
      clearInterval(tick);
      clearTimeout(stopAt);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  function finishStep() {
    const reg = STEPS[step].reg;
    const span = steadyExtremes(samples.current);
    setRecording(false);
    setLive(null);
    const nextFound = { ...found, [reg]: span };
    setFound(nextFound);
    if (step < STEPS.length - 1) setStep(step + 1);
    else buildDraft(nextFound);
  }

  function skipStep() {
    const nextFound = { ...found, [STEPS[step].reg]: null };
    setFound(nextFound);
    setRecording(false);
    if (step < STEPS.length - 1) setStep(step + 1);
    else buildDraft(nextFound);
  }

  function buildDraft(f: Partial<Record<Register, Span | null>>) {
    const base = s.range ?? DEFAULT_RANGE;
    const r = { ...base };
    for (const reg of Object.keys(f) as Register[]) {
      const span = f[reg];
      // Ignore implausibly narrow results (a single held note); keep the old span.
      if (span && span.hi - span.lo >= 2) r[reg] = span;
    }
    setDraft(r);
  }

  function adjust(reg: Register, end: 'lo' | 'hi', d: number) {
    if (!draft) return;
    const span = { ...draft[reg] };
    span[end] = Math.max(24, Math.min(96, span[end] + d));
    if (span.lo > span.hi) return;
    setDraft({ ...draft, [reg]: span });
  }

  async function save() {
    if (!draft) return;
    updateSettings({ range: draft });
    setHistory(await addRangeRecord(draft));
    go('/');
  }

  // ---------- summary ----------
  if (draft) {
    return (
      <main className="screen">
        <Header />
        <section className="card">
          <h3>Your range</h3>
          <Keyboard lo={33} hi={86} range={draft} />
          {(['chest', 'falsetto', 'low'] as Register[]).map((reg) => (
            <div key={reg} className="range-row">
              <span className="range-name">
                <i style={{ background: REGISTER_COLORS[reg] }} />
                {REGISTER_LABEL[reg]}
                {(found[reg] == null || found[reg]!.hi - found[reg]!.lo < 2) && <span className="muted small"> (not detected clearly, so the old value is kept)</span>}
              </span>
              <div className="range-adjust">
                <button className="btn small" onClick={() => adjust(reg, 'lo', -1)} aria-label={`${reg} lowest down`}>
                  −
                </button>
                <span>{midiToName(draft[reg].lo)}</span>
                <button className="btn small" onClick={() => adjust(reg, 'lo', 1)} aria-label={`${reg} lowest up`}>
                  +
                </button>
                <span className="muted">to</span>
                <button className="btn small" onClick={() => adjust(reg, 'hi', -1)} aria-label={`${reg} highest down`}>
                  −
                </button>
                <span>{midiToName(draft[reg].hi)}</span>
                <button className="btn small" onClick={() => adjust(reg, 'hi', 1)} aria-label={`${reg} highest up`}>
                  +
                </button>
              </div>
            </div>
          ))}
          <label className="toggle">
            <input type="checkbox" checked={s.stretch} onChange={(e) => updateSettings({ stretch: e.target.checked })} />
            <span>Stretch: allow notes up to 2 semitones beyond this range</span>
          </label>
          <div className="row">
            <button className="btn primary grow" onClick={() => void save()}>
              Save range
            </button>
            <button
              className="btn"
              onClick={() => {
                setDraft(null);
                setFound({});
                setStep(0);
              }}
            >
              Redo
            </button>
          </div>
        </section>
        {history.length > 0 && <RangeHistory history={[...history, { ts: Date.now(), range: draft }]} />}
      </main>
    );
  }

  // ---------- guided glides ----------
  const cur = STEPS[step];
  return (
    <main className="screen">
      <Header />
      <MicGate status={mic.status} error={mic.error}>
        <div className="steps muted small">
          Step {step + 1} of {STEPS.length}
        </div>
        <section className="card">
          <h3>
            {cur.title}
            {cur.experimental && <span className="badge">experimental</span>}
          </h3>
          <p className="instruction">{cur.text}</p>
          <PitchTrace a4={s.a4} seconds={6} height={180} />
          <div className="range-live">
            {live_ ? (
              <>
                Held: <strong>{midiToName(live_.lo)}</strong> to <strong>{midiToName(live_.hi)}</strong>
              </>
            ) : (
              <span className="muted">{recording ? 'Listening… hold a note for ⅓ s to mark it' : 'Tap Start, then sing.'}</span>
            )}
          </div>
          <div className="row">
            {recording ? (
              <button className="btn primary grow" onClick={finishStep}>
                Done
              </button>
            ) : (
              <button className="btn primary grow" onClick={() => setRecording(true)}>
                Start
              </button>
            )}
            <button className="btn" onClick={skipStep}>
              Skip
            </button>
          </div>
        </section>
      </MicGate>
    </main>
  );
}

function Header() {
  return (
    <header className="bar">
      <button className="btn ghost" onClick={() => go('/')}>
        ‹ Home
      </button>
      <h2>Voice range</h2>
    </header>
  );
}

function RangeHistory({ history }: { history: RangeRecord[] }) {
  const recs = history.slice(-12);
  const W = 300;
  const H = 160;
  const all = recs.flatMap((r) => Object.values(r.range).flatMap((s) => [s.lo, s.hi]));
  const lo = Math.min(...all) - 1;
  const hi = Math.max(...all) + 1;
  const y = (m: number) => H - 14 - ((m - lo) / (hi - lo)) * (H - 24);
  const x = (i: number) => (recs.length === 1 ? W / 2 : 24 + (i * (W - 40)) / (recs.length - 1));
  return (
    <section className="card">
      <h3>Range over time</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" aria-label="Range history">
        {[lo + 1, Math.round((lo + hi) / 2), hi - 1].map((m) => (
          <g key={m}>
            <line x1={20} x2={W} y1={y(m)} y2={y(m)} stroke="rgba(255,255,255,0.08)" />
            <text x={0} y={y(m) + 4} fontSize={10} fill="#9aa3b2">
              {midiToName(m)}
            </text>
          </g>
        ))}
        {recs.map((r, i) =>
          (['low', 'chest', 'falsetto'] as Register[]).map((reg, k) => (
            <line
              key={`${i}-${reg}`}
              x1={x(i) + (k - 1) * 5}
              x2={x(i) + (k - 1) * 5}
              y1={y(r.range[reg].lo)}
              y2={y(r.range[reg].hi)}
              stroke={REGISTER_COLORS[reg]}
              strokeWidth={4}
              strokeLinecap="round"
            />
          )),
        )}
        {recs.map((r, i) => (
          <text key={`d${i}`} x={x(i)} y={H - 1} fontSize={9} fill="#9aa3b2" textAnchor="middle">
            {new Date(r.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </text>
        ))}
      </svg>
    </section>
  );
}
