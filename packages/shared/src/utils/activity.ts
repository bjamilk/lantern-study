import type { StudyActivityDay } from '../types';

export const ACTIVITY_WEEKS = 16;
export const ACTIVITY_DAYS = ACTIVITY_WEEKS * 7;

export type ActivityHeatLevel = 0 | 1 | 2 | 3 | 4;

export function getActivityHeatLevel(count: number): ActivityHeatLevel {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

const HEAT_TAILWIND_LIGHT: Record<ActivityHeatLevel, string> = {
  0: 'bg-gray-200',
  1: 'bg-green-200',
  2: 'bg-green-400',
  3: 'bg-green-500',
  4: 'bg-green-600',
};

const HEAT_TAILWIND_DARK: Record<ActivityHeatLevel, string> = {
  0: 'bg-slate-700',
  1: 'bg-green-900',
  2: 'bg-green-700',
  3: 'bg-green-500',
  4: 'bg-green-400',
};

const HEAT_HEX_COLORS: Record<ActivityHeatLevel, string> = {
  0: '#e2e8f0',
  1: '#bbf7d0',
  2: '#4ade80',
  3: '#22c55e',
  4: '#16a34a',
};

export function getActivityHeatTailwindClass(
  level: ActivityHeatLevel,
  theme: 'light' | 'dark'
): string {
  return theme === 'dark' ? HEAT_TAILWIND_DARK[level] : HEAT_TAILWIND_LIGHT[level];
}

export function getActivityHeatHexColor(level: ActivityHeatLevel): string {
  return HEAT_HEX_COLORS[level];
}

export function getActivityHeatColorForCount(
  count: number,
  theme: 'light' | 'dark'
): string {
  return getActivityHeatTailwindClass(getActivityHeatLevel(count), theme);
}

export function formatActivityLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseActivityDate(dateStr: string): Date {
  const parts = dateStr.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(y, m - 1, d);
}

function addDaysToDateStr(dateStr: string, delta: number): string {
  const d = parseActivityDate(dateStr);
  d.setDate(d.getDate() + delta);
  return formatActivityLocalDate(d);
}

function getActiveDates(activityDays: StudyActivityDay[]): Set<string> {
  const active = new Set<string>();
  for (const day of activityDays) {
    if (day.date && day.count > 0) {
      active.add(day.date);
    }
  }
  return active;
}

function countConsecutiveFromAnchor(activeDates: Set<string>, anchor: string): number {
  let streak = 0;
  let cursor = anchor;
  while (activeDates.has(cursor)) {
    streak++;
    cursor = addDaysToDateStr(cursor, -1);
  }
  return streak;
}

function computeLongestStreak(activeDates: Set<string>): number {
  if (activeDates.size === 0) return 0;
  const sorted = Array.from(activeDates).sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    if (curr === addDaysToDateStr(prev, 1)) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }
  return longest;
}

export interface StudyStreakResult {
  current: number;
  longest: number;
  lastActiveDate: string | null;
}

/** Consecutive study days aligned with heatmap activity (local calendar dates). */
export function computeStudyStreak(
  activityDays: StudyActivityDay[],
  referenceDate: Date = new Date()
): StudyStreakResult {
  const activeDates = getActiveDates(activityDays);
  if (activeDates.size === 0) {
    return { current: 0, longest: 0, lastActiveDate: null };
  }

  const today = formatActivityLocalDate(referenceDate);
  const yesterday = addDaysToDateStr(today, -1);

  let anchor: string | null = null;
  if (activeDates.has(today)) {
    anchor = today;
  } else if (activeDates.has(yesterday)) {
    anchor = yesterday;
  }

  const current = anchor ? countConsecutiveFromAnchor(activeDates, anchor) : 0;
  const longest = Math.max(computeLongestStreak(activeDates), current);
  const lastActiveDate = Array.from(activeDates).sort().at(-1) ?? null;

  return { current, longest, lastActiveDate };
}

export function buildActivityMap(days: StudyActivityDay[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const day of days) {
    if (day.date) {
      map.set(day.date, day.count);
    }
  }
  return map;
}

export function buildActivityHeatmapGrid(
  days: StudyActivityDay[]
): { days: { date: string; count: number }[]; maxCount: number } {
  const counts = buildActivityMap(days);
  const today = new Date();
  const startDate = new Date();
  startDate.setDate(today.getDate() - ACTIVITY_DAYS + 1);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const gridDays: { date: string; count: number }[] = [];
  let maxCount = 0;
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  while (cursor <= todayEnd) {
    const dateStr = formatActivityLocalDate(cursor);
    const count = counts.get(dateStr) || 0;
    gridDays.push({ date: dateStr, count });
    if (count > maxCount) maxCount = count;
    cursor.setDate(cursor.getDate() + 1);
  }

  return { days: gridDays, maxCount };
}
