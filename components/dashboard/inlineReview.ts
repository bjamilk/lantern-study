/**
 * Inline review — the model behind Home's first "Recent activities" row.
 *
 * The reference product puts a live question on the dashboard. Lantern does
 * the same thing with the one kind of question it can ask for free and
 * honestly: a flashcard that is ALREADY DUE. Nothing here generates anything,
 * nothing here spends credits, and nothing here invents a card that the
 * student's own decks do not contain — if no card is due, there is no inline
 * card and Home renders the plain rows.
 *
 * Pure by design: selection and the front → back → next state machine live
 * here so they can be tested without React, a store, or a clock.
 */
import { isCardDue } from '@lantern/shared/utils';
import { FlashcardType, type Deck, type Flashcard } from '../../types';

/** One inline-reviewable card, flattened to exactly what the card renders. */
export interface InlineDueCard {
  id: string;
  deckId: string;
  /** Deck name, shown as the caption. Empty when the deck is not loaded. */
  deckName: string;
  front: string;
  back: string;
}

function text(value: string | undefined | null): string {
  return (value ?? '').trim();
}

function dueTime(card: Flashcard): number {
  const raw = card.srsData?.nextReviewDate;
  if (!raw) return 0;
  const at = new Date(raw).getTime();
  return Number.isNaN(at) ? 0 : at;
}

/**
 * The inline queue: every due card that can honestly be rendered as a
 * two-sided prompt, most overdue first, across every deck.
 *
 * CLOZE and IMAGE_OCCLUSION cards are deliberately excluded. They need the
 * session's renderer (blanked spans, masked regions); showing their raw text
 * inline would either leak the answer or show a prompt that makes no sense.
 * They stay due and are still reviewed in the full session.
 */
export function selectInlineDueCards(
  flashcards: Flashcard[],
  decks: Deck[],
): InlineDueCard[] {
  const deckNames = new Map(decks.map((deck) => [deck.id, deck.name]));
  return flashcards
    .filter((card) => card.type === FlashcardType.BASIC)
    .filter((card) => text(card.front).length > 0 && text(card.back).length > 0)
    .filter((card) => isCardDue(card.srsData))
    .slice()
    .sort((a, b) => dueTime(a) - dueTime(b) || a.id.localeCompare(b.id))
    .map((card) => ({
      id: card.id,
      deckId: card.deckId,
      deckName: deckNames.get(card.deckId) ?? '',
      front: text(card.front),
      back: text(card.back),
    }));
}

/** Where the inline card is: showing the prompt, or showing the answer. */
export type InlineReviewPhase = 'front' | 'back';

export interface InlineReviewState {
  /** Index into the queue captured when the card mounted. */
  index: number;
  phase: InlineReviewPhase;
}

export const INITIAL_INLINE_REVIEW_STATE: InlineReviewState = {
  index: 0,
  phase: 'front',
};

/**
 * `reveal` turns the card over; `advance` (a grade, or Skip) moves to the next
 * card face-down. Advancing past the end parks the index one past the queue,
 * which the card reads as "nothing left inline" rather than wrapping around —
 * wrapping would re-ask a card the student just graded.
 */
export type InlineReviewEvent = 'reveal' | 'advance';

export function inlineReviewReduce(
  state: InlineReviewState,
  event: InlineReviewEvent,
): InlineReviewState {
  if (event === 'reveal') {
    return state.phase === 'back' ? state : { ...state, phase: 'back' };
  }
  return { index: state.index + 1, phase: 'front' };
}

/** The card at the cursor, or null when the queue is exhausted. */
export function inlineReviewCurrent(
  queue: InlineDueCard[],
  state: InlineReviewState,
): InlineDueCard | null {
  return queue[state.index] ?? null;
}

/**
 * Where the card's `Study all N due` link goes.
 *
 * `home` is the only correct answer once Home is the one rendering the card:
 * Home builds the cross-deck `dueReviewPlan` and enters the session with it,
 * which is what the link promises. The other two are the standalone fallback
 * for a caller that has no plan — and `hub` in particular is what shipped by
 * accident, landing the student on the flashcards deck list rather than in a
 * review whenever the due pile spanned more than one deck.
 */
export type InlineStudyAllTarget =
  | { kind: 'home' }
  | { kind: 'deck'; deckId: string }
  | { kind: 'hub' };

export function inlineStudyAllTarget(
  queue: InlineDueCard[],
  hasHomeHandler: boolean,
): InlineStudyAllTarget {
  if (hasHomeHandler) return { kind: 'home' };
  const deckIds = new Set(queue.map((card) => card.deckId));
  const [onlyDeckId] = [...deckIds];
  return deckIds.size === 1 && onlyDeckId ? { kind: 'deck', deckId: onlyDeckId } : { kind: 'hub' };
}

/**
 * The number the card is allowed to say. Home's plan total wins whenever Home
 * supplied one: the inline queue drops cloze/occlusion cards and cards with an
 * empty face, so counting it made the card say 62 under a hub saying 67.
 */
export function inlineDueLabelCount(dueTotal: number | null | undefined, queueLength: number): number {
  return typeof dueTotal === 'number' && Number.isFinite(dueTotal)
    ? Math.max(0, Math.trunc(dueTotal))
    : queueLength;
}
