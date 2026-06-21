import type { GroupChallenge, ChallengeConfig, UserAnswerRecord } from '../types';
import { getAuthHeaders } from './supabase';
import { getApiBaseUrl } from '@lantern/shared';

const API_BASE_URL = getApiBaseUrl();

async function challengeRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/v1/challenges${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      ...(options.headers || {}),
    },
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || json.message || 'Challenge request failed');
  }
  return json.data as T;
}

export async function createChallenge(payload: {
  groupId: string;
  opponentId: string;
  config: ChallengeConfig;
}): Promise<GroupChallenge> {
  return challengeRequest<GroupChallenge>('/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchChallenges(status?: string): Promise<GroupChallenge[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return challengeRequest<GroupChallenge[]>(`${q}`);
}

export async function fetchChallenge(challengeId: string): Promise<GroupChallenge> {
  return challengeRequest<GroupChallenge>(`/${challengeId}`);
}

export async function acceptChallenge(challengeId: string): Promise<GroupChallenge> {
  return challengeRequest<GroupChallenge>(`/${challengeId}/accept`, { method: 'POST' });
}

export async function declineChallenge(challengeId: string): Promise<GroupChallenge> {
  return challengeRequest<GroupChallenge>(`/${challengeId}/decline`, { method: 'POST' });
}

export async function submitChallenge(
  challengeId: string,
  answers: Record<string, UserAnswerRecord>
): Promise<GroupChallenge> {
  return challengeRequest<GroupChallenge>(`/${challengeId}/submit`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}
