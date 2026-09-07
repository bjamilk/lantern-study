/**
 * Local (on-device) notifications.
 *
 * Separate from pushNotifications.ts on purpose: that module registers an Expo
 * push token with the server and is about messages the BACKEND sends. This one
 * never talks to the server — it posts a notification from the phone itself, so
 * a generation that finishes while the student is in another app still reaches
 * them. It works with no push token, no network and no server round trip.
 *
 * Permission is requested LAZILY — the first time a job actually runs, not at
 * boot — and a refusal is silent and final for the session: a student who said
 * no is not asked again on every generation, and nothing in the flow breaks.
 * On Expo Go `expo-notifications` resolves to src/stubs/expo-notifications.ts,
 * whose permission call returns `denied`, so this degrades to a no-op there.
 */
import { Platform } from 'react-native';

/** Android channel for finished generations. Named so the OS settings row makes sense. */
const JOBS_CHANNEL_ID = 'study-jobs';

type PermissionState = 'unknown' | 'granted' | 'denied';

let permission: PermissionState = 'unknown';
let inFlight: Promise<boolean> | null = null;

/** Test seam: forget the cached decision. */
export function resetLocalNotificationPermission(): void {
  permission = 'unknown';
  inFlight = null;
}

/**
 * Ask for notification permission if we have not already.
 *
 * Resolves false rather than throwing on any failure — a denied or broken
 * notification system must never take a generation down with it.
 */
export async function ensureLocalNotificationPermission(): Promise<boolean> {
  if (permission === 'granted') return true;
  if (permission === 'denied') return false;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const Notifications = await import('expo-notifications');
      const { status: existing } = await Notifications.getPermissionsAsync();
      let status = existing;
      if (status !== 'granted') {
        const requested = await Notifications.requestPermissionsAsync();
        status = requested.status;
      }
      if (status !== 'granted') {
        permission = 'denied';
        return false;
      }
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(JOBS_CHANNEL_ID, {
          name: 'Study materials',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      permission = 'granted';
      return true;
    } catch {
      permission = 'denied';
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export interface LocalNotificationInput {
  title: string;
  body: string;
  /**
   * Deep link for the tap. Delivered as `data.url`, which is exactly what
   * pushNotifications.addNotificationResponseListener reads, so a local
   * notification and a server push route through the same handler.
   */
  url?: string | null;
  /**
   * The job this is about. Sent as `data.jobId` — the same field a server push
   * carries — so the two can be told apart from each other, and so a tap can
   * be resolved even when the link is only the job itself.
   */
  jobId?: string;
  /**
   * The server's id for the same job. A server push carries THAT id in
   * `data.jobId`, so the dedupe below has to recognise either one.
   */
  serverJobId?: string;
}

/**
 * Jobs a server push has already announced.
 *
 * The JS poller does not run while the app is backgrounded, so a job that
 * finishes there is announced by the server's push and only noticed locally
 * when the student comes back. Without this the student would then get a
 * second notification for news they already had.
 */
const pushedJobIds = new Set<string>();

/** Record that a push covered this job. Called from the push listeners. */
export function markJobPushDelivered(jobId: string): void {
  if (jobId) pushedJobIds.add(jobId);
}

/** Has a push already told the student about this job? */
export function wasJobPushDelivered(jobId: string | undefined): boolean {
  return Boolean(jobId && pushedJobIds.has(jobId));
}

/** Test seam / sign-out: forget which jobs were announced. */
export function resetJobPushDeliveries(): void {
  pushedJobIds.clear();
}

/**
 * Is a notification for this job already sitting in the tray?
 *
 * The second half of the dedupe: a push delivered while the process was dead
 * was never seen by any listener, so the only evidence of it is the tray
 * itself. Resolves false on any failure — being unsure is not a reason to go
 * silent about work that finished.
 */
async function isAlreadyInTray(jobIds: string[]): Promise<boolean> {
  if (jobIds.length === 0) return false;
  try {
    const Notifications = await import('expo-notifications');
    const presented = await Notifications.getPresentedNotificationsAsync();
    return presented.some((item) => {
      const id = (item.request.content.data as { jobId?: string } | undefined)?.jobId;
      return typeof id === 'string' && jobIds.includes(id);
    });
  } catch {
    return false;
  }
}

/**
 * Post a notification now. Silent no-op when permission was refused.
 *
 * Returns whether one was actually posted, so a caller can fall back to an
 * in-app surface (the Home card) rather than assuming the student was told.
 */
export async function postLocalNotification(
  input: LocalNotificationInput
): Promise<boolean> {
  const allowed = await ensureLocalNotificationPermission();
  if (!allowed) return false;
  // Do not tell the student twice. A push about the same job already said it
  // — under either of the job's ids.
  const ids = [input.jobId, input.serverJobId].filter((id): id is string => Boolean(id));
  if (ids.some(wasJobPushDelivered)) return false;
  if (await isAlreadyInTray(ids)) return false;
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: input.title,
        body: input.body,
        // Never an empty payload: a tap with nothing in it just restores the
        // app wherever it was, which is how a finished quiz landed the student
        // back on the note editor.
        data: {
          ...(input.url ? { url: input.url } : {}),
          ...(input.jobId ? { jobId: input.jobId } : {}),
        },
      },
      // null = deliver immediately.
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}
