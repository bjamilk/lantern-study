import type { ActivityType, StudyActivityDay } from '@lantern/shared';
import { ACTIVITY_DAYS, formatActivityLocalDate } from '@lantern/shared/utils';
import { createIdempotencyKey } from '@lantern/shared/api';
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

export interface LeaderboardEntry {
  rank: number;
  user: {
    id: string;
    name: string;
    avatarUrl?: string | null;
    points: number;
    stats: Record<string, unknown>;
  };
}

export const fetchLeaderboard = (options?: {
  page?: number;
  limit?: number;
  ambassador?: boolean;
  institutionId?: string;
}) => {
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 50;
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (options?.ambassador) qs.set('ambassador', '1');
  if (options?.institutionId) qs.set('institutionId', options.institutionId);
  return gamificationRequest<LeaderboardEntry[]>(`/leaderboard?${qs}`);
};

/** Spends wallet coins for a streak freeze. Server enforces balance + cost. */
export const purchaseStreakFreeze = () =>
  gamificationRequest<{
    streak_freezes?: number;
    streakFreezes?: number;
    cost?: number;
    walletBalance?: number;
  }>('/streak/freeze/purchase', {
    method: 'POST',
    body: '{}',
    headers: { 'Idempotency-Key': createIdempotencyKey('streak-freeze-purchase') },
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

export const fetchStudyActivity = async (days = ACTIVITY_DAYS) => {
  const raw = await gamificationRequest<Record<string, unknown>[]>(`/activity?days=${days}`);
  return (raw || []).map(normalizeStudyActivityDay).filter((day) => Boolean(day.date));
};

export function trackStudyActivity(
  type: ActivityType,
  amount = 1,
  opts?: { scorePercent?: number }
): void {
  recordStudyActivity(type, amount, opts)
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
