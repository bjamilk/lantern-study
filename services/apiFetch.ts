/**
 * The ONE transport for every web → BFF call.
 *
 * Before this module the web client had five hand-rolled 401/403 retry shapes
 * (E3 finding: `services/supabase.ts` at the old :911, :2736, :2767, :3092,
 * :6908) plus `fetchWithTimeout`'s own copy — six policies that disagreed about
 * budgets, about whether a 403 may be refreshed, and about what a guest's 401
 * means. One of them was the unbounded recursion of E3 C4. This file is the
 * single replacement; `services/sessionHandler.ts` (F1) remains the single
 * *policy*, and this is the single *transport* that applies it.
 *
 * Exports:
 *  - `apiFetch(path, init, opts)` — base URL + auth headers + credentials +
 *    timeout + the one retry policy. Returns the raw `Response`, exactly like
 *    `fetch`, so the 170-odd call sites that hand-read their own error bodies
 *    keep working unchanged.
 *  - `apiJson<T>(path, init, opts)` — the same, then `!ok → throw
 *    ApiClientError`, `ok → parsed JSON`.
 *  - `ApiClientError` — `{ status, code, message, retryable }`.
 *  - `timeoutSignal(ms)` — the AbortController pair the timeout is built on.
 *
 * Retry policy (all of it; there is no other):
 *  1. AUTH. At most ONE retry, after a refresh, delegated to
 *     `handleApiAuthFailure(response, { attempt })`. That function owns the
 *     budget (`MAX_AUTH_RETRY_ATTEMPTS`), the single-flight refresh, the
 *     terminal codes and the rule that a **403 is never retried** (refreshing a
 *     valid session that answers 403 can only loop — E3 C4). Two guards run
 *     before it, in this order, because `fetchWithTimeout` had them in this
 *     order and both are load-bearing:
 *       a. a TERMINAL code (SESSION_REVOKED / ACCOUNT_BANNED /
 *          ACCOUNT_DEACTIVATED) signs out once, naming the reason, and the
 *          response is returned untouched;
 *       b. a viewer with NO cached access token gets the response untouched and
 *          NO "session expired" notice — a guest hitting an authed endpoint
 *          must not be redirected off a public page. Opt out with
 *          `requireCachedSession: false`.
 *  2. TRANSIENT (network error / 408 / 5xx). OFF by default, so migrating a
 *     call site onto this module can never add a request it did not make
 *     before. A caller opts in with `retryTransient: true`, and even then the
 *     request must be idempotent: GET/HEAD, or an explicit `idempotent: true`
 *     for a write the server dedupes. A POST is never retried without that
 *     flag, and nothing retries a 4xx other than the auth path above.
 *
 * Touches: `services/supabase.ts` (dynamically — `getAuthHeaders`,
 *  `withApiCredentials`, `hasCachedAccessToken`, `getApiRoot`; the two modules
 *  are circular, which is why the import is inside the function and not at the
 *  top), `services/sessionHandler.ts`, `services/accountSuspension.ts`.
 * Gotchas:
 *  - `timeoutSignal` uses an AbortController rather than `AbortSignal.timeout`:
 *    the latter is missing in jsdom and in older Safari, so the tests and a
 *    slice of real users would silently lose every timeout.
 *  - A timeout surfaces as `Error('Request timed out')`, NOT an `AbortError` —
 *    callers (and their catch blocks) have matched on that sentence since
 *    `fetchWithTimeout` was written. Do not "improve" the message.
 *  - The 403 suspension sniff is fire-and-forget on purpose; awaiting it would
 *    put `services/accountSuspension` on the hot path of every call.
 */
import {
  handleApiAuthFailure,
  isTerminalAuthCode,
  readAuthFailureCode,
  signOutForAuthCode,
} from './sessionHandler';

/** The default every BFF call used before this module existed. Do not raise globally. */
export const DEFAULT_API_TIMEOUT_MS = 8000;

/** Error thrown by `apiJson`. Shape is the contract the existing catch blocks read. */
export class ApiClientError extends Error {
  /** HTTP status, or `undefined` when the request never reached a server. */
  readonly status?: number;
  /** The server's `code` (e.g. ACCOUNT_SUSPENDED), when it sent one. */
  readonly code?: string;
  /** True for the failures a retry could plausibly fix (network, 408, 5xx). */
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { status?: number; code?: string; retryable?: boolean } = {}
  ) {
    // The queue classifiers (services/pendingQuestionBankScores.ts,
    // services/offlineFlashcardSync.ts) read the status out of the MESSAGE as
    // well as off the property, because one of them predates the property.
    // Both, so either classifier works — this is the same contract F1 gave
    // `recordQuestionBankScore`.
    const withStatus =
      options.status !== undefined && !/status:\s*\d/.test(message)
        ? `${message} (status: ${options.status})`
        : message;
    super(withStatus);
    this.name = 'ApiClientError';
    this.status = options.status;
    this.code = options.code;
    this.retryable =
      options.retryable ??
      (options.status === undefined || options.status === 408 || options.status >= 500);
  }
}

export interface ApiFetchOptions {
  /**
   * Abort after this many ms. Default `DEFAULT_API_TIMEOUT_MS` (8000).
   * `null` (or 0) means NO timeout — used by the call sites that were plain
   * `fetch` before this module existed, so migrating them could not introduce
   * a `Request timed out` throw they never used to produce.
   */
  timeoutMs?: number | null;
  /**
   * `'inject'` prepends `await getAuthHeaders()` (the caller's own headers still
   * win on a collision). Default `'none'`, because every existing call site
   * already builds `headers: await getAuthHeaders()` itself — and injecting
   * unconditionally would stamp `Content-Type: application/json` onto the
   * multipart uploads that deliberately leave it off.
   *
   * Independent of this: a request replayed after an auth refresh ALWAYS gets
   * fresh auth headers layered on top, or the retry would resend the token that
   * just 401'd (this is what `fetchWithTimeout` did, and it is load-bearing).
   */
  auth?: 'inject' | 'none';
  /** Allow the one auth-driven retry. Default true. */
  allowAuthRetry?: boolean;
  /**
   * Require a cached access token before treating a 401 as an expiry.
   * Default true — see guard (b) in the policy above.
   */
  requireCachedSession?: boolean;
  /** Opt in to the transient (network / 408 / 5xx) retry. Default false. */
  retryTransient?: boolean;
  /**
   * Declares a non-GET request safe to replay (the server dedupes it).
   * Only consulted when `retryTransient` is on; GET/HEAD are idempotent anyway.
   */
  idempotent?: boolean;
  /** Internal: the auth attempt number. Callers must not pass this. */
  attempt?: number;
}

/**
 * The timeout primitive. Returns the signal plus the `clear` that MUST run in a
 * `finally`, or a completed request leaves a pending timer (and, under fake
 * timers in tests, an open handle).
 */
export function timeoutSignal(
  timeoutMs: number | null,
  linkedTo?: AbortSignal | null
): { signal: AbortSignal; clear: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let didTimeOut = false;
  const armed = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0;
  const timer = armed
    ? setTimeout(() => {
        didTimeOut = true;
        controller.abort();
      }, timeoutMs as number)
    : undefined;
  const onLinkedAbort = () => controller.abort();
  if (linkedTo) {
    if (linkedTo.aborted) controller.abort();
    else linkedTo.addEventListener('abort', onLinkedAbort, { once: true });
  }
  return {
    signal: controller.signal,
    clear: () => {
      if (timer !== undefined) clearTimeout(timer);
      linkedTo?.removeEventListener?.('abort', onLinkedAbort);
    },
    timedOut: () => didTimeOut,
  };
}

/** `/api/v1/x` → `<apiRoot>/api/v1/x`; an absolute URL is passed through. */
function resolveUrl(path: string, apiRoot: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${apiRoot}${path.startsWith('/') ? '' : '/'}${path}`;
}

function isIdempotent(init: RequestInit, opts: ApiFetchOptions): boolean {
  if (opts.idempotent) return true;
  const method = (init.method || 'GET').toUpperCase();
  return method === 'GET' || method === 'HEAD';
}

/** Network failure (no response at all), including our own timeout sentinel. */
function isTransientThrow(error: unknown): boolean {
  const message = (error as { message?: string } | null)?.message ?? '';
  const name = (error as { name?: string } | null)?.name ?? '';
  return (
    message === 'Request timed out' ||
    name === 'TypeError' ||
    message.includes('Failed to fetch') ||
    message.includes('NetworkError')
  );
}

async function sendOnce(
  url: string,
  init: RequestInit,
  timeoutMs: number | null
): Promise<Response> {
  const { signal, clear, timedOut } = timeoutSignal(timeoutMs, init.signal ?? null);
  try {
    return await fetch(url, { ...init, signal });
  } catch (error: any) {
    // The sentence, not the AbortError: every existing catch block matches it.
    if (timedOut() || error?.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  } finally {
    clear();
  }
}

/**
 * The single transport. Same return contract as `fetch`: a non-ok status comes
 * back as a `Response`, only transport failures throw.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  opts: ApiFetchOptions = {}
): Promise<Response> {
  // Circular by construction: supabase.ts owns the token cache and imports this
  // module for its transport. The cost is one resolved module-map lookup.
  const { getApiRoot, getAuthHeaders, withApiCredentials, hasCachedAccessToken } = await import(
    './supabase'
  );

  const attempt = opts.attempt ?? 0;
  const timeoutMs = opts.timeoutMs === undefined ? DEFAULT_API_TIMEOUT_MS : opts.timeoutMs;
  const url = resolveUrl(path, getApiRoot());

  const callerHeaders = init.headers as Record<string, string> | undefined;
  const buildInit = async (): Promise<RequestInit> => {
    // Replay after a refresh: fresh auth headers LAST, so the stale
    // Authorization the caller captured before the 401 is overwritten.
    if (attempt > 0) {
      return withApiCredentials({
        ...init,
        headers: { ...callerHeaders, ...(await getAuthHeaders()) },
      });
    }
    if (opts.auth === 'inject') {
      return withApiCredentials({
        ...init,
        headers: { ...(await getAuthHeaders()), ...callerHeaders },
      });
    }
    return withApiCredentials(init);
  };

  let response: Response;
  try {
    response = await sendOnce(url, await buildInit(), timeoutMs);
  } catch (error) {
    if (opts.retryTransient && isIdempotent(init, opts) && isTransientThrow(error)) {
      return sendOnce(url, await buildInit(), timeoutMs);
    }
    throw error;
  }

  // A suspended account gets 403 { code: 'ACCOUNT_SUSPENDED' } on every
  // authenticated call and KEEPS its session; record it so App.tsx can render
  // the blocking notice (services/accountSuspension.ts). Non-blocking.
  if (response.status === 403) {
    void import('./accountSuspension').then(({ noteSuspendedResponse }) =>
      noteSuspendedResponse(response)
    );
  }

  if (
    (response.status === 401 || response.status === 403) &&
    opts.allowAuthRetry !== false
  ) {
    const code = await readAuthFailureCode(response);
    if (isTerminalAuthCode(code)) {
      signOutForAuthCode(code);
      return response;
    }
    // Guest guard: no token ever cached ⇒ this 401 is "endpoint needs auth",
    // not "your session died". Never notify, never refresh.
    if (opts.requireCachedSession !== false && !hasCachedAccessToken()) {
      return response;
    }
    if (await handleApiAuthFailure(response, { attempt })) {
      return apiFetch(path, init, { ...opts, attempt: attempt + 1 });
    }
    return response;
  }

  if (
    opts.retryTransient &&
    isIdempotent(init, opts) &&
    (response.status === 408 || response.status >= 500)
  ) {
    return sendOnce(url, await buildInit(), timeoutMs);
  }

  return response;
}

/** Best-effort `{ error, message, code }` read; never throws, never consumes twice. */
async function readErrorBody(
  response: Response
): Promise<{ error?: string; message?: string; code?: string }> {
  try {
    return (await response.clone().json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      code?: string;
    };
  } catch {
    return {};
  }
}

/**
 * `apiFetch` + "non-ok is an exception". The thrown `ApiClientError` carries
 * `.status` and `.code`, which is what the existing catch blocks read.
 */
export async function apiJson<T = any>(
  path: string,
  init: RequestInit = {},
  opts: ApiFetchOptions & { fallbackMessage?: string } = {}
): Promise<T> {
  const response = await apiFetch(path, init, opts);
  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new ApiClientError(
      body.error || body.message || opts.fallbackMessage || 'Request failed',
      { status: response.status, code: body.code }
    );
  }
  return (await response.json()) as T;
}
