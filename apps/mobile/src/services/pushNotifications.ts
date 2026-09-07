import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { API_BASE_URL, getAuthHeaders } from './supabase';

export function isPushNotificationsSupported(): boolean {
  return true;
}

export async function registerForPushNotifications(): Promise<string | null> {
  const Notifications = await import('expo-notifications');

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  try {
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    return token.data;
  } catch {
    return null;
  }
}

export async function clearPushToken(): Promise<void> {
  try {
    const headers = await getAuthHeaders();
    await fetch(`${API_BASE_URL}/api/v1/users/push-token`, {
      method: 'DELETE',
      headers,
    });
  } catch (e) {
    console.warn('[pushNotifications] Failed to clear push token:', e);
  }
}

export async function uploadPushToken(expoPushToken: string): Promise<void> {
  try {
    const headers = await getAuthHeaders();
    await fetch(`${API_BASE_URL}/api/v1/users/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ token: expoPushToken }),
    });
  } catch (e) {
    console.warn('[pushNotifications] Failed to upload push token:', e);
  }
}

/**
 * What a notification carries for the app to act on.
 *
 * `jobId` is Wave G's: the server sends it on a generation push so the client
 * can mark that job done from the server record — and so the local completion
 * notification for the same job is not posted a second time on top of it.
 */
export interface NotificationPayload {
  url?: string;
  jobId?: string;
  kind?: string;
  /** The server is telling us a job exists, not that it has finished. */
  pending?: boolean;
}

const readPayload = (data: unknown): NotificationPayload => {
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    url: typeof raw.url === 'string' ? raw.url : undefined,
    jobId: typeof raw.jobId === 'string' ? raw.jobId : undefined,
    kind: typeof raw.kind === 'string' ? raw.kind : undefined,
    pending: raw.pending === true,
  };
};

export function addNotificationResponseListener(
  handler: (payload: NotificationPayload) => void
): () => void {
  let unsubscribe: (() => void) | undefined;

  void import('expo-notifications').then(Notifications => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      handler(readPayload(response.notification.request.content.data));
    });
    unsubscribe = () => sub.remove();
  });

  return () => {
    unsubscribe?.();
  };
}

/** Fires when a notification ARRIVES with the app running, tapped or not. */
export function addNotificationReceivedListener(
  handler: (payload: NotificationPayload) => void
): () => void {
  let unsubscribe: (() => void) | undefined;

  void import('expo-notifications').then(Notifications => {
    const sub = Notifications.addNotificationReceivedListener(notification => {
      handler(readPayload(notification.request.content.data));
    });
    unsubscribe = () => sub.remove();
  });

  return () => {
    unsubscribe?.();
  };
}
