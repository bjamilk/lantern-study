import { formatBudgetDate } from './budgetFormat';

describe('formatBudgetDate', () => {
  it('never echoes the raw ISO date back', () => {
    const out = formatBudgetDate('2026-09-07');
    expect(out).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out).toContain('2026');
    expect(out).toContain('7');
  });

  it('reads a date-only string as a local calendar day, not a UTC instant', () => {
    // 2026-09-07 must render as the 7th regardless of the runner's timezone;
    // routing through `new Date('2026-09-07')` would show the 6th west of UTC.
    expect(formatBudgetDate('2026-09-07')).toContain('7');
  });

  it('accepts a Date as well as a string', () => {
    const out = formatBudgetDate(new Date(2026, 8, 7));
    expect(out).toContain('2026');
    expect(out).toContain('7');
  });
});
