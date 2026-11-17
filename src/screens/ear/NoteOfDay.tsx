import { useEffect, useState } from 'react';
import { midiToName, noteToFreq } from '../../lib/notes';
import { DEFAULT_RANGE } from '../../lib/range';
import { getSettings, updateSettings, useSettings } from '../../lib/settings';
import { appendList, loadList, saveAttempt } from '../../db/db';
import { localDateKey, noteOfTheDay } from '../../engine/ear';
import { listen } from '../../modules/listen';
import { useSingingMic } from '../../modules/useSingingMic';
import { MicGate } from '../../ui/MicGate';
import { EarShell, playSeq } from './common';

// Pitch-memory side quest: hear one note in the morning, sing it from memory
// later. Experimental: some adults partly learn absolute pitch, most improve
// only modestly.

interface Rec {
  date: string;
  note: string;
  cents: number | null;
  octave: number;
}

export function NoteOfDay() {
  const s = useSettings();
  const today = localDateKey();
  const range = s.range ?? DEFAULT_RANGE;
  const midi = noteOfTheDay(today, range.chest.lo + 2, range.chest.hi - 2);
  const nd = s.noteOfDay?.date === today ? s.noteOfDay : null;
  const [singing, setSinging] = useState(false);
  const [history, setHistory] = useState<Rec[]>([]);

  useEffect(() => {
    void loadList<Rec>('notdHistory').then(setHistory);
  }, []);

  const memorise = () => {
    playSeq([midi, midi, midi], { timbre: 'pad', dur: 1.2, gap: 0.6 });
    updateSettings({ noteOfDay: { date: today, midi, memorisedAt: Date.now(), result: null } });
  };

  const minutes = nd?.memorisedAt ? (Date.now() - nd.memorisedAt) / 60000 : 0;

  return (
    <EarShell title="Note of the day">
      <section className="card">
        <h3>
          Pitch memory <span className="badge">experimental</span>
        </h3>
        {!nd?.memorisedAt && (
          <>
            <p className="instruction">Hear today's note and memorise it. Later today, sing it from memory.</p>
            <button className="btn-huge" onClick={memorise}>
              Hear today's note
            </button>
          </>
        )}
        {nd?.memorisedAt && !nd.result && !singing && (
          <>
            <p className="instruction">Today's note is memorised. When you're ready, sing it from memory: no reference, no hints.</p>
            {minutes < 60 && <p className="muted small">It's a better test after a few hours.</p>}
            <button className="btn-huge" onClick={() => setSinging(true)}>
              Sing it from memory
            </button>
          </>
        )}
        {singing && !nd?.result && <SingCheck midi={midi} onDone={(r) => setHistory(r)} />}
        {nd?.result && (
          <>
            <div className="target-note">{midiToName(nd.midi)}</div>
            <p className="center">
              {describeMemory(nd.result.cents)}
            </p>
            <button className="btn" onClick={() => playSeq([nd.midi], { timbre: 'pad', dur: 1.2 })}>
              ▶ Hear it
            </button>
            <p className="muted small">A new note tomorrow.</p>
          </>
        )}
      </section>
      {history.length > 0 && (
        <section className="card">
          <h3>Recent days</h3>
          <dl className="kv">
            {history
              .slice(-10)
              .reverse()
              .map((h) => (
                <div key={h.date} className="kv-row">
                  <dt>
                    {h.date} · {h.note}
                  </dt>
                  <dd>{h.cents == null ? '—' : `${h.cents >= 0 ? '+' : '−'}${Math.abs(Math.round(h.cents))}¢`}</dd>
                </div>
              ))}
          </dl>
        </section>
      )}
    </EarShell>
  );
}

const pcOf = (c: number) => c - 1200 * Math.floor((c + 600) / 1200);

function describeMemory(c: number | null): string {
  if (c == null) return "Couldn't hear a steady note.";
  const a = Math.abs(c);
  if (a <= 50) return `Spot on: ${Math.round(a)}¢ ${c < 0 ? 'flat' : 'sharp'}.`;
  const pc = pcOf(c);
  if (Math.abs(pc) <= 50) return `Right note, ${Math.round(Math.abs(c) / 1200)} octave${Math.round(Math.abs(c) / 1200) > 1 ? 's' : ''} ${c < 0 ? 'low' : 'high'}.`;
  const semis = a / 100;
  return `${semis.toFixed(1)} semitones ${c < 0 ? 'low' : 'high'}.`;
}

function SingCheck({ midi, onDone }: { midi: number; onDone: (h: Rec[]) => void }) {
  const mic = useSingingMic();
  const [state, setState] = useState<'wait' | 'listening'>('wait');
  useEffect(() => {
    if (mic.status !== 'ready' || state !== 'wait') return;
    setState('listening');
    void (async () => {
      const st = getSettings();
      const res = await listen(noteToFreq(midi, st.a4), { toleranceCents: 50, holdMs: 800, maxMs: 12000, maxVoicedMs: 2500, silenceEndMs: 900, chime: false });
      const sc = res.score;
      const result = { cents: sc.meanCents, octave: sc.octave, ts: Date.now() };
      const nd = getSettings().noteOfDay;
      if (nd) updateSettings({ noteOfDay: { ...nd, result } });
      void saveAttempt({ ts: Date.now(), module: 'note-of-day', target: midiToName(midi), result: sc.verdict, centsError: sc.meanCents, octaveError: sc.octave, settleMs: sc.settleMs, stability: sc.stability, difficulty: {} });
      onDone(await appendList<Rec>('notdHistory', { date: localDateKey(), note: midiToName(midi), cents: sc.meanCents, octave: sc.octave }));
    })();
  }, [mic.status, state, midi, onDone]);
  return (
    <MicGate status={mic.status} error={mic.error}>
      <div className="phase">Sing it now and hold…</div>
      <p className="muted small center">No feedback until you're done.</p>
    </MicGate>
  );
}
