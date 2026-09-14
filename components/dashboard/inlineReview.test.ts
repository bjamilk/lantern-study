import { describe, it, expect } from 'vitest';
import { FlashcardType, type Deck, type Flashcard } from '../../types';
import {
  INITIAL_INLINE_REVIEW_STATE,
  inlineReviewCurrent,
  inlineReviewReduce,
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
      [
        due('a', 1),
        notDue('b'),
        due('c', 10, { deckId: 'deck-2' }),
        due('d', 5),
      ],
      decks,
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
      decks,
    );
    expect(queue.map((c) => c.id)).toEqual(['basic']);
  });

  it('excludes cards with a blank front or back rather than showing an empty prompt', () => {
    const queue = selectInlineDueCards(
      [due('blank-front', 3, { front: '   ' }), due('blank-back', 3, { back: '' }), due('ok', 3)],
      decks,
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
      [card({ id: 'z', srsData: srsData as Flashcard['srsData'] }), card({ id: 'a', srsData: srsData as Flashcard['srsData'] })],
      decks,
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

  it('Skip from the ANSWER state advances ungraded, exactly like the front', () => {
    // The card used to drop Skip once it turned over, leaving grading as the
    // only way forward. Both faces advance the same way, and neither one
    // grades: advancing is a pure cursor move, so a skipped card stays due.
    const front = INITIAL_INLINE_REVIEW_STATE;
    const back = inlineReviewReduce(front, 'reveal');
    expect(inlineReviewReduce(back, 'advance')).toEqual(inlineReviewReduce(front, 'advance'));
    expect(inlineReviewReduce(back, 'advance').phase).toBe('front');
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
