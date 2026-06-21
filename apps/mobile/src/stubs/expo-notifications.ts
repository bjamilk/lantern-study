/**
 * Stub used when bundling for Expo Go (remote push is unavailable in SDK 53+).
 * Metro redirects `expo-notifications` imports here when EXPO_PUBLIC_APP_RUNTIME=expo-go.
 */

export enum AndroidImportance {
  UNKNOWN = 0,
  UNSPECIFIED = 1,
  NONE = 2,
  MIN = 3,
  LOW = 4,
  DEFAULT = 5,
  HIGH = 6,
  MAX = 7,
}

export function setNotificationHandler(_handler: unknown): void {}

export async function getPermissionsAsync(): Promise<{ status: 'denied' }> {
  return { status: 'denied' };
}

export async function requestPermissionsAsync(): Promise<{ status: 'denied' }> {
  return { status: 'denied' };
}

export async function getExpoPushTokenAsync(
  _options?: unknown
): Promise<{ type: 'expo'; data: string }> {
  return { type: 'expo', data: '' };
}

export async function setNotificationChannelAsync(
  _channelId: string,
  _channel: unknown
): Promise<void> {}

export function addNotificationResponseReceivedListener(
  _listener: unknown
): { remove: () => void } {
  return { remove: () => {} };
}

export function addNotificationReceivedListener(_listener: unknown): { remove: () => void } {
  return { remove: () => {} };
}
