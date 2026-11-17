// Local calendar-day keys ("YYYY-MM-DD"). A practice day is the user's local
// day, so a session at 23:50 and one at 00:10 land on different days, in
// whatever time zone the phone is in at the time.

export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function keyFromMs(ms: number): string {
  return dateKey(new Date(ms));
}

function parts(key: string): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number);
  return [y, m, d];
}

/** Calendar arithmetic on keys (no DST issues: done in UTC). */
export function addDays(key: string, n: number): string {
  const [y, m, d] = parts(key);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Local midnight at the start of the day, in ms. */
export function startOfDayMs(key: string): number {
  const [y, m, d] = parts(key);
  return new Date(y, m - 1, d).getTime();
}

/** Monday-based week start key. */
export function weekStart(key: string): string {
  const [y, m, d] = parts(key);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(key, -((dow + 6) % 7));
}

export function dayIndex(key: string): number {
  return daysBetween('2024-01-01', key);
}
