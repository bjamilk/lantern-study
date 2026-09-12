import { describe, expect, it } from 'vitest';
import { flashcardReviewCounterLabel, queueDeckCount } from './FlashcardReviewScreen';

describe('queueDeckCount', () => {
  it('counts the decks the dealt queue actually spans', () => {
    expect(queueDeckCount([{ deckId: 'a' }, { deckId: 'a' }, { deckId: 'b' }])).toBe(2);
    expect(queueDeckCount([{ deckId: 'a' }])).toBe(1);
    expect(queueDeckCount([])).toBe(0);
  });
});

describe('flashcardReviewCounterLabel', () => {
  it('names the cross-deck span so 68 does not read as one deck', () => {
    expect(flashcardReviewCounterLabel(1, 68, 4)).toBe('1 / 68 across 4 decks');
  });

  it('stays plain for a single deck', () => {
    expect(flashcardReviewCounterLabel(3, 17, 1)).toBe('3 / 17');
    expect(flashcardReviewCounterLabel(3, 17, 0)).toBe('3 / 17');
  });
});
