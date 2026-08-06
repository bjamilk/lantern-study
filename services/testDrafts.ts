/**
 * Cloud draft API for durable paused test / study sessions.
 */
import type { PausedSessionSummary, TestSessionData, TestSessionKind } from '../types';
import { getApiRoot, getAuthHeaders } from './supabase';

function toIso(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Seconds left for a timed session — prefer explicit remainingTime, else endTime clock. */
export function getSessionRemainingSeconds(session: TestSessionData): number | null {
  if (typeof session.remainingTime === 'number' && Number.isFinite(session.remainingTime)) {
    return Math.max(0, Math.round(session.remainingTime));
  }
  if (session.endTime) {
    return Math.max(0, Math.round((new Date(session.endTime).getTime() - Date.now()) / 1000));
  }
  return null;
}

export function sessionToDraftPayload(session: TestSessionData, kind: TestSessionKind) {
  return {
    config: session.config,
    questions: session.questions,
    user_answers: session.userAnswers || {},
    start_time: toIso(session.startTime) || new Date().toISOString(),
    session_kind: kind,
    title:
      session.title ||
      session.config?.groupName ||
      (kind === 'study' ? 'Study session' : 'Test'),
    current_question_index: session.currentQuestionIndex || 0,
    // Persist countdown from endTime when remainingTime was never snapshotted (fresh start).
    remaining_time_seconds: getSessionRemainingSeconds(session),
    is_offline: !!session.isOffline,
  };
}

export function mapDraftToSession(data: any): TestSessionData {
  const remaining =
    typeof data.remainingTime === 'number'
      ? data.remainingTime
      : typeof data.remaining_time_seconds === 'number'
        ? data.remaining_time_seconds
        : undefined;
  return {
    id: data.id,
    config: data.config || {},
    questions: Array.isArray(data.questions) ? data.questions : [],
    userAnswers: data.userAnswers || data.user_answers || {},
    currentQuestionIndex:
      data.currentQuestionIndex ?? data.current_question_index ?? 0,
    startTime: data.startTime ? new Date(data.startTime) : new Date(data.start_time || Date.now()),
    endTime: data.endTime
      ? new Date(data.endTime)
      : data.end_time
        ? new Date(data.end_time)
        : undefined,
    remainingTime: remaining,
    isOffline: data.isOffline ?? data.is_offline ?? false,
    sessionKind: data.sessionKind || data.session_kind || 'test',
    status: data.status,
    title: data.title,
    updatedAt: data.updatedAt || data.updated_at,
    pausedAt: data.pausedAt || data.paused_at,
  };
}

export async function createTestDraft(
  session: TestSessionData,
  kind: TestSessionKind,
): Promise<TestSessionData> {
  const response = await fetch(`${getApiRoot()}/api/v1/tests/drafts`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(sessionToDraftPayload(session, kind)),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Draft create failed (${response.status})`);
  }
  const result = await response.json();
  return mapDraftToSession(result.data);
}

export async function patchTestDraft(
  draftId: string,
  updates: {
    userAnswers?: TestSessionData['userAnswers'];
    currentQuestionIndex?: number;
    remainingTime?: number | null;
    status?: 'in_progress' | 'paused';
    title?: string;
  },
): Promise<TestSessionData> {
  const response = await fetch(`${getApiRoot()}/api/v1/tests/drafts/${encodeURIComponent(draftId)}`, {
    method: 'PATCH',
    headers: await getAuthHeaders(),
    body: JSON.stringify({
      user_answers: updates.userAnswers,
      current_question_index: updates.currentQuestionIndex,
      remaining_time_seconds: updates.remainingTime,
      status: updates.status,
      title: updates.title,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Draft patch failed (${response.status})`);
  }
  const result = await response.json();
  return mapDraftToSession(result.data);
}

export async function completeTestDraft(
  draftId: string,
  payload: {
    userAnswers?: TestSessionData['userAnswers'];
    score?: number;
    correctAnswersCount?: number;
    totalQuestions?: number;
    activityDate?: string;
    config?: { groupId?: string; groupName?: string };
  },
): Promise<any> {
  const response = await fetch(
    `${getApiRoot()}/api/v1/tests/drafts/${encodeURIComponent(draftId)}/complete`,
    {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        user_answers: payload.userAnswers,
        score: payload.score,
        correct_answers_count: payload.correctAnswersCount,
        total_questions: payload.totalQuestions,
        activityDate: payload.activityDate,
        config: payload.config,
      }),
    },
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Draft complete failed (${response.status})`);
  }
  return (await response.json()).data;
}

export async function abandonTestDraft(draftId: string): Promise<void> {
  const response = await fetch(
    `${getApiRoot()}/api/v1/tests/drafts/${encodeURIComponent(draftId)}/abandon`,
    {
      method: 'POST',
      headers: await getAuthHeaders(),
    },
  );
  if (!response.ok && response.status !== 404) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Draft abandon failed (${response.status})`);
  }
}

export async function fetchPausedSessions(options?: {
  page?: number;
  limit?: number;
}): Promise<PausedSessionSummary[]> {
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 50;
  const params = new URLSearchParams({
    status: 'in_progress',
    lean: '1',
    page: String(page),
    limit: String(limit),
    sort: 'newest',
  });
  const response = await fetch(`${getApiRoot()}/api/v1/tests?${params}`, {
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch paused sessions (${response.status})`);
  }
  const result = await response.json();
  const rows = Array.isArray(result.data) ? result.data : [];
  return rows
    .filter((row: any) => row && (row.status === 'paused' || row.status === 'in_progress'))
    .map((row: any): PausedSessionSummary => ({
      id: row.id,
      sessionKind: row.sessionKind || row.session_kind || 'test',
      status: row.status === 'in_progress' ? 'in_progress' : 'paused',
      title: row.title || (row.sessionKind === 'study' ? 'Study session' : 'Test'),
      answeredCount: row.answeredCount ?? 0,
      totalQuestions: row.totalQuestions ?? 0,
      currentQuestionIndex: row.currentQuestionIndex ?? 0,
      remainingTimeSeconds: row.remainingTimeSeconds ?? null,
      startTime: row.startTime || new Date().toISOString(),
      updatedAt: row.updatedAt || row.startTime || new Date().toISOString(),
      pausedAt: row.pausedAt ?? null,
      groupId: row.groupId,
    }));
}

export async function fetchTestDraft(draftId: string): Promise<TestSessionData> {
  const response = await fetch(`${getApiRoot()}/api/v1/tests/${encodeURIComponent(draftId)}`, {
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to load session (${response.status})`);
  }
  const result = await response.json();
  return mapDraftToSession(result.data);
}

const localMirrorKey = (userId: string) => `lantern_paused_sessions_${userId}`;

export function writeLocalSessionMirror(
  userId: string,
  payload: {
    pausedSessions: PausedSessionSummary[];
    activeTestSession?: TestSessionData | null;
    activeStudySession?: TestSessionData | null;
  },
): void {
  if (typeof window === 'undefined') return;
  try {
    const serialize = (s: TestSessionData | null | undefined) =>
      s
        ? {
            ...s,
            startTime: toIso(s.startTime),
            endTime: toIso(s.endTime),
          }
        : null;
    localStorage.setItem(
      localMirrorKey(userId),
      JSON.stringify({
        pausedSessions: payload.pausedSessions,
        activeTestSession: serialize(payload.activeTestSession),
        activeStudySession: serialize(payload.activeStudySession),
        savedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // ignore quota
  }
}

export function readLocalSessionMirror(userId: string): {
  pausedSessions: PausedSessionSummary[];
  activeTestSession: TestSessionData | null;
  activeStudySession: TestSessionData | null;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(localMirrorKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const revive = (s: any): TestSessionData | null =>
      s
        ? {
            ...s,
            startTime: s.startTime ? new Date(s.startTime) : new Date(),
            endTime: s.endTime ? new Date(s.endTime) : undefined,
          }
        : null;
    return {
      pausedSessions: Array.isArray(parsed.pausedSessions) ? parsed.pausedSessions : [],
      activeTestSession: revive(parsed.activeTestSession),
      activeStudySession: revive(parsed.activeStudySession),
    };
  } catch {
    return null;
  }
}

export function clearLocalSessionMirror(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(localMirrorKey(userId));
  } catch {
    // ignore
  }
}
