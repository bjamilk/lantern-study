/**
 * Client-side AI service — calls the backend AI API endpoints.
 * Uses the same auth headers and base URL as the main supabase service.
 *
 * Two concerns live here:
 *  1. The AI usage/quota mirror (module-level `_latestUsage` + a listener set)
 *     that every credit badge subscribes to. It is updated from three places:
 *     GET /ai/usage, the `X-AI-Global-Usage-*` headers on ANY AI response, and
 *     429 error bodies. Nothing else may write it.
 *  2. Thin wrappers over POST /api/v1/ai/* — one per feature — plus the
 *     companion (chat) endpoints, including the SSE streaming send.
 *
 * Exports: getLatestAIUsage / subscribeToAIUsage / fetchAIUsage /
 * fetchAIUsageDetail / forceRefreshAIUsage / resetAIUsageState (sign-out) /
 * applyAIUsageFrom{Response,ErrorBody,Xhr};
 * the ai*() feature calls (questions, flashcards, lesson, recap, essay, tutor,
 * listing description …); the companion calls (send, stream, history,
 * conversations, attachments, feedback, analytics); CompanionStreamError.
 *
 * Touches: `${API_BASE_URL}/api/v1/ai/**`; `getAuthHeaders`/`ensureAuthTokenReady`
 * from ./supabase; `useAuthStore.getState().currentUser` (read, never written);
 * `pollApiJob` from ./jobPoll for 202 responses.
 *
 * Gotchas:
 *  - Unknown usage is `limit: 0`, NOT a default allowance. Every consumer draws
 *    nothing at limit 0 and every gate is written `limit > 0 && …`, so an
 *    un-answered quota never blocks a student and never states a wrong number.
 *    Do not seed this with DEFAULT_AI_DAILY_LIMIT (see the note below).
 *  - Long jobs answer 202 + jobId and are finished by polling, so these
 *    functions can take much longer than one HTTP round trip.
 *  - Feature quotas and the global quota are DIFFERENT counters; a feature 429
 *    body must not overwrite the global badge.
 *  - Charge semantics on a failed send are decided by CompanionStreamError.phase
 *    — read that type before changing any error path; deleting the optimistic
 *    bubbles on a 'stream' failure hides a credit the student was already
 *    charged.
 */
import { getApiBaseUrl } from '@lantern/shared';
import { AI_USAGE_UNKNOWN, resolveAIUsageFallback } from '@lantern/shared/utils/aiUsage';
import {
  normalizeCompanionCitation,
  parseGlobalAIUsageFromHeaderReader,
  parseGlobalAIUsageFromHeaders,
  xhrHeaderReader,
  type AIStudyPerformanceData,
} from '@lantern/shared/api';
import type { AIUsageSnapshot } from '@lantern/shared/ai';
import type {
  CompanionAction,
  CompanionCitation,
  CompanionConversation,
  CompanionImageAttachment,
  CompanionUserContext,
} from '../types';
import { useAuthStore } from '../stores/authStore';
import { getAuthHeaders, ensureAuthTokenReady } from './supabase';
import { pollApiJob } from './jobPoll';

export type {
  CompanionUserContext,
  CompanionImageAttachment,
  CompanionAction,
  CompanionConversation,
  CompanionMessage,
} from '../types';

const API_BASE_URL = getApiBaseUrl();

// ─── AI Usage Tracking ─────────────────────────────────────
// Module-level singleton: one cached snapshot, one listener set, one in-flight
// promise. `fetchAIUsage` is the cheap path used by badges — TTL'd (60s),
// single-flighted, and silent during a 30s backoff after a 429. Header-driven
// updates stamp `_usageLastFetchAt` so a slower TTL'd GET cannot stale-overwrite
// a fresher number.
// FIXED (F1) [E3 M11, medium]: `_latestUsage` is still a module global, but it
// is no longer stuck across an account change — `resetAIUsageState()` below puts
// it back to AI_USAGE_UNKNOWN (with the TTL, backoff and in-flight promise) and
// is registered in the one sign-out reset registry,
// stores/userScopedStoreReset.ts. The mobile half (`lantern.aiUsage.last`)
// belongs to another lane and is NOT fixed here.

export interface AIUsageInfo {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

/**
 * Before the server has told this browser the truth, the app knows NOTHING
 * about this account's allowance — so it starts at the honest unknown (limit
 * 0), not at DEFAULT_AI_DAILY_LIMIT.
 *
 * This used to seed {limit: 20, remaining: 20}, which is the API's DEFAULT and
 * not this account's allowance (production runs 100). Every surface reads this
 * value synchronously on mount, so on any cold start where the fetch had not
 * yet returned — offline boot, slow network, a 429 backoff — the badge drew a
 * confident "20/20", the nav showed "20", and the Usage screen said "20 of 20"
 * with a "Resets at midnight GMT" hint: a fifth of the real allowance, stated
 * as fact, that then jumped to 100. At limit 0 every consumer already draws
 * nothing — the badge and inline both `return null`, the nav credit is null,
 * every generation gate is written `limit > 0 && remaining < …` so an unknown
 * allowance never blocks a student — so the unknown state is silence, and the
 * server stays the only real gate.
 */
let _latestUsage: AIUsageInfo = AI_USAGE_UNKNOWN;
const _usageListeners = new Set<(usage: AIUsageInfo) => void>();
const USAGE_FETCH_TTL_MS = 60_000;
let _usageLastFetchAt = 0;
let _usageInFlight: Promise<AIUsageInfo> | null = null;
let _usageBackoffUntil = 0;

export function getLatestAIUsage(): AIUsageInfo {
  return _latestUsage;
}

/**
 * FIXED (F1) [E3 M11, medium]: drop everything this module knows about the
 * signed-out account's allowance. Called on every sign-out from the one
 * user-scoped reset registry (stores/userScopedStoreReset.ts), so the next
 * account starts at the honest unknown instead of inheriting A's remaining
 * credits — which used to fire B's generation gates on A's numbers until the
 * first live fetch landed. Listeners are notified so mounted badges redraw
 * immediately; the listener set itself is per-component, not per-account, and
 * is deliberately left in place.
 */
export function resetAIUsageState(): void {
  _usageLastFetchAt = 0;
  _usageInFlight = null;
  _usageBackoffUntil = 0;
  _latestUsage = AI_USAGE_UNKNOWN;
  _usageListeners.forEach((fn) => fn(AI_USAGE_UNKNOWN));
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
    // A failed refresh must never invent an allowance: repeat the last
    // server-known figures if we hold them, otherwise the honest unknown.
    return resolveAIUsageFallback(_latestUsage);
  }
}

async function fetchAIUsageFromApi(): Promise<AIUsageInfo> {
  const ready = await ensureAuthTokenReady();
  // Auth not ready yet is a not-answered state, not a zero allowance: hand back
  // the last server-known figures, or the honest unknown — never the seed.
  if (!ready) return resolveAIUsageFallback(_latestUsage);
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
  // In a 429 backoff we have not been re-answered: never fall back to the seed.
  if (now < _usageBackoffUntil) return resolveAIUsageFallback(_latestUsage);
  if (now - _usageLastFetchAt < USAGE_FETCH_TTL_MS && _latestUsage.limit > 0) {
    return _latestUsage;
  }
  if (_usageInFlight) return _usageInFlight;
  _usageInFlight = fetchAIUsageFromApi()
    // A failed fetch repeats the last server-known figures, or says nothing —
    // it must not synthesise a balance from DEFAULT_AI_DAILY_LIMIT.
    .catch(() => resolveAIUsageFallback(_latestUsage))
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
    message?: string;
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
    const specific =
      typeof json.error === 'string' && json.error.trim() && json.error.trim().toLowerCase() !== 'error'
        ? json.error
        : typeof json.message === 'string' && json.message.trim()
          ? json.message
          : '';
    const message =
      response.status === 400 &&
      typeof json.error === 'string' &&
      /at least 50 characters/i.test(json.error)
        ? 'Not enough study content yet. Add notes or wait for slide/PDF text extraction to finish.'
        : specific || `AI request failed (${response.status})`;
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

export async function aiGenerateLesson(
  notes: string,
  options?: { mode?: 'explore' | 'mastery'; sourceTitle?: string; subject?: string }
): Promise<{
  mode: 'explore' | 'mastery';
  sourceTitle: string;
  plan: { topics: Array<{ id: string; title: string; pageIds: string[] }> };
  pages: Array<{
    id: string;
    topicId: string;
    title: string;
    body: string;
    check?: {
      stem: string;
      kind: string;
      options?: string[];
      correctAnswer: string;
      explanation?: string;
    };
  }>;
  provider: string;
}> {
  return aiRequest('/generate-lesson', { notes, ...options });
}

export async function aiGenerateFromTopic(
  topic: string,
  options?: {
    subject?: string;
    level?: 'intro' | 'intermediate' | 'exam';
    count?: number;
    studySetId?: string;
  }
): Promise<{ notes: Array<{ title: string; body: string }>; provider: string }> {
  return aiRequest('/generate-from-topic', { topic, ...options });
}

export async function aiGenerateRecap(
  notes: string,
  options?: {
    style?: 'summary' | 'lecture' | 'podcast';
    length?: 'short' | 'medium' | 'long';
    sourceTitle?: string;
    subject?: string;
  }
): Promise<{
  style: 'summary' | 'lecture' | 'podcast';
  length: 'short' | 'medium' | 'long';
  sourceTitle: string;
  segments: Array<{ id: string; title: string; spoken: string; sourceCite: string }>;
  provider: string;
}> {
  return aiRequest('/generate-recap', { notes, ...options });
}

export async function aiGradeEssay(
  draft: string,
  options?: {
    rubricText?: string;
    prompt?: string;
    sourceNotes?: string;
    sourceTitle?: string;
  }
): Promise<{
  overall: number;
  scores: Array<{
    criterionId: string;
    label: string;
    score: number;
    max: number;
    comment: string;
  }>;
  feedback: string;
  provider: string;
}> {
  return aiRequest('/grade-essay', { draft, ...options });
}

export async function aiEnhanceFlashcard(
  front: string,
  back: string
): Promise<{ enhanced: AIGeneratedFlashcard; provider: string }> {
  return aiRequest('/enhance-flashcard', { front, back });
}

// ─── AI Companion ────────────────────────────────────────────

// Shared transport for /ai/companion/*. `trackUsage: false` is the norm here:
// most companion calls (history, conversations, plain send) either do not charge
// or are charged elsewhere, and letting them write the badge would move the
// counter for a read. Only the paths that really spend credits leave it on.
// Like aiRequest, a 202 + jobId is finished by polling.
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

  // FIXED (F9): failures here used to be bare `Error`s carrying no
  // phase/reachedServer, so `companionStore.sendMessage` withdrew the student's
  // question bubble on ANY failure — including a server error raised AFTER the
  // credit was charged. That is the exact "the send vanished but the credits
  // went down" shape `sendMessageStreaming` was fixed for. The non-streaming
  // path now throws the same `CompanionStreamError` the stream does, with the
  // same two phases: 'unsent' (never left the client — nothing charged) and
  // 'rejected' (the server answered, so the exchange is real).
  let response: Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (error: any) {
    throw new CompanionStreamError(error?.message || 'Network error', 'unsent');
  }

  if (options?.trackUsage !== false) {
    parseGlobalAIUsageFromHeaders(response, updateUsage);
  }

  const json = await response.json().catch(() => ({}));
  if (response.status === 202 && typeof json.jobId === 'string') {
    const { pollApiJob } = await import('./jobPoll');
    return pollApiJob<T>(json.jobId);
  }

  if (!response.ok) {
    throw new CompanionStreamError(
      json.error || `Companion request failed (${response.status})`,
      'rejected',
      response.status
    );
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
  citations?: CompanionCitation | null;
  conversationId?: string;
  /** Guided only: the step the lesson is on AFTER this reply. */
  guidedStep?: number | null;
}> {
  return companionRequest('/message', 'POST', { message, context }, { trackUsage: false });
}

/**
 * Upload one photo for the next companion turn.
 *
 * Reading the image costs AI credits (the same 2 the note photo OCR path
 * charges), and they are spent here rather than on send — so unlike the other
 * companion calls this one lets the usage badge update.
 */
export async function uploadCompanionImage(params: {
  base64Data: string;
  fileName?: string;
  contentType?: string;
}): Promise<CompanionImageAttachment> {
  return companionRequest('/attachments', 'POST', {
    base64Data: params.base64Data,
    fileName: params.fileName || 'image.jpg',
    contentType: params.contentType,
  });
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
    /**
     * Which note excerpts the answer was read out of. Declared `unknown` and
     * normalised by the caller, exactly as the shared client declares it: a
     * persisted chip that points nowhere is worse than no chip.
     */
    citations?: unknown;
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
  /** Which note excerpts this reply was read out of, for the source chips. */
  citations?: CompanionCitation | null;
  messageId?: string;
  userMessageId?: string;
  conversationId?: string;
  /** Guided only: the step the lesson is on AFTER this reply. */
  guidedStep?: number | null;
};

/**
 * Stream a companion message via SSE.
 * Calls `onToken` for each text chunk, `onDone` with final actions + persisted IDs, `onError` on failure.
 */
/**
 * Where a companion send died, which decides whether the student was billed.
 *
 * - `unsent`  — the request never left the client (no auth, connection refused).
 *               Nothing was charged, so the typed text can safely go back into
 *               the composer and the optimistic bubbles can be withdrawn.
 * - `rejected` — the server answered, but with a non-2xx. It processed the
 *               request far enough to decide; treat the exchange as real.
 * - `stream`  — the server accepted the request and then the stream failed or
 *               carried an `error` event. The credit is very likely already
 *               spent, so the exchange MUST stay in the thread.
 *
 * This distinction is the whole fix for "a send that appeared to fail still
 * billed a credit": the store used to delete both bubbles on every error,
 * which made a charged-but-failed send indistinguishable from one that never
 * happened.
 */
export type CompanionStreamErrorPhase = 'unsent' | 'rejected' | 'stream';

export class CompanionStreamError extends Error {
  readonly phase: CompanionStreamErrorPhase;
  readonly status?: number;
  /** True when the request reached the server, so a charge may have landed. */
  readonly reachedServer: boolean;

  constructor(message: string, phase: CompanionStreamErrorPhase, status?: number) {
    super(message);
    this.name = 'CompanionStreamError';
    this.phase = phase;
    this.status = status;
    this.reachedServer = phase !== 'unsent';
  }
}

/** The server's own sentence, when it sent one, rather than a bare status. */
async function readErrorSentence(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      const body = JSON.parse(text) as { error?: string; message?: string };
      return body.error || body.message || null;
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    return null;
  }
}

export async function companionSendMessageStream(
  message: string,
  context: CompanionUserContext | undefined,
  onToken: (token: string) => void,
  onDone: (result: CompanionStreamDone) => void,
  onError: (err: CompanionStreamError) => void
): Promise<void> {
  const userId = useAuthStore.getState().currentUser?.id;
  if (!userId) { onError(new CompanionStreamError('Not authenticated', 'unsent')); return; }

  const authHeaders = await getAuthHeaders();

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/ai/companion/message/stream`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ message, context }),
    });
  } catch (e: any) {
    onError(new CompanionStreamError(e?.message || 'Network error', 'unsent'));
    return;
  }

  // Companion also charges global; parseGlobal reads X-AI-Global-Usage-* for the
  // badge. Read on EVERY response, error ones included — a refusal that still
  // decremented the balance has to move the counter, or the student watches
  // credits vanish with no event to attach them to.
  parseGlobalAIUsageFromHeaders(response, updateUsage);

  if (!response.ok || !response.body) {
    // The body used to be dropped on the floor and replaced by
    // `Stream request failed (500)`, which hid every real reason — out of
    // credits, note too large, model refusal.
    const sentence = response.ok ? null : await readErrorSentence(response);
    onError(
      new CompanionStreamError(
        sentence || `Lantern could not answer (${response.status}).`,
        'rejected',
        response.status
      )
    );
    return;
  }

  // SSE read loop. Chunks are split on the blank-line event separator and the
  // trailing partial event is carried in `buffer` to the next read — never parse
  // a decoded chunk directly, events straddle reads. A malformed `data:` payload
  // is skipped rather than aborting the stream; `done` may arrive in the same
  // batch as the last tokens, so onToken/onDone order is per-event, not per-read.
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
          // Phase `stream`: the server accepted the request before emitting
          // this, so whatever it charged is already charged. The caller keeps
          // the exchange visible rather than withdrawing it.
          if (data.error) { onError(new CompanionStreamError(String(data.error), 'stream')); return; }
          if (data.token !== undefined) onToken(data.token as string);
          if (data.done) {
            onDone({
              actions: (data.actions as CompanionAction[]) || [],
              citations: normalizeCompanionCitation(data.citations),
              messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
              userMessageId: typeof data.userMessageId === 'string' ? data.userMessageId : undefined,
              conversationId:
                typeof data.conversationId === 'string' ? data.conversationId : undefined,
              guidedStep: typeof data.guidedStep === 'number' ? data.guidedStep : null,
            });
          }
        } catch { /* malformed chunk — skip */ }
      }
    }
  } catch (e: any) {
    onError(new CompanionStreamError(e?.message || 'Stream read error', 'stream'));
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

// ─── Health check / study plan: DELETED ──────────────────────
// FIXED (F1): `aiHealthCheck` and `aiGenerateStudyPlan` (plus StudyPlanContext /
// StudyPlanDay / StudyPlan) were removed. Both were dead — zero callers anywhere
// in the repo — and both were misleading: aiHealthCheck sent no auth headers to
// a route mounted behind authMiddleware (so it would 401), and
// aiGenerateStudyPlan POSTed to /api/v1/ai/study-plan, which the API server
// never registers ('study_plan' survives only as the rate-limit bucket on
// /ask-tutor). The mobile app's `aiHealthCheck` is a different function
// (packages/shared/src/api/ai.ts) and is untouched.
