import type { StudyActivityDay } from '../types';

export const ACTIVITY_WEEKS = 16;
export const ACTIVITY_DAYS = ACTIVITY_WEEKS * 7;

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
