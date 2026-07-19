/**
 * Cross-platform web notifications.
 * Mobile browsers require ServiceWorkerRegistration.showNotification();
 * the Notification constructor throws on many mobile UAs.
 *
 * Never read the bare `Notification` global without an existence check —
 * Safari throws "Can't find variable: Notification" when the API is absent.
 */

export interface WebNotificationPayload {
  title: string;
  body?: string;
  icon?: string;
  tag?: string;
  /** Passed to notificationclick handler (e.g. navigate: 'flashcards'). */
  data?: Record<string, unknown>;
  onClick?: () => void;
}

export function hasWebNotificationSupport(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
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

export async function showWebNotification(payload: WebNotificationPayload): Promise<void> {
  if (!hasWebNotificationSupport()) return;
  if (Notification.permission !== 'granted') return;

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
