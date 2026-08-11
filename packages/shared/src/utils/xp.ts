// ─── Volume XP with diminishing returns ──────────────────────────────────────
// XP for real study work, computed server-side in /gamification/activity/record.
// Design goals:
//   1. More work earns more XP (unlike quest-only XP, which capped at a fixed
//      70/day regardless of effort).
//   2. Diminishing returns + daily caps keep grinding bounded: the 4th test of
//      the day earns less than the 1st, and each activity type has a ceiling.
//   3. Quality matters where a score exists: a 100% test earns twice the XP of
//      a 0% attempt (multiplier 0.5 + 0.5 × score).

export interface ActivityXpInput {
  type: string;
  /** Units in this recording (tests completed, cards reviewed…). */
  amount: number;
  /** Same-type units already recorded today BEFORE this recording. */
  priorAmountToday: number;
  /** 0–100 when the activity has a score (tests, duels). */
  scorePercent?: number | null;
}

interface XpRate {
  /** XP per unit for the first `fullRateUnits` units of the day. */
  fullRate: number;
  fullRateUnits: number;
  /** XP per unit after that. */
  reducedRate: number;
  /** Max XP this activity type can contribute per day. */
  dailyCap: number;
  /** Whether scorePercent scales the award (0.5–1.0×). */
  qualityScaled: boolean;
}

export const ACTIVITY_XP_RATES: Record<string, XpRate> = {
  test: { fullRate: 15, fullRateUnits: 3, reducedRate: 5, dailyCap: 75, qualityScaled: true },
  game: { fullRate: 10, fullRateUnits: 3, reducedRate: 3, dailyCap: 45, qualityScaled: true },
  flashcard: { fullRate: 0.5, fullRateUnits: 40, reducedRate: 0.25, dailyCap: 20, qualityScaled: false },
  flashcard_new: { fullRate: 0.5, fullRateUnits: 40, reducedRate: 0.25, dailyCap: 20, qualityScaled: false },
  study_question: { fullRate: 2, fullRateUnits: 10, reducedRate: 0.5, dailyCap: 30, qualityScaled: false },
  daily_quiz: { fullRate: 5, fullRateUnits: 1, reducedRate: 0, dailyCap: 5, qualityScaled: false },
};

/** Raw (uncapped-by-quality) XP for units n = prior+1 … prior+amount. */
function marginalXp(rate: XpRate, priorUnits: number, amount: number): number {
  let xp = 0;
  const from = priorUnits;
  const to = priorUnits + amount;
  // Full-rate portion.
  const fullFrom = Math.min(from, rate.fullRateUnits);
  const fullTo = Math.min(to, rate.fullRateUnits);
  if (fullTo > fullFrom) xp += (fullTo - fullFrom) * rate.fullRate;
  // Reduced-rate portion.
  const redFrom = Math.max(from, rate.fullRateUnits);
  if (to > redFrom) xp += (to - redFrom) * rate.reducedRate;
  return xp;
}

/**
 * XP to award for one activity recording. Diminishing returns use the day's
 * prior units; the daily cap bounds the cumulative award; the quality
 * multiplier (0.5 + 0.5 × score) applies to scored types when a score is given.
 */
export function computeActivityXp(input: ActivityXpInput): number {
  const rate = ACTIVITY_XP_RATES[input.type];
  if (!rate) return 0;
  const amount = Math.max(0, Math.floor(input.amount));
  const prior = Math.max(0, Math.floor(input.priorAmountToday));
  if (amount === 0) return 0;

  let xp = marginalXp(rate, prior, amount);

  // Daily cap applies to cumulative XP for the type, assuming prior units also
  // earned at the marginal schedule.
  const priorXp = marginalXp(rate, 0, prior);
  xp = Math.max(0, Math.min(xp, rate.dailyCap - priorXp));

  if (rate.qualityScaled && typeof input.scorePercent === 'number' && Number.isFinite(input.scorePercent)) {
    const pct = Math.max(0, Math.min(100, input.scorePercent)) / 100;
    xp *= 0.5 + 0.5 * pct;
  }

  return Math.round(xp);
}
