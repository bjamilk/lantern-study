// ===========================================
// Lantern Study - Shared API Client Factory
// ===========================================
//
// PURPOSE
//   The single `fetch` wrapper every call to the Lantern API goes through.
//   It owns four things that must never diverge between platforms: the base
//   URL + `/api/v1` prefix, the auth-header/credentials handshake, the 401
//   refresh-and-retry dance, and the translation of a non-2xx response into a
//   typed Error a screen can show a student. Endpoint modules (./endpoints,
//   ./companion) are thin callers on top of the ApiClient this returns.
//
// CONSUMERS
//   web    — builds one client with `credentials: 'include'`, because the web
//            session lives in httpOnly cookies minted by the Cloudflare Pages
//            BFF; its getAuthHeaders returns a placeholder, not a real token.
//   mobile — builds one client with a real Supabase bearer token and a
//            `refreshAuth` backed by the Supabase session.
//   api    — does NOT use this; the server talks to Supabase directly.
//
// GOTCHAS
//   - `packages/shared` is consumed BUILT. Run `npm run build` in
//     packages/shared before typechecking or running the apps, or consumers
//     resolve a stale `dist/` and you will debug a bug you already fixed.
//   - The web turbo build compiles with strict `noUncheckedIndexedAccess`;
//     any indexed read added here must be narrowed before use.
//   - `refreshAuth` is deliberately tri-state (`true` / `false` / `'transient'`).
//     A boolean cannot distinguish "the session was revoked" from "the auth
//     server was unreachable", and collapsing the two is exactly what signed
//     students out on every flaky connection. Do not simplify it back.
//   - Errors thrown from here carry `status`, and may carry `code`,
//     `suspendedUntil` and `deliveryUncertain`. Callers that retry MUST check
//     `deliveryUncertain` before assuming the write did not land.

import { parseRetryAfterMs, RateLimitError } from './marketplaceCache';
import { VersionConflictError } from './versionConflict';

/**
 * Assemble request headers, dropping Content-Type for multipart bodies.
 *
 * getAuthHeaders always sets `Content-Type: application/json`. That is right for
 * the JSON endpoints but fatal for a FormData upload: the boundary is generated
 * by the platform when it serialises the body, and forcing a content type stops
 * it being set. React Native then fails the request outright with a bare
 * "Network request failed" — no status code — which reads like the server is
 * unreachable rather than a header problem.
 */
function buildHeaders(
  authHeaders: Record<string, string>,
  options: RequestInit
): Record<string, string> {
  const merged: Record<string, string> = {
    'X-Requested-With': 'LanternStudy',
    ...authHeaders,
    ...(options.headers as Record<string, string> | undefined),
  };

  const isMultipart =
    typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (isMultipart) {
    for (const key of Object.keys(merged)) {
      if (key.toLowerCase() === 'content-type') delete merged[key];
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Offline-vs-revoked 401 vocabulary
// ---------------------------------------------------------------------------
// The distinction these three exports encode is the whole reason mobile stopped
// signing students out (and discarding their unsynced work) on a dropped
// connection. An "offline auth error" means: we could neither verify nor
// disprove the session, so we kept it. Screens should show the message and let
// the student retry; they must NOT treat it as a sign-out.

export type AuthHeadersProvider = () => Promise<Record<string, string>>;

/**
 * Shown when a 401 could not be resolved because the refresh never reached the
 * auth server. Shared so web and mobile say the same thing (house rule), and
 * so the copy states the fact that matters most: nothing was lost.
 */
export const OFFLINE_AUTH_MESSAGE =
  'You appear to be offline. Your session is safe — reconnect to continue.';

export interface OfflineAuthError extends Error {
  status: 401;
  offline: true;
}

/** The 401 we throw when the session could not be verified OR disproved. */
export function createOfflineAuthError(): OfflineAuthError {
  const error = new Error(OFFLINE_AUTH_MESSAGE) as OfflineAuthError;
  error.status = 401;
  error.offline = true;
  return error;
}

/** True for the "session is safe, the network is not" 401 above. */
export function isOfflineAuthError(error: unknown): error is OfflineAuthError {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { offline?: unknown }).offline === true &&
    (error as { status?: unknown }).status === 401
  );
}

// ---------------------------------------------------------------------------
// Client configuration + the client surface
// ---------------------------------------------------------------------------
// One ApiClient per app, built once at boot. `request` is what almost every
// caller wants (it unwraps the API's `{ data }` envelope); `requestRaw` is for
// the handful of endpoints that return a bare body or need the envelope's
// siblings (pagination, meta).

export interface ApiClientConfig {
  getBaseUrl: () => string;
  getAuthHeaders: AuthHeadersProvider;
  defaultTimeoutMs?: number;
  credentials?: RequestCredentials;
  /**
   * Re-mint the session after a 401.
   *
   * `true` — refreshed, retry the request once.
   * `false` — the session is PROVEN dead; onUnauthorized runs (sign out).
   * `'transient'` — the refresh never reached the auth server, so nothing is
   *   proven. onOffline runs and an offline 401 is thrown; onUnauthorized must
   *   NOT run, because a boolean cannot tell "revoked" from "unreachable" and
   *   collapsing the two is how a dropped connection signed students out.
   */
  refreshAuth?: () => Promise<boolean | 'transient'>;
  /** Called when session cannot be refreshed (sign out / show login). */
  onUnauthorized?: () => void;
  /** Called when a 401 could not be resolved because the network is down. */
  onOffline?: () => void;
}

export interface ApiClient {
  request: <T>(endpoint: string, options?: RequestInit, timeoutMs?: number) => Promise<T>;
  requestRaw: <T>(endpoint: string, options?: RequestInit, timeoutMs?: number) => Promise<T>;
  requestText: (endpoint: string, options?: RequestInit, timeoutMs?: number) => Promise<string>;
  getBaseUrl: () => string;
}

const fetchWithTimeout = async (
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// The factory
// ---------------------------------------------------------------------------
// Request lifecycle, in order:
//   1. resolve auth headers, strip Content-Type for FormData
//   2. fetch with an AbortController timeout
//   3. 401 -> definitive codes sign out; otherwise refresh once and retry, or
//      raise an offline 401 when nothing is proven
//   4. non-2xx -> 429 becomes RateLimitError, 409 becomes VersionConflictError,
//      everything else becomes an Error carrying status/code/deliveryUncertain
//   5. 2xx -> parsed JSON

export function createApiClient(config: ApiClientConfig): ApiClient {
  const defaultTimeout = config.defaultTimeoutMs ?? 10000;

  /**
   * The ONE request core: auth headers, timeout, the 401 refresh/sign-out
   * policy, and the non-2xx → typed-Error mapping. It returns the raw ok
   * `Response`; the parser is the caller's (`requestRaw` reads JSON,
   * `requestText` reads text).
   *
   * FIXED (F9 · E3 L2): `requestText` used to be a SECOND copy of the fetch
   * that skipped all of this — no refresh, no SESSION_REVOKED, no
   * offline-vs-revoked distinction — and collapsed every failure into a bare
   * `HTTP error <status>` with no `status`/`code` on the Error. A student with
   * a just-expired token exporting a deck to CSV got a number and no recovery
   * on a perfectly good connection. Both parsers share this core now.
   */
  const requestResponse = async (
    endpoint: string,
    options: RequestInit = {},
    timeoutMs = defaultTimeout,
    allowRetry = true
  ): Promise<Response> => {
    const headers = await config.getAuthHeaders();
    const response = await fetchWithTimeout(
      `${config.getBaseUrl()}/api/v1${endpoint}`,
      {
        ...options,
        credentials: options.credentials ?? config.credentials ?? 'same-origin',
        headers: buildHeaders(headers, options),
      },
      timeoutMs
    );

    if (response.status === 401) {
      let authCode: string | undefined;
      try {
        const clone = response.clone();
        const body = (await clone.json().catch(() => ({}))) as { code?: string };
        authCode = body.code;
      } catch {
        authCode = undefined;
      }

      const definitiveAuthFailure =
        authCode === 'SESSION_REVOKED' ||
        authCode === 'ACCOUNT_BANNED' ||
        authCode === 'ACCOUNT_DEACTIVATED';

      if (definitiveAuthFailure) {
        config.onUnauthorized?.();
        const errBody = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(errBody.message || 'Session ended. Please sign in again.');
      }

      // Retry once after refresh. Only hard-sign-out when the refresh PROVED
      // the session is dead. A post-refresh 401 can be a bootstrap race —
      // throw without signing out so login fan-out does not bounce users.
      if (allowRetry && config.refreshAuth) {
        const refreshed = await config.refreshAuth();
        if (refreshed === true) {
          return requestResponse(endpoint, options, timeoutMs, false);
        }
        if (refreshed === 'transient') {
          // Unreachable auth server: nothing is proven, so the session stays.
          config.onOffline?.();
          throw createOfflineAuthError();
        }
        config.onUnauthorized?.();
        const errBody = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(errBody.message || 'Session ended. Please sign in again.');
      }

      if (allowRetry && !config.refreshAuth) {
        // Same gate: with no way to attempt a refresh this 401 carries no proof
        // either way (the definitive codes were handled above), so it must not
        // sign anyone out.
        config.onOffline?.();
        throw createOfflineAuthError();
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      if (response.status === 429) {
        const errBody = error as { message?: string; error?: string };
        const detail = errBody.message || errBody.error || 'Rate limit exceeded';
        throw new RateLimitError(detail, parseRetryAfterMs(response));
      }
      if (response.status === 409) {
        const errBody = error as {
          message?: string;
          error?: string;
          code?: string;
          data?: unknown;
        };
        // `error` is preferred when it is a sentence, but the global API error
        // handler puts the error CLASS NAME there ('Error') and the sentence in
        // `message` — so a 409 from the idempotency layer used to surface as
        // the bare word "Error". Same exception list as the general branch
        // below; the body's own `code` is carried through instead of being
        // flattened to 'version_conflict'.
        const label = errBody.error;
        const isClassLabel = !label || label === 'Error' || label === 'ApiError';
        throw new VersionConflictError(
          (isClassLabel ? errBody.message : label) ||
            errBody.error ||
            errBody.message ||
            'Resource was updated elsewhere',
          errBody.data ?? null,
          errBody.code
        );
      }
      const errBody = error as {
        message?: string;
        error?: string;
        code?: string;
        suspendedUntil?: string;
      };
      // `error` is preferred over `message` because it is usually the sentence
      // written for a student. These are the exceptions: labels that name a
      // CLASS of failure and say nothing about this one, while `message` holds
      // the actual reason. 'Validation Error' is what every express-validator
      // rejection sets, so a save refused for one bad field reached the student
      // as the bare words "Validation Error" — and the sheet's "Save to
      // library" then re-failed identically, which is how a fixable 400 looked
      // like a dead button.
      const genericErrors = new Set([
        'Error',
        'ApiError',
        'Request failed',
        'Validation Error',
        'Bad Request',
      ]);
      const detail =
        errBody.message && (!errBody.error || genericErrors.has(errBody.error))
          ? errBody.message
          : errBody.error || errBody.message || `HTTP error ${response.status}`;
      const requestError = new Error(detail) as Error & {
        status?: number;
        deliveryUncertain?: boolean;
        /** Machine-readable code from the API body (e.g. ACCOUNT_SUSPENDED). */
        code?: string;
        /** ISO timestamp carried by ACCOUNT_SUSPENDED responses. */
        suspendedUntil?: string;
      };
      requestError.status = response.status;
      requestError.deliveryUncertain = response.status === 408 || response.status >= 500;
      if (typeof errBody.code === 'string') requestError.code = errBody.code;
      if (typeof errBody.suspendedUntil === 'string') requestError.suspendedUntil = errBody.suspendedUntil;
      throw requestError;
    }

    return response;
  };

  const requestRaw = async <T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs = defaultTimeout
  ): Promise<T> => {
    const response = await requestResponse(endpoint, options, timeoutMs);
    return response.json() as Promise<T>;
  };

  const request = async <T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs = defaultTimeout
  ): Promise<T> => {
    const result = await requestRaw<{ data: T }>(endpoint, options, timeoutMs);
    return result.data;
  };

  /** Same core as `requestRaw` (see there), parsed as text. */
  const requestText = async (
    endpoint: string,
    options: RequestInit = {},
    timeoutMs = defaultTimeout
  ): Promise<string> => {
    const response = await requestResponse(endpoint, options, timeoutMs);
    return response.text();
  };

  return {
    request,
    requestRaw,
    requestText,
    getBaseUrl: config.getBaseUrl,
  };
}
