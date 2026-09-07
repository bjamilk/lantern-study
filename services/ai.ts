/**
 * Client-side AI service — calls the backend AI API endpoints.
 * Uses the same auth headers and base URL as the main supabase service.
 */
import { getApiBaseUrl, DEFAULT_AI_DAILY_LIMIT } from '@lantern/shared';
import {
  parseGlobalAIUsageFromHeaderReader,
  parseGlobalAIUsageFromHeaders,
  xhrHeaderReader,
  type AIStudyPerformanceData,
} from '@lantern/shared/api';
import type { AIUsageSnapshot } from '@lantern/shared/ai';
import type {
  CompanionAction,
  CompanionConversation,
  CompanionUserContext,
} from '../types';
import { useAuthStore } from '../stores/authStore';
import { getAuthHeaders, ensureAuthTokenReady } from './supabase';
import { pollApiJob } from './jobPoll';

export type {
  CompanionUserContext,
  CompanionAction,
  CompanionConversation,
  CompanionMessage,
} from '../types';

const API_BASE_URL = getApiBaseUrl();

// ─── AI Usage Tracking ─────────────────────────────────────

export interface AIUsageInfo {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

let _latestUsage: AIUsageInfo = {
  used: 0,
  limit: DEFAULT_AI_DAILY_LIMIT,
  remaining: DEFAULT_AI_DAILY_LIMIT,
  resetsAt: '',
};
const _usageListeners = new Set<(usage: AIUsageInfo) => void>();
const USAGE_FETCH_TTL_MS = 60_000;
let _usageLastFetchAt = 0;
let _usageInFlight: Promise<AIUsageInfo> | null = null;
let _usageBackoffUntil = 0;

export function getLatestAIUsage(): AIUsageInfo {
  return _latestUsage;
}

export function subscribeToAIUsage(listener: (usage: AIUsageInfo) => void): () => void {
  _usageListeners.add(listener);
  return () => { _usageListeners.delete(listener); };
}

function updateUsage(usage: AIUsageInfo) {
  _latestUsage = usage;
  // Treat header-driven updates as fresh so a TTL'd GET /usage cannot stale-overwrite them.
  _usageLastFetchAt = Date.now();
  _usageListeners.forEach(fn => fn(usage));
}

/** Apply global AI quota headers from a fetch Response (notes + AI clients). */
export function applyAIUsageFromResponse(response: Response): void {
  parseGlobalAIUsageFromHeaders(response, updateUsage);
}

/**
 * Apply usage from a 429 error body ({ used, limit, resetsAt }) so a refused
 * request corrects the badge — exactly when the number matters most. Feature
 * denials (body.feature set) are skipped: their counts use a different scale.
 */
export function applyAIUsageFromErrorBody(data: unknown): void {
  const body = data as { used?: number; limit?: number; resetsAt?: string; feature?: string };
  if (!body || typeof body.used !== 'number' || typeof body.limit !== 'number') return;
  if (body.feature) return;
  if (body.limit !== _latestUsage.limit) return; // not the global counter
  updateUsage({
    used: body.used,
    limit: body.limit,
    remaining: Math.max(0, body.limit - body.used),
    resetsAt: body.resetsAt || _latestUsage.resetsAt,
  });
}

/** Apply global AI quota headers from an XHR response (notes AI long-poll path). */
export function applyAIUsageFromXhr(xhr: XMLHttpRequest): void {
  parseGlobalAIUsageFromHeaderReader(xhrHeaderReader(xhr), updateUsage);
}

/** Bypass the client TTL and re-fetch global usage from GET /ai/usage. */
export async function forceRefreshAIUsage(): Promise<AIUsageInfo> {
  _usageLastFetchAt = 0;
  _usageInFlight = null;
  try {
    return await fetchAIUsageFromApi();
  } catch {
    return _latestUsage;
  }
}

async function fetchAIUsageFromApi(): Promise<AIUsageInfo> {
  const ready = await ensureAuthTokenReady();
  if (!ready) return _latestUsage;
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/api/v1/ai/usage`, { headers });
  if (res.status === 429) {
    _usageBackoffUntil = Date.now() + 30_000;
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
  updateUsage(usage);
  _usageLastFetchAt = Date.now();
  return usage;
}

/**
 * The full usage payload — global counts plus each feature's own daily cap.
 *
 * Read by the Usage & limits screen only, which is opened rarely, so it goes
 * straight to the server rather than through the badge's TTL cache. It still
 * publishes the global counts to every subscriber, so opening that screen
 * re-syncs the sidebar badge with what the server actually holds.
 */
export async function fetchAIUsageDetail(): Promise<AIUsageSnapshot> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/api/v1/ai/usage`, { headers });
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
  updateUsage({ used, limit, remaining: Math.max(0, limit - used), resetsAt: data.resetsAt || '' });
  _usageLastFetchAt = Date.now();
  return {
    used,
    limit,
    resetsAt: data.resetsAt || '',
    // Undefined, not [], on a server that predates the per-feature rows: the
    // screen must be able to say nothing rather than claim there are no caps.
    features: Array.isArray(data.features)
      ? data.features
          .filter((row) => row && typeof row.feature === 'string')
          .map((row) => ({
            feature: String(row.feature),
            used: Number(row.used) || 0,
            limit: Number(row.limit) || 0,
          }))
      : undefined,
    // Same rule as `features`: undefined when the server did not say, so the
    // panel hides the bonus line rather than printing a zero it never measured.
    bonusRemaining:
      typeof data.bonusRemaining === 'number' && Number.isFinite(data.bonusRemaining)
        ? data.bonusRemaining
        : undefined,
  };
}

export async function fetchAIUsage(_userId?: string): Promise<AIUsageInfo> {
  const now = Date.now();
  if (now < _usageBackoffUntil) return _latestUsage;
  if (now - _usageLastFetchAt < USAGE_FETCH_TTL_MS && _latestUsage.limit > 0) {
    return _latestUsage;
  }
  if (_usageInFlight) return _usageInFlight;
  _usageInFlight = fetchAIUsageFromApi()
    .catch(() => _latestUsage)
    .finally(() => {
      _usageInFlight = null;
    });
  return _usageInFlight;
}

// ─── Base request helper ────────────────────────────────────

async function aiRequest<T>(endpoint: string, body: Record<string, any>): Promise<T> {
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_BASE_URL}/api/v1/ai${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  // Badge prefers X-AI-Global-Usage-*; feature X-AI-Usage-* alone is ignored.
  const hadFeatureQuota = Boolean(response.headers.get('X-AI-Feature'));
  parseGlobalAIUsageFromHeaders(response, updateUsage);

  const json = (await response.json().catch(() => ({}))) as T & {
    jobId?: string;
    error?: string;
    used?: number;
    limit?: number;
    resetsAt?: string;
    feature?: string;
  };

  if (response.status === 202 && typeof json.jobId === 'string') {
    // Feature quotas use a separate counter; refresh global so the badge stays accurate.
    if (hadFeatureQuota) void forceRefreshAIUsage();
    return pollApiJob<T>(json.jobId);
  }

  if (!response.ok) {
    // Feature 429 bodies carry the feature limit — keep the global badge intact.
    if (
      response.status === 429 &&
      !json.feature &&
      json.used !== undefined &&
      json.limit !== undefined
    ) {
      updateUsage({
        used: json.used,
        limit: json.limit,
        remaining: 0,
        resetsAt: json.resetsAt || '',
      });
    }
    const message =
      response.status === 400 &&
      typeof json.error === 'string' &&
      /at least 50 characters/i.test(json.error)
        ? 'Not enough study content yet. Add notes or wait for slide/PDF text extraction to finish.'
        : json.error || `AI request failed (${response.status})`;
    // The status rides along so callers can say something true without
    // reading the server's sentence: `requestFailureSentence` turns a 429 into
    // "That was a lot of tries at once" instead of showing whatever the API
    // wrote. Screens that still render `message` are unchanged.
    const error = new Error(message) as Error & { status?: number; body?: unknown };
    error.status = response.status;
    error.body = json;
    throw error;
  }

  if (hadFeatureQuota) void forceRefreshAIUsage();
  return json as T;
}

// ─── Types ──────────────────────────────────────────────────

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

// ─── API Functions ──────────────────────────────────────────

export async function aiGenerateQuestions(
  notes: string,
  options?: { count?: number; difficulty?: string; questionTypes?: string[]; subject?: string }
): Promise<{ questions: AIGeneratedQuestion[]; provider: string }> {
  return aiRequest('/generate-questions', { notes, ...options });
}

export async function aiGenerateFlashcards(
  notes: string,
  options?: { count?: number; style?: 'concise' | 'detailed' }
): Promise<{ flashcards: AIGeneratedFlashcard[]; provider: string }> {
  return aiRequest('/generate-flashcards', { notes, ...options });
}

export async function aiExplainAnswer(
  question: string,
  userAnswer: string,
  correctAnswer: string,
  options?: string[]
): Promise<{ explanation: string; provider: string }> {
  return aiRequest('/explain-answer', { question, userAnswer, correctAnswer, options });
}

export async function aiGetStudyRecommendations(
  performanceData: AIStudyPerformanceData
): Promise<{ recommendations: AIStudyRecommendation; provider: string }> {
  return aiRequest('/study-recommendations', { performanceData });
}

export async function aiAskTutor(
  question: string,
  context?: { subject?: string; recentTopics?: string[] }
): Promise<{ answer: string; provider: string }> {
  return aiRequest('/ask-tutor', { question, context });
}

export async function aiEnhanceFlashcard(
  front: string,
  back: string
): Promise<{ enhanced: AIGeneratedFlashcard; provider: string }> {
  return aiRequest('/enhance-flashcard', { front, back });
}

// ─── AI Companion ────────────────────────────────────────────

async function companionRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: Record<string, any>,
  options?: { trackUsage?: boolean }
): Promise<T> {
  const url = `${API_BASE_URL}/api/v1/ai/companion${endpoint}`;
  const authHeaders = await getAuthHeaders();

  const fetchOptions: RequestInit = {
    method,
    headers: authHeaders,
  };

  if (method === 'POST' || method === 'DELETE') {
    fetchOptions.body = JSON.stringify(body || {});
  }

  const response = await fetch(url, fetchOptions);

  if (options?.trackUsage !== false) {
    parseGlobalAIUsageFromHeaders(response, updateUsage);
  }

  const json = await response.json().catch(() => ({}));
  if (response.status === 202 && typeof json.jobId === 'string') {
    const { pollApiJob } = await import('./jobPoll');
    return pollApiJob<T>(json.jobId);
  }

  if (!response.ok) {
    throw new Error(json.error || `Companion request failed (${response.status})`);
  }

  return json as T;
}

function companionHistoryQuery(opts?: {
  conversationId?: string | null;
  noteContextId?: string | null;
}): string {
  const params = new URLSearchParams();
  if (opts?.conversationId?.trim()) {
    params.set('conversationId', opts.conversationId.trim());
  } else if (opts?.noteContextId?.trim()) {
    params.set('noteContextId', opts.noteContextId.trim());
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function companionSendMessage(
  message: string,
  context?: CompanionUserContext
): Promise<{
  reply: string;
  actions: CompanionAction[];
  provider: string;
  conversationId?: string;
}> {
  return companionRequest('/message', 'POST', { message, context }, { trackUsage: false });
}

export async function fetchCompanionConversations(): Promise<{
  conversations: CompanionConversation[];
}> {
  return companionRequest('/conversations', 'GET', undefined, { trackUsage: false });
}

export async function createCompanionConversation(noteContextId?: string | null): Promise<{
  conversation: CompanionConversation;
}> {
  return companionRequest(
    '/conversations',
    'POST',
    noteContextId?.trim() ? { noteContextId: noteContextId.trim() } : {},
    { trackUsage: false }
  );
}

export async function fetchCompanionHistory(
  opts?: { conversationId?: string | null; noteContextId?: string | null } | string | null
): Promise<{
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    actions?: CompanionAction[];
    feedback?: 'up' | 'down' | null;
    created_at: string;
  }>;
  conversationId: string | null;
  noteContextId: string | null;
}> {
  const normalized =
    typeof opts === 'string' || opts === null || opts === undefined
      ? { noteContextId: opts ?? null }
      : opts;
  return companionRequest(
    `/history${companionHistoryQuery(normalized)}`,
    'GET',
    undefined,
    { trackUsage: false }
  );
}

export async function clearCompanionHistory(
  opts?: { conversationId?: string | null; noteContextId?: string | null } | string | null
): Promise<{
  success: boolean;
  conversationId: string | null;
  noteContextId: string | null;
}> {
  const normalized =
    typeof opts === 'string' || opts === null || opts === undefined
      ? { noteContextId: opts ?? null }
      : opts;
  return companionRequest(
    `/history${companionHistoryQuery(normalized)}`,
    'DELETE',
    undefined,
    { trackUsage: false }
  );
}

export type CompanionStreamDone = {
  actions: CompanionAction[];
  messageId?: string;
  userMessageId?: string;
  conversationId?: string;
};

/**
 * Stream a companion message via SSE.
 * Calls `onToken` for each text chunk, `onDone` with final actions + persisted IDs, `onError` on failure.
 */
export async function companionSendMessageStream(
  message: string,
  context: CompanionUserContext | undefined,
  onToken: (token: string) => void,
  onDone: (result: CompanionStreamDone) => void,
  onError: (err: Error) => void
): Promise<void> {
  const userId = useAuthStore.getState().currentUser?.id;
  if (!userId) { onError(new Error('Not authenticated')); return; }

  const authHeaders = await getAuthHeaders();

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/ai/companion/message/stream`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ message, context }),
    });
  } catch (e: any) {
    onError(new Error(e.message || 'Network error'));
    return;
  }

  // Companion also charges global; parseGlobal reads X-AI-Global-Usage-* for the badge.
  parseGlobalAIUsageFromHeaders(response, updateUsage);

  if (!response.ok || !response.body) {
    onError(new Error(`Stream request failed (${response.status})`));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        if (!part.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(part.slice(6));
          if (data.error) { onError(new Error(data.error)); return; }
          if (data.token !== undefined) onToken(data.token as string);
          if (data.done) {
            onDone({
              actions: (data.actions as CompanionAction[]) || [],
              messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
              userMessageId: typeof data.userMessageId === 'string' ? data.userMessageId : undefined,
              conversationId:
                typeof data.conversationId === 'string' ? data.conversationId : undefined,
            });
          }
        } catch { /* malformed chunk — skip */ }
      }
    }
  } catch (e: any) {
    onError(new Error(e.message || 'Stream read error'));
  }
}

const PERSISTED_COMPANION_MESSAGE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPersistedCompanionMessageId(messageId: string): boolean {
  return PERSISTED_COMPANION_MESSAGE_ID.test(messageId);
}

export async function submitCompanionFeedback(
  messageId: string,
  rating: 'up' | 'down' | null
): Promise<void> {
  const userId = useAuthStore.getState().currentUser?.id;
  if (!userId) {
    throw new Error('Not authenticated');
  }
  if (!isPersistedCompanionMessageId(messageId)) {
    throw new Error('Message is still saving; try feedback again in a moment');
  }
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/v1/ai/companion/feedback`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messageId, rating }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Failed to save feedback');
  }
}

export async function trackAIAnalyticsEvent(
  event: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const userId = useAuthStore.getState().currentUser?.id;
  if (!userId) return;
  try {
    const headers = await getAuthHeaders();
    await fetch(`${API_BASE_URL}/api/v1/ai/companion/analytics`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ event, metadata }),
    });
  } catch { /* non-critical */ }
}

export async function aiGenerateListingDescription(details: {
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
}): Promise<{ description: string; provider: string }> {
  return aiRequest('/generate-listing-description', details);
}

export async function summarizeGroupChat(
  groupId: string,
  groupName?: string
): Promise<{ summary: string; provider: string }> {
  return companionRequest('/summarize-group', 'POST', { groupId, groupName });
}

// ─── Health check (no auth needed) ──────────────────────────

export async function aiHealthCheck(): Promise<{
  status: string;
  totalRemainingToday: number;
  providers: Array<{ name: string; available: boolean; remainingToday: number }>;
}> {
  const response = await fetch(`${API_BASE_URL}/api/v1/ai/health`);
  if (!response.ok) throw new Error('AI health check failed');
  return response.json();
}

// ─── Study Plan ──────────────────────────────────────────────

export interface StudyPlanContext {
  userName?: string;
  dueCardsCount?: number;
  weakTopics?: string[];
  recentTestSummary?: string;
  studyGoal?: string;
  availableHoursPerDay?: number;
  daysUntilExam?: number;
}

export interface StudyPlanDay {
  day: string;
  focus: string;
  tasks: string[];
  estimatedMinutes: number;
}

export interface StudyPlan {
  overview: string;
  days: StudyPlanDay[];
  tips: string[];
  provider: string;
}

export async function aiGenerateStudyPlan(context: StudyPlanContext): Promise<StudyPlan> {
  const response = await fetch(`${API_BASE_URL}/api/v1/ai/study-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to generate study plan');
  }
  return response.json();
}
