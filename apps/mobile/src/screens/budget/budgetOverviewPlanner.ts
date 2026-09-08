/**
 * Pure logic behind the "This Month's Budget" card, kept out of the screen so
 * jest (node env) can pin it down.
 *
 * The screen used to treat any budget row as "has a budget", so a row with a
 * zero monthly cap rendered "₦100.00 / ₦0.00" and, worse, "₦-100.00 left to
 * spend" — a negative amount of money left, which is nonsense to a student. A
 * cap is only a cap when it is greater than zero; below that the card is a
 * pure planner with nothing to spend against yet.
 */

export type BudgetSpendStatus =
  | { kind: 'none' }
  | { kind: 'left'; amount: number }
  | { kind: 'over'; amount: number };

/**
 * @param monthlyLimit the month's expense cap (0 or absent = no budget set)
 * @param spent        expenses logged so far this month
 */
export function budgetSpendStatus(
  monthlyLimit: number | null | undefined,
  spent: number,
): BudgetSpendStatus {
  const limit = Number(monthlyLimit) || 0;
  if (limit <= 0) return { kind: 'none' };
  if (spent <= limit) return { kind: 'left', amount: limit - spent };
  return { kind: 'over', amount: spent - limit };
}
