/**
 * Date-only (`yyyy-mm-dd`) helpers.
 *
 * Budget transactions store calendar dates, not instants. `new Date('2026-08-10')`
 * parses as MIDNIGHT UTC, so `toLocaleDateString` renders the PREVIOUS day for
 * every user west of UTC — a transaction entered on 10 Aug listed as "9 Aug".
 * Symmetrically, `new Date().toISOString().split('T')[0]` is "today in UTC",
 * which drifts a day for users near midnight on either side of UTC.
 *
 * Rule: a date-only string is a LOCAL calendar date. Parse and format it
 * without ever routing through UTC.
 */

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Parse `yyyy-mm-dd` (or an ISO string starting with it) as a LOCAL date. */
export function parseDateOnlyLocal(value: string): Date {
  const m = DATE_ONLY_RE.exec(value);
  if (!m) return new Date(value); // not date-only; keep normal semantics
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Format a Date as `yyyy-mm-dd` using its LOCAL calendar fields. */
export function toDateOnlyLocal(date: Date): string {
  const y = date.getFullYear();
  const mo = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** Today's LOCAL calendar date as `yyyy-mm-dd`. */
export function todayDateOnlyLocal(): string {
  return toDateOnlyLocal(new Date());
}
