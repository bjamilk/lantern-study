/**
 * Exam reminders: the keying, the idempotency, and the one that would be
 * invisible in production until a student missed an exam — moving the date.
 */
import {
  DEFAULT_TIMEZONE,
  EXAM_REMINDER_NOTIFICATION_TYPE,
  daysBetween,
  dueStages,
  examReminderKey,
  examReminderMessage,
  localNow,
  processExamReminders,
} from './examReminders';

jest.mock('./topicMastery', () => ({
  getTopicMasteryService: () => ({
    courseReadiness: async () => [
      { weakestTopics: ['Krebs cycle'], nextAction: { label: 'Review Krebs cards' } },
    ],
  }),
}));

describe('exam reminder keys and timing', () => {
  it('puts the exam DATE in the key, so a moved exam mints fresh keys', () => {
    expect(examReminderKey('c1', '2026-09-20', 'week')).toBe('exam:c1:2026-09-20:week');
    expect(examReminderKey('c1', '2026-09-27', 'week')).not.toBe(
      examReminderKey('c1', '2026-09-20', 'week')
    );
  });

  it('reads the student local day, not the UTC day', () => {
    // 23:30 UTC is already the next day in Lagos (UTC+1).
    expect(localNow(new Date('2026-09-20T23:30:00Z'), DEFAULT_TIMEZONE).date).toBe('2026-09-21');
    expect(localNow(new Date('2026-09-20T23:30:00Z'), 'UTC').date).toBe('2026-09-20');
  });

  it('falls back to the default timezone rather than throwing on a bad one', () => {
    expect(localNow(new Date('2026-09-20T12:00:00Z'), 'Not/AZone').date).toBe('2026-09-20');
  });

  it('counts whole days between calendar dates', () => {
    expect(daysBetween('2026-09-20', '2026-09-27')).toBe(7);
    expect(daysBetween('2026-09-20', '2026-09-20')).toBe(0);
    expect(daysBetween('2026-09-21', '2026-09-20')).toBe(-1);
  });

  it('fires nothing before 06:00 local', () => {
    expect(dueStages(0, 5)).toEqual([]);
    expect(dueStages(0, 6)).toEqual(['morning', 'day', 'week']);
  });

  it('orders due stages most urgent first and fires nothing after the exam', () => {
    expect(dueStages(7, 9)).toEqual(['week']);
    expect(dueStages(1, 9)).toEqual(['day', 'week']);
    expect(dueStages(8, 9)).toEqual([]);
    expect(dueStages(-1, 9)).toEqual([]);
  });

  it('never says "in 1 days"', () => {
    expect(examReminderMessage({ stage: 'day', daysUntil: 1, courseLabel: 'BCH 201' })).toBe(
      'Your BCH 201 exam is tomorrow.'
    );
    expect(
      examReminderMessage({ stage: 'week', daysUntil: 1, courseLabel: 'BCH 201' })
    ).toContain('in 2 days');
  });
});

// ---------------------------------------------------------------------------

interface Enrolment {
  user_id: string;
  course_id: string;
  exam_date: string;
  courses: { id: string; code: string; title: string };
}

function harness(enrolments: Enrolment[]) {
  const claimed = new Set<string>();
  const notifications: Array<{ userId: string; message: string; type?: string; data?: any }> = [];

  const chain = (data: unknown) => {
    const api: any = {};
    for (const method of ['select', 'eq', 'not', 'gte', 'lte', 'in', 'limit', 'order']) {
      api[method] = () => api;
    }
    api.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve);
    return api;
  };

  const supabaseService: any = {
    getClient: () => ({
      from: (table: string) => {
        if (table === 'retention_reminders_sent') {
          return {
            insert: async (row: { user_id: string; reminder_key: string }) => {
              const key = `${row.user_id}|${row.reminder_key}`;
              if (claimed.has(key)) return { error: { code: '23505', message: 'dup' } };
              claimed.add(key);
              return { error: null };
            },
          };
        }
        if (table === 'user_courses') return chain(enrolments);
        if (table === 'profiles') return chain([]);
        return chain([]);
      },
    }),
    notifications: {
      createNotification: async (userId: string, payload: any) => {
        notifications.push({ userId, ...payload });
        return { id: `n${notifications.length}` };
      },
    },
  };

  return { supabaseService, claimed, notifications };
}

const enrolment = (examDate: string): Enrolment => ({
  user_id: 'user-1',
  course_id: 'course-1',
  exam_date: examDate,
  courses: { id: 'course-1', code: 'BCH 201', title: 'Biochemistry' },
});

// 09:00 in Lagos.
const at = (iso: string) => new Date(iso);

describe('processExamReminders', () => {
  it('sends the week reminder once and never again for the same date', async () => {
    const h = harness([enrolment('2026-09-27')]);
    const first = await processExamReminders(h.supabaseService, at('2026-09-20T08:00:00Z'));
    expect(first.sent).toBe(1);
    expect(h.notifications[0].type).toBe(EXAM_REMINDER_NOTIFICATION_TYPE);
    expect(h.notifications[0].message).toContain('in 7 days');

    const second = await processExamReminders(h.supabaseService, at('2026-09-20T14:00:00Z'));
    expect(second.sent).toBe(0);
    expect(h.notifications).toHaveLength(1);
  });

  it('delivers three reminders across the run-up, one per stage', async () => {
    const h = harness([enrolment('2026-09-27')]);
    await processExamReminders(h.supabaseService, at('2026-09-20T08:00:00Z')); // 7 days
    await processExamReminders(h.supabaseService, at('2026-09-23T08:00:00Z')); // 4 days
    await processExamReminders(h.supabaseService, at('2026-09-26T08:00:00Z')); // 1 day
    await processExamReminders(h.supabaseService, at('2026-09-27T08:00:00Z')); // morning
    expect(h.notifications.map((n) => n.data.stage)).toEqual(['week', 'day', 'morning']);
  });

  it('sends one message, not two, when a date is added at short notice', async () => {
    const h = harness([enrolment('2026-09-21')]);
    const result = await processExamReminders(h.supabaseService, at('2026-09-20T08:00:00Z'));
    expect(result.sent).toBe(1);
    expect(result.claimed).toBe(2); // week is claimed silently so it cannot follow
    expect(h.notifications[0].message).toContain('tomorrow');
  });

  it('does not re-fire the old date and does fire the new one when an exam moves', async () => {
    const h = harness([enrolment('2026-09-27')]);
    await processExamReminders(h.supabaseService, at('2026-09-20T08:00:00Z'));
    expect(h.notifications).toHaveLength(1);

    // The student moves the exam a week later. Same course, same student.
    const moved = harness([enrolment('2026-10-04')]);
    // Carry the old ledger over: this is the same table in production.
    for (const key of h.claimed) moved.claimed.add(key);
    const after = await processExamReminders(moved.supabaseService, at('2026-09-27T08:00:00Z'));
    expect(after.sent).toBe(1);
    expect(moved.notifications[0].data.examDate).toBe('2026-10-04');
    expect(moved.notifications[0].message).toContain('in 7 days');
  });

  it('carries the readiness deep link and the next action', async () => {
    const h = harness([enrolment('2026-09-27')]);
    await processExamReminders(h.supabaseService, at('2026-09-20T08:00:00Z'));
    expect(h.notifications[0]).toEqual(
      expect.objectContaining({ link: '/dashboard?readiness=course-1' })
    );
    expect(h.notifications[0].data.nextActionLabel).toBe('Review Krebs cards');
    expect(h.notifications[0].message).toContain('Krebs cycle');
  });

  it('stays quiet before 06:00 in the student day', async () => {
    const h = harness([enrolment('2026-09-27')]);
    // 04:00 UTC is 05:00 in Lagos.
    const result = await processExamReminders(h.supabaseService, at('2026-09-20T04:00:00Z'));
    expect(result.sent).toBe(0);
  });
});
