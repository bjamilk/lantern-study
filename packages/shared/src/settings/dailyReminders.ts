import type { NotificationSettings, UserSettings } from './userSettings';
import { formatActivityLocalDate } from '../utils/activity';

const REMINDER_STORAGE_KEY = 'lantern.dailyReminder.lastFired';

export function parseReminderTime(timeString: string): { hours: number; minutes: number } {
  const [hoursStr, minutesStr] = (timeString || '20:00').split(':');
  return {
    hours: Math.min(23, Math.max(0, parseInt(hoursStr || '20', 10) || 20)),
    minutes: Math.min(59, Math.max(0, parseInt(minutesStr || '0', 10) || 0)),
  };
}

export function shouldTriggerDailyReminder(
  notifications: Pick<NotificationSettings, 'dailyReminder' | 'reminderTime'>,
  lastFiredDateKey: string | null,
  now: Date = new Date()
): boolean {
  if (!notifications.dailyReminder) return false;

  const todayKey = formatActivityLocalDate(now);
  if (lastFiredDateKey === todayKey) return false;

  const { hours, minutes } = parseReminderTime(notifications.reminderTime);
  const reminderAt = new Date(now);
  reminderAt.setHours(hours, minutes, 0, 0);

  return now.getTime() >= reminderAt.getTime();
}

export function millisecondsUntilNextReminder(
  notifications: Pick<NotificationSettings, 'dailyReminder' | 'reminderTime'>,
  now: Date = new Date()
): number | null {
  if (!notifications.dailyReminder) return null;

  const { hours, minutes } = parseReminderTime(notifications.reminderTime);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  if (now.getTime() >= next.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return Math.max(0, next.getTime() - now.getTime());
}

export function getDailyReminderStorageKey(userId: string): string {
  return `${REMINDER_STORAGE_KEY}.${userId}`;
}

export function readLastReminderDateKey(
  storage: { getItem(key: string): string | null | Promise<string | null> },
  userId: string
): string | null {
  try {
    const value = storage.getItem(getDailyReminderStorageKey(userId));
    if (value instanceof Promise) return null;
    return value;
  } catch {
    return null;
  }
}

export async function readLastReminderDateKeyAsync(
  storage: { getItem(key: string): Promise<string | null> | string | null },
  userId: string
): Promise<string | null> {
  try {
    const value = await storage.getItem(getDailyReminderStorageKey(userId));
    return value ?? null;
  } catch {
    return null;
  }
}

export function writeLastReminderDateKey(
  storage: { setItem(key: string, value: string): void | Promise<void> },
  userId: string,
  dateKey: string = formatActivityLocalDate(new Date())
): void {
  void storage.setItem(getDailyReminderStorageKey(userId), dateKey);
}

export function buildDailyReminderMessage(settings: UserSettings): { title: string; body: string } {
  const cardGoal = settings.study.dailyCardGoal;
  const testGoal = settings.study.dailyTestGoal;
  const parts: string[] = [];
  if (cardGoal > 0) parts.push(`${cardGoal} flashcards`);
  if (testGoal > 0) parts.push(`${testGoal} test${testGoal === 1 ? '' : 's'}`);
  const target = parts.length ? parts.join(' and ') : 'your study session';
  return {
    title: 'Time to study',
    body: `Your daily goal: ${target}. Open Lantern Study to keep your streak going.`,
  };
}
