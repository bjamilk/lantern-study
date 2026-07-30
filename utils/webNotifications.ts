/**
 * Cross-platform web notifications.
 * Mobile browsers require ServiceWorkerRegistration.showNotification();
 * the Notification constructor throws on many mobile UAs.
 *
 * Never read the bare `Notification` global without an existence check —
 * Safari throws "Can't find variable: Notification" when the API is absent.
 *
 * Study reminders stay quiet while the Lantern tab is focused so users
 * studying notes/flashcards are not interrupted by OS toast spam.
 */

import {
  getSrsReminderStorageKey,
  parseSrsReminderMarker,
  serializeSrsReminderMarker,
  shouldSendSrsReminder,
  type SrsReminderMarker,
  SRS_REMINDER_COOLDOWN_MS as SHARED_SRS_COOLDOWN_MS,
} from '@lantern/shared/settings';

export interface WebNotificationPayload {
  title: string;
  body?: string;
  icon?: string;
  tag?: string;
  /** Passed to notificationclick handler (e.g. navigate: 'flashcards'). */
  data?: Record<string, unknown>;
  onClick?: () => void;
  /**
   * When false (default), skip OS notifications if the Lantern tab is visible.
   * Set true only for rare high-priority alerts that must interrupt active use.
   */
  forceWhileVisible?: boolean;
}

/** Re-export shared cooldown for callers/tests. */
export const SRS_REMINDER_COOLDOWN_MS = SHARED_SRS_COOLDOWN_MS;

/** In-memory fallback when localStorage is unavailable (private mode / quota). */
const srsMemoryByKey = new Map<string, SrsReminderMarker>();
/** Prevents re-entrant double-sends before persistence completes. */
const srsInFlightKeys = new Set<string>();

export function hasWebNotificationSupport(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** True when the Lantern document is visible / focused for the user. */
export function isLanternPageVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible';
}

/** Safe read of Notification.permission; never throws when the API is missing. */
export function getWebNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!hasWebNotificationSupport()) return 'unsupported';
  return Notification.permission;
}

export async function requestWebNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!hasWebNotificationSupport()) {
    return 'unsupported';
  }
  if (Notification.permission !== 'default') {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function readSrsMarker(userId?: string | null): SrsReminderMarker | null {
  const key = getSrsReminderStorageKey(userId);
  const memory = srsMemoryByKey.get(key);
  if (memory) return memory;

  try {
    const parsed = parseSrsReminderMarker(localStorage.getItem(key));
    if (parsed) {
      srsMemoryByKey.set(key, parsed);
      return parsed;
    }
    // Migrate legacy unscoped key when reading a user-scoped marker.
    if (userId) {
      const legacy = parseSrsReminderMarker(
        localStorage.getItem(getSrsReminderStorageKey(null))
      );
      if (legacy) {
        srsMemoryByKey.set(key, legacy);
        return legacy;
      }
    }
  } catch {
    // private mode / disabled storage — memory only
  }
  return null;
}

/**
 * Whether an SRS due-card OS notification should fire now.
 * Suppresses while the tab is visible and throttles background reminders.
 */
export function shouldSendSrsWebReminder(
  totalDue: number,
  now = Date.now(),
  userId?: string | null
): boolean {
  if (isLanternPageVisible()) return false;
  const key = getSrsReminderStorageKey(userId);
  if (srsInFlightKeys.has(key)) return false;
  return shouldSendSrsReminder(totalDue, readSrsMarker(userId), now);
}

export function markSrsWebReminderSent(
  totalDue: number,
  now = Date.now(),
  userId?: string | null
): void {
  const key = getSrsReminderStorageKey(userId);
  const marker: SrsReminderMarker = { at: now, dueCount: totalDue };
  srsMemoryByKey.set(key, marker);
  srsInFlightKeys.delete(key);
  try {
    localStorage.setItem(key, serializeSrsReminderMarker(marker));
  } catch {
    // Memory marker still blocks remount/AppState spam for this session.
  }
}

/** Claim the send slot before the async showNotification path runs. */
export function beginSrsWebReminderSend(userId?: string | null): boolean {
  const key = getSrsReminderStorageKey(userId);
  if (srsInFlightKeys.has(key)) return false;
  srsInFlightKeys.add(key);
  return true;
}

export function cancelSrsWebReminderSend(userId?: string | null): void {
  srsInFlightKeys.delete(getSrsReminderStorageKey(userId));
}

/** Test helper — clears in-memory SRS throttle state. */
export function __resetSrsWebReminderStateForTests(): void {
  srsMemoryByKey.clear();
  srsInFlightKeys.clear();
}

export async function showWebNotification(payload: WebNotificationPayload): Promise<void> {
  if (!hasWebNotificationSupport()) return;
  if (Notification.permission !== 'granted') return;

  // Default: no OS toasts while the user is already in Lantern.
  if (!payload.forceWhileVisible && isLanternPageVisible()) {
    return;
  }

  const { title, body, icon = '/favicon.ico', tag, data, onClick } = payload;
  const notificationData = { ...data, tag };

  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      if (registration?.showNotification) {
        await registration.showNotification(title, {
          body,
          icon,
          tag,
          data: notificationData,
          // Replace any prior notification with the same tag (dedupe tray spam).
          renotify: false,
        } as NotificationOptions);
        return;
      }
    } catch (err) {
      console.warn('[webNotifications] Service worker notification failed:', err);
    }
  }

  // Desktop fallback — not available on most mobile browsers.
  try {
    const notification = new Notification(title, { body, icon, tag, data: notificationData });
    if (onClick) {
      notification.onclick = () => {
        onClick();
        notification.close();
      };
    }
  } catch (err) {
    console.warn('[webNotifications] Notification constructor failed:', err);
  }
}

export function onWebNotificationClick(
  handler: (data: Record<string, unknown>) => void
): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {};
  }

  const listener = (event: MessageEvent) => {
    if (event.data?.type === 'notification-click') {
      handler(event.data as Record<string, unknown>);
    }
  };

  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}
