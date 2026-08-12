import {
  computePeriodPace,
  isBudgetForMonth,
  computeSpendPace,
  normalizeBudgetPlan,
  summarizeBudgetPlan,
  toMonthYear,
} from './budgetPlan';

describe('normalizeBudgetPlan', () => {
  it('reads the legacy categoryBudgets map as the expense plan', () => {
    const plan = normalizeBudgetPlan(
      { monthlyLimit: 50000, categoryBudgets: { food_feeding: 20000 } },
      '2026-08'
    );
    expect(plan.plannedExpenses).toEqual({ food_feeding: 20000 });
    expect(plan.monthlyLimit).toBe(50000);
    expect(plan.plannedIncome).toEqual({});
    expect(plan.plannedSavings).toBe(0);
  });

  it('prefers an explicit expense plan over the legacy map', () => {
    const plan = normalizeBudgetPlan(
      {
        plannedExpenses: { transport: 5000 },
        categoryBudgets: { food_feeding: 20000 },
      },
      '2026-08'
    );
    expect(plan.plannedExpenses).toEqual({ transport: 5000 });
  });

  it('falls back to the supplied month and zeroes for a missing plan', () => {
    expect(normalizeBudgetPlan(null, '2026-08')).toEqual({
      monthYear: '2026-08',
      monthlyLimit: 0,
      plannedExpenses: {},
      plannedIncome: {},
      plannedSavings: 0,
    });
  });

  it('treats non-numeric stored values as zero rather than NaN', () => {
    const plan = normalizeBudgetPlan(
      { monthlyLimit: undefined, plannedSavings: Number.NaN },
      '2026-08'
    );
    expect(plan.monthlyLimit).toBe(0);
    expect(plan.plannedSavings).toBe(0);
  });
});

describe('summarizeBudgetPlan', () => {
  const base = { monthYear: '2026-08', monthlyLimit: 0, plannedExpenses: {}, plannedIncome: {}, plannedSavings: 0 };

  it('balances to zero when every unit of income has a job', () => {
    const summary = summarizeBudgetPlan({
      ...base,
      plannedIncome: { allowance: 80000, part_time: 20000 },
      plannedExpenses: { food_feeding: 40000, transport: 20000, data_airtime: 10000 },
      plannedSavings: 30000,
    });
    expect(summary.totalPlannedIncome).toBe(100000);
    expect(summary.totalPlannedExpenses).toBe(70000);
    expect(summary.leftToAllocate).toBe(0);
    expect(summary.isBalanced).toBe(true);
  });

  it('reports money that still has no job', () => {
    const summary = summarizeBudgetPlan({
      ...base,
      plannedIncome: { allowance: 100000 },
      plannedExpenses: { food_feeding: 40000 },
      plannedSavings: 10000,
    });
    expect(summary.leftToAllocate).toBe(50000);
    expect(summary.isBalanced).toBe(false);
  });

  it('goes negative when the plan commits more than it earns', () => {
    const summary = summarizeBudgetPlan({
      ...base,
      plannedIncome: { allowance: 50000 },
      plannedExpenses: { food_feeding: 40000, accommodation: 30000 },
    });
    expect(summary.leftToAllocate).toBe(-20000);
    expect(summary.isBalanced).toBe(false);
  });

  it('uses the overall cap when no per-category expense plan exists', () => {
    const summary = summarizeBudgetPlan({
      ...base,
      monthlyLimit: 60000,
      plannedIncome: { allowance: 100000 },
    });
    expect(summary.totalPlannedExpenses).toBe(60000);
    expect(summary.leftToAllocate).toBe(40000);
  });

  it('ignores the overall cap once categories are planned', () => {
    const summary = summarizeBudgetPlan({
      ...base,
      monthlyLimit: 60000,
      plannedExpenses: { food_feeding: 25000 },
      plannedIncome: { allowance: 100000 },
    });
    expect(summary.totalPlannedExpenses).toBe(25000);
  });

  it('is not balanced merely because an empty plan sums to zero', () => {
    const summary = summarizeBudgetPlan(base);
    expect(summary.isBalanced).toBe(false);
    expect(summary.hasPlan).toBe(false);
  });

  it('tolerates sub-unit rounding when deciding balance', () => {
    const summary = summarizeBudgetPlan({
      ...base,
      plannedIncome: { allowance: 100000 },
      plannedExpenses: { food_feeding: 33333.33, transport: 33333.33, other: 33333.34 },
    });
    expect(summary.isBalanced).toBe(true);
  });
});

describe('computePeriodPace', () => {
  it('counts the current day as elapsed', () => {
    const pace = computePeriodPace('2026-08', new Date(2026, 7, 12));
    expect(pace.daysInPeriod).toBe(31);
    expect(pace.daysElapsed).toBe(12);
    expect(pace.elapsedRatio).toBeCloseTo(12 / 31);
    expect(pace.isCurrentPeriod).toBe(true);
  });

  it('knows how long February is in a leap year', () => {
    expect(computePeriodPace('2028-02', new Date(2028, 1, 10)).daysInPeriod).toBe(29);
    expect(computePeriodPace('2026-02', new Date(2026, 1, 10)).daysInPeriod).toBe(28);
  });

  it('treats a past month as fully elapsed', () => {
    const pace = computePeriodPace('2026-07', new Date(2026, 7, 12));
    expect(pace.daysElapsed).toBe(31);
    expect(pace.elapsedRatio).toBe(1);
    expect(pace.isCurrentPeriod).toBe(false);
  });

  it('treats a future month as not started', () => {
    const pace = computePeriodPace('2026-09', new Date(2026, 7, 12));
    expect(pace.daysElapsed).toBe(0);
    expect(pace.elapsedRatio).toBe(0);
  });

  it('returns a neutral pace for a malformed month', () => {
    expect(computePeriodPace('nonsense', new Date(2026, 7, 12))).toEqual({
      daysInPeriod: 0,
      daysElapsed: 0,
      elapsedRatio: 0,
      isCurrentPeriod: false,
    });
  });
});

describe('computeSpendPace', () => {
  const midMonth = computePeriodPace('2026-08', new Date(2026, 7, 16)); // 16/31

  it('calls even spending on track', () => {
    const result = computeSpendPace(51_612, 100_000, midMonth);
    expect(result.verdict).toBe('on-track');
    expect(result.expectedSpendToDate).toBeCloseTo(100_000 * (16 / 31), 0);
    expect(Math.abs(result.spendVsExpected)).toBeLessThan(100);
  });

  it('flags spending well ahead of the calendar', () => {
    const result = computeSpendPace(80_000, 100_000, midMonth);
    expect(result.verdict).toBe('ahead');
    expect(result.spendVsExpected).toBeGreaterThan(0);
  });

  it('flags an exhausted budget as over regardless of the date', () => {
    expect(computeSpendPace(120_000, 100_000, midMonth).verdict).toBe('over');
  });

  it('does not judge pace when nothing is budgeted', () => {
    const result = computeSpendPace(5_000, 0, midMonth);
    expect(result.verdict).toBe('no-budget');
    expect(result.spentRatio).toBe(0);
  });

  it('is on track spending under budget late in the month', () => {
    const lateMonth = computePeriodPace('2026-08', new Date(2026, 7, 30));
    expect(computeSpendPace(90_000, 100_000, lateMonth).verdict).toBe('on-track');
  });
});

describe('toMonthYear', () => {
  it('pads single-digit months and uses local calendar fields', () => {
    expect(toMonthYear(new Date(2026, 0, 31))).toBe('2026-01');
    expect(toMonthYear(new Date(2026, 11, 1))).toBe('2026-12');
  });
});

describe('isBudgetForMonth', () => {
  it('accepts a budget saved for the month being viewed', () => {
    expect(isBudgetForMonth('2026-08', '2026-08')).toBe(true);
  });

  it('rejects last month\u2019s budget — the carry-over bug', () => {
    expect(isBudgetForMonth('2026-07', '2026-08')).toBe(false);
  });

  it('rejects a budget with no month rather than assuming it is current', () => {
    expect(isBudgetForMonth(undefined, '2026-08')).toBe(false);
    expect(isBudgetForMonth(null, '2026-08')).toBe(false);
    expect(isBudgetForMonth('', '2026-08')).toBe(false);
  });
});
