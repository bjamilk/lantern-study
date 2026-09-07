/**
 * How long a lecture has actually been recording.
 *
 * Not "now minus when we started": a recording can be PAUSED — by the student
 * stepping out, or by resuming after an interruption — and paused time is not
 * recorded time. Billing and the size estimate both read this number, so time
 * spent paused must not appear in either. It is a pure function so the
 * arithmetic can be tested without a recorder.
 */

export interface RecordingClock {
  /** When `startAsync` first ran, or `null` when nothing is recording. */
  startedAt: number | null;
  /** Milliseconds already spent paused, across every earlier pause. */
  pausedTotalMs: number;
  /** When the CURRENT pause began, or `null` when running. */
  pausedAt: number | null;
}

export function elapsedRecordingMs(clock: RecordingClock, now: number = Date.now()): number {
  if (!clock.startedAt) return 0;
  // While paused, the clock reads the moment the pause began — the number on
  // screen must stop moving, or a student watching it would think the pause
  // did nothing.
  const end = clock.pausedAt ?? now;
  const raw = end - clock.startedAt - Math.max(0, clock.pausedTotalMs);
  return Math.max(0, raw);
}

export function elapsedRecordingSeconds(clock: RecordingClock, now: number = Date.now()): number {
  return Math.floor(elapsedRecordingMs(clock, now) / 1000);
}

/** The paused total to store when a pause ENDS. */
export function pausedTotalAfterResume(
  pausedTotalMs: number,
  pausedAt: number | null,
  now: number = Date.now()
): number {
  if (!pausedAt) return Math.max(0, pausedTotalMs);
  return Math.max(0, pausedTotalMs) + Math.max(0, now - pausedAt);
}
