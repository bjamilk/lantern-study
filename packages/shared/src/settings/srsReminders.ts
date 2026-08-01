/** Minimum gap between SRS due-card OS reminders (product: “every few hours”). */
export const SRS_REMINDER_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/**
 * Absolute floor even when the due backlog grows. Prevents sync/batch loads from
 * re-firing every time the count jumps by 10+ while the app is backgrounded.
 */
export const SRS_REMINDER_MIN_GAP_MS = 30 * 60 * 1000;

export const SRS_BACKLOG_GROWTH_THRESHOLD = 10;

export const SRS_REMINDER_STORAGE_KEY = 'lantern.srsReminder.lastNotified';

export interface SrsReminderMarker {
  at: number;
  dueCount: number;
}

/**
 * Pure cadence check for SRS due-card reminders (no DOM / storage).
 * Callers still suppress while the app/tab is focused.
 */
export function shouldSendSrsReminder(
  totalDue: number,
  last: SrsReminderMarker | null,
  now: number = Date.now()
): boolean {
  if (totalDue <= 0) return false;
  if (!last || typeof last.at !== 'number') return true;

  const elapsed = now - last.at;
  // Hard floor: never spam faster than MIN_GAP, even if backlog jumped.
  if (elapsed < SRS_REMINDER_MIN_GAP_MS) return false;

  const cooledDown = elapsed >= SRS_REMINDER_COOLDOWN_MS;
  const previousDue = typeof last.dueCount === 'number' ? last.dueCount : 0;
  const backlogGrew = totalDue >= previousDue + SRS_BACKLOG_GROWTH_THRESHOLD;
  return cooledDown || backlogGrew;
}

export function parseSrsReminderMarker(raw: string | null): SrsReminderMarker | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { at?: number; dueCount?: number };
    if (typeof parsed.at !== 'number') return null;
    return {
      at: parsed.at,
      dueCount: typeof parsed.dueCount === 'number' ? parsed.dueCount : 0,
    };
  } catch {
    return null;
  }
}

export function serializeSrsReminderMarker(marker: SrsReminderMarker): string {
  return JSON.stringify({ at: marker.at, dueCount: marker.dueCount });
}

export function getSrsReminderStorageKey(userId?: string | null): string {
  return userId ? `${SRS_REMINDER_STORAGE_KEY}.${userId}` : SRS_REMINDER_STORAGE_KEY;
}
