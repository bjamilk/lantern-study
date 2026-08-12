/**
 * Zero-based budget planning — the shared model and its arithmetic.
 *
 * The app used to hold only a spending cap: "don't spend more than X this
 * month". That answers *am I overspending?* but never *does my month add up?*
 * A zero-based plan gives every unit of income a job before the month starts:
 *
 *     income − (expenses + savings) = 0
 *
 * Whatever is left over is money with no job yet — surfaced as `leftToAllocate`
 * so it can be assigned rather than quietly drifting into spending.
 *
 * Two clients render this, so the arithmetic lives here rather than in either.
 * Everything below is pure: pass the clock in, never read it.
 */

/** `yyyy-mm` — the month a plan applies to. */
export type MonthYear = string;

/**
 * A month's plan. `plannedExpenses` is the existing per-category budget map
 * under its meaningful name; `monthlyLimit` is the older single overall cap and
 * is still honoured when no per-category expense plan exists.
 */
export interface BudgetPlan {
  monthYear: MonthYear;
  /** Overall expense cap. Legacy input — a per-category plan supersedes it. */
  monthlyLimit: number;
  /** expense categoryId -> planned amount */
  plannedExpenses: Record<string, number>;
  /** income categoryId -> planned amount */
  plannedIncome: Record<string, number>;
  /** Planned savings allocation for the month (a single bucket). */
  plannedSavings: number;
}

export interface ZeroBasedSummary {
  totalPlannedIncome: number;
  totalPlannedExpenses: number;
  plannedSavings: number;
  /** income − (expenses + savings). Positive = unassigned, negative = over-committed. */
  leftToAllocate: number;
  /** True when the plan balances to zero (within rounding tolerance). */
  isBalanced: boolean;
  /** True once the user has planned anything at all — drives empty states. */
  hasPlan: boolean;
}

/** Money comparisons tolerate sub-unit rounding; below this counts as zero. */
const ZERO_TOLERANCE = 0.005;

function sumValues(map: Record<string, number> | undefined | null): number {
  if (!map) return 0;
  let total = 0;
  for (const value of Object.values(map)) {
    const n = Number(value);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalise anything the stores may hold — including the legacy shape where
 * only `monthlyLimit` and `categoryBudgets` existed — into a full plan.
 */
export function normalizeBudgetPlan(
  input:
    | (Partial<BudgetPlan> & { categoryBudgets?: Record<string, number> })
    | null
    | undefined,
  monthYear: MonthYear
): BudgetPlan {
  return {
    monthYear: input?.monthYear || monthYear,
    monthlyLimit: safeNumber(input?.monthlyLimit),
    // `categoryBudgets` is the legacy name for exactly this map.
    plannedExpenses: input?.plannedExpenses ?? input?.categoryBudgets ?? {},
    plannedIncome: input?.plannedIncome ?? {},
    plannedSavings: safeNumber(input?.plannedSavings),
  };
}

/**
 * The zero-based figures for a plan.
 *
 * Expenses come from the per-category plan when there is one, and fall back to
 * `monthlyLimit` otherwise, so a user who only ever set an overall cap still
 * gets a meaningful "left to allocate" once they add planned income.
 */
export function summarizeBudgetPlan(plan: BudgetPlan): ZeroBasedSummary {
  const totalPlannedIncome = sumValues(plan.plannedIncome);
  const categoryTotal = sumValues(plan.plannedExpenses);
  const totalPlannedExpenses =
    Object.keys(plan.plannedExpenses).length > 0
      ? categoryTotal
      : safeNumber(plan.monthlyLimit);
  const plannedSavings = safeNumber(plan.plannedSavings);
  const leftToAllocate =
    totalPlannedIncome - (totalPlannedExpenses + plannedSavings);

  return {
    totalPlannedIncome,
    totalPlannedExpenses,
    plannedSavings,
    leftToAllocate,
    isBalanced:
      totalPlannedIncome > 0 && Math.abs(leftToAllocate) < ZERO_TOLERANCE,
    hasPlan:
      totalPlannedIncome > 0 || totalPlannedExpenses > 0 || plannedSavings > 0,
  };
}

export interface PeriodPace {
  daysInPeriod: number;
  /** Days counted as elapsed, 1-based on the current day (day 1 = 1 elapsed). */
  daysElapsed: number;
  /** 0..1 — how far through the month we are. */
  elapsedRatio: number;
  /** True when `now` falls inside the plan's month. */
  isCurrentPeriod: boolean;
}

function parseMonthYear(monthYear: MonthYear): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(monthYear);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(m[1]), month };
}

/**
 * How far through the month we are.
 *
 * "You have used 85% of your budget" is not actionable on its own — on day 3
 * it is alarming and on day 28 it is fine. Pairing spend with elapsed time is
 * what makes the number mean something.
 *
 * A past month is fully elapsed; a future one has not started.
 */
export function computePeriodPace(monthYear: MonthYear, now: Date): PeriodPace {
  const parsed = parseMonthYear(monthYear);
  if (!parsed) {
    return { daysInPeriod: 0, daysElapsed: 0, elapsedRatio: 0, isCurrentPeriod: false };
  }

  const { year, month } = parsed;
  const daysInPeriod = new Date(year, month, 0).getDate();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;

  const isCurrentPeriod = nowYear === year && nowMonth === month;
  const isPast = nowYear > year || (nowYear === year && nowMonth > month);

  const daysElapsed = isCurrentPeriod
    ? Math.min(now.getDate(), daysInPeriod)
    : isPast
      ? daysInPeriod
      : 0;

  return {
    daysInPeriod,
    daysElapsed,
    elapsedRatio: daysInPeriod > 0 ? daysElapsed / daysInPeriod : 0,
    isCurrentPeriod,
  };
}

/** How actual spending compares with both the plan and the calendar. */
export type PaceVerdict = 'no-budget' | 'on-track' | 'ahead' | 'over';

export interface SpendPace {
  /** 0..1+ — spent ÷ planned expenses. */
  spentRatio: number;
  /** 0..1 — how far through the month. */
  elapsedRatio: number;
  /** What the plan says should be spent by now if spread evenly. */
  expectedSpendToDate: number;
  /** Actual minus expected. Positive = spending faster than the calendar. */
  spendVsExpected: number;
  verdict: PaceVerdict;
}

/** Spending more than this fraction ahead of the calendar counts as "ahead". */
const AHEAD_THRESHOLD = 0.1;

/**
 * Compare spend against an even burn-down of the plan.
 *
 * Deliberately simple: a flat daily rate. Real spending is lumpy (rent lands on
 * day 1), so this is a prompt to look, not a verdict on the month.
 */
export function computeSpendPace(
  spent: number,
  plannedExpenses: number,
  pace: PeriodPace
): SpendPace {
  const safeSpent = safeNumber(spent);
  const planned = safeNumber(plannedExpenses);

  if (planned <= 0) {
    return {
      spentRatio: 0,
      elapsedRatio: pace.elapsedRatio,
      expectedSpendToDate: 0,
      spendVsExpected: 0,
      verdict: 'no-budget',
    };
  }

  const spentRatio = safeSpent / planned;
  const expectedSpendToDate = planned * pace.elapsedRatio;
  const spendVsExpected = safeSpent - expectedSpendToDate;

  const verdict: PaceVerdict =
    spentRatio > 1
      ? 'over'
      : spentRatio - pace.elapsedRatio > AHEAD_THRESHOLD
        ? 'ahead'
        : 'on-track';

  return { spentRatio, elapsedRatio: pace.elapsedRatio, expectedSpendToDate, spendVsExpected, verdict };
}

/**
 * True when a stored budget belongs to the month being viewed.
 *
 * The budget object is cached locally and reloaded on launch, but nothing used
 * to check which month it was for — so on the 1st of a new month last month's
 * limit, category budgets and plan silently became this month's, and the
 * progress bar compared new spending against an old cap.
 */
export function isBudgetForMonth(
  budgetMonth: string | undefined | null,
  monthYear: MonthYear
): boolean {
  return Boolean(budgetMonth) && budgetMonth === monthYear;
}

/** `yyyy-mm` for a date, using its LOCAL calendar fields. */
export function toMonthYear(date: Date): MonthYear {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`;
}
