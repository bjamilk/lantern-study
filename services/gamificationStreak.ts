import { getApiBaseUrl } from '@lantern/shared';
import { createIdempotencyKey } from '@lantern/shared/api';
import type { ActivityType, StudyActivityDay, UserStats } from '@lantern/shared';
import { ACTIVITY_DAYS, formatActivityLocalDate } from '@lantern/shared/utils';
import { getAuthHeaders } from './supabase';
import { handleApiAuthFailure } from './sessionHandler';

const API_BASE = getApiBaseUrl();

async function gamificationRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const doFetch = async () => {
    const headers = await getAuthHeaders();
    return fetch(`${API_BASE}/api/v1/gamification${path}`, {
      ...options,
      headers: { ...headers, 'Content-Type': 'application/json', ...options.headers },
    });
  };

  let res = await doFetch();
  if (res.status === 401 || res.status === 403) {
    if (await handleApiAuthFailure(res.status)) {
      res = await doFetch();
    } else {
      throw new Error('Session expired');
    }
  }

  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    throw new Error(
      (typeof data.message === 'string' && data.message) ||
        (typeof data.error === 'string' && data.error !== 'Error' ? data.error : null) ||
        'Gamification request failed'
    );
  }
  return data.data as T;
}

export interface GamificationSyncResult {
  points: number;
  badges: Array<{ id: string; level: number; name: string }>;
  stats: UserStats;
  awardedBadges?: Array<{ id: string; level: number; name: string }>;
}

export const syncGamificationProgress = () =>
  gamificationRequest<GamificationSyncResult>('/me/sync-progress', {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const recordLoginStreak = () =>
  gamificationRequest<any>('/streak/record', {
    method: 'POST',
    body: JSON.stringify({ activityDate: formatActivityLocalDate(new Date()) }),
  });

export const fetchLoginStreak = () =>
  gamificationRequest<any>('/streak');

export const useStreakFreeze = () =>
  gamificationRequest<any>('/streak/freeze', {
    method: 'POST',
    body: '{}',
    headers: { 'Idempotency-Key': createIdempotencyKey('streak-freeze-use') },
  });

export const purchaseStreakFreeze = () =>
  gamificationRequest<any>('/streak/freeze/purchase', {
    method: 'POST',
    body: '{}',
    headers: { 'Idempotency-Key': createIdempotencyKey('streak-freeze-purchase') },
  });

export const fetchDailyQuests = () => {
  const activityDate = formatActivityLocalDate(new Date());
  return gamificationRequest<any[]>(`/quests/daily?activityDate=${encodeURIComponent(activityDate)}`);
};

export const incrementQuestProgress = (questType: string, increment = 1) =>
  gamificationRequest<any>('/quests/progress', {
    method: 'POST',
    body: JSON.stringify({
      questType,
      increment,
      activityDate: formatActivityLocalDate(new Date()),
    }),
  });

export const recordStudyActivity = (
  type: ActivityType,
  amount = 1,
  opts?: { scorePercent?: number }
) =>
  gamificationRequest<any>('/activity/record', {
    method: 'POST',
    body: JSON.stringify({
      type,
      amount,
      activityDate: formatActivityLocalDate(new Date()),
      // Quality-weighted XP: tests/duels earn more for higher scores.
      ...(typeof opts?.scorePercent === 'number' ? { scorePercent: opts.scorePercent } : {}),
    }),
  });

export const fetchStudyActivity = (days = ACTIVITY_DAYS) =>
  gamificationRequest<StudyActivityDay[]>(`/activity?days=${days}`);
