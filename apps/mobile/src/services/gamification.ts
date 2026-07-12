import type { ActivityType, StudyActivityDay } from '@lantern/shared';
import { ACTIVITY_DAYS, formatActivityLocalDate } from '@lantern/shared/utils';
import { getAuthHeaders, API_BASE_URL } from './supabase';

function normalizeStudyActivityDay(row: Record<string, unknown>): StudyActivityDay {
  const breakdown = (row.breakdown as StudyActivityDay['breakdown']) || undefined;
  return {
    date: String(row.date || row.activity_date || ''),
    count: Number(row.count) || 0,
    ...(breakdown ? { breakdown } : {}),
  };
}

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
  gamificationRequest<any>('/streak/record', {
    method: 'POST',
    body: JSON.stringify({ activityDate: formatActivityLocalDate(new Date()) }),
  });

export const fetchDailyQuests = () => {
  const activityDate = formatActivityLocalDate(new Date());
  return gamificationRequest<DailyQuest[]>(`/quests/daily?activityDate=${encodeURIComponent(activityDate)}`);
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

export function trackQuestProgress(questType: string, increment = 1): void {
  incrementQuestProgress(questType, increment).catch(() => {});
}

export const recordStudyActivity = (type: ActivityType, amount = 1) =>
  gamificationRequest<any>('/activity/record', {
    method: 'POST',
    body: JSON.stringify({
      type,
      amount,
      activityDate: formatActivityLocalDate(new Date()),
    }),
  });

export const fetchStudyActivity = async (days = ACTIVITY_DAYS) => {
  const raw = await gamificationRequest<Record<string, unknown>[]>(`/activity?days=${days}`);
  return (raw || []).map(normalizeStudyActivityDay).filter((day) => Boolean(day.date));
};

export function trackStudyActivity(type: ActivityType, amount = 1): void {
  recordStudyActivity(type, amount)
    .then((result) => {
      if (result && typeof result.walletBalance === 'number') {
        void import('../stores/budgetStore').then(({ useBudgetStore }) => {
          useBudgetStore.setState({ walletBalance: result.walletBalance });
        });
      }
      return fetchStudyActivity().then((days) => ({ days, result }));
    })
    .then(({ days }) => {
      if (!Array.isArray(days) || days.length === 0) return;
      void import('../stores/statsStore').then(({ useStatsStore }) => {
        const current = useStatsStore.getState().stats;
        if (current) {
          useStatsStore.setState({ stats: { ...current, activityDays: days } });
        }
      });
    })
    .catch(() => {});
}
