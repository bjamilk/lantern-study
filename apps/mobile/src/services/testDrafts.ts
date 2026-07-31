import type { PausedSessionSummary, TestSessionKind } from '@lantern/shared';
import { API_BASE_URL, getAuthHeaders } from './supabase';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(await getAuthHeaders()),
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Request failed (${response.status})`);
  }
  const json = await response.json();
  return (json.data ?? json) as T;
}

export async function createMobileTestDraft(payload: {
  config: Record<string, unknown>;
  questions: unknown[];
  user_answers?: Record<string, unknown>;
  session_kind: TestSessionKind;
  title?: string;
  current_question_index?: number;
  remaining_time_seconds?: number | null;
  start_time?: string;
}): Promise<{ id: string } & Record<string, unknown>> {
  return request('/api/v1/tests/drafts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function patchMobileTestDraft(
  draftId: string,
  updates: {
    user_answers?: Record<string, unknown>;
    current_question_index?: number;
    remaining_time_seconds?: number | null;
    status?: 'in_progress' | 'paused';
  },
): Promise<Record<string, unknown>> {
  return request(`/api/v1/tests/drafts/${encodeURIComponent(draftId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function completeMobileTestDraft(
  draftId: string,
  payload: {
    user_answers?: Record<string, unknown>;
    score?: number;
    correct_answers_count?: number;
    total_questions?: number;
  },
): Promise<Record<string, unknown>> {
  return request(`/api/v1/tests/drafts/${encodeURIComponent(draftId)}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function abandonMobileTestDraft(draftId: string): Promise<void> {
  await request(`/api/v1/tests/drafts/${encodeURIComponent(draftId)}/abandon`, {
    method: 'POST',
  });
}

export async function fetchMobilePausedSessions(): Promise<PausedSessionSummary[]> {
  const params = new URLSearchParams({
    status: 'in_progress',
    lean: '1',
    limit: '100',
    sort: 'newest',
  });
  const data = await request<any[]>(`/api/v1/tests?${params}`);
  const rows = Array.isArray(data) ? data : [];
  return rows
    .filter((row) => row && (row.status === 'paused' || row.status === 'in_progress'))
    .map((row) => ({
      id: row.id,
      sessionKind: row.sessionKind || 'test',
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

export async function fetchMobileTestDraft(draftId: string): Promise<Record<string, unknown>> {
  return request(`/api/v1/tests/${encodeURIComponent(draftId)}`);
}
