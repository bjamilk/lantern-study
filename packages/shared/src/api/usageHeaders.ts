import type { AIUsageInfo } from '../types';

/** Minimal header reader — works with `Headers`, `Response.headers`, and XHR adapters. */
export type AIUsageHeaderReader = {
  get(name: string): string | null;
};

/**
 * Updates global AI usage from response headers.
 * Skips feature-scoped quotas (e.g. companion) — those use separate counters on the server.
 */
export function parseGlobalAIUsageFromHeaderReader(
  headers: AIUsageHeaderReader,
  onUsageUpdate?: (usage: AIUsageInfo) => void
): void {
  // Case-insensitive: Fetch Headers are, XHR getResponseHeader is; normalize for plain maps.
  const feature =
    headers.get('X-AI-Feature') ||
    headers.get('x-ai-feature');
  if (feature) return;

  const usedHeader =
    headers.get('X-AI-Usage-Used') || headers.get('x-ai-usage-used');
  const limitHeader =
    headers.get('X-AI-Usage-Limit') || headers.get('x-ai-usage-limit');
  const resetsHeader =
    headers.get('X-AI-Usage-Resets-At') || headers.get('x-ai-usage-resets-at');
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
