/**
 * Unit tests for the recurring-budget date maths — the part that decides what
 * gets posted and when the rule fires next. DB-free and deterministic.
 */
import { advanceDate, computeDueRuns } from './recurringBudget';

describe('advanceDate', () => {
  it('weekly adds 7 days across a month boundary', () => {
    expect(advanceDate('2026-01-28', 'weekly')).toBe('2026-02-04');
  });

  it('monthly keeps the same day next month', () => {
    expect(advanceDate('2026-01-15', 'monthly', 15)).toBe('2026-02-15');
  });

  it('monthly clamps a 31st rule to the shorter month (no skip into March)', () => {
    expect(advanceDate('2026-01-31', 'monthly', 31)).toBe('2026-02-28');
  });

  it('monthly clamps to Feb 29 in a leap year', () => {
    expect(advanceDate('2028-01-31', 'monthly', 31)).toBe('2028-02-29');
  });

  it('monthly rolls over the year boundary', () => {
    expect(advanceDate('2026-12-10', 'monthly', 10)).toBe('2027-01-10');
  });

  it('after clamping, a 31st rule recovers to 31 in a long month', () => {
    // Feb 28 (clamped) -> next month should target day 31 again, clamped to 31.
    expect(advanceDate('2026-02-28', 'monthly', 31)).toBe('2026-03-31');
  });
});

describe('computeDueRuns', () => {
  it('returns nothing when the rule is not yet due', () => {
    const r = computeDueRuns('2026-09-01', 'monthly', 1, '2026-08-21');
    expect(r.runs).toEqual([]);
    expect(r.newNextDate).toBe('2026-09-01');
  });

  it('posts a single due occurrence and advances one period', () => {
    const r = computeDueRuns('2026-08-01', 'monthly', 1, '2026-08-21');
    expect(r.runs).toEqual(['2026-08-01']);
    expect(r.newNextDate).toBe('2026-09-01');
  });

  it('back-fills every missed period up to today', () => {
    const r = computeDueRuns('2026-06-01', 'monthly', 1, '2026-08-21');
    expect(r.runs).toEqual(['2026-06-01', '2026-07-01', '2026-08-01']);
    expect(r.newNextDate).toBe('2026-09-01');
  });

  it('is bounded by maxCatchup and skips the remaining backlog forward past today', () => {
    // Weekly rule dormant for ~1 year, today far in the future.
    const r = computeDueRuns('2025-01-01', 'weekly', null, '2026-08-21', 12);
    expect(r.runs).toHaveLength(12);
    // After capping, the next date must be in the future (no stale burst next run).
    expect(r.newNextDate > '2026-08-21').toBe(true);
  });

  it('includes today when today is exactly the due date', () => {
    const r = computeDueRuns('2026-08-21', 'weekly', null, '2026-08-21');
    expect(r.runs).toEqual(['2026-08-21']);
    expect(r.newNextDate).toBe('2026-08-28');
  });
});
