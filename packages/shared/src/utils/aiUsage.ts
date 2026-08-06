/**
 * Format AI quota reset as a relative countdown (e.g. "Resets in 4h 23m").
 */

/** Default daily AI request quota per user (overridable via API `AI_DAILY_LIMIT` env). */
export const DEFAULT_AI_DAILY_LIMIT = 100;

/** Default per-feature daily AI quotas (overridable via `AI_LIMIT_<FEATURE>` env vars). */
export const DEFAULT_AI_FEATURE_LIMITS = {
  companion: 75,
  generate_questions: 15,
  generate_flashcards: 15,
  explain: 40,
  study_plan: 10,
  enhance_flashcard: 25,
  study_recommendations: 25,
  listing_description: 20,
} as const;

export type AIFeatureLimitKey = keyof typeof DEFAULT_AI_FEATURE_LIMITS;

export function formatAIResetCountdown(resetsAt: string, nowMs = Date.now()): string {
  if (!resetsAt) return '';
  const diffMs = new Date(resetsAt).getTime() - nowMs;
  if (diffMs <= 0) return 'Resets soon';
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return diffHrs > 0 ? `Resets in ${diffHrs}h ${diffMins}m` : `Resets in ${diffMins}m`;
}

/**
 * Format AI quota reset as an absolute local time (e.g. "Jun 14, 3:42 PM").
 */
export function formatAIResetTime(resetsAt: string): string {
  if (!resetsAt) return '';
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Human-readable reset label with fallbacks when the API has no active window yet.
 */
export function getAIResetLabel(
  resetsAt: string,
  opts: { used: number; limit: number; nowMs?: number }
): string {
  const { used, limit, nowMs = Date.now() } = opts;
  if (limit <= 0) return '';

  const countdown = formatAIResetCountdown(resetsAt, nowMs);
  if (countdown) return countdown;

  if (used === 0) return 'Resets at midnight GMT';
  if (used >= limit) return 'Resets soon';
  return 'Reset time updating...';
}
