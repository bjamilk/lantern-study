import { formatDisplayDate } from './displayDate';

describe('formatDisplayDate', () => {
  it('formats a timestamp as day-shortmonth-year', () => {
    // Midday UTC: the calendar day is the same in every real timezone, so this
    // value assertion is deterministic on any runner.
    expect(formatDisplayDate('2026-09-07T12:00:00.000Z')).toBe('7 Sep 2026');
  });

  it('reads LOCAL calendar fields, never the UTC ones', () => {
    // The rule this file exists for: an order placed at 00:30 WAT (23:30 UTC
    // the day before) must show the LOCAL day, not the UTC day. Reading
    // getUTCDate/Month/FullYear is the exact regression. Spying the UTC getters
    // locks the rule without depending on the runner's timezone (a TZ-based
    // test is flaky under jest's cached V8 isolate) — it FAILS the moment the
    // formatter reverts to UTC getters, on both the string and Date paths.
    const utcDate = jest.spyOn(Date.prototype, 'getUTCDate');
    const utcMonth = jest.spyOn(Date.prototype, 'getUTCMonth');
    const utcYear = jest.spyOn(Date.prototype, 'getUTCFullYear');
    try {
      formatDisplayDate('2026-09-07T23:30:00.000Z');
      formatDisplayDate(new Date('2026-09-07T23:30:00.000Z'));
      formatDisplayDate(Date.now());
      formatDisplayDate('2026-09-07');
      expect(utcDate).not.toHaveBeenCalled();
      expect(utcMonth).not.toHaveBeenCalled();
      expect(utcYear).not.toHaveBeenCalled();
    } finally {
      utcDate.mockRestore();
      utcMonth.mockRestore();
      utcYear.mockRestore();
    }
  });

  it('treats a bare yyyy-mm-dd as a local calendar day, never UTC midnight', () => {
    // `new Date('2026-09-07').getDate()` is the 6th west of UTC; a local parse
    // keeps the 7th. Proven by the reference date landing on the 7th and the
    // UTC-getter spy above staying untouched.
    const d = new Date(2026, 8, 7);
    expect(formatDisplayDate('2026-09-07')).toBe(
      `7 ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} 2026`
    );
  });

  it('accepts a Date and reads its local fields', () => {
    expect(formatDisplayDate(new Date(2026, 8, 7, 23, 30))).toBe('7 Sep 2026');
  });

  it('accepts an epoch-millis number', () => {
    const d = new Date(2026, 8, 7, 12, 0);
    expect(formatDisplayDate(d.getTime())).toBe('7 Sep 2026');
  });

  it('is empty for a missing, empty or unparseable value', () => {
    expect(formatDisplayDate(null)).toBe('');
    expect(formatDisplayDate(undefined)).toBe('');
    expect(formatDisplayDate('')).toBe('');
    expect(formatDisplayDate('not-a-date')).toBe('');
  });
});
