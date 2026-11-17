import { db, type Attempt } from '../db/db';
import { dateKey } from '../engine/dates';

// JSON backup of everything: the kv table (settings, practice log, histories)
// and all attempts. Import replaces what's on this device.

export interface Backup {
  app: 'pitch-trainer';
  format: 1;
  version: string;
  exportedAt: string;
  kv: { key: string; value: unknown }[];
  attempts: Attempt[];
}

export async function makeBackup(): Promise<Backup> {
  const [kv, attempts] = await Promise.all([db.kv.toArray(), db.attempts.toArray()]);
  return { app: 'pitch-trainer', format: 1, version: __APP_VERSION__, exportedAt: new Date().toISOString(), kv, attempts };
}

/** Share sheet on iPhone ("Save to Files"), plain download elsewhere. */
export async function exportBackup(): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const data = await makeBackup();
  const name = `pitch-trainer-backup-${dateKey()}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Pitch Trainer backup' });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export function parseBackup(text: string): Backup {
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const b = d as Partial<Backup>;
  if (!b || b.app !== 'pitch-trainer' || !Array.isArray(b.kv) || !Array.isArray(b.attempts)) throw new Error("That isn't a Pitch Trainer backup.");
  if (b.kv.some((r) => !r || typeof r.key !== 'string')) throw new Error('The backup looks damaged.');
  return b as Backup;
}

export function describeBackup(b: Backup): string {
  const days = Object.keys((b.kv.find((r) => r.key === 'practiceLog')?.value as Record<string, number>) ?? {}).length;
  return `${b.attempts.length} attempts, ${days} practice days, exported ${new Date(b.exportedAt).toLocaleDateString()}`;
}

export async function restoreBackup(b: Backup): Promise<void> {
  await db.transaction('rw', db.kv, db.attempts, async () => {
    await db.kv.clear();
    await db.attempts.clear();
    await db.kv.bulkPut(b.kv);
    await db.attempts.bulkPut(b.attempts);
  });
}

export async function resetAll(): Promise<void> {
  await db.transaction('rw', db.kv, db.attempts, async () => {
    await db.kv.clear();
    await db.attempts.clear();
  });
}
