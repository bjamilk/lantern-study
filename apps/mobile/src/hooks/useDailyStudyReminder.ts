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

export function useDailyStudyReminder(): void {
  const userId = useAuthStore(s => s.user?.id);
  const settings = useSettingsStore(s => s.settings);
  const firedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || isRunningInExpoGo()) return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    const tick = async () => {
      if (cancelled) return;
      const lastFired =
        firedRef.current ?? (await readLastReminderDateKeyAsync(AsyncStorage, userId));

      if (!shouldTriggerDailyReminder(settings.notifications, lastFired)) {
        return;
      }

      try {
        const Notifications = await import('expo-notifications');
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') return;

        const message = buildDailyReminderMessage(settings);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: message.title,
            body: message.body,
            sound: true,
          },
          trigger: null,
        });

        const todayKey = formatActivityLocalDate();
        writeLastReminderDateKey(AsyncStorage, userId, todayKey);
        firedRef.current = todayKey;
      } catch {
        // Non-fatal when notifications unavailable
      }
    };

    void tick();
    interval = setInterval(() => void tick(), CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [userId, settings.notifications.dailyReminder, settings.notifications.reminderTime, settings.study.dailyCardGoal, settings.study.dailyTestGoal]);
}
