import {
  shouldTriggerDailyReminder,
  buildDailyReminderMessage,
} from './dailyReminders';
import { formatActivityLocalDate } from '../utils/activity';
import { DEFAULT_USER_SETTINGS } from './userSettings';

describe('shouldTriggerDailyReminder', () => {
  it('fires once after reminder time and not again the same local day', () => {
    // Local afternoon after a 09:00 reminder.
    const now = new Date(2026, 6, 30, 20, 0, 0); // Jul 30, 2026 20:00 local
    const todayKey = formatActivityLocalDate(now);

    expect(
      shouldTriggerDailyReminder(
        { dailyReminder: true, reminderTime: '09:00' },
        null,
        now
      )
    ).toBe(true);

    expect(
      shouldTriggerDailyReminder(
        { dailyReminder: true, reminderTime: '09:00' },
        todayKey,
        now
      )
    ).toBe(false);
  });

  it('only suppresses when lastFired matches the local activity date key', () => {
    // Web used to persist toISOString().slice(0,10) (UTC) while the gate compares
    // formatActivityLocalDate (local). In US evening timezones those diverge and the
    // reminder re-fires every minute. Persistence must use the local key.
    const now = new Date(2026, 6, 30, 20, 0, 0);
    const localKey = formatActivityLocalDate(now);
    const mismatchedKey = localKey === '2026-07-30' ? '2026-07-31' : '2026-07-30';

    expect(
      shouldTriggerDailyReminder(
        { dailyReminder: true, reminderTime: '09:00' },
        localKey,
        now
      )
    ).toBe(false);
    expect(
      shouldTriggerDailyReminder(
        { dailyReminder: true, reminderTime: '09:00' },
        mismatchedKey,
        now
      )
    ).toBe(true);
  });
});

describe('buildDailyReminderMessage', () => {
  it('includes study goals', () => {
    const msg = buildDailyReminderMessage({
      ...DEFAULT_USER_SETTINGS,
      study: { ...DEFAULT_USER_SETTINGS.study, dailyCardGoal: 20, dailyTestGoal: 1 },
    });
    expect(msg.title).toBe('Time to study');
    expect(msg.body).toContain('20 flashcards');
  });
});
