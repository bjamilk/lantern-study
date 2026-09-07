/**
 * When the recording notification is up, and what it says.
 *
 * One rule, and it is the whole file: the ongoing notification exists while,
 * and only while, the microphone is open. A notification that outlives the
 * recording tells a student their lecture is still being captured when it is
 * not — and a microphone held with nothing on screen saying so is worse still.
 *
 * `status` here is `LectureRecordingStatus`, kept structural so this module
 * has no import back into the store it drives.
 */

export type NotificationStatus =
  | 'idle'
  | 'recording'
  | 'naming'
  | 'uploading'
  | 'transcribing'
  | 'failed';

export interface RecordingNotificationPlan {
  /** Whether the foreground service (and so the notification) should be up. */
  visible: boolean;
  title: string;
  body: string;
}

export const LECTURE_NOTIFICATION_BODY = 'Tap to return';

/**
 * The notification follows the microphone, not the session. `naming`,
 * `uploading`, `transcribing` and `failed` all happen with the recorder shut
 * down — the in-app banner covers those, and it is on screen.
 */
export function planRecordingNotification(
  status: NotificationStatus,
  noteTitle?: string | null
): RecordingNotificationPlan {
  if (status !== 'recording') {
    return { visible: false, title: '', body: '' };
  }
  const name = (noteTitle || '').trim();
  return {
    visible: true,
    title: name ? `Recording lecture — ${name}` : 'Recording lecture',
    body: LECTURE_NOTIFICATION_BODY,
  };
}

/**
 * The transition, so a caller can act on a change rather than re-issuing the
 * same start on every tick. `'start'` also covers a title change while
 * recording, because the service call replaces the notification's text.
 */
export function notificationTransition(
  previous: NotificationStatus,
  next: NotificationStatus
): 'start' | 'stop' | 'none' {
  const was = planRecordingNotification(previous).visible;
  const now = planRecordingNotification(next).visible;
  if (now && !was) return 'start';
  if (!now && was) return 'stop';
  return 'none';
}
