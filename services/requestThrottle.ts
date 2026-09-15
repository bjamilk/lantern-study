/**
 * The two guards that keep a background refresh from becoming a request storm.
 *
 * FIXED (SW) [Sentry WEB-1H / WEB-1S / WEB-1R: 78 + 74 + 5 events, one user,
 * one afternoon on /budget/wallet]: the Budget screen refreshes on open, on
 * `focus` and on `visibilitychange`, and every one of those fires BOTH
 * `/budget/transactions` and `/budget/wallet`. Nothing deduped them and nothing
 * noticed a 429, so once the authenticated budget (1200 / 15 min per user) was
 * exhausted the screen kept asking — each attempt a fresh `console.error`, and
 * therefore a fresh Sentry event, for a condition the user could do nothing
 * about.
 *
 * Exports:
 *  - `dedupe(key, fn)` — callers that land while a request is in flight share
 *    its promise instead of opening a second one.
 *  - `noteRateLimited(key, retryAfterHeader)` / `rateLimitedUntil(key)` —
 *    record a 429 and honour `Retry-After` (seconds or an HTTP-date; a missing
 *    or unparseable header falls back to 60s, capped at 15 minutes, which is
 *    the API's own window).
 *  - `resetRequestThrottle()` — tests, and sign-out.
 *
 * Deliberately NOT a cache: `dedupe` shares only the in-flight promise, so a
 * refresh that lands after the previous one settled still hits the network. A
 * screen that shows stale money would be worse than one extra request.
 */

const inFlight = new Map<string, Promise<unknown>>();
const blockedUntil = new Map<string, number>();

/** A 429 with no usable Retry-After: long enough to break a render loop. */
const DEFAULT_RETRY_AFTER_MS = 60_000;
/** The authenticated limiter's window — never sit out longer than that. */
const MAX_RETRY_AFTER_MS = 15 * 60_000;

export function resetRequestThrottle(): void {
  inFlight.clear();
  blockedUntil.clear();
}

/** Share the in-flight request for `key` rather than opening a second one. */
export function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = run().finally(() => {
    // Only clear OUR entry: a later call that already replaced it must survive.
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

/** ms remaining on a 429 cooldown for `key`, or 0 when the caller may proceed. */
export function rateLimitedUntil(key: string): number {
  const until = blockedUntil.get(key);
  if (!until) return 0;
  const remaining = until - Date.now();
  if (remaining <= 0) {
    blockedUntil.delete(key);
    return 0;
  }
  return remaining;
}

/** True while `key` is inside its 429 cooldown. */
export function isRateLimited(key: string): boolean {
  return rateLimitedUntil(key) > 0;
}

/**
 * `Retry-After` is either delta-seconds or an HTTP-date (RFC 9110 §10.2.3).
 * Both appear in the wild; express-rate-limit sends seconds.
 */
export function parseRetryAfterMs(header: string | null | undefined): number {
  if (!header) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(date - Date.now(), 0) || DEFAULT_RETRY_AFTER_MS, MAX_RETRY_AFTER_MS);
  }
  return DEFAULT_RETRY_AFTER_MS;
}

/** Record a 429 for `key`. Returns the cooldown in ms, for logging. */
export function noteRateLimited(key: string, retryAfterHeader?: string | null): number {
  const wait = parseRetryAfterMs(retryAfterHeader);
  blockedUntil.set(key, Date.now() + wait);
  return wait;
}
