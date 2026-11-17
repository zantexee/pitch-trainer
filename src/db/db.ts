import Dexie, { type EntityTable } from 'dexie';
import { DEFAULT_A4 } from '../lib/notes';
import type { Timbre } from '../audio/synth';
import type { DroneMode } from '../audio/drone';

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
