import { useEffect, useRef } from 'react';
import {
  buildDailyReminderMessage,
  getDailyReminderStorageKey,
  shouldTriggerDailyReminder,
} from '@lantern/shared/settings';
import { normalizeUserSettings } from '@lantern/shared/settings';
import { formatActivityLocalDate } from '@lantern/shared/utils';
import type { User } from '../types';
import { getWebNotificationPermission, showWebNotification } from '../utils/webNotifications';

const CHECK_INTERVAL_MS = 60_000;

/**
 * Fires at most one daily OS reminder. showWebNotification already skips
 * while the Lantern tab is visible so active study sessions stay quiet.
 *
 * Persistence uses formatActivityLocalDate (local calendar day) — the same key
 * shouldTriggerDailyReminder compares against. UTC ISO date keys must not be used
 * or reminders re-fire every minute after evening reminder time in western timezones.
 */
export function useDailyStudyReminder(currentUser: User | null): void {
  const userRef = useRef(currentUser);
  userRef.current = currentUser;
  const firedRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  const userId = currentUser?.id;
  const normalized = currentUser ? normalizeUserSettings(currentUser.settings) : null;
  const dailyReminder = normalized?.notifications.dailyReminder;
  const reminderTime = normalized?.notifications.reminderTime;
  const dailyCardGoal = normalized?.study.dailyCardGoal;
  const dailyTestGoal = normalized?.study.dailyTestGoal;

  useEffect(() => {
    if (!userId) return;

    const storageKey = getDailyReminderStorageKey(userId);
    try {
      firedRef.current = localStorage.getItem(storageKey);
    } catch {
      // keep prior memory marker
    }

    const tick = () => {
      if (inFlightRef.current) return;
      const user = userRef.current;
      if (!user?.id) return;
      const settings = normalizeUserSettings(user.settings);

      let lastFired = firedRef.current;
      try {
        lastFired = firedRef.current ?? localStorage.getItem(storageKey);
      } catch {
        // keep memory
      }

      if (
        !shouldTriggerDailyReminder(settings.notifications, lastFired) ||
        getWebNotificationPermission() !== 'granted'
      ) {
        return;
      }

      // Persist the local day key before the async show path to stop interval spam.
      const todayKey = formatActivityLocalDate(new Date());
      inFlightRef.current = true;
      firedRef.current = todayKey;
      try {
        localStorage.setItem(storageKey, todayKey);
      } catch {
        // memory marker still blocks this session
      }

      const message = buildDailyReminderMessage(settings);
      void showWebNotification({
        title: message.title,
        body: message.body,
        icon: '/favicon.ico',
        tag: 'daily-study-reminder',
        onClick: () => window.focus(),
      }).finally(() => {
        inFlightRef.current = false;
      });
    };

    tick();
    const interval = setInterval(tick, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [userId, dailyReminder, reminderTime, dailyCardGoal, dailyTestGoal]);
}
