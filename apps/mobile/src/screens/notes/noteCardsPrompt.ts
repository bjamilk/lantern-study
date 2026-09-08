/**
 * What the note editor says before it spends an AI use on flashcards.
 *
 * The contextual row under a note reads "Learn · Cards · Test · AI". Those are
 * NAMES, and a name cannot carry a price the way the Learn panel's tiles do —
 * so on device, tapping "Cards" started a generation and took an AI use with
 * nothing said before it and nothing said after. A student who read the item
 * as "show me this note's cards" paid for something they did not ask for.
 *
 * Every priced control in this app prints its cost before it is pressed. The
 * row item cannot, so it asks — with the cost AND the balance, because "1 AI
 * use" means nothing to someone who does not know they have two left.
 *
 * Pure, and separate from the screen, so the sentences are unit-tested rather
 * than read off a screenshot.
 */
import { formatCreditCost } from '@lantern/shared/utils/aiCredits';
import { getAIResetLabel } from '@lantern/shared/utils/aiUsage';

/** The live credit figures, as `services/ai` reports them. */
export interface AIUsageSnapshot {
  remaining: number;
  limit: number;
  used: number;
  resetsAt: string;
}

/**
 * "71 of 100 AI uses left today · Resets in 56m.", or nothing.
 *
 * Empty when the app has not heard a limit from the server yet: a balance of
 * "0 of 0" would read as an exhausted account on the one screen where that
 * would stop a student generating anything at all.
 */
export function creditsLeftLine(usage: AIUsageSnapshot, nowMs = Date.now()): string {
  if (!usage.limit || usage.limit <= 0) return '';
  const remaining = Math.max(0, usage.remaining);
  const reset = getAIResetLabel(usage.resetsAt, {
    used: usage.used,
    limit: usage.limit,
    nowMs,
  });
  const balance = `${remaining} of ${usage.limit} AI uses left today`;
  return reset ? `${balance} · ${reset}.` : `${balance}.`;
}

/**
 * The confirmation the row's Cards item shows before any credit moves.
 *
 * The cost goes through `formatCreditCost` like every other priced control's
 * does — a "1 AI use" typed in here is how two names for one unit start.
 */
export function makeCardsConfirmMessage(
  cost: number,
  usage: AIUsageSnapshot,
  nowMs = Date.now()
): string {
  const price = `Costs ${formatCreditCost(cost)}.`;
  const left = creditsLeftLine(usage, nowMs);
  return left ? `${price} ${left}` : price;
}

/**
 * The refusal when there is nothing left to spend.
 *
 * It says when the allowance comes back rather than "tomorrow": the windows
 * roll over at midnight UTC, so for most students "tomorrow" is this evening.
 */
export function noCreditsLeftMessage(
  cost: number,
  usage: AIUsageSnapshot,
  nowMs = Date.now()
): string {
  const price = `Flashcards from a note cost ${formatCreditCost(cost)}.`;
  const reset = getAIResetLabel(usage.resetsAt, {
    used: usage.used,
    limit: usage.limit,
    nowMs,
  });
  return reset ? `${price} ${reset}.` : price;
}
