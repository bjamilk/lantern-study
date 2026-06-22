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
