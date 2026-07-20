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

const SRS_REMINDER_STORAGE_KEY = 'lantern.srsReminder.lastNotified';
/** Minimum gap between SRS OS notifications when the tab is in the background. */
export const SRS_REMINDER_COOLDOWN_MS = 4 * 60 * 60 * 1000;

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

/**
 * Whether an SRS due-card OS notification should fire now.
 * Suppresses while the tab is visible and throttles background reminders.
 */
export function shouldSendSrsWebReminder(totalDue: number, now = Date.now()): boolean {
  if (totalDue <= 0) return false;
  if (isLanternPageVisible()) return false;

  try {
    const raw = localStorage.getItem(SRS_REMINDER_STORAGE_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { at?: number; dueCount?: number };
    const at = typeof parsed.at === 'number' ? parsed.at : 0;
    const previousDue = typeof parsed.dueCount === 'number' ? parsed.dueCount : 0;
    const cooledDown = now - at >= SRS_REMINDER_COOLDOWN_MS;
    // Allow an earlier ping if the backlog grew substantially while away.
    const backlogGrew = totalDue >= previousDue + 10;
    return cooledDown || backlogGrew;
  } catch {
    return true;
  }
}

export function markSrsWebReminderSent(totalDue: number, now = Date.now()): void {
  try {
    localStorage.setItem(
      SRS_REMINDER_STORAGE_KEY,
      JSON.stringify({ at: now, dueCount: totalDue })
    );
  } catch {
    // ignore quota / private mode
  }
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
        });
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
