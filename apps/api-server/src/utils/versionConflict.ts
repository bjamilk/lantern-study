export class VersionConflictError extends Error {
  readonly code = 'version_conflict';
  readonly status = 409;
  readonly current: unknown;

  constructor(message: string, current?: unknown) {
    super(message);
    this.name = 'VersionConflictError';
    this.current = current ?? null;
  }
}

export function isVersionConflictError(error: unknown): error is VersionConflictError {
  return (
    error instanceof VersionConflictError ||
    (!!error &&
      typeof error === 'object' &&
      (error as { code?: string }).code === 'version_conflict')
  );
}
