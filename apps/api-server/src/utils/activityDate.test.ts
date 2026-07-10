import { resolveAllowedActivityDate } from './activityDate';

describe('resolveAllowedActivityDate', () => {
  it('allows today in UTC', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(resolveAllowedActivityDate(today)).toBe(today);
  });

  it('rejects dates outside today ±1', () => {
    expect(resolveAllowedActivityDate('2020-01-01')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(resolveAllowedActivityDate('2020-01-01')).not.toBe('2020-01-01');
  });

  it('defaults invalid input to today', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(resolveAllowedActivityDate('not-a-date')).toBe(today);
  });
});
