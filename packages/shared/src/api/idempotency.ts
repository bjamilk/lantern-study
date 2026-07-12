/** Generate a client idempotency key for mutating API calls. */
export function createIdempotencyKey(prefix = 'idem'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
