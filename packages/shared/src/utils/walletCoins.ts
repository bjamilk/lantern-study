/** Wallet coin amounts and award keys (server-authoritative). */

export const WALLET_COINS = {
  STUDY_DAY: 5,
  TEST_PASS: 15,
  FLASHCARDS_20: 10,
  STREAK_7: 50,
  UNDER_BUDGET: 100,
  GOAL_COMPLETE: 75,
  STREAK_FREEZE_COST: 50,
} as const;

export const WALLET_TEST_PASS_THRESHOLD = 80;

export function studyAwardKey(date: string): string {
  return `study:${date}`;
}

export function flashcardsAwardKey(date: string): string {
  return `flashcards:${date}`;
}

export function testAwardKey(testSessionId: string): string {
  return `test:${testSessionId}`;
}

export function streak7AwardKey(date: string, streakMilestone: number): string {
  return `streak7:${date}:${streakMilestone}`;
}

export function underBudgetAwardKey(monthYear: string): string {
  return `underbudget:${monthYear}`;
}

export function goalAwardKey(goalId: string): string {
  return `goal:${goalId}`;
}

/** Streak milestones that award coins (7, 14, 21, ...). */
export function streakMilestoneFor(currentStreak: number): number | null {
  if (currentStreak < 7) return null;
  if (currentStreak % 7 === 0) return currentStreak;
  return null;
}
