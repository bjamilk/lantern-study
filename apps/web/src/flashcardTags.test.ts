import { describe, expect, it } from 'vitest';
import {
  MAX_FLASHCARD_TAGS,
  MAX_FLASHCARD_TAG_LENGTH,
  formatFlashcardTags,
  parseFlashcardTags,
} from '../../../utils/flashcardTags';

describe('parseFlashcardTags', () => {
  it('splits on commas/semicolons/newlines, trims and drops empties', () => {
    expect(parseFlashcardTags('enzymes, Chapter 3 ;; krebs\n cycle ,,')).toEqual([
      'enzymes',
      'Chapter 3',
      'krebs',
      'cycle',
    ]);
  });

  it('dedupes case-insensitively keeping the first spelling and strips a leading #', () => {
    expect(parseFlashcardTags('Enzymes, enzymes, #ENZYMES, #krebs')).toEqual(['Enzymes', 'krebs']);
  });

  it('collapses inner whitespace and caps tag length and count', () => {
    expect(parseFlashcardTags('chapter    three')).toEqual(['chapter three']);
    const long = 'x'.repeat(MAX_FLASHCARD_TAG_LENGTH + 10);
    expect(parseFlashcardTags(long)[0]).toHaveLength(MAX_FLASHCARD_TAG_LENGTH);
    const many = Array.from({ length: MAX_FLASHCARD_TAGS + 5 }, (_, i) => `t${i}`).join(',');
    expect(parseFlashcardTags(many)).toHaveLength(MAX_FLASHCARD_TAGS);
  });

  it('handles empty input', () => {
    expect(parseFlashcardTags('')).toEqual([]);
    expect(parseFlashcardTags(null)).toEqual([]);
    expect(parseFlashcardTags(' , ; ')).toEqual([]);
  });
});

describe('formatFlashcardTags', () => {
  it('round-trips through parse', () => {
    const tags = ['enzymes', 'Chapter 3'];
    expect(formatFlashcardTags(tags)).toBe('enzymes, Chapter 3');
    expect(parseFlashcardTags(formatFlashcardTags(tags))).toEqual(tags);
  });

  it('skips blanks and tolerates null', () => {
    expect(formatFlashcardTags(['a', '', '  ', 'b'])).toBe('a, b');
    expect(formatFlashcardTags(null)).toBe('');
  });
});
