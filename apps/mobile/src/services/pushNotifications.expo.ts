/**
 * Expo Go build: push notifications are unavailable (SDK 53+).
 * Metro resolves this file when bundling for Expo Go via the .expo.ts extension.
 */

export function isPushNotificationsSupported(): boolean {
  return false;
}

export async function registerForPushNotifications(): Promise<string | null> {
  return null;
}

export async function uploadPushToken(_expoPushToken: string): Promise<void> {
  // no-op in Expo Go
}

export interface NotificationPayload {
  url?: string;
  jobId?: string;
  kind?: string;
  pending?: boolean;
}

export function addNotificationResponseListener(
  _handler: (payload: NotificationPayload) => void
): () => void {
  return () => {};
}

export function addNotificationReceivedListener(
  _handler: (payload: NotificationPayload) => void
): () => void {
  return () => {};
}
