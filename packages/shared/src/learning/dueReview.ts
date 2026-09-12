/**
 * What "Study all N due" actually opens.
 *
 * The button on Home counts every due card across every deck, but both clients
 * then handed the student ONE deck — the biggest pile — so a button that said
 * 68 started a session of 17 and ended there, with 51 due cards left unnamed
 * and unreachable from the door that promised them. Two independent copies of
 * that rule existed (web inlined it in `App.tsx`, the phone kept `topDueDeck`
 * in `homeSections.ts`, and only the phone's broke ties), so the two platforms
 * could and did pick different decks from the same data.
 *
 * This is the one rule. It returns the WHOLE due queue in deck order, plus the
 * legs it is made of, so a client that can carry a cross-deck queue runs the
 * full N in one session and a client that opens one deck at a time (the
 * phone's `FlashcardReview` route) takes the first leg and chains to the next
 * one by name when it ends.
 *
 * Ordering is biggest pile first, ties broken by deck id. The tiebreak is not
 * cosmetic: without it two decks with the same due count could swap places
 * between renders, and the deck named on the button would not be the deck the
 * next tap opens.
 */

import { getStudyAllDueLabel } from '../flashcards/labels';

/** The minimum a deck must look like to be planned over. */
export interface DueReviewDeckLike {
  id: string;
  name?: string | null;
}

/** One deck's share of the due queue. */
export interface DueReviewLeg<TCard> {
  deckId: string;
  deckName: string;
  cards: TCard[];
  dueCount: number;
}

export interface DueReviewPlan<TCard> {
  /** Legs in the order they should be studied, biggest pile first. */
  legs: DueReviewLeg<TCard>[];
  /** Every due card, concatenated in leg order — what a cross-deck session runs. */
  queue: TCard[];
  /** `queue.length`, i.e. the N the Home button counts. */
  totalDue: number;
  /** The leg a single-deck client opens, or null when nothing is due. */
  first: DueReviewLeg<TCard> | null;
  /**
   * The label for a client that runs `queue` — matches the session exactly,
   * because it is derived from the same number.
   */
  queueLabel: string;
  /**
   * The label for a client that can only run `first`. It names the deck and
   * that deck's count, so the button never promises cards the session will not
   * deal. `null` when nothing is due.
   */
  chainLabel: string | null;
}

const UNTITLED_DECK = 'Untitled deck';

function deckLabel(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : UNTITLED_DECK;
}

/**
 * Plan a "study everything due" session across decks.
 *
 * `getDueCards` is the caller's own due rule — the store selector on web, the
 * loaded-card filter on the phone — so the plan can never disagree with the
 * count the button rendered from that same source.
 */
export function dueReviewPlan<TDeck extends DueReviewDeckLike, TCard>(
  decks: readonly TDeck[] | null | undefined,
  getDueCards: (deckId: string) => readonly TCard[] | null | undefined
): DueReviewPlan<TCard> {
  const legs: DueReviewLeg<TCard>[] = [];

  for (const deck of decks ?? []) {
    if (!deck?.id) continue;
    const cards = getDueCards(deck.id);
    if (!cards || cards.length === 0) continue;
    legs.push({
      deckId: deck.id,
      deckName: deckLabel(deck.name),
      cards: [...cards],
      dueCount: cards.length,
    });
  }

  legs.sort((a, b) => b.dueCount - a.dueCount || a.deckId.localeCompare(b.deckId));

  const queue = legs.flatMap((leg) => leg.cards);
  const first = legs[0] ?? null;

  return {
    legs,
    queue,
    totalDue: queue.length,
    first,
    queueLabel: getStudyAllDueLabel(queue.length),
    chainLabel: first ? `Review ${first.deckName} · ${first.dueCount} due` : null,
  };
}

/** The leg after `deckId`, for a client that chains one deck at a time. */
export function nextDueReviewLeg<TCard>(
  plan: DueReviewPlan<TCard>,
  deckId: string
): DueReviewLeg<TCard> | null {
  const index = plan.legs.findIndex((leg) => leg.deckId === deckId);
  if (index < 0) return null;
  return plan.legs[index + 1] ?? null;
}

/**
 * "Continue with Pharmacology (12 due)" — the offer at the end of a leg.
 *
 * Takes only the name and the count, so a client that re-counts the next leg
 * from its own store at the moment it offers it (the phone does, to skip a
 * deck cleared elsewhere) does not have to carry the cards to say so.
 */
export function continueDueReviewLabel(leg: { deckName: string; dueCount: number }): string {
  return `Continue with ${leg.deckName} (${leg.dueCount} due)`;
}

/** Where the student is across the WHOLE plan, not just the deck on screen. */
export interface DueReviewProgress {
  /** 1-based position in the cross-deck queue — the `n` in "n / total". */
  overall: number;
  /** Every due card the plan covers, i.e. the N the Home button promised. */
  total: number;
  /** "Deck 1 of 4 · Pharmacology" — which leg this is, and of how many. */
  deckLabel: string;
}

/**
 * The counter for a client that runs the plan one deck at a time.
 *
 * Home says "Study all 68 due" and the phone opens the first leg, so its own
 * counter said "1 / 17" — true of the deck, and silent about the other 51. The
 * student had no way to see that the session was 1 of 68. This maps a
 * (deckIndex, cardIndex) inside one leg onto the position across every leg.
 *
 * Returns `null` when there is nothing cross-deck to say — no plan, a
 * single-deck plan, an out-of-range deck, or an empty one — which is the
 * signal to keep the plain "n / deckDue" counter rather than dress a
 * one-deck session up as a chain.
 *
 * `cardIndex` is clamped into the leg, so a caller that hands over the
 * end-of-deck index (`cardIndex === dueCount`) gets the last card's position
 * instead of running past `total`.
 */
export function dueReviewProgress(
  plan: { legs: readonly { deckName: string; dueCount: number }[] } | null | undefined,
  deckIndex: number,
  cardIndex: number
): DueReviewProgress | null {
  const legs = plan?.legs ?? [];
  if (legs.length <= 1) return null;
  if (!Number.isInteger(deckIndex) || deckIndex < 0 || deckIndex >= legs.length) return null;

  const size = (leg: { dueCount: number }) => Math.max(0, Math.trunc(leg.dueCount) || 0);
  const total = legs.reduce((sum, leg) => sum + size(leg), 0);
  if (total <= 0) return null;

  let before = 0;
  for (let i = 0; i < deckIndex; i += 1) {
    const leg = legs[i];
    if (leg) before += size(leg);
  }

  const current = legs[deckIndex];
  if (!current) return null;
  const legSize = size(current);
  if (legSize <= 0) return null;
  const within = Math.min(Math.max(0, Math.trunc(cardIndex) || 0), legSize - 1);

  return {
    overall: Math.min(before + within + 1, total),
    total,
    deckLabel: `Deck ${deckIndex + 1} of ${legs.length} · ${deckLabel(current.deckName)}`,
  };
}
