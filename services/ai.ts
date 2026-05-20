/**
 * Client-side AI service — calls the backend AI API endpoints.
 * Uses the same auth headers and base URL as the main supabase service.
 */
import { getApiBaseUrl } from '@lantern/shared';
import { useAuthStore } from '../stores/authStore';

const API_BASE_URL = getApiBaseUrl();

// ─── AI Usage Tracking ─────────────────────────────────────

export interface AIUsageInfo {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

let _latestUsage: AIUsageInfo = { used: 0, limit: 10, remaining: 10, resetsAt: '' };
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

export async function fetchAIUsage(userId: string): Promise<AIUsageInfo> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/ai/usage?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const usage: AIUsageInfo = {
      used: data.used,
      limit: data.limit,
      remaining: data.limit - data.used,
      resetsAt: data.resetsAt,
    };
    updateUsage(usage);
    return usage;
  } catch {
    return _latestUsage;
  }
}

// ─── Base request helper ────────────────────────────────────

async function aiRequest<T>(endpoint: string, body: Record<string, any>): Promise<T> {
  const userId = useAuthStore.getState().currentUser?.id;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const response = await fetch(`${API_BASE_URL}/api/v1/ai${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, userId }),
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
    throw new Error(error.error || `AI request failed (${response.status})`);
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
