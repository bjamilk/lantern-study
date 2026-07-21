/** Client-side mirror of API 409 version_conflict responses. */
export class VersionConflictError extends Error {
  readonly code = 'version_conflict';
  readonly status = 409;
  readonly current: unknown;

  constructor(message = 'Resource was updated elsewhere', current: unknown = null) {
    super(message);
    this.name = 'VersionConflictError';
    this.current = current;
  }
}

export function isVersionConflictError(error: unknown): error is VersionConflictError {
  if (error instanceof VersionConflictError) return true;
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; status?: number; name?: string };
  return e.code === 'version_conflict' || e.status === 409 || e.name === 'VersionConflictError';
}
