/**
 * The web suite for `inlineReview`, run against the phone's copy.
 *
 * Same cases, same expectations, deliberately: this is the gate that keeps the
 * two Homes picking the same card. If a case here is ever changed, the web
 * file (`components/dashboard/inlineReview.test.ts`) changes with it.
 *
 * The last two blocks are additions, not drift: web covers the link target and
 * the label count only through its render test, and mobile's jest is a node
 * environment with no renderer, so they are asserted on the pure functions.
 */
import { FlashcardType, type Deck, type Flashcard } from '@lantern/shared/types';
import {
  INITIAL_INLINE_REVIEW_STATE,
  inlineDueLabelCount,
  inlineReviewCurrent,
  inlineReviewReduce,
  inlineStudyAllTarget,
  selectInlineDueCards,
} from './inlineReview';

const HOUR = 60 * 60 * 1000;

function card(overrides: Partial<Flashcard> & { id: string }): Flashcard {
  return {
    deckId: 'deck-1',
    type: FlashcardType.BASIC,
    front: 'Front of ' + overrides.id,
    back: 'Back of ' + overrides.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Flashcard;
}

function due(id: string, overdueHours: number, rest: Partial<Flashcard> = {}): Flashcard {
  return card({
    id,
    ...rest,
    srsData: {
      nextReviewDate: new Date(Date.now() - overdueHours * HOUR).toISOString(),
      repetitions: 2,
      interval: 1,
      easeFactor: 2.5,
    } as Flashcard['srsData'],
  });
}

function notDue(id: string, rest: Partial<Flashcard> = {}): Flashcard {
  return card({
    id,
    ...rest,
    srsData: {
      nextReviewDate: new Date(Date.now() + 48 * HOUR).toISOString(),
      repetitions: 2,
      interval: 1,
      easeFactor: 2.5,
    } as Flashcard['srsData'],
  });
}

const decks: Deck[] = [
  { id: 'deck-1', name: 'Pharmacology', createdAt: '2026-01-01T00:00:00.000Z' } as Deck,
  { id: 'deck-2', name: 'Anatomy', createdAt: '2026-01-01T00:00:00.000Z' } as Deck,
];

describe('selectInlineDueCards', () => {
  it('returns only due cards, most overdue first, across decks', () => {
    const queue = selectInlineDueCards(
      [due('a', 1), notDue('b'), due('c', 10, { deckId: 'deck-2' }), due('d', 5)],
      decks
    );
    expect(queue.map((c) => c.id)).toEqual(['c', 'd', 'a']);
    expect(queue[0].deckName).toBe('Anatomy');
    expect(queue[1].deckName).toBe('Pharmacology');
  });

  it('excludes new / never-scheduled cards — they belong to the new-card budget', () => {
    expect(selectInlineDueCards([card({ id: 'new-1' })], decks)).toEqual([]);
  });

  it('excludes cloze and image-occlusion cards, which need the session renderer', () => {
    const queue = selectInlineDueCards(
      [
        due('cloze', 3, { type: FlashcardType.CLOZE, clozeText: 'The {{heart}} pumps' }),
        due('occ', 3, { type: FlashcardType.IMAGE_OCCLUSION, imageUrl: 'x.png' }),
        due('basic', 3),
      ],
      decks
    );
    expect(queue.map((c) => c.id)).toEqual(['basic']);
  });

  it('excludes cards with a blank front or back rather than showing an empty prompt', () => {
    const queue = selectInlineDueCards(
      [due('blank-front', 3, { front: '   ' }), due('blank-back', 3, { back: '' }), due('ok', 3)],
      decks
    );
    expect(queue.map((c) => c.id)).toEqual(['ok']);
  });

  it('leaves the deck caption empty when the deck is not loaded, never guessing a name', () => {
    const queue = selectInlineDueCards([due('a', 1, { deckId: 'missing' })], decks);
    expect(queue[0].deckName).toBe('');
  });

  it('is stable when two cards are equally overdue', () => {
    const at = new Date(Date.now() - HOUR).toISOString();
    const srsData = { nextReviewDate: at, repetitions: 2, interval: 1, easeFactor: 2.5 };
    const queue = selectInlineDueCards(
      [
        card({ id: 'z', srsData: srsData as Flashcard['srsData'] }),
        card({ id: 'a', srsData: srsData as Flashcard['srsData'] }),
      ],
      decks
    );
    expect(queue.map((c) => c.id)).toEqual(['a', 'z']);
  });

  it('does not mutate the caller list order', () => {
    const cards = [due('a', 1), due('c', 10)];
    selectInlineDueCards(cards, decks);
    expect(cards.map((c) => c.id)).toEqual(['a', 'c']);
  });
});

describe('inlineReviewReduce', () => {
  it('starts on the front', () => {
    expect(INITIAL_INLINE_REVIEW_STATE).toEqual({ index: 0, phase: 'front' });
  });

  it('reveal turns the card over and is idempotent', () => {
    const back = inlineReviewReduce(INITIAL_INLINE_REVIEW_STATE, 'reveal');
    expect(back).toEqual({ index: 0, phase: 'back' });
    expect(inlineReviewReduce(back, 'reveal')).toBe(back);
  });

  it('advance moves to the next card face-down (grade or skip)', () => {
    const back = inlineReviewReduce(INITIAL_INLINE_REVIEW_STATE, 'reveal');
    expect(inlineReviewReduce(back, 'advance')).toEqual({ index: 1, phase: 'front' });
  });

  it('advance from the front (Skip) also moves on without revealing', () => {
    expect(inlineReviewReduce(INITIAL_INLINE_REVIEW_STATE, 'advance')).toEqual({
      index: 1,
      phase: 'front',
    });
  });

  it('never wraps around, so a just-graded card is not asked again', () => {
    const queue = selectInlineDueCards([due('a', 2), due('b', 1)], decks);
    let state = INITIAL_INLINE_REVIEW_STATE;
    state = inlineReviewReduce(state, 'advance');
    state = inlineReviewReduce(state, 'advance');
    expect(state.index).toBe(2);
    expect(inlineReviewCurrent(queue, state)).toBeNull();
  });
});

describe('inlineReviewCurrent', () => {
  it('reads the card at the cursor', () => {
    const queue = selectInlineDueCards([due('a', 2), due('b', 1)], decks);
    expect(inlineReviewCurrent(queue, INITIAL_INLINE_REVIEW_STATE)?.id).toBe('a');
    expect(inlineReviewCurrent(queue, { index: 1, phase: 'front' })?.id).toBe('b');
  });

  it('is null for an empty queue', () => {
    expect(inlineReviewCurrent([], INITIAL_INLINE_REVIEW_STATE)).toBeNull();
  });
});

describe('inlineStudyAllTarget', () => {
  it("takes Home's own session whenever Home handed one over", () => {
    const queue = selectInlineDueCards([due('a', 2), due('b', 1, { deckId: 'deck-2' })], decks);
    expect(inlineStudyAllTarget(queue, true)).toEqual({ kind: 'home' });
  });

  it('falls back to the one deck when the whole pile is that deck', () => {
    const queue = selectInlineDueCards([due('a', 2), due('b', 1)], decks);
    expect(inlineStudyAllTarget(queue, false)).toEqual({ kind: 'deck', deckId: 'deck-1' });
  });

  it('falls back to the hub when the pile spans decks and Home offered nothing', () => {
    const queue = selectInlineDueCards([due('a', 2), due('b', 1, { deckId: 'deck-2' })], decks);
    expect(inlineStudyAllTarget(queue, false)).toEqual({ kind: 'hub' });
  });
});

describe('inlineDueLabelCount', () => {
  it("says Home's plan total, not the shorter inline queue", () => {
    expect(inlineDueLabelCount(67, 62)).toBe(67);
  });

  it('falls back to the queue length when there is no plan total', () => {
    expect(inlineDueLabelCount(undefined, 62)).toBe(62);
    expect(inlineDueLabelCount(null, 62)).toBe(62);
    expect(inlineDueLabelCount(Number.NaN, 62)).toBe(62);
  });

  it('never says a negative or fractional number of cards', () => {
    expect(inlineDueLabelCount(-4, 62)).toBe(0);
    expect(inlineDueLabelCount(6.9, 62)).toBe(6);
  });
});
