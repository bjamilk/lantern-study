/**
 * The app's one human-readable calendar date, e.g. "7 Sep 2026".
 *
 * WHY THIS EXISTS
 * ---------------
 * Every date a student reads should be the LOCAL calendar day, and every date
 * should look the same. Two bugs this consolidates:
 *
 *  - `new Date('2026-09-07').toLocaleDateString()` parses the string as UTC
 *    midnight, so it renders the 6th for everyone west of UTC (see dateOnly.ts).
 *  - `date.getUTCDate()` on a real instant renders the UTC calendar day, so an
 *    order placed at 00:30 WAT (23:30 UTC the day before) showed the previous
 *    day. This reads LOCAL fields instead.
 *
 * The rule this encodes: a bare `yyyy-mm-dd` is a local calendar day (no time,
 * never routed through UTC); anything with a time component is an instant shown
 * in the viewer's local day. Both then read local `getDate`/`getMonth`/
 * `getFullYear`, so the label is the day the student would call it.
 *
 * The month names are a fixed English table rather than `toLocaleDateString`:
 * the output is then identical in the app and in node jest (no ICU/locale
 * flakiness), and the app's locale is en-* anyway.
 *
 * Pure and import-light so mobile jest (node env, `*.test.ts` only) can reach
 * it. This is the shared formatter the Notes and Order screens point at instead
 * of reaching into another lane's Budget file.
 */
import { parseDateOnlyLocal } from './dateOnly';

const DISPLAY_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** A bare calendar date with no time component: `yyyy-mm-dd`. */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Format a value as the app's local calendar date, e.g. `7 Sep 2026`.
 *
 * Returns `''` for a missing, empty or unparseable value so a caller can hide
 * the line rather than ever render "Invalid Date" or a 1970 fallback.
 */
export function formatDisplayDate(
  value: string | number | Date | null | undefined
): string {
  if (value == null || value === '') return '';
  let d: Date;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === 'number') {
    d = new Date(value);
  } else {
    // A bare date-only string is a LOCAL calendar day; a timestamp is an
    // instant read in local time. Never route a date-only string through
    // `new Date(str)` — that is the UTC-midnight regression.
    d = DATE_ONLY_RE.test(value) ? parseDateOnlyLocal(value) : new Date(value);
  }
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${DISPLAY_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
