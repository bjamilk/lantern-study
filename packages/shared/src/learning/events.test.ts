import {
  CONCEPT_SLUG_MAX_LENGTH,
  LEARNING_EVENT_TYPES,
  flashcardRatingToNumber,
  isUuidLike,
  normalizeConceptName,
  normalizeConceptSlug,
  parseQuestionBankListingId,
} from './events';

describe('normalizeConceptSlug', () => {
  it.each([
    ['Photosynthesis', 'photosynthesis'],
    ['  Cell   Biology ', 'cell-biology'],
    ['Krebs Cycle (TCA)', 'krebs-cycle-tca'],
    ['C++ pointers', 'c-pointers'],
    ['Newton’s 2nd Law', 'newton-s-2nd-law'],
    ['BIO 201 — enzymes', 'bio-201-enzymes'],
    ['Élan vital', 'elan-vital'],
    ['über-cool', 'uber-cool'],
    ['---already-kebab---', 'already-kebab'],
    ['UPPER_snake_case', 'upper-snake-case'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizeConceptSlug(input)).toBe(expected);
  });

  it('is idempotent', () => {
    const once = normalizeConceptSlug('Krebs Cycle (TCA)');
    expect(normalizeConceptSlug(once)).toBe(once);
  });

  it('returns an empty string for empty, punctuation-only or non-string input', () => {
    expect(normalizeConceptSlug('')).toBe('');
    expect(normalizeConceptSlug('   ')).toBe('');
    expect(normalizeConceptSlug('!!!')).toBe('');
    expect(normalizeConceptSlug(null)).toBe('');
    expect(normalizeConceptSlug(undefined)).toBe('');
    expect(normalizeConceptSlug(42)).toBe('42');
  });

  it('caps the slug length without leaving a trailing dash', () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const slug = normalizeConceptSlug(long);
    expect(slug.length).toBeLessThanOrEqual(CONCEPT_SLUG_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('normalizeConceptName', () => {
  it('collapses whitespace but keeps case', () => {
    expect(normalizeConceptName('  Krebs   Cycle ')).toBe('Krebs Cycle');
    expect(normalizeConceptName(null)).toBe('');
  });
});

describe('flashcardRatingToNumber', () => {
  it('maps the four grades and rejects anything else', () => {
    expect(flashcardRatingToNumber('again')).toBe(1);
    expect(flashcardRatingToNumber('hard')).toBe(2);
    expect(flashcardRatingToNumber('good')).toBe(3);
    expect(flashcardRatingToNumber('EASY')).toBe(4);
    expect(flashcardRatingToNumber('perfect')).toBeNull();
    expect(flashcardRatingToNumber(3)).toBeNull();
    expect(flashcardRatingToNumber(undefined)).toBeNull();
  });
});

describe('parseQuestionBankListingId', () => {
  const id = '0b6f3a3e-2c8e-4c3f-9d1a-7f2e5b1c9a10';

  it('extracts the listing uuid from a qbank bundle id', () => {
    expect(parseQuestionBankListingId(`qbank-${id}`)).toBe(id);
    expect(parseQuestionBankListingId(`qbank-${id.toUpperCase()}`)).toBe(id);
  });

  it('returns null for other bundle kinds and malformed ids', () => {
    expect(parseQuestionBankListingId('deck-abc')).toBeNull();
    expect(parseQuestionBankListingId('qbank-not-a-uuid')).toBeNull();
    expect(parseQuestionBankListingId('qbank-')).toBeNull();
    expect(parseQuestionBankListingId(undefined)).toBeNull();
    expect(parseQuestionBankListingId(null)).toBeNull();
  });
});

describe('isUuidLike', () => {
  it('accepts canonical uuids only', () => {
    expect(isUuidLike('0b6f3a3e-2c8e-4c3f-9d1a-7f2e5b1c9a10')).toBe(true);
    expect(isUuidLike('custom-123')).toBe(false);
    expect(isUuidLike('')).toBe(false);
    expect(isUuidLike(undefined)).toBe(false);
  });
});

describe('LEARNING_EVENT_TYPES', () => {
  it('matches the migration CHECK list (10 types)', () => {
    expect(LEARNING_EVENT_TYPES).toEqual([
      'card_reviewed',
      'question_shown',
      'question_answered',
      'resource_opened',
      'note_created',
      'card_generated',
      'question_generated',
      'bank_downloaded',
      'bank_score_recorded',
      'group_question_posted',
    ]);
  });
});
