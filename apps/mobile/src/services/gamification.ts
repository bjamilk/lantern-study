import type { ActivityType, StudyActivityDay } from '@lantern/shared';
import { ACTIVITY_DAYS } from '@lantern/shared/utils';
import { getAuthHeaders, API_BASE_URL } from './supabase';

async function gamificationRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/api/v1/gamification${path}`, {
    ...options,
    headers: { ...headers, 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || 'Gamification request failed');
  return data.data;
}

export interface DailyQuest {
  id: string;
  quest_type: string;
  target_count: number;
  progress_count: number;
  completed: boolean;
  reward_xp: number;
}

export const recordLoginStreak = () =>
  gamificationRequest<any>('/streak/record', { method: 'POST', body: '{}' });

export const fetchDailyQuests = () =>
  gamificationRequest<DailyQuest[]>('/quests/daily');

export const incrementQuestProgress = (questType: string, increment = 1) =>
  gamificationRequest<any>('/quests/progress', {
    method: 'POST',
    body: JSON.stringify({ questType, increment }),
  });

export function trackQuestProgress(questType: string, increment = 1): void {
  incrementQuestProgress(questType, increment).catch(() => {});
}

export const recordStudyActivity = (type: ActivityType, amount = 1) =>
  gamificationRequest<any>('/activity/record', {
    method: 'POST',
    body: JSON.stringify({ type, amount }),
  });

export const fetchStudyActivity = (days = ACTIVITY_DAYS) =>
  gamificationRequest<StudyActivityDay[]>(`/activity?days=${days}`);

export function trackStudyActivity(type: ActivityType, amount = 1): void {
  recordStudyActivity(type, amount).catch(() => {});
}
