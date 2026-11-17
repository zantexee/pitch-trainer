import { useEffect, useRef, useState } from 'react';
import type { AttemptScore, PitchSample } from '../pitch/scoring';
import { cents } from '../lib/notes';

// After each attempt: your trace over the target, the numbers, and the
// Replay / Hear my attempt / Next buttons. Auto-advances unless you tap.

interface Props {
  score: AttemptScore;
  samples: PitchSample[];
  targetHz: number;
  toleranceCents: number;
  targetName: string;
  personalBest?: string | null;
  onReplay?: () => void;
  onHear?: (() => void) | null;
  onNext: () => void;
  autoNextMs?: number;
}

const HEADLINE: Record<AttemptScore['verdict'], string> = {
  locked: '✓ Locked',
  close: 'Close',
  octave: 'Right note, wrong octave',
  off: 'Not quite',
  unreadable: "Couldn't hear a steady note",
};

export function ResultCard({ score, samples, targetHz, toleranceCents, targetName, personalBest, onReplay, onHear, onNext, autoNextMs = 1500 }: Props) {
  const [auto, setAuto] = useState(true);
  const next = useRef(onNext);
  next.current = onNext;

  useEffect(() => {
    if (!auto) return;
    const id = setTimeout(() => next.current(), autoNextMs);
    return () => clearTimeout(id);
  }, [auto, autoNextMs]);

  const stop = () => setAuto(false);
  let headline = HEADLINE[score.verdict];
  if (score.verdict === 'octave') headline = `Right note, ${Math.abs(score.octave) === 1 ? 'one octave' : `${Math.abs(score.octave)} octaves`} ${score.octave < 0 ? 'low' : 'high'}`;
  if (score.verdict === 'off' && score.meanCents != null) headline = score.meanCents < 0 ? 'Flat. Aim higher' : 'Sharp. Aim lower';
  if (score.verdict === 'close' && score.meanCents != null) headline = `Close. A little ${score.meanCents < 0 ? 'flat' : 'sharp'}`;

  return (
    <div className={`result ${score.verdict}`} onPointerDown={stop}>
      <div className="result-head">
        <strong>{headline}</strong>
        <span className="muted">{targetName}</span>
      </div>
      {personalBest && <div className="pb">★ {personalBest}</div>}
      <MiniTrace samples={samples} targetHz={targetHz} toleranceCents={toleranceCents} />
      <dl className="stats">
        <div>
          <dt>Accuracy</dt>
          <dd>{score.accuracy != null ? `±${Math.round(score.verdict === 'octave' ? score.pcAccuracy! : score.accuracy)}¢` : '—'}</dd>
        </div>
        <div>
          <dt>Stability</dt>
          <dd>{score.stability != null ? `${Math.round(score.stability)}¢` : '—'}</dd>
        </div>
        <div>
          <dt>Settle</dt>
          <dd>{score.settleMs != null ? `${(score.settleMs / 1000).toFixed(2)} s` : '—'}</dd>
        </div>
      </dl>
      <div className="row">
        {onReplay && (
          <button className="btn" onClick={() => (stop(), onReplay())}>
            ▶ Target
          </button>
        )}
        {onHear && (
          <button className="btn" onClick={() => (stop(), onHear())}>
            🎧 My attempt
          </button>
        )}
        <button className="btn primary grow" onClick={() => next.current()}>
          Next
          {auto && <span className="auto-bar" style={{ animationDuration: `${autoNextMs}ms` }} />}
        </button>
      </div>
    </div>
  );
}

function MiniTrace({ samples, targetHz, toleranceCents }: { samples: PitchSample[]; targetHz: number; toleranceCents: number }) {
  const pts = samples.filter((s) => s.freq != null).map((s) => ({ t: s.t, c: cents(s.freq!, targetHz) }));
  const W = 300;
  const H = 90;
  if (!pts.length) return <svg className="mini" viewBox={`0 0 ${W} ${H}`} />;
  const t0 = pts[0].t;
  const t1 = Math.max(t0 + 500, pts[pts.length - 1].t);
  const maxAbs = Math.max(toleranceCents * 3, ...pts.map((p) => Math.min(1500, Math.abs(p.c)) + 20));
  const y = (c: number) => H / 2 - (Math.max(-maxAbs, Math.min(maxAbs, c)) / maxAbs) * (H / 2 - 4);
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  let d = '';
  let prevT = -1e9;
  for (const p of pts) {
    d += `${p.t - prevT > 120 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.c).toFixed(1)}`;
    prevT = p.t;
  }
  return (
    <svg className="mini" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Your pitch over the target">
      <rect x={0} width={W} y={y(toleranceCents)} height={y(-toleranceCents) - y(toleranceCents)} fill="rgba(94,224,160,0.15)" />
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="rgba(255,255,255,0.6)" strokeDasharray="5 4" />
      {maxAbs > 1100 && <line x1={0} x2={W} y1={y(-1200)} y2={y(-1200)} stroke="rgba(255,255,255,0.15)" />}
      {maxAbs > 1100 && <line x1={0} x2={W} y1={y(1200)} y2={y(1200)} stroke="rgba(255,255,255,0.15)" />}
      <path d={d} fill="none" stroke="#7cc4ff" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
