/**
 * The rules behind POST /decks/with-cards. An empty or malformed card array
 * must be refused BEFORE a deck row exists — an accepted-then-failed write is
 * exactly the empty "0 cards" deck this endpoint replaces.
 */
import {
  cardToFlashcardRow,
  isMissingRpcError,
  MAX_CARDS_PER_DECK,
  validateDeckCards,
} from './deckWithCards';

const basic = (n = 1) =>
  Array.from({ length: n }, (_, i) => ({ front: `q${i}`, back: `a${i}` }));

describe('validateDeckCards', () => {
  it('rejects an empty array with EMPTY_CARDS', () => {
    const result = validateDeckCards([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('EMPTY_CARDS');
    expect(result.rejection.field).toBe('cards');
  });

  it('rejects a missing array the same way', () => {
    expect(validateDeckCards(undefined).ok).toBe(false);
    expect(validateDeckCards(null).ok).toBe(false);
    expect(validateDeckCards('cards').ok).toBe(false);
  });

  it('rejects more cards than one request may carry', () => {
    const result = validateDeckCards(basic(MAX_CARDS_PER_DECK + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('TOO_MANY_CARDS');
  });

  it('names the card and field at fault instead of a generic error', () => {
    const result = validateDeckCards([
      { front: 'ok', back: 'ok' },
      { front: 'no answer', back: '   ' },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection).toMatchObject({ code: 'INVALID_CARD', index: 1, field: 'back' });
  });

  it('rejects an unknown card type', () => {
    const result = validateDeckCards([{ type: 'SPACED', front: 'a', back: 'b' }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('INVALID_CARD_TYPE');
  });

  it('requires clozeText on a cloze card and clears its front/back', () => {
    expect(validateDeckCards([{ type: 'CLOZE', front: 'a' }]).ok).toBe(false);

    const result = validateDeckCards([
      { type: 'CLOZE', clozeText: 'The {{c1::mitochondrion}}', front: 'stray', back: 'stray' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // check_flashcard_fields forbids front/back on a cloze card.
    expect(result.cards[0]).toMatchObject({ front: null, back: null, clozeText: expect.any(String) });
  });

  it('requires imageUrl and front on an occlusion card and clears its back', () => {
    const missing = validateDeckCards([{ type: 'IMAGE_OCCLUSION', front: 'label it' }]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.rejection.field).toBe('imageUrl');

    const ok = validateDeckCards([
      { type: 'IMAGE_OCCLUSION', front: 'label it', back: 'ignored', imageUrl: 'https://x/y.png' },
    ]);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.cards[0].back).toBeNull();
  });

  it('keeps only string tags', () => {
    const result = validateDeckCards([{ front: 'a', back: 'b', tags: ['bio', 3, '  ', ' cell '] }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cards[0].tags).toEqual(['bio', 'cell']);
  });

  it('rejects an over-long field by name', () => {
    const result = validateDeckCards([{ front: 'a'.repeat(10001), back: 'b' }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection).toMatchObject({ code: 'CARD_FIELD_TOO_LONG', field: 'front' });
  });
});

describe('cardToFlashcardRow', () => {
  it('omits optional columns rather than writing nulls into them', () => {
    const result = validateDeckCards([{ front: 'a', back: 'b' }]);
    if (!result.ok) throw new Error('expected valid');
    const row = cardToFlashcardRow(result.cards[0], 'deck-1');
    expect(row).toEqual({
      deck_id: 'deck-1',
      type: 'BASIC',
      front: 'a',
      back: 'b',
      cloze_text: null,
      image_url: null,
    });
  });
});

describe('isMissingRpcError', () => {
  it('recognises the unapplied-migration signals', () => {
    expect(isMissingRpcError({ code: 'PGRST202' })).toBe(true);
    expect(isMissingRpcError({ code: '42883' })).toBe(true);
    expect(
      isMissingRpcError({ message: 'Could not find the function public.create_deck_with_cards' })
    ).toBe(true);
  });

  it('does not swallow a real failure', () => {
    expect(isMissingRpcError({ code: '23514', message: 'check constraint violated' })).toBe(false);
    expect(isMissingRpcError(null)).toBe(false);
  });
});
