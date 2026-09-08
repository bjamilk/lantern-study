/**
 * Pure logic for the Expense-splits create form.
 *
 * The header line used to read "Split between you + 0 others" before anyone
 * was added — a split of one, phrased as arithmetic. When it is just the
 * creator, say so plainly; once there are others, count them through the
 * shared pluraliser so "1 other" / "2 others" is never hand-rolled.
 */
import { pluralize } from '@lantern/shared/utils/plural';

/** Label above the participant list. `othersCount` excludes the creator. */
export function splitHeadcountLabel(othersCount: number): string {
  const others = Math.max(0, Math.floor(othersCount));
  if (others === 0) return 'Just you';
  return `Split between you and ${pluralize(others, 'other')}`;
}

/** Even share per head, given a total and the number of OTHER participants. */
export function splitPerPersonShare(total: number, othersCount: number): number {
  const headcount = Math.max(1, Math.floor(othersCount) + 1);
  if (!(total > 0)) return 0;
  return total / headcount;
}
