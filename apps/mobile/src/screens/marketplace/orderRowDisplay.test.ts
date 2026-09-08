import { orderReference, orderDateLabel, orderRowMeta } from './orderRowDisplay';

describe('orderReference', () => {
  it('is a short upper-cased code from the id tail, not the raw id', () => {
    expect(orderReference('1e547f81-9b2c-4a3d-8e5f-00aa11bb3af9')).toBe('#BB3AF9');
  });

  it('drops dashes before slicing so the code is 6 alphanumerics', () => {
    expect(orderReference('abcdef')).toBe('#ABCDEF');
    expect(orderReference('12-34-56-78')).toBe('#345678');
  });

  it('is stable — the same id always yields the same reference', () => {
    const id = '1e547f81-9b2c-4a3d-8e5f-00aa11bb3af9';
    expect(orderReference(id)).toBe(orderReference(id));
  });

  it('tells two same-item orders apart', () => {
    expect(orderReference('aaaaaaaa-0001')).not.toBe(orderReference('aaaaaaaa-0002'));
  });

  it('is empty when there is no id', () => {
    expect(orderReference('')).toBe('');
    expect(orderReference(null)).toBe('');
    expect(orderReference(undefined)).toBe('');
  });
});

describe('orderDateLabel', () => {
  it('formats an ISO stamp as a day-month-year date', () => {
    // Midday UTC: the same calendar day in every real timezone, so deterministic.
    expect(orderDateLabel('2026-09-07T12:00:00.000Z')).toBe('7 Sep 2026');
  });

  it('uses the LOCAL calendar day, not the UTC day', () => {
    // The rule changed with this round: created_at is a UTC instant, and the
    // old label read getUTCDate, so an order placed after 23:00 WAT (the WAT
    // day rolled over, the UTC day had not) showed the previous day. It now
    // reads local fields, like every other date in the app. Spying the UTC
    // getters locks that without depending on the runner's timezone — it FAILS
    // if the label reverts to getUTC*.
    const utcDate = jest.spyOn(Date.prototype, 'getUTCDate');
    const utcMonth = jest.spyOn(Date.prototype, 'getUTCMonth');
    const utcYear = jest.spyOn(Date.prototype, 'getUTCFullYear');
    try {
      orderDateLabel('2026-09-07T23:30:00.000Z');
      expect(utcDate).not.toHaveBeenCalled();
      expect(utcMonth).not.toHaveBeenCalled();
      expect(utcYear).not.toHaveBeenCalled();
    } finally {
      utcDate.mockRestore();
      utcMonth.mockRestore();
      utcYear.mockRestore();
    }
  });

  it('is empty for a missing or unparseable stamp', () => {
    expect(orderDateLabel(null)).toBe('');
    expect(orderDateLabel(undefined)).toBe('');
    expect(orderDateLabel('not-a-date')).toBe('');
  });
});

describe('orderRowMeta', () => {
  // Midday-UTC stamps: the same calendar day in every real timezone.
  it('joins reference and date with a middot', () => {
    expect(orderRowMeta({ id: 'aaaa-00bb3af9', created_at: '2026-09-07T12:00:00.000Z' })).toBe(
      '#BB3AF9 · 7 Sep 2026'
    );
  });

  it('shows just the reference when the date is missing', () => {
    expect(orderRowMeta({ id: 'aaaa-00bb3af9', created_at: null })).toBe('#BB3AF9');
  });

  it('shows just the date when the id is missing', () => {
    expect(orderRowMeta({ id: '', created_at: '2026-09-07T12:00:00.000Z' })).toBe('7 Sep 2026');
  });

  it('is empty when neither is present', () => {
    expect(orderRowMeta({ id: '', created_at: '' })).toBe('');
  });
});
