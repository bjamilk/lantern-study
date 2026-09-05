// ===========================================
// Lantern Study - Shared API Client Factory
// ===========================================

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

export function createApiClient(config: ApiClientConfig): ApiClient {
  const defaultTimeout = config.defaultTimeoutMs ?? 10000;

  const requestRaw = async <T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs = defaultTimeout,
    allowRetry = true
  ): Promise<T> => {
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
          return requestRaw<T>(endpoint, options, timeoutMs, false);
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
        throw new VersionConflictError(
          errBody.error || errBody.message || 'Resource was updated elsewhere',
          errBody.data ?? null
        );
      }
      const errBody = error as {
        message?: string;
        error?: string;
        code?: string;
        suspendedUntil?: string;
      };
      const genericErrors = new Set(['Error', 'ApiError', 'Request failed']);
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

  const requestText = async (
    endpoint: string,
    options: RequestInit = {},
    timeoutMs = defaultTimeout
  ): Promise<string> => {
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
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }
    return response.text();
  };

  return {
    request,
    requestRaw,
    requestText,
    getBaseUrl: config.getBaseUrl,
  };
}
