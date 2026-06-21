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

export function addNotificationResponseListener(
  _handler: (url: string | undefined) => void
): () => void {
  return () => {};
}
