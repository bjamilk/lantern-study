/**
 * Bound a best-effort upstream call so a slow dependency cannot become a 500.
 *
 * FIXED (SW) [Sentry LANTERN-STUDY-API-2 — "Error: Gateway Timeout" inside
 * POST /api/v1/users/presence/heartbeat, 25 events]: PostgREST/Supabase answers
 * a slow query with a status-less `Error`, and `@sentry/node`'s express handler
 * treats an error with no status as a 500 (see the sentry-access memory note).
 * A fire-and-forget presence beat therefore filed as a server crash and the
 * client saw a hard failure. Routes that only *want* an upstream write — never
 * require it — wrap it here and answer with an explicit status instead.
 *
 * Never throws. `{ ok: true, value }` on success; otherwise `{ ok: false }`
 * with `reason` 'timeout' or 'error' and the original error for logging.
 *
 * Note the promise is NOT cancelled on timeout (there is nothing to cancel in
 * postgrest-js): the request simply stops waiting for it, and the rejection is
 * swallowed so it cannot surface later as an unhandled rejection.
 */
export type UpstreamResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'timeout' | 'error'; error?: unknown };

export async function withUpstreamTimeout<T>(
  work: Promise<T>,
  timeoutMs: number
): Promise<UpstreamResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = work.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, reason: 'error' as const, error })
  );
  const timeout = new Promise<UpstreamResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs);
  });
  try {
    return await Promise.race([guarded, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Presence is written every two minutes per active user. Four seconds is well
 * past a healthy round trip and well under the client's 8s fetch timeout, so a
 * stalled write answers before the browser gives up on it.
 */
export const PRESENCE_UPSTREAM_TIMEOUT_MS = 4000;
