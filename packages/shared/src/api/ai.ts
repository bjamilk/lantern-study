// ===========================================
// Lantern Study - Shared AI API Client
// ===========================================

import type {
  AIUsageInfo,
  CompanionUserContext,
} from '../types';
import { DEFAULT_AI_DAILY_LIMIT } from '../utils/aiUsage';
import type { AIUsageSnapshot } from '../ai/aiUsageView';
import { parseGlobalAIUsageFromHeaders } from './usageHeaders';
import {
  JobStillRunningError,
  createJobClient,
  type JobUpdateHandler,
} from '../jobs/jobClient';

export type AuthHeadersProvider = () => Promise<Record<string, string>>;

export interface AIClientConfig {
  getBaseUrl: () => string;
  getAuthHeaders: AuthHeadersProvider;
  getUserId?: () => Promise<string | undefined>;
  onUsageUpdate?: (usage: AIUsageInfo) => void;
  defaultTimeoutMs?: number;
  /**
   * Whether this runtime can read a streamed response body. React Native's
   * fetch resolves with `body === null`, so token streaming is impossible there
   * and the caller must use the non-streaming endpoint instead. Defaults to
   * true (browsers). This has to be declared rather than detected after the
   * fact: by the time a streamed response comes back unreadable the server has
   * already generated and billed the reply, so retrying would charge twice.
   */
  supportsResponseStreaming?: boolean;
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

/**
 * Request body for POST /ai/study-recommendations (`performanceData`).
 *
 * Every field must mean what its name says — the coach prompt describes them
 * to the model verbatim:
 *  - recentScores: per-topic TEST accuracy (0..100), most relevant first.
 *  - flashcardAccuracy: per-DECK share of reviewed cards that are mature
 *    (see utils/flashcardAccuracy). OMIT when no card has been reviewed;
 *    never substitute test accuracy under this name.
 *  - studyDaysThisWeek: distinct days with study activity in the last 7 days
 *    (0..7; utils/activity countActiveDaysInLastWeek). Replaces the legacy
 *    `studyHoursThisWeek`, which the API still accepts from older builds.
 */
export interface AIStudyPerformanceData {
  recentScores: { topic: string; score: number; date: string }[];
  flashcardAccuracy?: { topic: string; correctRate: number }[];
  studyDaysThisWeek: number;
}

export function createAIClient(config: AIClientConfig) {
  const defaultTimeout = config.defaultTimeoutMs ?? 30000;
  /**
   * Queued work is watched, not blind-polled: stages and percent come back on
   * every poll, and when the client's 90s budget runs out we surface
   * JobStillRunningError (carrying the jobId) instead of claiming failure —
   * the job is still running and the student has already been charged once.
   */
  const jobs = createJobClient({
    getBaseUrl: config.getBaseUrl,
    getAuthHeaders: config.getAuthHeaders,
    // Every poll restates the counters. The 202 that started the job published
    // the CHARGED numbers; a job that then fails is refunded server-side, and
    // this is what tells the badge so.
    onUsageUpdate: (usage) => notifyUsage(usage),
  });

  const awaitJob = async <T>(jobId: string, onUpdate?: JobUpdateHandler): Promise<T> => {
    const outcome = await jobs.watchJob<T>(jobId, onUpdate);
    if (outcome.status === 'done') return outcome.result;
    if (outcome.status === 'failed') throw new Error(outcome.error.message);
    throw new JobStillRunningError(jobId);
  };
  const USAGE_FETCH_TTL_MS = 60_000;
  let usageLastFetchAt = 0;
  let usageInFlight: Promise<AIUsageInfo> | null = null;
  let usageBackoffUntil = 0;
  let cachedUsage: AIUsageInfo | null = null;

  const notifyUsage = (usage: AIUsageInfo) => {
    cachedUsage = usage;
    usageLastFetchAt = Date.now();
    config.onUsageUpdate?.(usage);
  };

  const refreshGlobalUsage = () => {
    void (async () => {
      try {
        const headers = await config.getAuthHeaders();
        const res = await fetch(`${config.getBaseUrl()}/api/v1/ai/usage`, { headers });
        if (!res.ok) return;
        const data = await res.json();
        notifyUsage({
          used: data.used,
          limit: data.limit,
          remaining: data.limit - data.used,
          resetsAt: data.resetsAt,
        });
      } catch {
        // non-fatal
      }
    })();
  };

  const aiRequest = async <T>(
    endpoint: string,
    body: Record<string, unknown> = {},
    method: 'GET' | 'POST' = 'POST',
    onJobUpdate?: JobUpdateHandler
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

      const hadFeatureQuota = Boolean(response.headers.get('X-AI-Feature'));
      parseGlobalAIUsageFromHeaders(response, notifyUsage);

      const json = (await response.json().catch(() => ({}))) as T & {
        jobId?: string;
        error?: string;
        used?: number;
        limit?: number;
        resetsAt?: string;
        feature?: string;
      };

      if (response.status === 202 && typeof json.jobId === 'string') {
        if (hadFeatureQuota) refreshGlobalUsage();
        return awaitJob<T>(json.jobId, onJobUpdate);
      }

      if (!response.ok) {
        if (
          response.status === 429 &&
          !json.feature &&
          json.used !== undefined &&
          json.limit !== undefined
        ) {
          notifyUsage({
            used: json.used,
            limit: json.limit,
            remaining: 0,
            resetsAt: json.resetsAt || '',
          });
        }
        throw new Error(json.error || `AI request failed (${response.status})`);
      }

      if (hadFeatureQuota) refreshGlobalUsage();
      // A synchronous 200 is still a job to the watcher: queued → done, now.
      onJobUpdate?.({ jobId: null, kind: 'other', stage: 'queued', percent: 0, record: null });
      onJobUpdate?.({ jobId: null, kind: 'other', stage: 'done', percent: 100, record: null });
      return json as T;
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('AI request timed out. Please try again.');
      }
      throw error;
    }
  };

  return {
    /** Watch/resume/cancel background jobs (see jobs/jobClient). */
    jobs,
    /** Reattach to a job after a restart, e.g. from a saved jobId. */
    resumeJob: <T>(jobId: string, onUpdate?: JobUpdateHandler) => awaitJob<T>(jobId, onUpdate),
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
        notifyUsage(usage);
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

    /**
     * The full usage payload, including each feature's own daily cap.
     *
     * `fetchAIUsage` deliberately keeps only the four fields the badge needs
     * and caches them; the Usage & limits screen needs the per-feature rows as
     * well and is opened rarely, so it reads straight through. The global
     * counts still go to `notifyUsage`, so opening the screen also corrects
     * the badge — which is how a student checks that the counter is honest.
     */
    fetchAIUsageDetail: async (): Promise<AIUsageSnapshot> => {
      const headers = await config.getAuthHeaders();
      const res = await fetch(`${config.getBaseUrl()}/api/v1/ai/usage`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        used?: number;
        limit?: number;
        resetsAt?: string;
        features?: Array<{ feature?: string; used?: number; limit?: number }>;
        bonusRemaining?: number;
      };
      const used = Number(data.used) || 0;
      const limit = Number(data.limit) || 0;
      notifyUsage({ used, limit, remaining: Math.max(0, limit - used), resetsAt: data.resetsAt || '' });
      return {
        used,
        limit,
        resetsAt: data.resetsAt || '',
        // Absent on a server that predates the per-feature rows. Undefined,
        // not [] — the screen must be able to tell "no caps reported" from
        // "no caps exist" and say nothing rather than claim nothing.
        features: Array.isArray(data.features)
          ? data.features
              .filter((row) => row && typeof row.feature === 'string')
              .map((row) => ({
                feature: String(row.feature),
                used: Number(row.used) || 0,
                limit: Number(row.limit) || 0,
              }))
          : undefined,
        // Same rule as `features`: undefined when the server did not say, so
        // the screen hides the bonus line rather than printing a zero it
        // never measured.
        bonusRemaining:
          typeof data.bonusRemaining === 'number' && Number.isFinite(data.bonusRemaining)
            ? data.bonusRemaining
            : undefined,
      };
    },

    aiGenerateQuestions: (
      notes: string,
      options?: {
        count?: number;
        difficulty?: string;
        questionTypes?: string[];
        subject?: string;
        /** Called with stage/percent while the work is queued. */
        onJobUpdate?: JobUpdateHandler;
      }
    ) => {
      const { onJobUpdate, ...rest } = options ?? {};
      return aiRequest<{ questions: AIGeneratedQuestion[]; provider: string }>(
        '/generate-questions',
        { notes, ...rest },
        'POST',
        onJobUpdate
      );
    },

    aiGenerateFlashcards: (
      notes: string,
      options?: {
        count?: number;
        style?: 'concise' | 'detailed';
        /** Called with stage/percent while the work is queued. */
        onJobUpdate?: JobUpdateHandler;
      }
    ) => {
      const { onJobUpdate, ...rest } = options ?? {};
      return aiRequest<{ flashcards: AIGeneratedFlashcard[]; provider: string }>(
        '/generate-flashcards',
        { notes, ...rest },
        'POST',
        onJobUpdate
      );
    },

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

    aiGetStudyRecommendations: (performanceData: AIStudyPerformanceData) =>
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
