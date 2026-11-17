import { notesInRange, REGISTERS, type Register, type VoiceRange } from '../lib/range';

// Octave Jump: hear a note in register A, sing the same note (or note +
// interval) in register B without hearing it first.

export interface OctaveTask {
  ref: number;
  refReg: Register;
  target: number;
  targetReg: Register;
  /** target - ref, semitones */
  jump: number;
  /** introduced at the current stage (shown more often) */
  isNew: boolean;
}

export const OCTAVE_STAGES = [
  'One octave, same register',
  'One octave, across registers',
  'Two octaves',
  'Other notes than C',
  'Any note in range',
  'Octave plus an interval',
] as const;

const NATURALS = [0, 2, 4, 5, 7, 9, 11];
const ALL_PCS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

interface JumpType {
  jumps: number[];
  /** true: registers must differ, false: must match, null: any */
  cross: boolean | null;
  stage: number;
}

const JUMP_TYPES: JumpType[] = [
  { jumps: [12, -12], cross: false, stage: 0 },
  { jumps: [12, -12], cross: true, stage: 1 },
  { jumps: [24, -24], cross: null, stage: 2 },
  { jumps: [19, -19, 16, -16, 15, -15, 17, -17], cross: null, stage: 5 },
];

export function pitchClassesFor(stage: number): number[] {
  if (stage <= 2) return [0];
  if (stage === 3) return NATURALS;
  return ALL_PCS;
}

/** All valid tasks for a stage, given the measured ranges. */
export function octaveTasks(range: VoiceRange, stage: number, stretch = false): OctaveTask[] {
  const pcs = new Set(pitchClassesFor(stage));
  const types = JUMP_TYPES.filter((t) => t.stage <= stage);
  const newest = Math.max(...types.map((t) => t.stage));
  const inReg = (r: Register) => new Set(notesInRange(range, [r], stretch));
  const sets = Object.fromEntries(REGISTERS.map((r) => [r, inReg(r)])) as Record<Register, Set<number>>;
  const out: OctaveTask[] = [];
  const seen = new Set<string>();
  for (const type of types) {
    for (const refReg of REGISTERS) {
      for (const ref of sets[refReg]) {
        if (!pcs.has(((ref % 12) + 12) % 12)) continue;
        for (const jump of type.jumps) {
          const target = ref + jump;
          for (const targetReg of REGISTERS) {
            if (!sets[targetReg].has(target)) continue;
            if (type.cross === true && targetReg === refReg) continue;
            if (type.cross === false && targetReg !== refReg) continue;
            const key = `${ref}${refReg}${target}${targetReg}`;
            if (seen.has(key)) continue;
            seen.add(key);
            // stages 3–4 widen the note choice, so everything there counts as new
            const isNew = type.stage === newest || stage === 3 || stage === 4;
            out.push({ ref, refReg, target, targetReg, jump, isNew });
          }
        }
      }
    }
  }
  return out;
}

/** Tasks for the stage, falling back to easier stages if the range can't support it. */
export function tasksWithFallback(range: VoiceRange, stage: number, stretch = false): { tasks: OctaveTask[]; stage: number } {
  for (let s = stage; s >= 0; s--) {
    const t = octaveTasks(range, s, stretch);
    if (t.length) return { tasks: t, stage: s };
  }
  // Ranges too narrow even for C-only octaves: allow any pitch class at stage 0.
  for (let s = Math.max(4, stage); s >= 0; s--) {
    const t = octaveTasks(range, s, true);
    if (t.length) return { tasks: t, stage: s };
  }
  return { tasks: [], stage: 0 };
}

export const pairKey = (t: Pick<OctaveTask, 'refReg' | 'targetReg'>) => `${t.refReg}→${t.targetReg}`;

export interface PairStats {
  n: number;
  ok: number;
}

/**
 * Pick a task: new material ~60% of the time, otherwise anything; weaker
 * register pairs (lower success) are weighted up.
 */
export function pickOctaveTask(tasks: OctaveTask[], rand: () => number, stats: Record<string, PairStats> = {}, prev?: OctaveTask | null): OctaveTask {
  let pool = tasks;
  const fresh = tasks.filter((t) => t.isNew);
  if (fresh.length && fresh.length < tasks.length && rand() < 0.6) pool = fresh;
  if (prev && pool.length > 1) {
    const different = pool.filter((t) => !(t.ref === prev.ref && t.target === prev.target));
    if (different.length) pool = different;
  }
  const weights = pool.map((t) => {
    const s = stats[pairKey(t)];
    const rate = s && s.n >= 3 ? s.ok / s.n : 0.5;
    return 1 + 2 * (1 - rate);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rand() * total;
  for (let i = 0; i < pool.length; i++) {
    x -= weights[i];
    if (x <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
