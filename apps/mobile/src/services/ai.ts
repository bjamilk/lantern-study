/**
 * Mobile AI Service — thin wrapper around @lantern/shared/api AI + companion clients
 */
import { createLanternAI, parseGlobalAIUsageFromHeaders } from '@lantern/shared/api';
import type { AIUsageInfo } from '@lantern/shared';
import { isAIUsageKnown } from '@lantern/shared/utils/aiUsage';
import type {
  FlashcardGenerationDifficulty,
  FlashcardTypeMix,
} from '@lantern/shared/flashcards/generationOptions';
import { getAuthHeaders, API_BASE_URL, supabase } from './supabase';
import { settleJob } from './jobWatch';
import { getLatestAIUsage, publishAIUsage, subscribeToAIUsage } from './aiUsageStore';

export type {
  AIGeneratedQuestion,
  AIGeneratedFlashcard,
  AIStudyRecommendation,
} from '@lantern/shared/api';

export type {
  CompanionUserContext,
  CompanionAction,
  CompanionMessage,
  AIUsageInfo,
} from '@lantern/shared';

function updateUsage(usage: AIUsageInfo) {
  publishAIUsage(usage);
}

/** Apply global AI quota headers from a fetch Response (notes AI paths). */
export function applyAIUsageFromResponse(response: Response): void {
  parseGlobalAIUsageFromHeaders(response, updateUsage);
}

/**
 * Decide what a 429 error body should do to the usage badge — PURE, so every
 * branch is unit-tested without the AI client or the store.
 *
 * A 429 is the ONE moment the server states this account's real figures on a
 * cold start whose usage fetch failed. The rules:
 *  - the body must carry numeric `used` and `limit`, or it says nothing;
 *  - a feature denial (`body.feature` set) counts on a DIFFERENT, per-feature
 *    scale and must never be written to the global badge;
 *  - when the current figures are NOT known (the store starts at the explicit
 *    unknown, limit 0), accept the body — this is the truth we were missing;
 *  - when they ARE known, a body whose `limit` differs is STALE and is refused,
 *    so a lagging refusal cannot clobber a known-good allowance.
 *
 * Returns the usage to publish, or null to leave the badge untouched.
 */
export function planAIUsageFromErrorBody(
  data: unknown,
  latest: AIUsageInfo
): AIUsageInfo | null {
  const body = data as { used?: number; limit?: number; resetsAt?: string; feature?: string };
  if (!body || typeof body.used !== 'number' || typeof body.limit !== 'number') return null;
  if (body.feature) return null;
  // Only reject a differing limit once we actually KNOW the current one; before
  // that, a mismatch is exactly the figure we lacked, not a stale one.
  if (isAIUsageKnown(latest) && body.limit !== latest.limit) return null;
  return {
    used: body.used,
    limit: body.limit,
    remaining: Math.max(0, body.limit - body.used),
    resetsAt: body.resetsAt || latest.resetsAt,
  };
}

/**
 * Apply usage from a 429 error body ({ used, limit, resetsAt }) so a refused
 * request corrects the badge. See {@link planAIUsageFromErrorBody} for the rules.
 */
export function applyAIUsageFromErrorBody(data: unknown): void {
  const next = planAIUsageFromErrorBody(data, getLatestAIUsage());
  if (next) updateUsage(next);
}

async function getCurrentUserId(): Promise<string | undefined> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id;
}

const { ai, companion } = createLanternAI({
  getBaseUrl: () => API_BASE_URL,
  getAuthHeaders,
  getUserId: getCurrentUserId,
  onUsageUpdate: updateUsage,
  // Initial enqueue is fast; async job polling has its own timeout.
  defaultTimeoutMs: 120_000,
  // React Native's fetch resolves with a null body, so the streaming companion
  // endpoint can never be read here — every message failed with
  // "Stream request failed (200)" until this routed to the whole-reply endpoint.
  supportsResponseStreaming: false,
});

/**
 * The badge's numbers and everything that watches them live in
 * `services/aiUsageStore`, so the job poller can publish a refund without
 * importing this module back. Re-exported here because every caller in the app
 * already asks `services/ai` for them.
 */
export { getLatestAIUsage, subscribeToAIUsage };

export const fetchAIUsage = ai.fetchAIUsage;
/**
 * The full usage payload — global counts plus each feature's own daily cap.
 * Read by the Usage & limits screen only; it also republishes the global
 * counts to `subscribeToAIUsage`, so opening that screen re-syncs the badge.
 */
export const fetchAIUsageDetail = ai.fetchAIUsageDetail;

// Every generator below may answer 202 in production (BullMQ is on). The
// shared client watches such a job for 90 s and then throws
// JobStillRunningError — the right signal for a sheet, the wrong one for the
// runner that has to save the result, which would otherwise report a running,
// already-charged job as failed. settleJob carries it to the real end.
export const aiGenerateQuestions: typeof ai.aiGenerateQuestions = (notes, options) =>
  settleJob(() => ai.aiGenerateQuestions(notes, options));
/**
 * Options the generation sheet sends, which is more than the shared client
 * declares today.
 *
 * `POST /ai/generate-flashcards` accepts `typeMix`, `clozeCount` and
 * `difficulty` (apps/api-server/src/routes/ai.ts) and the shared options model
 * puts them in the request body it plans
 * (`@lantern/shared/flashcards/generationOptions`), but the shared AI client's
 * option type still lists only `{ count, style, onJobUpdate }`
 * (packages/shared/src/api/ai.ts). It spreads whatever else it is given
 * straight into the JSON body, so widening the type here is enough for mobile
 * to send them — no shared change, and nothing to undo but this block when the
 * client declares the fields itself.
 */
export type GenerateFlashcardsOptions = NonNullable<
  Parameters<typeof ai.aiGenerateFlashcards>[1]
> & {
  typeMix?: FlashcardTypeMix;
  clozeCount?: number;
  difficulty?: FlashcardGenerationDifficulty;
};

export const aiGenerateFlashcards = (
  notes: string,
  options?: GenerateFlashcardsOptions
): ReturnType<typeof ai.aiGenerateFlashcards> =>
  settleJob(() => ai.aiGenerateFlashcards(notes, options));
export const aiExplainAnswer: typeof ai.aiExplainAnswer = (...args) =>
  settleJob(() => ai.aiExplainAnswer(...args));
export const aiGetStudyRecommendations: typeof ai.aiGetStudyRecommendations = (...args) =>
  settleJob(() => ai.aiGetStudyRecommendations(...args));
export const aiAskTutor: typeof ai.aiAskTutor = (...args) => settleJob(() => ai.aiAskTutor(...args));
export const aiEnhanceFlashcard: typeof ai.aiEnhanceFlashcard = (...args) =>
  settleJob(() => ai.aiEnhanceFlashcard(...args));
export const aiHealthCheck = ai.aiHealthCheck;
export const aiGenerateListingDescription = ai.aiGenerateListingDescription;

export const companionSendMessage = companion.companionSendMessage;
export const fetchCompanionHistory = companion.fetchCompanionHistory;
export const clearCompanionHistory = companion.clearCompanionHistory;
export const fetchCompanionConversations = companion.fetchCompanionConversations;
export const createCompanionConversation = companion.createCompanionConversation;
export const companionSendMessageStream = companion.companionSendMessageStream;
export const submitCompanionFeedback = companion.submitCompanionFeedback;
export const trackAIAnalyticsEvent = companion.trackAIAnalyticsEvent;
export const summarizeGroupChat = companion.summarizeGroupChat;
