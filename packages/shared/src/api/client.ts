// ===========================================
// Lantern Study - Shared API Client Factory
// ===========================================

import { parseRetryAfterMs, RateLimitError } from './marketplaceCache';

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
        headers: {
          'X-Requested-With': 'LanternStudy',
          ...headers,
          ...options.headers,
        },
      },
      timeoutMs
    );

    if (response.status === 401 && allowRetry) {
      let authCode: string | undefined;
      try {
        const clone = response.clone();
        const body = (await clone.json().catch(() => ({}))) as { code?: string };
        authCode = body.code;
      } catch {
        authCode = undefined;
      }
      if (authCode === 'SESSION_REVOKED' || authCode === 'ACCOUNT_BANNED' || authCode === 'ACCOUNT_DEACTIVATED') {
        config.onUnauthorized?.();
        const errBody = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(errBody.message || 'Session ended. Please sign in again.');
      }
      if (config.refreshAuth) {
        const refreshed = await config.refreshAuth();
        if (refreshed) {
          return requestRaw<T>(endpoint, options, timeoutMs, false);
        }
        config.onUnauthorized?.();
      } else {
        config.onUnauthorized?.();
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      if (response.status === 401) {
        config.onUnauthorized?.();
      }
      if (response.status === 429) {
        const errBody = error as { message?: string; error?: string };
        const detail = errBody.message || errBody.error || 'Rate limit exceeded';
        throw new RateLimitError(detail, parseRetryAfterMs(response));
      }
      const errBody = error as { message?: string; error?: string };
      const genericErrors = new Set(['Error', 'ApiError', 'Request failed']);
      const detail =
        errBody.message && (!errBody.error || genericErrors.has(errBody.error))
          ? errBody.message
          : errBody.error || errBody.message || `HTTP error ${response.status}`;
      throw new Error(detail);
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
        headers: {
          'X-Requested-With': 'LanternStudy',
          ...headers,
          ...options.headers,
        },
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
