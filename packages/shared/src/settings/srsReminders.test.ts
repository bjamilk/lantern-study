import {
  SRS_BACKLOG_GROWTH_THRESHOLD,
  SRS_REMINDER_COOLDOWN_MS,
  SRS_REMINDER_MIN_GAP_MS,
  parseSrsReminderMarker,
  shouldSendSrsReminder,
} from './srsReminders';

describe('shouldSendSrsReminder', () => {
  const t0 = 1_700_000_000_000;

  it('allows the first reminder when cards are due', () => {
    expect(shouldSendSrsReminder(3, null, t0)).toBe(true);
  });

  it('blocks when nothing is due', () => {
    expect(shouldSendSrsReminder(0, null, t0)).toBe(false);
  });

  it('enforces the multi-hour cooldown for the same backlog', () => {
    const last = { at: t0, dueCount: 12 };
    expect(shouldSendSrsReminder(12, last, t0 + SRS_REMINDER_MIN_GAP_MS)).toBe(false);
    expect(
      shouldSendSrsReminder(12, last, t0 + SRS_REMINDER_COOLDOWN_MS - 1)
    ).toBe(false);
    expect(
      shouldSendSrsReminder(12, last, t0 + SRS_REMINDER_COOLDOWN_MS)
    ).toBe(true);
  });

  it('does not let backlog growth bypass the minimum gap (spam during sync)', () => {
    const last = { at: t0, dueCount: 5 };
    const grew = 5 + SRS_BACKLOG_GROWTH_THRESHOLD;
    expect(shouldSendSrsReminder(grew, last, t0 + 60_000)).toBe(false);
    expect(
      shouldSendSrsReminder(grew, last, t0 + SRS_REMINDER_MIN_GAP_MS)
    ).toBe(true);
  });
});

describe('parseSrsReminderMarker', () => {
  it('reads valid markers and rejects junk', () => {
    expect(parseSrsReminderMarker(JSON.stringify({ at: 10, dueCount: 4 }))).toEqual({
      at: 10,
      dueCount: 4,
    });
    expect(parseSrsReminderMarker('not-json')).toBeNull();
    expect(parseSrsReminderMarker(null)).toBeNull();
  });
});
