import { useEffect, useRef } from 'react';
import { live } from '../audio';
import { freqToMidi, midiToName } from '../lib/notes';
import { zoneFor } from '../pitch/scoring';

// Scrolling pitch trace over the last few seconds, drawn on a canvas.
// Target line + tolerance band when a target is given; note-name grid lines.

interface Props {
  a4: number;
  targetHz?: number | null;
  toleranceCents?: number;
  seconds?: number;
  height?: number;
}

interface Pt {
  t: number;
  midi: number | null;
}

// Canvas can't use CSS variables directly, so read the colour tokens once.
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    grid: v('--grid', 'rgba(255,255,255,0.07)'),
    gridC: v('--grid-strong', 'rgba(255,255,255,0.16)'),
    label: v('--label', 'rgba(255,255,255,0.45)'),
    target: v('--target-line', 'rgba(255,255,255,0.7)'),
    band: v('--band-in', 'rgba(94,224,160,0.2)'),
    in: v('--green', '#5ee0a0'),
    close: v('--amber', '#d99a2b'),
    off: v('--muted', '#9aa3b2'),
    free: v('--blue', '#7cc4ff'),
  };
}

// Line style per zone, so the trace reads without colour: thick solid when
// in tune, medium solid when close, thin dashed when off.
const STYLE = {
  in: { w: 4.5, dash: [] as number[] },
  close: { w: 3, dash: [] as number[] },
  off: { w: 2, dash: [3, 5] },
  free: { w: 3, dash: [] as number[] },
};

export function PitchTrace({ a4, targetHz = null, toleranceCents = 50, seconds = 4, height = 200 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pts = useRef<Pt[]>([]);
  const view = useRef<{ center: number | null }>({ center: null });
  const props = useRef({ a4, targetHz, toleranceCents, seconds });
  props.current = { a4, targetHz, toleranceCents, seconds };

  useEffect(() => {
    const unsub = live.subscribe((f) => {
      const p = props.current;
      pts.current.push({ t: f.t, midi: f.out.freq ? freqToMidi(f.out.freq, p.a4) : null });
      const cutoff = f.t - p.seconds * 1000 - 200;
      while (pts.current.length && pts.current[0].t < cutoff) pts.current.shift();
    });
    const COLORS = readColors();
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvasRef.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const p = props.current;
      const now = performance.now();
      const targetMidi = p.targetHz ? freqToMidi(p.targetHz, p.a4) : null;

      // Vertical range: ±6 semitones around the target, or follow the voice.
      const recent = pts.current.filter((q) => q.midi != null && q.t > now - 1500).map((q) => q.midi!);
      let center = targetMidi;
      if (center == null) {
        if (recent.length) {
          const m = recent[recent.length - 1];
          const v = view.current;
          v.center = v.center == null ? m : v.center + (m - v.center) * 0.08;
          if (Math.abs(m - v.center) > 5) v.center = m;
        }
        center = view.current.center ?? 57;
      } else if (recent.length) {
        // keep an octave-off voice visible
        const m = recent[recent.length - 1];
        if (Math.abs(m - targetMidi!) > 6) center = (m + targetMidi!) / 2;
      }
      const span = Math.max(12, targetMidi != null && recent.length ? Math.abs(recent[recent.length - 1] - targetMidi) + 4 : 12);
      const lo = center - span / 2;
      const hi = center + span / 2;
      const y = (midi: number) => h - ((midi - lo) / (hi - lo)) * h;
      const x = (t: number) => w - ((now - t) / (p.seconds * 1000)) * w;

      // grid
      g.font = '11px system-ui, sans-serif';
      g.textBaseline = 'middle';
      const step = span > 20 ? 2 : 1;
      for (let m = Math.ceil(lo); m <= Math.floor(hi); m += step) {
        const isC = ((m % 12) + 12) % 12 === 0;
        const natural = [0, 2, 4, 5, 7, 9, 11].includes(((m % 12) + 12) % 12);
        g.strokeStyle = isC ? COLORS.gridC : COLORS.grid;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0, y(m) + 0.5);
        g.lineTo(w, y(m) + 0.5);
        g.stroke();
        if (natural) {
          g.fillStyle = COLORS.label;
          g.fillText(midiToName(m), 4, y(m) - 7);
        }
      }

      // target + tolerance band
      if (targetMidi != null) {
        const tol = p.toleranceCents / 100;
        g.fillStyle = COLORS.band;
        g.fillRect(0, y(targetMidi + tol), w, y(targetMidi - tol) - y(targetMidi + tol));
        g.strokeStyle = COLORS.target;
        g.lineWidth = 1.5;
        g.setLineDash([6, 4]);
        g.beginPath();
        g.moveTo(0, y(targetMidi));
        g.lineTo(w, y(targetMidi));
        g.stroke();
        g.setLineDash([]);
      }

      // trace
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      let prev: Pt | null = null;
      for (const q of pts.current) {
        if (q.midi == null) {
          prev = null;
          continue;
        }
        if (prev && prev.midi != null && q.t - prev.t < 120) {
          const zone = targetMidi != null ? zoneFor((q.midi - targetMidi) * 100, p.toleranceCents) : 'free';
          g.strokeStyle = COLORS[zone];
          g.lineWidth = STYLE[zone].w;
          g.setLineDash(STYLE[zone].dash);
          g.beginPath();
          g.moveTo(x(prev.t), y(prev.midi));
          g.lineTo(x(q.t), y(q.midi));
          g.stroke();
        }
        prev = q;
      }
      g.setLineDash([]);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} className="trace" style={{ height }} role="img" aria-label="Live pitch trace: your pitch over the last few seconds against the target line" />;
}
