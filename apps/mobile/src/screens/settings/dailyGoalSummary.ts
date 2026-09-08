import { pluralize } from '@lantern/shared/utils/plural';

/**
 * The Daily Goal subtitle: "20 cards, 1 test" — not "1 test(s)".
 *
 * Both the settings row and the goal modal used to hard-code "test(s)", so a
 * goal of one read "1 test(s)". Routing the count through the shared pluralize
 * helper gives "1 test" / "2 tests" (and "1 card" / "20 cards") from one rule.
 */
export function dailyGoalSummary(cardGoal: number, testGoal: number): string {
  return `${pluralize(cardGoal, 'card')}, ${pluralize(testGoal, 'test')}`;
}
