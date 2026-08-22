/**
 * Pure helpers for the report flow (kept free of React Native imports so the
 * jest suite can cover them).
 */

/**
 * POST /reports answers 409 when this user already reported the target. The
 * shared client turns every 409 into a VersionConflictError (status 409,
 * name 'VersionConflictError') carrying the server sentence, so match on
 * status/name first and on the sentence as a fallback for older clients.
 */
export function isAlreadyReportedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: unknown; name?: unknown; code?: unknown; message?: unknown };
  if (e.status === 409 || e.name === 'VersionConflictError' || e.code === 'version_conflict') {
    return true;
  }
  return typeof e.message === 'string' && /already reported/i.test(e.message);
}

export const ALREADY_REPORTED_MESSAGE = 'You already reported this. Our team will review it.';

/** User-facing sentence for a failed report submission. */
export function describeReportError(error: unknown): string {
  if (isAlreadyReportedError(error)) return ALREADY_REPORTED_MESSAGE;
  if (error instanceof Error && error.message) return error.message;
  return 'Could not submit your report. Please try again.';
}
