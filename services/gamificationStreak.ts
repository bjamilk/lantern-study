import { getApiBaseUrl } from '@lantern/shared';
import type { ActivityType, StudyActivityDay, UserStats } from '@lantern/shared';
import { ACTIVITY_DAYS, formatActivityLocalDate } from '@lantern/shared/utils';
import { getAuthHeaders } from './supabase';

const API_BASE = getApiBaseUrl();

async function gamificationRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/v1/gamification${path}`, {
    ...options,
    headers: { ...headers, 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || 'Gamification request failed');
  return data.data;
}

export interface GamificationSyncResult {
  points: number;
  badges: Array<{ id: string; level: number; name: string }>;
  stats: UserStats;
  awardedBadges?: Array<{ id: string; level: number; name: string }>;
}

export const syncGamificationProgress = (options?: {
  stats?: Partial<UserStats>;
  bonusPoints?: number;
  bonusReason?: string;
}) =>
  gamificationRequest<GamificationSyncResult>('/me/sync-progress', {
    method: 'POST',
    body: JSON.stringify(options ?? {}),
  });

export const recordLoginStreak = () =>
  gamificationRequest<any>('/streak/record', {
    method: 'POST',
    body: JSON.stringify({ activityDate: formatActivityLocalDate(new Date()) }),
  });

export const fetchLoginStreak = () =>
  gamificationRequest<any>('/streak');

export const useStreakFreeze = () =>
  gamificationRequest<any>('/streak/freeze', { method: 'POST', body: '{}' });

export const purchaseStreakFreeze = () =>
  gamificationRequest<any>('/streak/freeze/purchase', { method: 'POST', body: '{}' });

export const fetchDailyQuests = () =>
  gamificationRequest<any[]>('/quests/daily');

export const incrementQuestProgress = (questType: string, increment = 1) =>
  gamificationRequest<any>('/quests/progress', {
    method: 'POST',
    body: JSON.stringify({ questType, increment }),
  });

export const recordStudyActivity = (type: ActivityType, amount = 1) =>
  gamificationRequest<any>('/activity/record', {
    method: 'POST',
    body: JSON.stringify({
      type,
      amount,
      activityDate: formatActivityLocalDate(new Date()),
    }),
  });

export const fetchStudyActivity = (days = ACTIVITY_DAYS) =>
  gamificationRequest<StudyActivityDay[]>(`/activity?days=${days}`);
