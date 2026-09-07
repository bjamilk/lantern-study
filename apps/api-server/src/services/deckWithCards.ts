/**
 * Validation and normalisation for POST /api/v1/decks/with-cards.
 *
 * The two-step "create the deck, then create its cards" flow is what left
 * empty decks behind whenever the client died between the steps (airplane
 * mode, process death): the deck row was already committed, and the client's
 * rollback could only remove its own local copy. This module backs the single
 * endpoint that replaces it, so a deck and its cards land together or not
 * at all.
 *
 * Kept free of supabase so the rules can be unit-tested directly.
 */

/** A deck this big is a client bug, not a study deck; refuse before writing. */
export const MAX_CARDS_PER_DECK = 500;
export const MAX_CARD_FIELD_LENGTH = 10000;

export type DeckCardType = 'BASIC' | 'CLOZE' | 'IMAGE_OCCLUSION';

export type DeckCardInput = {
  type?: string | null;
  front?: string | null;
  back?: string | null;
  clozeText?: string | null;
  imageUrl?: string | null;
  occlusionData?: unknown;
  tags?: unknown;
};

/** A card in the exact shape both the RPC and the fallback insert consume. */
export type NormalizedDeckCard = {
  type: DeckCardType;
  front: string | null;
  back: string | null;
  clozeText: string | null;
  imageUrl: string | null;
  occlusionData: unknown | null;
  tags: string[];
};

export type DeckCardsRejection = {
  /** Machine code the client can branch on; never a prose message. */
  code:
    | 'EMPTY_CARDS'
    | 'TOO_MANY_CARDS'
    | 'INVALID_CARD_TYPE'
    | 'INVALID_CARD'
    | 'CARD_FIELD_TOO_LONG';
  message: string;
  /** Index of the offending card, when one card is at fault. */
  index?: number;
  /** Which field on that card is at fault. */
  field?: string;
};

export type DeckCardsValidation =
  | { ok: true; cards: NormalizedDeckCard[] }
  | { ok: false; rejection: DeckCardsRejection };

const CARD_TYPES: DeckCardType[] = ['BASIC', 'CLOZE', 'IMAGE_OCCLUSION'];

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const stringTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    .map((tag) => tag.trim())
    .slice(0, 50);
};

const tooLong = (value: string | null): boolean =>
  value !== null && value.length > MAX_CARD_FIELD_LENGTH;

/**
 * Validate and normalise the whole card array. Every rejection carries a code
 * plus the index/field at fault so a client can show which card is broken
 * instead of "Validation Error".
 */
export function validateDeckCards(input: unknown): DeckCardsValidation {
  if (!Array.isArray(input) || input.length === 0) {
    return {
      ok: false,
      rejection: {
        code: 'EMPTY_CARDS',
        message: 'A deck needs at least one card. Nothing was saved.',
        field: 'cards',
      },
    };
  }

  if (input.length > MAX_CARDS_PER_DECK) {
    return {
      ok: false,
      rejection: {
        code: 'TOO_MANY_CARDS',
        message: `A deck can hold at most ${MAX_CARDS_PER_DECK} cards in one request.`,
        field: 'cards',
      },
    };
  }

  const cards: NormalizedDeckCard[] = [];

  for (let index = 0; index < input.length; index++) {
    const raw = input[index] as DeckCardInput | null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        ok: false,
        rejection: { code: 'INVALID_CARD', message: 'Each card must be an object.', index },
      };
    }

    const type = (text(raw.type) || 'BASIC') as DeckCardType;
    if (!CARD_TYPES.includes(type)) {
      return {
        ok: false,
        rejection: {
          code: 'INVALID_CARD_TYPE',
          message: `Card type must be one of ${CARD_TYPES.join(', ')}.`,
          index,
          field: 'type',
        },
      };
    }

    const front = text(raw.front);
    const back = text(raw.back);
    const clozeText = text(raw.clozeText);
    const imageUrl = text(raw.imageUrl);

    for (const [field, value] of [
      ['front', front],
      ['back', back],
      ['clozeText', clozeText],
    ] as const) {
      if (tooLong(value)) {
        return {
          ok: false,
          rejection: {
            code: 'CARD_FIELD_TOO_LONG',
            message: `Card ${field} must be at most ${MAX_CARD_FIELD_LENGTH} characters.`,
            index,
            field,
          },
        };
      }
    }

    // Mirrors the check_flashcard_fields constraint. Catching it here means a
    // bad card is a 400 naming the card, not a 23514 that rolls back a write
    // the caller thought was valid.
    if (type === 'BASIC') {
      if (!front) {
        return {
          ok: false,
          rejection: { code: 'INVALID_CARD', message: 'front is required.', index, field: 'front' },
        };
      }
      if (!back) {
        return {
          ok: false,
          rejection: { code: 'INVALID_CARD', message: 'back is required.', index, field: 'back' },
        };
      }
    } else if (type === 'CLOZE') {
      if (!clozeText) {
        return {
          ok: false,
          rejection: {
            code: 'INVALID_CARD',
            message: 'clozeText is required for a cloze card.',
            index,
            field: 'clozeText',
          },
        };
      }
    } else if (!imageUrl || !front) {
      return {
        ok: false,
        rejection: {
          code: 'INVALID_CARD',
          message: 'imageUrl and front are required for an image occlusion card.',
          index,
          field: imageUrl ? 'front' : 'imageUrl',
        },
      };
    }

    cards.push({
      type,
      // CLOZE keeps front/back NULL and occlusion keeps back NULL — the DB
      // constraint rejects anything else.
      front: type === 'CLOZE' ? null : front,
      back: type === 'BASIC' ? back : null,
      clozeText: type === 'CLOZE' ? clozeText : null,
      imageUrl: type === 'CLOZE' ? null : imageUrl,
      occlusionData:
        type === 'IMAGE_OCCLUSION' && raw.occlusionData && typeof raw.occlusionData === 'object'
          ? raw.occlusionData
          : null,
      tags: stringTags(raw.tags),
    });
  }

  return { ok: true, cards };
}

/** Row shape for the compensating (no-RPC) insert path. */
export function cardToFlashcardRow(card: NormalizedDeckCard, deckId: string) {
  return {
    deck_id: deckId,
    type: card.type,
    front: card.front,
    back: card.back,
    cloze_text: card.clozeText,
    image_url: card.imageUrl,
    ...(card.occlusionData ? { occlusion_data: card.occlusionData } : {}),
    ...(card.tags.length > 0 ? { tags: card.tags } : {}),
  };
}

/**
 * True when the database has no `create_deck_with_cards` yet — migrations are
 * hand-applied here, so the API ships before the function exists and must fall
 * back rather than 500. PostgREST answers PGRST202 for an unknown RPC;
 * Postgres itself answers 42883 (undefined_function).
 */
export function isMissingRpcError(error: unknown): boolean {
  const err = error as { code?: unknown; message?: unknown } | null | undefined;
  if (!err) return false;
  if (err.code === 'PGRST202' || err.code === '42883') return true;
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  return (
    message.includes('could not find the function') ||
    message.includes('does not exist') && message.includes('create_deck_with_cards')
  );
}

/** A failure the route turns into a structured JSON body. */
export class DeckWithCardsError extends Error {
  constructor(
    readonly code: 'CARD_WRITE_FAILED' | 'DECK_WRITE_FAILED',
    message: string,
    /** True when the partial deck row was successfully removed. */
    readonly rolledBack: boolean,
  ) {
    super(message);
    this.name = 'DeckWithCardsError';
  }
}
