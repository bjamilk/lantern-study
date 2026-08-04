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

export interface ApiClientConfig {
  getBaseUrl: () => string;
  getAuthHeaders: AuthHeadersProvider;
  defaultTimeoutMs?: number;
  credentials?: RequestCredentials;
  /** Called once after a 401 when refreshAuth returns true and request is retried. */
  refreshAuth?: () => Promise<boolean>;
  /** Called when session cannot be refreshed (sign out / show login). */
  onUnauthorized?: () => void;
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

      // Retry once after refresh. Only hard-sign-out when refresh fails
      // (no recoverable session). A post-refresh 401 can be bootstrap race —
      // throw without signing out so login fan-out does not bounce users.
      if (allowRetry && config.refreshAuth) {
        const refreshed = await config.refreshAuth();
        if (refreshed) {
          return requestRaw<T>(endpoint, options, timeoutMs, false);
        }
        config.onUnauthorized?.();
        const errBody = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(errBody.message || 'Session ended. Please sign in again.');
      }

      if (allowRetry && !config.refreshAuth) {
        config.onUnauthorized?.();
        const errBody = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(errBody.message || 'Session ended. Please sign in again.');
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
      const errBody = error as { message?: string; error?: string };
      const genericErrors = new Set(['Error', 'ApiError', 'Request failed']);
      const detail =
        errBody.message && (!errBody.error || genericErrors.has(errBody.error))
          ? errBody.message
          : errBody.error || errBody.message || `HTTP error ${response.status}`;
      const requestError = new Error(detail) as Error & {
        status?: number;
        deliveryUncertain?: boolean;
      };
      requestError.status = response.status;
      requestError.deliveryUncertain = response.status === 408 || response.status >= 500;
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
