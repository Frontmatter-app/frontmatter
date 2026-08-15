/**
 * Day keys for every metric in this module.
 *
 * These were all `toISOString().split('T')[0]`, which is a UTC day. The hour
 * buckets, meanwhile, were filled from `getHours()`, which is a local hour. So
 * a writer in UTC-7 working at 6pm had their evening filed under tomorrow's
 * date, at hour 18 of a day they had not started — the heatmap's "today" cell
 * stayed empty through an entire evening's work, and the streak broke at the
 * same time every night.
 *
 * A metric about a person's day has to use that person's day. Everything here
 * is local time, and `dayKey` is the only way a date becomes a key.
 */

/** `YYYY-MM-DD` in the writer's own timezone. */
export function dayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Local midnight of a `YYYY-MM-DD` key. Never `new Date(key)`, which is UTC. */
export function fromDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

/** The key `delta` days from `key`, negative to go back. */
export function shiftDayKey(key: string, delta: number): string {
  const date = fromDayKey(key);
  date.setDate(date.getDate() + delta);
  return dayKey(date);
}

/** Whole days from `from` to `to`, positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  const ms = fromDayKey(to).getTime() - fromDayKey(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** Day-of-week of a key, 0 = Sunday, in local time. */
export function dayOfWeek(key: string): number {
  return fromDayKey(key).getDay();
}

/** The last `count` day keys ending today, oldest first. */
export function recentDayKeys(count: number, today: string = dayKey()): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) keys.push(shiftDayKey(today, -i));
  return keys;
}

/** Days since an ISO timestamp, as of `now`. Used for document staleness. */
export function daysSince(isoTimestamp: string, now: Date = new Date()): number {
  const then = new Date(isoTimestamp);
  if (Number.isNaN(then.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
}
