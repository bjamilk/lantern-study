/**
 * Mobile AI Service — thin wrapper around @lantern/shared/api AI + companion clients
 */
import { createLanternAI } from '@lantern/shared/api';
import type { AIUsageInfo } from '@lantern/shared';
import { DEFAULT_AI_DAILY_LIMIT } from '@lantern/shared/utils/aiUsage';
import { getAuthHeaders, API_BASE_URL, supabase } from './supabase';

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
  defaultTimeoutMs: 30000,
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
export const aiGenerateQuestions = ai.aiGenerateQuestions;
export const aiGenerateFlashcards = ai.aiGenerateFlashcards;
export const aiExplainAnswer = ai.aiExplainAnswer;
export const aiGetStudyRecommendations = ai.aiGetStudyRecommendations;
export const aiAskTutor = ai.aiAskTutor;
export const aiEnhanceFlashcard = ai.aiEnhanceFlashcard;
export const aiHealthCheck = ai.aiHealthCheck;
export const aiGenerateListingDescription = ai.aiGenerateListingDescription;

export const companionSendMessage = companion.companionSendMessage;
export const fetchCompanionHistory = companion.fetchCompanionHistory;
export const clearCompanionHistory = companion.clearCompanionHistory;
export const companionSendMessageStream = companion.companionSendMessageStream;
export const submitCompanionFeedback = companion.submitCompanionFeedback;
export const trackAIAnalyticsEvent = companion.trackAIAnalyticsEvent;
export const summarizeGroupChat = companion.summarizeGroupChat;
