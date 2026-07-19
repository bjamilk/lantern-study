import { useEffect, useRef } from 'react';
import {
  buildDailyReminderMessage,
  getDailyReminderStorageKey,
  shouldTriggerDailyReminder,
} from '@lantern/shared/settings';
import { normalizeUserSettings } from '@lantern/shared/settings';
import type { User } from '../types';
import { getWebNotificationPermission, showWebNotification } from '../utils/webNotifications';

const CHECK_INTERVAL_MS = 60_000;

export function useDailyStudyReminder(currentUser: User | null): void {
  const firedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentUser?.id) return;

    const storageKey = getDailyReminderStorageKey(currentUser.id);
    firedRef.current = localStorage.getItem(storageKey);

    const tick = () => {
      const settings = normalizeUserSettings(currentUser.settings);
      const lastFired = firedRef.current ?? localStorage.getItem(storageKey);

      if (
        !shouldTriggerDailyReminder(settings.notifications, lastFired) ||
        getWebNotificationPermission() !== 'granted'
      ) {
        return;
      }

      const todayKey = new Date().toISOString().slice(0, 10);
      const message = buildDailyReminderMessage(settings);
      void showWebNotification({
        title: message.title,
        body: message.body,
        icon: '/favicon.ico',
        tag: 'daily-study-reminder',
        onClick: () => window.focus(),
      });

      localStorage.setItem(storageKey, todayKey);
      firedRef.current = todayKey;
    };

    tick();
    const interval = setInterval(tick, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [currentUser?.id, currentUser?.settings]);
}
