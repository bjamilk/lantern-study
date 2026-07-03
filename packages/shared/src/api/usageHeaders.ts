import type { AIUsageInfo } from '../types';

/**
 * Updates global AI usage from response headers.
 * Skips feature-scoped quotas (e.g. companion) — those use separate counters on the server.
 */
export function parseGlobalAIUsageFromHeaders(
  response: Response,
  onUsageUpdate?: (usage: AIUsageInfo) => void
): void {
  if (response.headers.get('X-AI-Feature')) return;

  const usedHeader = response.headers.get('X-AI-Usage-Used');
  const limitHeader = response.headers.get('X-AI-Usage-Limit');
  const resetsHeader = response.headers.get('X-AI-Usage-Resets-At');
  if (usedHeader && limitHeader) {
    const used = parseInt(usedHeader, 10);
    const limit = parseInt(limitHeader, 10);
    onUsageUpdate?.({
      used,
      limit,
      remaining: limit - used,
      resetsAt: resetsHeader || '',
    });
  }
}
