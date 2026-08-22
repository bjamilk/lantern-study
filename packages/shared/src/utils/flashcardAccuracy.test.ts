import { FlashcardType, type Flashcard, type SrsData } from '../types';
import {
  FLASHCARD_ACCURACY_MAX_DECKS,
  buildFlashcardAccuracyByDeck,
  isFlashcardMature,
  isFlashcardReviewed,
} from './flashcardAccuracy';

function srs(overrides: Partial<SrsData>): SrsData {
  return {
    interval: 1,
    easeFactor: 2.5,
    repetitions: 0,
    nextReviewDate: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

function card(id: string, deckId: string, srsData?: SrsData): Flashcard {
  return { id, deckId, type: FlashcardType.BASIC, front: id, back: id, createdAt: '2026-08-01T00:00:00.000Z', srsData };
}

describe('isFlashcardReviewed / isFlashcardMature', () => {
  it('treats a never-graded card as not reviewed', () => {
    expect(isFlashcardReviewed(undefined)).toBe(false);
    expect(isFlashcardReviewed(srs({ repetitions: 0, failedAttempts: 0 }))).toBe(false);
  });

  it('counts a card that was only ever failed as reviewed (repetitions reset to 0 on again)', () => {
    expect(isFlashcardReviewed(srs({ repetitions: 0, failedAttempts: 2 }))).toBe(true);
  });

  it('requires the mastered streak and excludes leeches', () => {
    expect(isFlashcardMature(srs({ repetitions: 4 }))).toBe(false);
    expect(isFlashcardMature(srs({ repetitions: 5 }))).toBe(true);
    expect(isFlashcardMature(srs({ repetitions: 7, isLeech: true }))).toBe(false);
  });
});

describe('buildFlashcardAccuracyByDeck', () => {
  const decks = [
    { id: 'd1', name: 'Anatomy' },
    { id: 'd2', name: 'Pharmacology' },
    { id: 'd3', name: 'Untouched deck' },
  ];

  it('returns [] when no card in any deck has been reviewed (caller omits the field)', () => {
    const cards = [card('a', 'd1'), card('b', 'd1', srs({ repetitions: 0 })), card('c', 'd3')];
    expect(buildFlashcardAccuracyByDeck(decks, cards)).toEqual([]);
  });

  it('computes mature / reviewed per deck, names the topic after the deck, drops unreviewed decks', () => {
    const cards = [
      // d1: 4 reviewed, 2 mature (one leech at 6 reps is NOT mature)
      card('a', 'd1', srs({ repetitions: 5 })),
      card('b', 'd1', srs({ repetitions: 9 })),
      card('c', 'd1', srs({ repetitions: 6, isLeech: true, failedAttempts: 5 })),
      card('d', 'd1', srs({ repetitions: 0, failedAttempts: 1 })),
      card('e', 'd1'), // new — not reviewed, not in denominator
      // d2: 1 reviewed, 0 mature
      card('f', 'd2', srs({ repetitions: 2 })),
      // d3 has only new cards
      card('g', 'd3'),
    ];

    expect(buildFlashcardAccuracyByDeck(decks, cards)).toEqual([
      { topic: 'Pharmacology', correctRate: 0 },
      { topic: 'Anatomy', correctRate: 0.5 },
    ]);
  });

  it('accepts the mobile store shape (record keyed by deck id)', () => {
    const byDeck = {
      d1: [card('a', 'd1', srs({ repetitions: 5 })), card('b', 'd1', srs({ repetitions: 1 }))],
      d2: [],
    };
    expect(buildFlashcardAccuracyByDeck(decks, byDeck)).toEqual([{ topic: 'Anatomy', correctRate: 0.5 }]);
  });

  it('ignores cards whose deck is unknown and decks with blank names get a fallback label', () => {
    const cards = [card('x', 'ghost', srs({ repetitions: 5 })), card('y', 'd1', srs({ repetitions: 5 }))];
    expect(buildFlashcardAccuracyByDeck([{ id: 'd1', name: '   ' }], cards)).toEqual([
      { topic: 'Untitled deck', correctRate: 1 },
    ]);
  });

  it('caps the list at the weakest N decks', () => {
    const manyDecks = Array.from({ length: FLASHCARD_ACCURACY_MAX_DECKS + 5 }, (_, i) => ({ id: `d${i}`, name: `Deck ${i}` }));
    const cards = manyDecks.flatMap((d, i) => [
      card(`${d.id}-a`, d.id, srs({ repetitions: 5 })),
      ...Array.from({ length: i }, (_, j) => card(`${d.id}-${j}`, d.id, srs({ repetitions: 1 }))),
    ]);
    const result = buildFlashcardAccuracyByDeck(manyDecks, cards);
    expect(result).toHaveLength(FLASHCARD_ACCURACY_MAX_DECKS);
    // Weakest first: the deck with the most immature cards leads.
    expect(result[0]!.correctRate).toBeLessThanOrEqual(result[result.length - 1]!.correctRate);
    expect(result.some(e => e.topic === 'Deck 0')).toBe(false); // 100% deck is the strongest, trimmed
  });
});
