import { useEffect, useRef } from 'react';
import { midiToName } from '../lib/notes';
import type { Register, VoiceRange } from '../lib/range';

// Horizontally scrolling piano. Highlights register ranges and lets you pick a key.

interface Props {
  lo: number;
  hi: number;
  range?: VoiceRange | null;
  selected?: number | null;
  /** keys outside these are dimmed and not tappable */
  allowed?: number[];
  onPick?: (midi: number) => void;
  /** per-note colour override (heatmap etc.) */
  colors?: Record<number, string>;
}

const BLACK = new Set([1, 3, 6, 8, 10]);
export const REGISTER_COLORS: Record<Register, string> = { low: 'var(--reg-low)', chest: 'var(--reg-chest)', falsetto: 'var(--reg-falsetto)' };

export function Keyboard({ lo, hi, range, selected, allowed, onPick, colors }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const keys: number[] = [];
  for (let m = lo; m <= hi; m++) keys.push(m);
  const whites = keys.filter((m) => !BLACK.has(((m % 12) + 12) % 12));
  const allowedSet = allowed ? new Set(allowed) : null;

  useEffect(() => {
    // keep the selected key in view
    const el = ref.current?.querySelector('[data-selected="true"]') as HTMLElement | null;
    el?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [selected]);

  const regsFor = (m: number) => (range ? (Object.keys(range) as Register[]).filter((r) => m >= range[r].lo && m <= range[r].hi) : []);

  const W = 34;
  return (
    <div className="kb-scroll" ref={ref}>
      <div className="kb" style={{ width: whites.length * W }}>
        {keys.map((m) => {
          const pc = ((m % 12) + 12) % 12;
          const black = BLACK.has(pc);
          const whiteIndex = whites.filter((w) => w < m).length;
          const left = black ? whiteIndex * W - W * 0.3 : whiteIndex * W;
          const regs = regsFor(m);
          const disabled = allowedSet ? !allowedSet.has(m) : false;
          return (
            <button
              key={m}
              className={`key ${black ? 'black' : 'white'} ${selected === m ? 'sel' : ''} ${disabled ? 'dim' : ''}`}
              style={{ left, width: black ? W * 0.6 : W, background: colors?.[m] }}
              data-selected={selected === m}
              disabled={disabled || !onPick}
              onClick={() => onPick?.(m)}
              aria-label={midiToName(m)}
            >
              <span className="key-regs">
                {regs.map((r) => (
                  <i key={r} style={{ background: REGISTER_COLORS[r] }} />
                ))}
              </span>
              {!black && pc === 0 && <span className="key-label">{midiToName(m)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
