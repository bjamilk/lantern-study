/**
 * Mobile AI Service — thin wrapper around @lantern/shared/api AI + companion clients
 */
import { createLanternAI, parseGlobalAIUsageFromHeaders } from '@lantern/shared/api';
import type { AIUsageInfo } from '@lantern/shared';
import { DEFAULT_AI_DAILY_LIMIT } from '@lantern/shared/utils/aiUsage';
import { getAuthHeaders, API_BASE_URL, supabase } from './supabase';
import { settleJob } from './jobWatch';

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

let _latestUsage: AIUsageInfo = {
  used: 0,
  limit: DEFAULT_AI_DAILY_LIMIT,
  remaining: DEFAULT_AI_DAILY_LIMIT,
  resetsAt: '',
};
const _usageListeners = new Set<(usage: AIUsageInfo) => void>();

function updateUsage(usage: AIUsageInfo) {
  _latestUsage = usage;
  _usageListeners.forEach((fn) => fn(usage));
}

/** Apply global AI quota headers from a fetch Response (notes AI paths). */
export function applyAIUsageFromResponse(response: Response): void {
  parseGlobalAIUsageFromHeaders(response, updateUsage);
}

/**
 * Apply usage from a 429 error body ({ used, limit, resetsAt }) so a refused
 * request corrects the badge. Feature denials (body.feature set) use a
 * different scale and are skipped.
 */
export function applyAIUsageFromErrorBody(data: unknown): void {
  const body = data as { used?: number; limit?: number; resetsAt?: string; feature?: string };
  if (!body || typeof body.used !== 'number' || typeof body.limit !== 'number') return;
  if (body.feature) return;
  if (body.limit !== _latestUsage.limit) return;
  updateUsage({
    used: body.used,
    limit: body.limit,
    remaining: Math.max(0, body.limit - body.used),
    resetsAt: body.resetsAt || _latestUsage.resetsAt,
  });
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

export function getLatestAIUsage(): AIUsageInfo {
  return _latestUsage;
}

export function subscribeToAIUsage(listener: (usage: AIUsageInfo) => void): () => void {
  _usageListeners.add(listener);
  return () => {
    _usageListeners.delete(listener);
  };
}

export const fetchAIUsage = ai.fetchAIUsage;

// Every generator below may answer 202 in production (BullMQ is on). The
// shared client watches such a job for 90 s and then throws
// JobStillRunningError — the right signal for a sheet, the wrong one for the
// runner that has to save the result, which would otherwise report a running,
// already-charged job as failed. settleJob carries it to the real end.
export const aiGenerateQuestions: typeof ai.aiGenerateQuestions = (notes, options) =>
  settleJob(() => ai.aiGenerateQuestions(notes, options));
export const aiGenerateFlashcards: typeof ai.aiGenerateFlashcards = (notes, options) =>
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
