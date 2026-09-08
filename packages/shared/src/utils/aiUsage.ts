/**
 * Format AI quota reset as a relative countdown (e.g. "Resets in 4h 23m").
 */

/** Default daily AI request quota per user (overridable via API `AI_DAILY_LIMIT` env). */
export const DEFAULT_AI_DAILY_LIMIT = 20;

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
  /**
   * Asking a question out loud, from the walk-through.
   *
   * A spoken question is the same question typed — it must not cost a lecture.
   * The clip is capped at VOICE_ASK_MAX_DURATION_MS, so the transcription
   * behind it is a few seconds of audio, and the only thing standing between a
   * student and asking is this daily cap. It is deliberately generous: 40 is
   * more spoken questions than a day of study contains, and the point of the
   * number is to bound a runaway loop, not to ration the feature.
   */
  voice_ask: 40,
} as const;

export type AIFeatureLimitKey = keyof typeof DEFAULT_AI_FEATURE_LIMITS;

/**
 * The features that have a daily cap but spend NO AI uses.
 *
 * The per-feature counter is a fairness rule about how much of one tool you
 * may run in a day; the global allowance is the currency. These keys have the
 * first and not the second: the limiter must enforce the cap without touching
 * the daily counter or the banked bonus, or the counter would tick down for
 * something the app told the student was free.
 */
export const ZERO_CREDIT_AI_FEATURES = ['voice_ask'] as const;

export type ZeroCreditAIFeatureKey = (typeof ZERO_CREDIT_AI_FEATURES)[number];

/** True when this feature key is capped but costs nothing. */
export function isZeroCreditAIFeature(featureKey: string | null | undefined): boolean {
  return (
    typeof featureKey === 'string' &&
    (ZERO_CREDIT_AI_FEATURES as readonly string[]).includes(featureKey)
  );
}

/** The feature key a spoken question is charged (or rather, not charged) under. */
export const VOICE_ASK_FEATURE_KEY = 'voice_ask';

/**
 * Longest clip the voice-ask path accepts, in milliseconds.
 *
 * This is what keeps "ask a question out loud" from becoming a free
 * transcription door: a 15-second clip is a question, and anything longer is
 * a recording, which goes through the priced lecture path instead. The server
 * checks the claimed duration AND the actual audio size, because a duration
 * in a request body is a claim.
 */
export const VOICE_ASK_MAX_DURATION_MS = 15_000;

/**
 * Largest audio payload the voice-ask path accepts, in bytes.
 *
 * The measured half of the same rule. 15 seconds of speech is tens of
 * kilobytes at any codec a phone records; 2 MB is far above that and still far
 * below a lecture, so an honest clip is never refused and a mislabelled
 * hour-long file cannot slip through by claiming to be 12 seconds.
 */
export const VOICE_ASK_MAX_AUDIO_BYTES = 2_000_000;

/** What the student is told when a voice question is too long. */
export const VOICE_ASK_TOO_LONG_MESSAGE = `Ask by voice takes a clip of up to ${Math.round(
  VOICE_ASK_MAX_DURATION_MS / 1000
)} seconds. Record the lecture instead if you want the whole thing written out.`;

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

// ─────────────────────────────────────────────────────────────
// What a student is told when a daily cap is reached
// ─────────────────────────────────────────────────────────────

/**
 * What each feature's daily allowance is a count OF, in plain words.
 *
 * On device the flashcard cap produced "Daily limit reached for this feature
 * (generate_flashcards). Try again tomorrow." — an internal key, in brackets,
 * shown to someone revising for an exam. The key is a routing detail; the
 * student's question is "how many of these do I get, and when do I get more?",
 * and that is what these nouns and the sentence below answer.
 *
 * A key with no entry falls back to `AI_LIMIT_FALLBACK_NOUN`: a new feature
 * added on the server must never be able to print its own key at a student.
 */
export const AI_FEATURE_LIMIT_NOUNS: Record<string, string> = {
  companion: 'AI chat replies',
  generate_questions: 'test runs',
  generate_flashcards: 'flashcard runs',
  explain: 'explanations',
  study_plan: 'study plans',
  enhance_flashcard: 'card rewrites',
  study_recommendations: 'study suggestions',
  listing_description: 'listing descriptions',
  voice_ask: 'spoken questions',
};

/** Said instead of a key nobody outside the server has ever seen. */
export const AI_LIMIT_FALLBACK_NOUN = 'AI runs';

/** The plain noun for a feature key, never the key itself. */
export function aiFeatureLimitNoun(featureKey: string | null | undefined): string {
  if (!featureKey) return AI_LIMIT_FALLBACK_NOUN;
  return AI_FEATURE_LIMIT_NOUNS[featureKey] ?? AI_LIMIT_FALLBACK_NOUN;
}

/**
 * When the allowance comes back, as a sentence — or nothing.
 *
 * `formatAIResetCountdown` returns "Resets in 3h 12m"; a limit message wants
 * that as its own sentence, and wants to say NOTHING rather than guess when
 * the server sent no window. "Try again tomorrow" was that guess, and it is
 * wrong for most of the day: the caps reset at midnight UTC, which for a
 * student in Lagos or Manila is the same afternoon.
 */
function resetSentence(resetsAt: string | null | undefined, nowMs?: number): string {
  // A stamp that will not parse produces "Resets in NaNm" from the countdown
  // formatter, so it is checked here rather than printed at a student.
  if (!resetsAt || Number.isNaN(Date.parse(resetsAt))) return '';
  const countdown = formatAIResetCountdown(resetsAt, nowMs ?? Date.now());
  return countdown ? `${countdown}.` : '';
}

/** Everything a limit message can be built from. `resetsAt` may be absent. */
export interface AILimitCopyInput {
  /** The per-feature key the SERVER capped on, or null for the global allowance. */
  featureKey?: string | null;
  /** The cap that was hit. */
  limit: number;
  /** ISO timestamp the window rolls over at, when the server knows one. */
  resetsAt?: string | null;
  nowMs?: number;
}

/**
 * The one sentence shown when a per-feature daily cap is reached.
 *
 * Names the number the student actually gets and when it comes back — the two
 * facts that make the message act-on-able — and never the feature key, which
 * is why this function exists rather than a template literal at each of the
 * three call sites in the limiter.
 */
export function describeAIFeatureLimitReached(input: AILimitCopyInput): string {
  const noun = aiFeatureLimitNoun(input.featureKey);
  const used = input.limit > 0 ? `You have used today's ${input.limit} ${noun}.` : `You have used today's ${noun}.`;
  const reset = resetSentence(input.resetsAt, input.nowMs);
  return reset ? `${used} ${reset}` : used;
}

/** The same sentence for the whole-account allowance, which has no feature. */
export function describeAIDailyLimitReached(input: Omit<AILimitCopyInput, 'featureKey'>): string {
  const used =
    input.limit > 0
      ? `You have used today's ${input.limit} AI uses.`
      : "You have used today's AI uses.";
  const reset = resetSentence(input.resetsAt, input.nowMs);
  return reset ? `${used} ${reset}` : used;
}
