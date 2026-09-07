import {
  LECTURE_NOTIFICATION_BODY,
  notificationTransition,
  planRecordingNotification,
  type NotificationStatus,
} from './lectureNotification';

const EVERY_STATUS: NotificationStatus[] = [
  'idle',
  'recording',
  'naming',
  'uploading',
  'transcribing',
  'failed',
];

describe('planRecordingNotification', () => {
  it('is up while the microphone is open, and only then', () => {
    for (const status of EVERY_STATUS) {
      expect(planRecordingNotification(status).visible).toBe(status === 'recording');
    }
  });

  it('names the note, so the notification says which lecture is running', () => {
    const plan = planRecordingNotification('recording', 'Pharmacology week 3');
    expect(plan.title).toBe('Recording lecture — Pharmacology week 3');
    expect(plan.body).toBe(LECTURE_NOTIFICATION_BODY);
  });

  it('still says what it is when the note has no name yet', () => {
    expect(planRecordingNotification('recording', '   ').title).toBe('Recording lecture');
    expect(planRecordingNotification('recording', null).title).toBe('Recording lecture');
  });

  it('carries no text at all when it is not showing', () => {
    // A stale title on a hidden notification is how one gets re-posted with
    // the wrong lecture's name.
    expect(planRecordingNotification('transcribing', 'Anatomy')).toEqual({
      visible: false,
      title: '',
      body: '',
    });
  });
});

describe('notificationTransition', () => {
  it('starts on the way into recording', () => {
    expect(notificationTransition('idle', 'recording')).toBe('start');
  });

  it('stops on every way out of recording — no exit path may leak it', () => {
    for (const next of EVERY_STATUS.filter((s) => s !== 'recording')) {
      expect(notificationTransition('recording', next)).toBe('stop');
    }
  });

  it('does nothing while nothing changed', () => {
    expect(notificationTransition('recording', 'recording')).toBe('none');
    expect(notificationTransition('naming', 'uploading')).toBe('none');
    expect(notificationTransition('failed', 'idle')).toBe('none');
  });
});
