import Dexie, { type EntityTable } from 'dexie';
import { DEFAULT_A4 } from '../lib/notes';
import type { Timbre } from '../audio/synth';
import type { DroneMode } from '../audio/drone';
import type { VoiceRange } from '../lib/range';
import type { AdaptiveState } from '../engine/adaptive';

// All local data lives in IndexedDB. Nothing is uploaded anywhere.

export interface Settings {
  a4: number;
  noiseGate: number | null;
  timbre: Timbre;
  droneMode: DroneMode;
  droneVolume: number;
  headphones: boolean;
  inputDeviceId: string | null;
  lowNoteTipShown: boolean;
  /** Measured voice range; null until the range finder has run. */
  range: VoiceRange | null;
  /** Allow notes up to 2 semitones outside the measured range. */
  stretch: boolean;
  pitchMatch: AdaptiveState | null;
  /** Drone hold challenge level: 0 = 1 s, 1 = 3 s, 2 = 5 s */
  droneHoldLevel: number;
  /** Notes Pitch Match has seen, with recent outcomes (for doubling and ears-only trials). */
  noteHistory: Record<string, boolean[]>;
  octaveJump: AdaptiveState | null;
  /** success per register pair, e.g. "chest→falsetto" */
  octaveStats: Record<string, { n: number; ok: number }>;
  ladder: AdaptiveState | null;
  ladderTimed: boolean;
  ladderKey: 'cadence' | 'drone';
  /** note labels in Scale Ladder */
  labelMode: 'names' | 'degrees' | 'solfege';
}

export const DEFAULT_SETTINGS: Settings = {
  a4: DEFAULT_A4,
  noiseGate: null,
  timbre: 'pure',
  droneMode: 'root',
  droneVolume: 0.6,
  headphones: false,
  inputDeviceId: null,
  lowNoteTipShown: false,
  range: null,
  stretch: false,
  pitchMatch: null,
  droneHoldLevel: 0,
  noteHistory: {},
  octaveJump: null,
  octaveStats: {},
  ladder: null,
  ladderTimed: false,
  ladderKey: 'cadence',
  labelMode: 'names',
};

interface KV {
  key: string;
  value: unknown;
}

/** One stored attempt (used from M1 on). */
export interface Attempt {
  id?: number;
  ts: number;
  module: string;
  target: string;
  result: string;
  centsError: number | null;
  octaveError: number;
  settleMs: number | null;
  stability: number | null;
  difficulty: Record<string, number | string>;
}

export const db = new Dexie('pitch-trainer') as Dexie & {
  kv: EntityTable<KV, 'key'>;
  attempts: EntityTable<Attempt, 'id'>;
};

db.version(1).stores({
  kv: 'key',
  attempts: '++id, ts, module, target',
});

export async function loadSettings(): Promise<Settings> {
  const row = await db.kv.get('settings');
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await db.kv.put({ key: 'settings', value: s });
}

export interface RangeRecord {
  ts: number;
  range: VoiceRange;
}

export async function loadRangeHistory(): Promise<RangeRecord[]> {
  const row = await db.kv.get('rangeHistory');
  return (row?.value as RangeRecord[]) ?? [];
}

export async function addRangeRecord(range: VoiceRange): Promise<RangeRecord[]> {
  const list = [...(await loadRangeHistory()), { ts: Date.now(), range }];
  await db.kv.put({ key: 'rangeHistory', value: list });
  return list;
}

export async function saveAttempt(a: Omit<Attempt, 'id'>): Promise<void> {
  try {
    await db.attempts.add(a);
  } catch {
    /* storage full or blocked: training still works */
  }
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
