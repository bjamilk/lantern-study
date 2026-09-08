import { formatJobCompensation } from './compensation';
import type { JobCompensation } from './types';

describe('formatJobCompensation', () => {
  it('writes naira with its symbol and thousands separators', () => {
    const c: JobCompensation = {
      kind: 'paid',
      currency: 'NGN',
      amountMin: 30000,
      period: 'month',
    };
    expect(formatJobCompensation(c)).toBe('₦30,000 / month');
  });

  it('never emits the raw "NGN 30000" shape', () => {
    const c: JobCompensation = {
      kind: 'paid',
      currency: 'NGN',
      amountMin: 30000,
      period: 'month',
    };
    const out = formatJobCompensation(c);
    expect(out).not.toContain('NGN');
    expect(out).not.toMatch(/\d{4,}/); // no un-separated run of 4+ digits
  });

  it('formats a range with a single leading symbol', () => {
    const c: JobCompensation = {
      kind: 'paid',
      currency: 'NGN',
      amountMin: 30000,
      amountMax: 50000,
      period: 'hour',
    };
    expect(formatJobCompensation(c)).toBe('₦30,000–50,000 / hour');
  });

  it('defaults a missing currency to naira', () => {
    const c: JobCompensation = { kind: 'paid', amountMin: 5000 };
    expect(formatJobCompensation(c)).toBe('₦5,000');
  });

  it('keeps a non-naira currency as a code prefix', () => {
    const c: JobCompensation = {
      kind: 'paid',
      currency: 'USD',
      amountMin: 1200,
      period: 'month',
    };
    expect(formatJobCompensation(c)).toBe('USD 1,200 / month');
  });

  it('handles discuss and unpaid without an amount', () => {
    expect(formatJobCompensation({ kind: 'discuss' })).toBe('Pay: discuss');
    expect(formatJobCompensation({ kind: 'unpaid' })).toBe('Unpaid');
    expect(formatJobCompensation(null)).toBe('Pay: discuss');
  });
});
