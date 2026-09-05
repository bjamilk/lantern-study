/**
 * Auth-failure classification — PURE.
 *
 * A transient network failure must never sign a student out or delete their
 * work. Everything that decides "is this session actually dead, or is the
 * phone just on a bad campus link?" lives here so it can be unit-tested
 * without pulling in expo-secure-store, expo-constants or a zustand store
 * (importing those into a test kills the whole suite).
 *
 * No runtime imports: `import type` only, nothing from ./supabase, no stores.
 *
 * The bias is deliberate and one-directional: UNKNOWN MEANS TRANSIENT. Being
 * wrong in the "transient" direction costs an offline banner the student can
 * dismiss by reconnecting; being wrong in the "invalid" direction throws away
 * a live session and, historically, the unsynced test results with it.
 */

/** Result of an attempted session refresh. */
export type RefreshOutcome = 'refreshed' | 'transient' | 'invalid';

/**
 * Copy for "we could not verify your session, and we could not disprove it
 * either". It states the fact that matters: nothing was lost.
 *
 * This string MUST stay identical to `OFFLINE_AUTH_MESSAGE` in
 * packages/shared/src/api/client.ts (web and mobile share copy strings). It is
 * duplicated rather than imported only because `@lantern/shared/api` does not
 * re-export the constant yet — see followUps.
 */
export const OFFLINE_AUTH_MESSAGE =
  'You appear to be offline. Your session is safe — reconnect to continue.';

/**
 * Thrown instead of sending a request with no Authorization header. The old
 * code sent one anyway for a 30 s window, manufacturing guaranteed 401s that
 * fed straight into the sign-out path.
 */
export class OfflineAuthError extends Error {
  readonly status = 401;
  readonly offline = true;

  constructor(message: string = OFFLINE_AUTH_MESSAGE) {
    super(message);
    this.name = 'OfflineAuthError';
    // Subclassing Error needs this to survive TypeScript's ES5-class downlevel.
    Object.setPrototypeOf(this, OfflineAuthError.prototype);
  }
}

/**
 * Structural, so it also recognises the offline 401 minted by the shared API
 * client (packages/shared/src/api/client.ts) — a different class, same shape.
 */
export function isOfflineAuthError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { offline?: unknown }).offline === true &&
    (error as { status?: unknown }).status === 401
  );
}

/** What a 401 from our own API should cause. */
export type AuthDecision = 'sign-out' | 'retry' | 'stay-offline';

/**
 * gotrue error codes that positively prove the refresh token is dead. Anything
 * outside this list — including a bare 400 with no code — is not proof.
 */
const INVALID_REFRESH_CODES: ReadonlySet<string> = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'invalid_grant',
  'session_not_found',
  'session_expired',
  'user_banned',
  'user_not_found',
]);

/**
 * API `code` values that mean the server itself ended this session. These are
 * the only 401 bodies that may sign a student out without a refresh attempt.
 */
const DEFINITIVE_AUTH_CODES: ReadonlySet<string> = new Set([
  'SESSION_REVOKED',
  'ACCOUNT_BANNED',
  'ACCOUNT_DEACTIVATED',
]);

/**
 * Shapes that only ever come from the transport: a dead link, a captive
 * portal, a DNS failure, an aborted request. React Native surfaces most of
 * these as a bare `TypeError: Network request failed` with no status at all.
 */
const TRANSIENT_MESSAGE_PATTERN =
  /network request failed|failed to fetch|timed out|timeout|ECONN|ENOTFOUND|EAI_AGAIN|abort/i;

/**
 * HTTP statuses that never prove a dead session:
 *  - 0   — auth-js's AuthRetryableFetchError for "the request never left"
 *  - 408 — request timeout, 425 — too early
 *  - 429 — rate limited (the token may be perfectly good)
 *  - >=500 — including Cloudflare's 520-527 "origin unreachable" family, which
 *    a Nigerian ISP's transparent proxy loves to return.
 */
function isTransientStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

interface AuthErrorLike {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  code?: unknown;
  /** gotrue REST bodies spell it `error_code`; auth-js maps it to `code`. */
  error_code?: unknown;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Classify a failed `refreshSession()`.
 *
 * DEFAULT IS `transient`. `invalid` is returned only when the error positively
 * proves the stored refresh token can never work again:
 *   a 400/401/403 from gotrue AND (a known dead-token code OR
 *   AuthSessionMissingError, which is auth-js saying there is no session at
 *   all on this device).
 *
 * Transport-shaped failures win over everything, so a timeout that happens to
 * carry a 400 still reads as transient.
 */
export function classifyRefreshError(error: unknown): 'transient' | 'invalid' {
  if (!error || typeof error !== 'object') return 'transient';

  const err = error as AuthErrorLike;
  const name = readString(err.name);
  const message = readString(err.message);
  const code = readString(err.code) ?? readString(err.error_code);
  const status = typeof err.status === 'number' ? err.status : undefined;

  // auth-js's own "retry me" signal, and its wrapper for anything it could not
  // parse (a captive-portal HTML page, a truncated body).
  if (name === 'AuthRetryableFetchError' || name === 'AuthUnknownError') return 'transient';

  if (status !== undefined && isTransientStatus(status)) return 'transient';

  if (message && TRANSIENT_MESSAGE_PATTERN.test(message)) return 'transient';

  const provenDeadToken =
    (code !== undefined && INVALID_REFRESH_CODES.has(code)) ||
    name === 'AuthSessionMissingError';

  if ((status === 400 || status === 401 || status === 403) && provenDeadToken) {
    return 'invalid';
  }

  // Anything else — an unknown error object, a 400 with no code, a plain
  // Error — is not proof. Keep the session.
  return 'transient';
}

/** True for the API `code` values that end a session on the server's say-so. */
export function isDefinitiveAuthCode(code: string | undefined | null): boolean {
  return typeof code === 'string' && DEFINITIVE_AUTH_CODES.has(code);
}

export interface Decide401Input {
  /** `code` from the 401 body, if the API sent one. */
  authCode?: string | null;
  /** Outcome of the refresh attempt made in response to that 401. */
  refresh: RefreshOutcome;
}

/**
 * The single place that decides what a 401 from our API means.
 *
 * - a definitive server code             → sign out (the server ended it)
 * - the refresh worked                   → retry the request once
 * - the refresh could not reach the server → stay signed in, show offline
 * - the refresh proved the token is dead → sign out
 */
export function decideOn401({ authCode, refresh }: Decide401Input): AuthDecision {
  if (isDefinitiveAuthCode(authCode)) return 'sign-out';
  if (refresh === 'refreshed') return 'retry';
  if (refresh === 'transient') return 'stay-offline';
  return 'sign-out';
}
