/**
 * Budget-screen date helper.
 *
 * The real formatter now lives in `@lantern/shared/utils/displayDate` — six
 * unrelated features needed it, so a budget-local file (hard-coding a single
 * market's locale) was the wrong home. This thin wrapper keeps existing budget
 * and note callers working while delegating to the one shared formatter.
 *
 * A recurring rule's "next" date and a goal's deadline are stored as date-only
 * strings (`yyyy-mm-dd`); the shared formatter reads those as a LOCAL calendar
 * day (never through UTC — see dateOnly.ts).
 */
import { formatDisplayDate } from '@lantern/shared/utils/displayDate';

/** A date-only string or Date → e.g. "7 Sep 2026". */
export function formatBudgetDate(value: string | Date): string {
  // The shared formatter guards missing/unparseable input and never echoes a
  // raw ISO string (or "Invalid Date") back to a student.
  return formatDisplayDate(value);
}
