/**
 * Server-side per-tag accuracy for the AI companion's weak-topic context.
 *
 * companionContext used to read `result.tagBreakdown`, which nothing produced,
 * so the companion never knew a weak topic. This is a server port of the
 * shared dashboard builder (packages/shared/src/utils/buildDashboardStats.ts
 * buildTopicPerformance): walk each session's `questions` jsonb, look up the
 * user's answer by question id, and tally correct/total per tag. Untagged
 * questions fall under "General" exactly as the dashboard shows them, so the
 * companion and the dashboards agree on what the weak topics are.
 */

export interface TagBreakdownEntry {
  total: number;
  correct: number;
}

export type TagBreakdown = Record<string, TagBreakdownEntry>;

/** A tag needs this many answered questions before it can be called weak. */
export const WEAK_TOPIC_MIN_QUESTIONS = 3;
/** Accuracy strictly below this (0..1) is weak. */
export const WEAK_TOPIC_MAX_ACCURACY = 0.6;
/** How many weak topics the companion context carries. */
export const WEAK_TOPIC_LIMIT = 5;
/** Sessions inspected per request — keeps the tally bounded and recent. */
export const WEAK_TOPIC_SESSION_LIMIT = 10;

export interface TagBreakdownSession {
  questions?: unknown;
  userAnswers?: unknown;
  user_answers?: unknown;
}

const GENERAL_TAG = 'General';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Mirrors the shared getQuestionTags: explicit tags, else "General". */
function questionTags(question: Record<string, unknown>): string[] {
  const raw = question.tags;
  if (Array.isArray(raw)) {
    const tags = new Set<string>();
    for (const tag of raw) {
      if (typeof tag !== 'string') continue;
      const trimmed = tag.trim();
      if (trimmed) tags.add(trimmed);
    }
    if (tags.size > 0) return [...tags];
  }
  return [GENERAL_TAG];
}

/**
 * Tally correct / total per tag across the given sessions. Accepts either the
 * camelCase rows fetchTestResults maps (`userAnswers`) or raw table rows
 * (`user_answers`). Sessions without questions or answers contribute nothing.
 */
export function buildTagBreakdown(
  sessions: Iterable<TagBreakdownSession | null | undefined>
): TagBreakdown {
  const breakdown: TagBreakdown = {};

  for (const session of sessions) {
    if (!session) continue;
    const questions = Array.isArray(session.questions) ? session.questions : [];
    const answersRaw = session.userAnswers ?? session.user_answers;
    if (questions.length === 0 || !isRecord(answersRaw)) continue;

    for (const question of questions) {
      if (!isRecord(question) || typeof question.id !== 'string') continue;
      const answer = answersRaw[question.id];
      // Same rule as the dashboard: an answer record means the question was
      // attempted; isCorrect decides the tally.
      if (!answer) continue;
      const isCorrect = isRecord(answer) && answer.isCorrect === true;

      for (const tag of questionTags(question)) {
        const entry = breakdown[tag] ?? (breakdown[tag] = { total: 0, correct: 0 });
        entry.total++;
        if (isCorrect) entry.correct++;
      }
    }
  }

  return breakdown;
}

/**
 * Tags with at least WEAK_TOPIC_MIN_QUESTIONS answered and accuracy below
 * WEAK_TOPIC_MAX_ACCURACY, weakest first, capped at WEAK_TOPIC_LIMIT.
 */
export function deriveWeakTopics(
  breakdown: TagBreakdown,
  options: { minQuestions?: number; maxAccuracy?: number; limit?: number } = {}
): string[] {
  const minQuestions = options.minQuestions ?? WEAK_TOPIC_MIN_QUESTIONS;
  const maxAccuracy = options.maxAccuracy ?? WEAK_TOPIC_MAX_ACCURACY;
  const limit = options.limit ?? WEAK_TOPIC_LIMIT;

  return Object.entries(breakdown)
    .filter(([, stats]) => stats.total >= minQuestions)
    .map(([tag, stats]) => ({ tag, accuracy: stats.correct / stats.total }))
    .filter(({ accuracy }) => accuracy < maxAccuracy)
    .sort((a, b) => a.accuracy - b.accuracy || a.tag.localeCompare(b.tag))
    .slice(0, limit)
    .map(({ tag }) => tag);
}
