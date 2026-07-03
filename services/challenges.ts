import type { GroupChallenge, ChallengeConfig, UserAnswerRecord } from '../types';
import { getAuthHeaders, hasValidSession } from './supabase';
import { getApiBaseUrl } from '@lantern/shared';

const API_BASE_URL = getApiBaseUrl();

async function challengeRequest<T>(
  path: string,
  options: RequestInit = {},
  requestOpts?: { fallbackOnAuthError?: T }
): Promise<T> {
  if (!(await hasValidSession())) {
    if (requestOpts?.fallbackOnAuthError !== undefined) {
      return requestOpts.fallbackOnAuthError;
    }
    throw new Error('Authentication required');
  }

  const doFetch = async () => {
    const headers = await getAuthHeaders();
    return fetch(`${API_BASE_URL}/api/v1/challenges${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        ...(options.headers || {}),
      },
    });
  };

  let response = await doFetch();

  if (response.status === 401 || response.status === 403) {
    const { handleApiAuthFailure } = await import('./sessionHandler');
    if (await handleApiAuthFailure(response.status)) {
      response = await doFetch();
    }
  }

  const json = await response.json().catch(() => ({} as Record<string, string>));

  if (!response.ok) {
    if (
      (response.status === 401 || response.status === 403) &&
      requestOpts?.fallbackOnAuthError !== undefined
    ) {
      return requestOpts.fallbackOnAuthError;
    }
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
  return challengeRequest<GroupChallenge[]>(`${q}`, {}, { fallbackOnAuthError: [] });
}

export async function fetchChallenge(challengeId: string): Promise<GroupChallenge> {
  return challengeRequest<GroupChallenge>(`/${encodeURIComponent(challengeId)}`);
}

export async function acceptChallenge(challengeId: string): Promise<GroupChallenge> {
  return challengeRequest<GroupChallenge>(`/${encodeURIComponent(challengeId)}/accept`, {
    method: 'POST',
  });
}

export async function declineChallenge(challengeId: string): Promise<GroupChallenge> {
  return challengeRequest<GroupChallenge>(`/${encodeURIComponent(challengeId)}/decline`, {
    method: 'POST',
  });
}

export async function submitChallenge(
  challengeId: string,
  answers: Record<string, UserAnswerRecord>
): Promise<GroupChallenge> {
  return challengeRequest<GroupChallenge>(`/${encodeURIComponent(challengeId)}/submit`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

export async function forfeitChallenge(challengeId: string): Promise<GroupChallenge> {
  return challengeRequest<GroupChallenge>(`/${encodeURIComponent(challengeId)}/forfeit`, {
    method: 'POST',
  });
}
