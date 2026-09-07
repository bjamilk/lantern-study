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

/**
 * Can this device actually be told a background job finished?
 *
 * Two things have to be true: the OS permission, and a push token the server
 * knows about. The device run backgrounded a generation and was told nothing
 * for 212 s (F6) — the sheet promises "we'll tell you when it's ready", and a
 * promise it cannot keep is worse than no promise, so the sheet asks this and
 * says something true instead.
 *
 * Returns `true` when it cannot tell (an older server with no status route,
 * or no connection): claiming notifications are off on a guess would send the
 * student to a settings screen that is already correct.
 */
export async function areJobNotificationsReady(): Promise<boolean> {
  try {
    const Notifications = await import('expo-notifications');
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return false;
  } catch {
    // No notifications module at all (Expo Go): nothing will be delivered.
    return false;
  }
  const registered = await fetchPushTokenRegistered();
  return registered !== false;
}

/**
 * Will the server actually push to this account?
 *
 * True when a usable Expo token is on file AND pushes are enabled in the
 * account's settings. `null` when the question cannot be answered — a 404
 * from a server that predates the route, or a failed request.
 */
export async function fetchPushTokenRegistered(): Promise<boolean | null> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/users/push-token/status`, { headers });
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as {
      data?: { registered?: boolean; hasToken?: boolean; pushEnabled?: boolean };
      registered?: boolean;
    } | null;
    const body = payload?.data ?? payload ?? {};
    const registered = body.registered ?? (body as { hasToken?: boolean }).hasToken;
    if (typeof registered !== 'boolean') return null;
    // The account's own master switch counts: a token on file that the
    // server will never send to is not a notification the student will get.
    const enabled = (body as { pushEnabled?: boolean }).pushEnabled;
    return registered && enabled !== false;
  } catch {
    return null;
  }
}

/**
 * Turn job notifications on from inside the app.
 *
 * Asks for permission, registers a token and hands it to the server. Returns
 * false when the OS refuses — the caller then sends the student to the system
 * settings, which is the only place a hard refusal can be undone.
 */
export async function enableJobNotifications(): Promise<boolean> {
  const token = await registerForPushNotifications();
  if (!token) return false;
  await uploadPushToken(token);
  return true;
}
