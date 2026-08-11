import { parseDateOnlyLocal, toDateOnlyLocal, todayDateOnlyLocal } from './dateOnly';

describe('dateOnly', () => {
  it('parses yyyy-mm-dd as a local calendar date, not UTC midnight', () => {
    const d = parseDateOnlyLocal('2026-08-10');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(10); // the regression: UTC parse renders 9 west of UTC
    expect(d.getHours()).toBe(0);
  });

  it('accepts a full ISO string but keeps the calendar date', () => {
    const d = parseDateOnlyLocal('2026-08-10T23:30:00.000Z');
    expect(d.getDate()).toBe(10);
  });

  it('round-trips through toDateOnlyLocal', () => {
    expect(toDateOnlyLocal(parseDateOnlyLocal('2026-01-02'))).toBe('2026-01-02');
  });

  it('formats local fields, never UTC', () => {
    // 23:30 local on the 10th must stay the 10th regardless of timezone.
    const late = new Date(2026, 7, 10, 23, 30);
    expect(toDateOnlyLocal(late)).toBe('2026-08-10');
  });

  it('falls back to native parsing for non date-only input', () => {
    const d = parseDateOnlyLocal('not-a-date');
    expect(Number.isNaN(d.getTime())).toBe(true);
  });

  it('todayDateOnlyLocal matches local now', () => {
    expect(todayDateOnlyLocal()).toBe(toDateOnlyLocal(new Date()));
  });
});
