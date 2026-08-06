import type { AIUsageInfo } from '../types';

/** Minimal header reader — works with `Headers`, `Response.headers`, and XHR adapters. */
export type AIUsageHeaderReader = {
  get(name: string): string | null;
};

function header(
  headers: AIUsageHeaderReader,
  ...names: string[]
): string | null {
  for (const name of names) {
    const value = headers.get(name);
    if (value) return value;
  }
  return null;
}

/**
 * Updates global AI usage from response headers.
 *
 * Preference order:
 * 1. Explicit global headers (`X-AI-Global-Usage-*`) — present on feature routes
 *    that also charge the global daily counter.
 * 2. Legacy `X-AI-Usage-*` when `X-AI-Feature` is absent (global-only routes).
 *
 * Feature-scoped `X-AI-Usage-*` alone (without global headers) is ignored so a
 * 15-limit tool cannot overwrite the 100-limit badge.
 */
export function parseGlobalAIUsageFromHeaderReader(
  headers: AIUsageHeaderReader,
  onUsageUpdate?: (usage: AIUsageInfo) => void
): void {
  const globalUsed = header(
    headers,
    'X-AI-Global-Usage-Used',
    'x-ai-global-usage-used'
  );
  const globalLimit = header(
    headers,
    'X-AI-Global-Usage-Limit',
    'x-ai-global-usage-limit'
  );
  const globalResets = header(
    headers,
    'X-AI-Global-Usage-Resets-At',
    'x-ai-global-usage-resets-at'
  );

  if (globalUsed && globalLimit) {
    const used = parseInt(globalUsed, 10);
    const limit = parseInt(globalLimit, 10);
    if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return;
    onUsageUpdate?.({
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetsAt: globalResets || '',
    });
    return;
  }

  const feature = header(headers, 'X-AI-Feature', 'x-ai-feature');
  if (feature) return;

  const usedHeader = header(headers, 'X-AI-Usage-Used', 'x-ai-usage-used');
  const limitHeader = header(headers, 'X-AI-Usage-Limit', 'x-ai-usage-limit');
  const resetsHeader = header(
    headers,
    'X-AI-Usage-Resets-At',
    'x-ai-usage-resets-at'
  );
  if (usedHeader && limitHeader) {
    const used = parseInt(usedHeader, 10);
    const limit = parseInt(limitHeader, 10);
    if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return;
    onUsageUpdate?.({
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetsAt: resetsHeader || '',
    });
  }
}

export function parseGlobalAIUsageFromHeaders(
  response: Response,
  onUsageUpdate?: (usage: AIUsageInfo) => void
): void {
  parseGlobalAIUsageFromHeaderReader(response.headers, onUsageUpdate);
}

/** Adapter for XMLHttpRequest response headers (web notes AI XHR path). */
export function xhrHeaderReader(xhr: {
  getResponseHeader(name: string): string | null;
}): AIUsageHeaderReader {
  return {
    get: (name: string) => xhr.getResponseHeader(name),
  };
}
