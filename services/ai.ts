/**
 * Client-side AI service — calls the backend AI API endpoints.
 * Uses the same auth headers and base URL as the main supabase service.
 */
import { getApiBaseUrl } from '@lantern/shared';
import { useAuthStore } from '../stores/authStore';
import { getAuthHeaders, ensureAuthTokenReady } from './supabase';

const API_BASE_URL = getApiBaseUrl();

// ─── AI Usage Tracking ─────────────────────────────────────

export interface AIUsageInfo {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

let _latestUsage: AIUsageInfo = { used: 0, limit: 20, remaining: 20, resetsAt: '' };
const _usageListeners = new Set<(usage: AIUsageInfo) => void>();

export function getLatestAIUsage(): AIUsageInfo {
  return _latestUsage;
}

export function subscribeToAIUsage(listener: (usage: AIUsageInfo) => void): () => void {
  _usageListeners.add(listener);
  return () => { _usageListeners.delete(listener); };
}

function updateUsage(usage: AIUsageInfo) {
  _latestUsage = usage;
  _usageListeners.forEach(fn => fn(usage));
}

const USAGE_FETCH_TTL_MS = 60_000;
let _usageLastFetchAt = 0;
let _usageInFlight: Promise<AIUsageInfo> | null = null;
let _usageBackoffUntil = 0;

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

  // Read usage from response headers (set by aiRateLimit middleware)
  const usedHeader = response.headers.get('X-AI-Usage-Used');
  const limitHeader = response.headers.get('X-AI-Usage-Limit');
  const resetsHeader = response.headers.get('X-AI-Usage-Resets-At');
  if (usedHeader && limitHeader) {
    const used = parseInt(usedHeader, 10);
    const limit = parseInt(limitHeader, 10);
    updateUsage({ used, limit, remaining: limit - used, resetsAt: resetsHeader || '' });
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    // If 429 (rate limited), update usage from the error body
    if (response.status === 429 && error.used !== undefined && error.limit !== undefined) {
      updateUsage({ used: error.used, limit: error.limit, remaining: 0, resetsAt: error.resetsAt || '' });
    }
    const message =
      response.status === 400 &&
      typeof error.error === 'string' &&
      /at least 50 characters/i.test(error.error)
        ? 'Not enough study content yet. Add notes or wait for slide/PDF text extraction to finish.'
        : error.error || `AI request failed (${response.status})`;
    throw new Error(message);
  }

  return response.json();
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

export async function aiGetStudyRecommendations(performanceData: {
  recentScores: { topic: string; score: number; date: string }[];
  flashcardAccuracy: { topic: string; correctRate: number }[];
  studyHoursThisWeek: number;
}): Promise<{ recommendations: AIStudyRecommendation; provider: string }> {
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

export interface CompanionUserContext {
  userName?: string;
  groups?: string[];
  weakTopics?: string[];
  dueCardsCount?: number;
  recentTestSummary?: string;
  budgetSummary?: string;
  currentScreen?: string;
  activeSessionSummary?: string;
}

export interface CompanionAction {
  type: 'navigate_to_flashcards' | 'open_test_config' | 'open_create_flashcard' | 'navigate_to_dashboard' | 'navigate_to_chat';
  label: string;
  payload?: Record<string, string>;
}

async function companionRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: Record<string, any>
): Promise<T> {
  const url = `${API_BASE_URL}/api/v1/ai/companion${endpoint}`;
  const authHeaders = await getAuthHeaders();

  const options: RequestInit = {
    method,
    headers: authHeaders,
  };

  if (method === 'POST' || method === 'DELETE') {
    options.body = JSON.stringify(body || {});
  }

  const response = await fetch(url, options);

  // Track AI usage from headers (companion uses the same rate limit)
  const usedHeader = response.headers.get('X-AI-Usage-Used');
  const limitHeader = response.headers.get('X-AI-Usage-Limit');
  const resetsHeader = response.headers.get('X-AI-Usage-Resets-At');
  if (usedHeader && limitHeader) {
    const used = parseInt(usedHeader, 10);
    const limit = parseInt(limitHeader, 10);
    updateUsage({ used, limit, remaining: limit - used, resetsAt: resetsHeader || '' });
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `Companion request failed (${response.status})`);
  }

  return response.json();
}

export async function companionSendMessage(
  message: string,
  context?: CompanionUserContext
): Promise<{ reply: string; actions: CompanionAction[]; provider: string }> {
  return companionRequest('/message', 'POST', { message, context });
}

export async function fetchCompanionHistory(): Promise<{ messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; actions?: CompanionAction[]; created_at: string }> }> {
  return companionRequest('/history', 'GET');
}

export async function clearCompanionHistory(): Promise<{ success: boolean }> {
  return companionRequest('/history', 'DELETE');
}

/**
 * Stream a companion message via SSE.
 * Calls `onToken` for each text chunk, `onDone` with final actions, `onError` on failure.
 */
export async function companionSendMessageStream(
  message: string,
  context: CompanionUserContext | undefined,
  onToken: (token: string) => void,
  onDone: (actions: CompanionAction[]) => void,
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
          if (data.done) onDone((data.actions as CompanionAction[]) || []);
        } catch { /* malformed chunk — skip */ }
      }
    }
  } catch (e: any) {
    onError(new Error(e.message || 'Stream read error'));
  }
}

export async function submitCompanionFeedback(
  messageId: string,
  rating: 'up' | 'down'
): Promise<void> {
  const userId = useAuthStore.getState().currentUser?.id;
  if (!userId) return;
  try {
    const headers = await getAuthHeaders();
    await fetch(`${API_BASE_URL}/api/v1/ai/companion/feedback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messageId, rating }),
    });
  } catch { /* non-critical */ }
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
  messages: string[],
  groupName: string
): Promise<{ summary: string; provider: string }> {
  return companionRequest('/summarize-group', 'POST', { messages, groupName });
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
