import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { API_BASE_URL, getAuthHeaders } from './supabase';
import { ensureJobsChannel } from './localNotifications';
import {
  pushReadiness,
  type PushAppIdentity,
  type PushPermissionState,
  type PushReadiness,
  type PushRegisterOutcome,
  type PushServerStatus,
} from '../utils/pushDiagnostics';

export function isPushNotificationsSupported(): boolean {
  return true;
}

/**
 * The last token this device actually obtained.
 *
 * Held in memory so the diagnostics screen can answer "did registration ever
 * work HERE?" without asking the OS again — the two halves of a missing push
 * (this device has no token / the server has no token) are different problems
 * with different fixes, and until now neither was visible.
 */
let lastDeviceToken: string | null = null;

/**
 * The native transport the last registration actually used ('fcm' / 'apns').
 *
 * The device audit read "Could not find APNs credentials for
 * com.lanternstudy.app.dev" on an ANDROID emulator, and nothing on the phone
 * could contradict it. Recording the transport makes the contradiction
 * visible: an Android build that reports anything but `fcm` is the bug.
 */
let lastDeviceTokenType: string | null = null;

/** Whatever stopped the last registration, kept verbatim. */
let lastRegisterError: string | null = null;

/** What this device got from Expo, if registration has run in this process. */
export function getCachedPushToken(): string | null {
  return lastDeviceToken;
}

/** Why the last registration produced no token, or `null` when it worked. */
export function getLastPushRegisterError(): string | null {
  return lastRegisterError;
}

/**
 * Which app this device would mint a token for.
 *
 * Read from the running config, not remembered from a build: `.dev` variants
 * carry a different application id, and a token minted under one identity is
 * delivered with that identity's credentials no matter which build later asks
 * the server to push.
 */
export function getPushAppIdentity(): PushAppIdentity {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const applicationId =
    Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.bundleIdentifier
      : Constants.expoConfig?.android?.package;
  return {
    platform: Platform.OS,
    applicationId: applicationId ?? null,
    projectId: getPushProjectId() ?? null,
    appVariant: typeof extra?.appVariant === 'string' ? extra.appVariant : null,
    deviceTokenType: lastDeviceTokenType,
  };
}

/**
 * The EAS project whose push credentials Expo will look up.
 *
 * Passed explicitly on every call: without it `getExpoPushTokenAsync` falls
 * back to whatever the manifest happens to carry, which in a dev client is the
 * dev-client's own identity rather than this app's.
 */
function getPushProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: unknown } }
    | undefined;
  const fromExtra = extra?.eas?.projectId;
  if (typeof fromExtra === 'string' && fromExtra.length > 0) return fromExtra;
  const fromEas = (Constants as unknown as { easConfig?: { projectId?: unknown } }).easConfig
    ?.projectId;
  return typeof fromEas === 'string' && fromEas.length > 0 ? fromEas : undefined;
}

/** The OS answer, without asking for anything. */
export async function getPushPermissionState(): Promise<PushPermissionState> {
  try {
    const Notifications = await import('expo-notifications');
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return 'granted';
    if (status === 'denied') return canAskAgain ? 'undetermined' : 'denied';
    return 'undetermined';
  } catch {
    return 'unavailable';
  }
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

  if (Platform.OS === 'android') {
    // Created BEFORE the token is requested, not after: on Android a token is
    // only useful if there is a channel to deliver on, and the previous order
    // meant a registration that threw left the app with no channel at all.
    //
    // The server's job pushes name `study-jobs` (services/jobPush.ts), which
    // `ensureJobsChannel` below creates; `default` stays for everything else
    // and has to be legible: the OS settings row was literally titled
    // "default", which tells a student nothing about what they are muting.
    try {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Lantern Study',
        description: 'Work you asked us to do, and everything else from the app.',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
      // The app's own channel for locally posted completions, created here too
      // so it exists before the first generation rather than at the first post.
      await ensureJobsChannel();
    } catch {
      // A missing channel is a delivery problem, not a registration one.
    }
  }

  // The native token, read first and only for its TYPE. On Android this is the
  // FCM registration, and it is the one thing that proves this build has a
  // Firebase configuration at all — without `android.googleServicesFile` it
  // throws here, which is exactly the failure the panel has to be able to say
  // out loud instead of reporting "no token".
  lastDeviceTokenType = null;
  try {
    const device = await Notifications.getDevicePushTokenAsync();
    lastDeviceTokenType = typeof device?.type === 'string' ? device.type : null;
  } catch (error) {
    lastRegisterError = error instanceof Error ? error.message : String(error);
  }

  const projectId = getPushProjectId();
  try {
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    lastDeviceToken = token.data;
    lastRegisterError = null;
    return token.data;
  } catch (error) {
    lastRegisterError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

export async function clearPushToken(): Promise<void> {
  lastDeviceToken = null;
  lastDeviceTokenType = null;
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
    await uploadPushTokenChecked(expoPushToken);
  } catch (e) {
    console.warn('[pushNotifications] Failed to upload push token:', e);
  }
}

/**
 * The same upload, but it tells you when it failed.
 *
 * `uploadPushToken` swallows everything, which is right for the boot path —
 * a registration failure must not break sign-in — and exactly wrong for a
 * button the student pressed to fix their notifications. The server's own
 * error text is preserved: "Push notifications are disabled in your settings"
 * is the actual reason a token will not stick, and paraphrasing it into
 * "something went wrong" is how this failure stayed invisible.
 */
export async function uploadPushTokenChecked(expoPushToken: string): Promise<void> {
  const headers = await getAuthHeaders();
  const identity = getPushAppIdentity();
  const response = await fetch(`${API_BASE_URL}/api/v1/users/push-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    // The identity travels with the token so the server-side audit can say
    // WHICH app a failing push was addressed to. These fields are optional and
    // an older server ignores them; the token alone is still the contract.
    body: JSON.stringify({
      token: expoPushToken,
      platform: identity.platform,
      applicationId: identity.applicationId ?? undefined,
      projectId: identity.projectId ?? undefined,
      appVariant: identity.appVariant ?? undefined,
      deviceTokenType: identity.deviceTokenType ?? undefined,
    }),
  });
  if (response.ok) return;
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(payload?.error || `The server refused the token (${response.status})`);
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
  return (await jobNotificationsReadiness()) !== 'off';
}

/**
 * The three-answer version, and the one the sheet uses.
 *
 * Every condition is checked against a real source: the OS for permission,
 * and `GET /users/push-token/status` for the token and the account switch.
 * Nothing is inferred from the client's own settings store — build 161's
 * sheet promised a notification while none of these had been asked.
 */
export async function jobNotificationsReadiness(): Promise<PushReadiness> {
  const permission = await getPushPermissionState();
  const server = await fetchPushTokenStatus();
  return pushReadiness({
    supported: isPushNotificationsSupported(),
    permission,
    deviceToken: lastDeviceToken,
    server,
  });
}

/**
 * Will the server actually push to this account?
 *
 * True when a usable Expo token is on file AND pushes are enabled in the
 * account's settings. `null` when the question cannot be answered — a 404
 * from a server that predates the route, or a failed request.
 */
export async function fetchPushTokenRegistered(): Promise<boolean | null> {
  const status = await fetchPushTokenStatus();
  if (!status) return null;
  return status.hasToken && status.pushEnabled;
}

/**
 * The whole answer from `GET /users/push-token/status`, or `null`.
 *
 * `null` means the question could not be asked — an older server, no
 * connection, a signed-out client. Every caller distinguishes that from "no",
 * because they are different things to tell a student.
 */
export async function fetchPushTokenStatus(): Promise<PushServerStatus | null> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/users/push-token/status`, { headers });
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as {
      data?: Record<string, unknown>;
    } | null;
    const body = (payload?.data ?? payload ?? {}) as Record<string, unknown>;
    const hasToken =
      typeof body.hasToken === 'boolean'
        ? body.hasToken
        : typeof body.registered === 'boolean'
          ? body.registered
          : undefined;
    if (typeof hasToken !== 'boolean') return null;
    return {
      hasToken,
      // A server that does not report the switch is not asserting it is off.
      pushEnabled: body.pushEnabled !== false,
      updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : null,
    };
  } catch {
    return null;
  }
}

/**
 * Register this device again and hand the token to the server, reporting
 * exactly what happened.
 *
 * The action behind the diagnostics screen's "Re-register": it is the same
 * work the app does at sign-in, run on demand, with the failure surfaced
 * instead of logged to a console nobody on a phone can read.
 */
export async function reRegisterPushToken(): Promise<PushRegisterOutcome> {
  let token: string | null = null;
  try {
    token = await registerForPushNotifications();
  } catch (error) {
    return {
      token: null,
      uploaded: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!token) return { token: null, uploaded: false };
  try {
    await uploadPushTokenChecked(token);
    return { token, uploaded: true };
  } catch (error) {
    return {
      token,
      uploaded: false,
      error: error instanceof Error ? error.message : String(error),
    };
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
