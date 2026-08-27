import { utcDayKey, utcWeekKey } from './retentionReminders';

describe('retention reminder keys', () => {
  it('uses UTC calendar day', () => {
    expect(utcDayKey(new Date('2026-08-27T23:30:00.000Z'))).toBe('2026-08-27');
  });

  it('uses ISO week so a Monday and the following Sunday share a key', () => {
    expect(utcWeekKey(new Date('2026-08-24T08:00:00.000Z'))).toBe('2026-W35');
    expect(utcWeekKey(new Date('2026-08-30T08:00:00.000Z'))).toBe('2026-W35');
    expect(utcWeekKey(new Date('2026-08-31T08:00:00.000Z'))).toBe('2026-W36');
  });
});
