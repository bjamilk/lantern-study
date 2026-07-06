// ===========================================
// Lantern Study - Shared AI API Client
// ===========================================

import type {
  AIUsageInfo,
  CompanionUserContext,
} from '../types';
import { DEFAULT_AI_DAILY_LIMIT } from '../utils/aiUsage';
import { parseGlobalAIUsageFromHeaders } from './usageHeaders';

export type AuthHeadersProvider = () => Promise<Record<string, string>>;

export interface AIClientConfig {
  getBaseUrl: () => string;
  getAuthHeaders: AuthHeadersProvider;
  getUserId?: () => Promise<string | undefined>;
  onUsageUpdate?: (usage: AIUsageInfo) => void;
  defaultTimeoutMs?: number;
}

export interface AIGeneratedQuestion {
  text: string;
  type: 'multiple_choice' | 'true_false' | 'short_answer' | 'fill_in_blank';
  options?: string[];
  correctAnswer: string;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
}

export interface AIGeneratedFlashcard {
  front: string;
  back: string;
  mnemonic?: string;
  example?: string;
}

export interface AIStudyRecommendation {
  weakTopics: string[];
  suggestedCards: string[];
  suggestedQuestions: string[];
  studyTip: string;
  estimatedMinutes: number;
}

export function createAIClient(config: AIClientConfig) {
  const defaultTimeout = config.defaultTimeoutMs ?? 30000;
  const USAGE_FETCH_TTL_MS = 60_000;
  let usageLastFetchAt = 0;
  let usageInFlight: Promise<AIUsageInfo> | null = null;
  let usageBackoffUntil = 0;
  let cachedUsage: AIUsageInfo | null = null;

  const aiRequest = async <T>(
    endpoint: string,
    body: Record<string, unknown> = {},
    method: 'GET' | 'POST' = 'POST'
  ): Promise<T> => {
    const headers = await config.getAuthHeaders();
    const userId = config.getUserId ? await config.getUserId() : undefined;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), defaultTimeout);

    try {
      const response = await fetch(`${config.getBaseUrl()}/api/v1/ai${endpoint}`, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify({ ...body, ...(userId ? { userId } : {}) }) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      parseGlobalAIUsageFromHeaders(response, config.onUsageUpdate);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        if (
          response.status === 429 &&
          error.used !== undefined &&
          error.limit !== undefined
        ) {
          config.onUsageUpdate?.({
            used: error.used,
            limit: error.limit,
            remaining: 0,
            resetsAt: error.resetsAt || '',
          });
        }
        throw new Error(error.error || `AI request failed (${response.status})`);
      }

      return response.json() as Promise<T>;
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('AI request timed out. Please try again.');
      }
      throw error;
    }
  };

  return {
    fetchAIUsage: async (_userId?: string): Promise<AIUsageInfo> => {
      const now = Date.now();
      if (now < usageBackoffUntil && cachedUsage) return cachedUsage;
      if (cachedUsage && now - usageLastFetchAt < USAGE_FETCH_TTL_MS) {
        return cachedUsage;
      }
      if (usageInFlight) return usageInFlight;

      usageInFlight = (async () => {
        const headers = await config.getAuthHeaders();
        const res = await fetch(`${config.getBaseUrl()}/api/v1/ai/usage`, { headers });
        if (res.status === 429) {
          usageBackoffUntil = Date.now() + 30_000;
          throw new Error('HTTP 429');
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const usage: AIUsageInfo = {
          used: data.used,
          limit: data.limit,
          remaining: data.limit - data.used,
          resetsAt: data.resetsAt,
        };
        cachedUsage = usage;
        usageLastFetchAt = Date.now();
        config.onUsageUpdate?.(usage);
        return usage;
      })()
        .catch(
          () =>
            cachedUsage || {
              used: 0,
              limit: DEFAULT_AI_DAILY_LIMIT,
              remaining: DEFAULT_AI_DAILY_LIMIT,
              resetsAt: '',
            }
        )
        .finally(() => {
          usageInFlight = null;
        });

      return usageInFlight;
    },

    aiGenerateQuestions: (
      notes: string,
      options?: { count?: number; difficulty?: string; questionTypes?: string[]; subject?: string }
    ) =>
      aiRequest<{ questions: AIGeneratedQuestion[]; provider: string }>('/generate-questions', {
        notes,
        ...options,
      }),

    aiGenerateFlashcards: (
      notes: string,
      options?: { count?: number; style?: 'concise' | 'detailed' }
    ) =>
      aiRequest<{ flashcards: AIGeneratedFlashcard[]; provider: string }>('/generate-flashcards', {
        notes,
        ...options,
      }),

    aiExplainAnswer: (
      question: string,
      userAnswer: string,
      correctAnswer: string,
      options?: string[]
    ) =>
      aiRequest<{ explanation: string; provider: string }>('/explain-answer', {
        question,
        userAnswer,
        correctAnswer,
        options,
      }),

    aiGetStudyRecommendations: (performanceData: {
      recentScores: { topic: string; score: number; date: string }[];
      flashcardAccuracy: { topic: string; correctRate: number }[];
      studyHoursThisWeek: number;
    }) =>
      aiRequest<{ recommendations: AIStudyRecommendation; provider: string }>(
        '/study-recommendations',
        { performanceData }
      ),

    aiAskTutor: (
      question: string,
      context?: { subject?: string; recentTopics?: string[] }
    ) => aiRequest<{ answer: string; provider: string }>('/ask-tutor', { question, context }),

    aiEnhanceFlashcard: (front: string, back: string) =>
      aiRequest<{ enhanced: AIGeneratedFlashcard; provider: string }>('/enhance-flashcard', {
        front,
        back,
      }),

    aiHealthCheck: async () => {
      const response = await fetch(`${config.getBaseUrl()}/api/v1/ai/health`);
      if (!response.ok) throw new Error('AI health check failed');
      return response.json() as Promise<{
        status: string;
        totalRemainingToday: number;
        providers: Array<{ name: string; available: boolean; remainingToday: number }>;
      }>;
    },

    aiGenerateListingDescription: (details: {
      title: string;
      category: string;
      subcategory?: string;
      price?: string;
      condition?: string;
      courseCode?: string;
      isbn?: string;
      edition?: string;
      bedrooms?: string;
      furnished?: string;
      distanceToCampus?: string;
    }) =>
      aiRequest<{ description: string; provider: string }>('/generate-listing-description', details),
  };
}

export type LanternAIClient = ReturnType<typeof createAIClient>;

// Re-export companion context type for convenience
export type { CompanionUserContext };
