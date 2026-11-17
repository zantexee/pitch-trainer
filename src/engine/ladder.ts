import { notesInRange, type Register, type VoiceRange } from '../lib/range';

// Scale Ladder: step sequences in Kodály order, easiest first.

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11, 12],
  minor: [0, 2, 3, 5, 7, 8, 10, 12],
  dorian: [0, 2, 3, 5, 7, 9, 10, 12],
  mixolydian: [0, 2, 4, 5, 7, 9, 10, 12],
  lydian: [0, 2, 4, 6, 7, 9, 11, 12],
  phrygian: [0, 1, 3, 5, 7, 8, 10, 12],
} as const;
export type ScaleName = keyof typeof SCALES;

export const LADDER_STAGES = [
  'sol–mi',
  'sol–mi–la',
  '+ do',
  '+ re (pentatonic)',
  'Major scale',
  'Natural minor',
  'Other modes',
  'Degree jumps',
  'Register transfer',
] as const;

export interface LadderStep {
  /** semitones above the tonic */
  offset: number;
  /** register this step should be sung in (register transfer only) */
  register?: Register;
}

export interface LadderPlan {
  stage: number;
  title: string;
  scale: ScaleName;
  steps: LadderStep[];
}

/** Random walk over `set`, starting at `start`, never repeating a note twice in a row. */
function walk(set: number[], len: number, rand: () => number, start: number): number[] {
  const out = [start];
  while (out.length < len) {
    const options = set.filter((x) => x !== out[out.length - 1]);
    out.push(options[Math.floor(rand() * options.length)]);
  }
  return out;
}

const upDown = (scale: readonly number[]) => [...scale, ...scale.slice(0, -1).reverse()];

export function ladderPlan(stage: number, rand: () => number): LadderPlan {
  const s = Math.max(0, Math.min(LADDER_STAGES.length - 1, stage));
  const title: string = LADDER_STAGES[s];
  const mk = (scale: ScaleName, offsets: number[], t = title): LadderPlan => ({ stage: s, title: t, scale, steps: offsets.map((offset) => ({ offset })) });
  switch (s) {
    case 0:
      return mk('major', walk([7, 4], 6, rand, 7));
    case 1:
      return mk('major', walk([7, 4, 9], 7, rand, 7));
    case 2:
      return mk('major', walk([0, 4, 7, 9], 8, rand, 0));
    case 3:
      return rand() < 0.5 ? mk('major', [0, 2, 4, 7, 9, 7, 4, 2, 0]) : mk('major', walk([0, 2, 4, 7, 9], 9, rand, 0));
    case 4:
      return mk('major', upDown(SCALES.major));
    case 5:
      return mk('minor', upDown(SCALES.minor));
    case 6: {
      const modes: ScaleName[] = ['dorian', 'mixolydian', 'lydian', 'phrygian'];
      const m = modes[Math.floor(rand() * modes.length)];
      return mk(m, upDown(SCALES[m]), `${m[0].toUpperCase()}${m.slice(1)} mode`);
    }
    case 7:
      return mk('major', [0, ...walk([7, 4, 9, 2, 5, 11, 12], 8, rand, 7)]);
    default: {
      const up = [...SCALES.major];
      return {
        stage: s,
        title,
        scale: 'major',
        steps: [...up.map((offset) => ({ offset, register: 'chest' as Register })), ...up.map((offset) => ({ offset: offset + 12, register: 'falsetto' as Register }))],
      };
    }
  }
}

/**
 * Tonic so every step fits the singer's range. Plain ladders must fit the
 * chest range (or chest ∪ falsetto if that's impossible); register-transfer
 * ladders must fit each step's own register. Returns null if nothing fits.
 */
export function chooseTonic(plan: LadderPlan, range: VoiceRange, stretch: boolean, rand: () => number): number | null {
  const fits = (pools: (r?: Register) => Set<number>) => {
    const lo = Math.min(...plan.steps.map((st) => st.offset));
    const candidates: number[] = [];
    for (let t = 24; t <= 96; t++) {
      if (plan.steps.every((st) => pools(st.register).has(t + st.offset)) && pools(plan.steps[0].register).has(t + lo)) candidates.push(t);
    }
    return candidates;
  };
  const chest = new Set(notesInRange(range, ['chest'], stretch));
  const both = new Set(notesInRange(range, ['chest', 'falsetto'], stretch));
  const reg = (r: Register) => new Set(notesInRange(range, [r], stretch));
  let c: number[];
  if (plan.steps.some((s) => s.register)) {
    const cache: Partial<Record<Register, Set<number>>> = {};
    c = fits((r) => (r ? (cache[r] ??= reg(r)) : chest));
  } else {
    c = fits(() => chest);
    if (!c.length) c = fits(() => both);
  }
  return c.length ? c[Math.floor(rand() * c.length)] : null;
}

/** Plan + tonic, dropping to easier stages if the range can't fit the requested one. */
export function buildLadder(stage: number, range: VoiceRange, stretch: boolean, rand: () => number): { plan: LadderPlan; tonic: number } | null {
  for (let s = stage; s >= 0; s--) {
    const plan = ladderPlan(s, rand);
    const tonic = chooseTonic(plan, range, stretch, rand);
    if (tonic != null) return { plan, tonic };
  }
  return null;
}

const SOLFEGE: Record<number, string> = { 0: 'do', 1: 'ra', 2: 're', 3: 'me', 4: 'mi', 5: 'fa', 6: 'fi', 7: 'sol', 8: 'le', 9: 'la', 10: 'te', 11: 'ti' };
const DEGREE: Record<number, string> = { 0: '1', 1: '♭2', 2: '2', 3: '♭3', 4: '3', 5: '4', 6: '♯4', 7: '5', 8: '♭6', 9: '6', 10: '♭7', 11: '7' };

export function solfege(offset: number): string {
  return SOLFEGE[((offset % 12) + 12) % 12];
}

export function degreeLabel(offset: number): string {
  const d = DEGREE[((offset % 12) + 12) % 12];
  return offset >= 12 && offset % 12 === 0 ? '8' : d;
}

/** I–IV–V–I (or i–iv–V–i) cadence voicings relative to the tonic: bass + triad. */
export function cadence(scale: ScaleName): number[][] {
  const minorish = scale === 'minor' || scale === 'dorian' || scale === 'phrygian';
  const third = minorish ? 3 : 4;
  const sixth = minorish ? 8 : 9;
  return [
    [-12, 0, third, 7],
    [-7, 0, 5, sixth],
    [-5, -1, 2, 7],
    [-12, 0, third, 7],
  ];
}
