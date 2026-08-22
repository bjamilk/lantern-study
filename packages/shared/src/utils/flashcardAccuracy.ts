/**
 * Per-deck flashcard accuracy for the AI Study Coach.
 *
 * The coach request has a `flashcardAccuracy` field. Until now both clients
 * filled it with TEST topic accuracy under the flashcard name, so the model was
 * told "your flashcards on X are at 40%" when no flashcard on X had ever been
 * graded. This helper derives the number from the SRS state the clients already
 * hold, so the field is either honest or omitted.
 *
 * Definition (shared by web + mobile so both send identical numbers):
 *  - reviewed = cards graded at least once. Both schedulers reset `repetitions`
 *    to 0 on "again" but bump `failedAttempts`, so a card that has only ever
 *    been failed still counts as reviewed.
 *  - mature   = `repetitions >= FLASHCARD_MATURE_REPETITIONS` and not a leech —
 *    the same threshold the deck stats call "mastered".
 *  - correctRate = mature / reviewed, per deck, topic = deck name.
 *  - decks with no reviewed card are dropped; an empty result means the caller
 *    should OMIT the field rather than send something else under its name.
 */
import type { Flashcard, SrsData } from '../types';

export interface FlashcardTopicAccuracy {
  /** Deck name — the closest thing a flashcard has to a topic. */
  topic: string;
  /** Share of reviewed cards that are currently mature, 0..1 (two decimals). */
  correctRate: number;
}

/** Repetition streak at which a card counts as mature / mastered. */
export const FLASHCARD_MATURE_REPETITIONS = 5;

/** Upper bound on entries sent to the coach prompt (weakest decks first). */
export const FLASHCARD_ACCURACY_MAX_DECKS = 20;

function repetitionsOf(srs: SrsData | null | undefined): number {
  const value = srs?.repetitions;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function failedAttemptsOf(srs: SrsData | null | undefined): number {
  const value = srs?.failedAttempts;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** True once a card has been graded at least once (success or failure). */
export function isFlashcardReviewed(srs: SrsData | null | undefined): boolean {
  return repetitionsOf(srs) > 0 || failedAttemptsOf(srs) > 0;
}

/** True when a card sits at the mastered repetition streak and is not a leech. */
export function isFlashcardMature(srs: SrsData | null | undefined): boolean {
  return repetitionsOf(srs) >= FLASHCARD_MATURE_REPETITIONS && !srs?.isLeech;
}

type DeckLike = { id: string; name?: string | null };
type CardsInput = ReadonlyArray<Flashcard> | Readonly<Record<string, ReadonlyArray<Flashcard>>>;

function groupCardsByDeck(cards: CardsInput): Map<string, ReadonlyArray<Flashcard>> {
  const byDeck = new Map<string, Flashcard[]>();
  const push = (card: Flashcard, fallbackDeckId?: string) => {
    const deckId = card.deckId || fallbackDeckId;
    if (!deckId) return;
    const bucket = byDeck.get(deckId);
    if (bucket) bucket.push(card);
    else byDeck.set(deckId, [card]);
  };

  if (Array.isArray(cards)) {
    for (const card of cards as ReadonlyArray<Flashcard>) push(card);
  } else {
    for (const [deckId, deckCards] of Object.entries(cards as Record<string, ReadonlyArray<Flashcard>>)) {
      for (const card of deckCards || []) push(card, deckId);
    }
  }
  return byDeck;
}

/**
 * Build the coach's `flashcardAccuracy` list from decks + cards.
 *
 * Accepts the web store shape (flat card array) and the mobile store shape
 * (record keyed by deck id). Returns [] when no card in any deck has been
 * reviewed — callers omit the field in that case.
 */
export function buildFlashcardAccuracyByDeck(
  decks: ReadonlyArray<DeckLike>,
  cards: CardsInput
): FlashcardTopicAccuracy[] {
  const byDeck = groupCardsByDeck(cards);
  const entries: FlashcardTopicAccuracy[] = [];

  for (const deck of decks) {
    if (!deck || typeof deck.id !== 'string') continue;
    const deckCards = byDeck.get(deck.id);
    if (!deckCards || deckCards.length === 0) continue;

    let reviewed = 0;
    let mature = 0;
    for (const card of deckCards) {
      const srs = card.srsData;
      if (!isFlashcardReviewed(srs)) continue;
      reviewed++;
      if (isFlashcardMature(srs)) mature++;
    }
    if (reviewed === 0) continue;

    const name = typeof deck.name === 'string' ? deck.name.trim() : '';
    entries.push({
      topic: name || 'Untitled deck',
      correctRate: Math.round((mature / reviewed) * 100) / 100,
    });
  }

  return entries
    .sort((a, b) => a.correctRate - b.correctRate || a.topic.localeCompare(b.topic))
    .slice(0, FLASHCARD_ACCURACY_MAX_DECKS);
}
