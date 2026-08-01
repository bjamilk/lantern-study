import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buildDailyReminderMessage,
  readLastReminderDateKeyAsync,
  shouldTriggerDailyReminder,
  writeLastReminderDateKey,
} from '@lantern/shared/settings';
import { formatActivityLocalDate } from '@lantern/shared/utils';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { isRunningInExpoGo } from 'expo';

const CHECK_INTERVAL_MS = 60_000;
const DAILY_REMINDER_ID = 'lantern-daily-study-reminder';

export function useDailyStudyReminder(): void {
  const userId = useAuthStore(s => s.user?.id);
  const settings = useSettingsStore(s => s.settings);
  const firedRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const dailyReminder = settings.notifications.dailyReminder;
  const reminderTime = settings.notifications.reminderTime;
  const dailyCardGoal = settings.study.dailyCardGoal;
  const dailyTestGoal = settings.study.dailyTestGoal;

  useEffect(() => {
    if (!userId || isRunningInExpoGo()) return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    const tick = async () => {
      if (cancelled || inFlightRef.current) return;
      const currentSettings = settingsRef.current;
      const lastFired =
        firedRef.current ?? (await readLastReminderDateKeyAsync(AsyncStorage, userId));

      if (!shouldTriggerDailyReminder(currentSettings.notifications, lastFired)) {
        return;
      }

      inFlightRef.current = true;
      try {
        const Notifications = await import('expo-notifications');
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted' || cancelled) return;

        // Persist first so overlapping interval ticks / effect remounts cannot spam.
        const todayKey = formatActivityLocalDate();
        writeLastReminderDateKey(AsyncStorage, userId, todayKey);
        firedRef.current = todayKey;

        // Replace any prior daily reminder instead of stacking duplicates.
        try {
          await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_ID);
        } catch {
          // ignore missing id
        }

        const message = buildDailyReminderMessage(currentSettings);
        await Notifications.scheduleNotificationAsync({
          identifier: DAILY_REMINDER_ID,
          content: {
            title: message.title,
            body: message.body,
            sound: true,
          },
          trigger: null,
        });
      } catch {
        // Non-fatal when notifications unavailable
      } finally {
        inFlightRef.current = false;
      }
    };

    void tick();
    interval = setInterval(() => void tick(), CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [userId, dailyReminder, reminderTime, dailyCardGoal, dailyTestGoal]);
}
