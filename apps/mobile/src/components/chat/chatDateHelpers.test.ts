import {
  formatChatDateLabel,
  isDifferentChatDay,
  planDateSeparators,
} from './chatDateHelpers';

// Timestamps are built with the local-time Date constructor so the calendar
// day is exactly what each test writes, independent of the machine timezone.
const at = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min);

describe('planDateSeparators', () => {
  it('labels the first message and inserts a separator on every day change', () => {
    // The exact reversed-looking DM from the finding: 3:56 PM, 4:32 PM (day 1),
    // 2:17 PM (day 2), then 5:01/5:10/5:14 AM (day 3). The clock appears to run
    // backwards only because the days were never drawn.
    const labels = planDateSeparators([
      at(2026, 9, 1, 15, 56),
      at(2026, 9, 1, 16, 32),
      at(2026, 9, 2, 14, 17),
      at(2026, 9, 3, 5, 1),
      at(2026, 9, 3, 5, 10),
      at(2026, 9, 3, 5, 14),
    ]);

    expect(labels).toHaveLength(6);
    // First message always carries its day, so the thread never opens dateless.
    expect(labels[0]).toBeTruthy();
    // Same calendar day as the message before → no repeat separator.
    expect(labels[1]).toBeNull();
    // New day → a separator.
    expect(labels[2]).toBeTruthy();
    expect(labels[3]).toBeTruthy();
    // The 5:10 and 5:14 AM messages share day 3 with 5:01 AM.
    expect(labels[4]).toBeNull();
    expect(labels[5]).toBeNull();
    // Exactly three separators for three days.
    expect(labels.filter(Boolean)).toHaveLength(3);
  });

  it('never repeats a separator across a run of same-day messages', () => {
    const labels = planDateSeparators([
      at(2026, 9, 4, 9, 0),
      at(2026, 9, 4, 9, 5),
      at(2026, 9, 4, 23, 59),
    ]);
    expect(labels[0]).toBeTruthy();
    expect(labels.slice(1)).toEqual([null, null]);
  });

  it('returns an empty plan for an empty thread', () => {
    expect(planDateSeparators([])).toEqual([]);
  });

  it('emits no separator for an unparseable or missing timestamp, and never throws', () => {
    const labels = planDateSeparators([
      at(2026, 9, 5, 10, 0),
      'not-a-date',
      null,
      at(2026, 9, 6, 10, 0),
    ]);
    expect(labels[0]).toBeTruthy();
    // The bad rows carry no label rather than a "1 Jan 1970" or a crash.
    expect(labels[1]).toBeNull();
    expect(labels[2]).toBeNull();
    // A valid message after the bad rows still opens its new day.
    expect(labels[3]).toBeTruthy();
  });

  it('accepts ISO strings and epoch millis as well as Date objects', () => {
    const iso = at(2026, 9, 7, 8, 0).toISOString();
    const nextDayMs = at(2026, 9, 8, 8, 0).getTime();
    const labels = planDateSeparators([iso, nextDayMs]);
    expect(labels[0]).toBeTruthy();
    expect(labels[1]).toBeTruthy();
  });
});

describe('formatChatDateLabel', () => {
  const now = new Date();
  const noonToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0);
  const noonYesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    12,
    0
  );

  it('names today and yesterday relative to now', () => {
    expect(formatChatDateLabel(noonToday)).toBe('Today');
    expect(formatChatDateLabel(noonYesterday)).toBe('Yesterday');
  });

  it('returns an empty string for a missing or unparseable timestamp', () => {
    expect(formatChatDateLabel(null)).toBe('');
    expect(formatChatDateLabel(undefined)).toBe('');
    expect(formatChatDateLabel('nonsense')).toBe('');
  });
});

describe('isDifferentChatDay', () => {
  it('is false within a day and true across the midnight boundary', () => {
    expect(isDifferentChatDay(at(2026, 9, 1, 0, 1), at(2026, 9, 1, 23, 59))).toBe(false);
    expect(isDifferentChatDay(at(2026, 9, 1, 23, 59), at(2026, 9, 2, 0, 1))).toBe(true);
  });

  it('treats a missing timestamp as a different day', () => {
    expect(isDifferentChatDay(null, at(2026, 9, 1, 12, 0))).toBe(true);
    expect(isDifferentChatDay(at(2026, 9, 1, 12, 0), undefined)).toBe(true);
  });
});
