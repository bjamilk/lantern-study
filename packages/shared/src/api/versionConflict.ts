/** Client-side mirror of API 409 version_conflict responses. */
export class VersionConflictError extends Error {
  /**
   * The API body's own `code` when it sent one, and 'version_conflict'
   * otherwise. Not every 409 is a stale-write conflict: the idempotency layer
   * answers 409 with IDEMPOTENCY_CONCURRENT ("the same key is still in flight,
   * retry it") or IDEMPOTENCY_PREVIOUS_FAILED ("mint a new key"), and callers
   * could not tell those apart — or apart from a real version conflict —
   * because this class flattened every 409 to one code and one message.
   *
   * The class name and `status` are unchanged, and `isVersionConflictError`
   * still matches on either of those, so existing catchers keep working.
   */
  readonly code: string;
  readonly status = 409;
  readonly current: unknown;

  constructor(
    message = 'Resource was updated elsewhere',
    current: unknown = null,
    code = 'version_conflict'
  ) {
    super(message);
    this.name = 'VersionConflictError';
    this.current = current;
    this.code = code || 'version_conflict';
  }
}

export function isVersionConflictError(error: unknown): error is VersionConflictError {
  if (error instanceof VersionConflictError) return true;
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; status?: number; name?: string };
  return e.code === 'version_conflict' || e.status === 409 || e.name === 'VersionConflictError';
}
