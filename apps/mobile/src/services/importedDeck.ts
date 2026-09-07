/**
 * Saving an IMPORTED deck — online in one request, offline in one queued
 * operation, and never in a way that pretends it went further than it did.
 *
 * A generated deck refuses the offline path altogether
 * (services/jobArtifacts.ts): its cards cost a credit, so nothing is written
 * until the server has them. An imported deck is the opposite case. The cards
 * already exist on the student's phone, the parse cost nothing, and refusing
 * to hold them until there is signal would make the zero-credit door useless
 * exactly where it matters most — a data-less bus ride with a 200-card Anki
 * export in the clipboard.
 *
 * So this module has two honest outcomes and the sheet prints which one
 * happened:
 *
 *   saved   — POST /decks/with-cards returned; the account holds the deck.
 *   queued  — the deck and its cards are on this device and studiable now,
 *             and ONE queued `deck` create carries both to the server later.
 *
 * The queued shape matters. The obvious offline path — `createDeck`, then
 * `createFlashcard` per card — queues a deck create whose new server id is
 * never bound back, plus one card write per card aimed at the local
 * `temp_deck_…` id. Those card writes are refused every single time and are
 * purged as unsendable on the next launch (`isDoomedTempDeckOp`). That path
 * shows 200 cards, syncs an empty deck, and silently loses all 200. The
 * operation written here carries its cards, so the deck handler can replay the
 * whole import through the same atomic endpoint the online path uses.
 */
import { mapDeckFromApi, mapFlashcardsFromApi } from '@lantern/shared';
import { isPermanentSyncError, syncErrorMessage } from '../utils/syncErrorPolicy';
import { createDeckWithCards, type DeckWithCardsRequest } from './api';
import { syncService } from './syncService';
import { useFlashcardStore, type Deck, type Flashcard } from '../stores/flashcardStore';
import { importedCardsToLocalFlashcards } from '../components/flashcards/importCardsMachine';
import type { ImportedCard } from '../components/flashcards/deckImportParse';

export interface SaveImportedDeckInput {
  userId: string;
  deckName: string;
  cards: ImportedCard[];
  description?: string;
}

export interface SaveImportedDeckResult {
  kind: 'saved' | 'queued';
  count: number;
  deckName: string;
  deckId: string;
}

/** The request body both the online save and its queued replay send. */
export function importRequestBody(
  clientKey: string,
  deckName: string,
  cards: ImportedCard[],
  description?: string
): DeckWithCardsRequest {
  return {
    clientKey,
    name: deckName,
    description,
    cards: cards.map((card) => ({
      type: card.type,
      front: card.front,
      back: card.back,
      ...(card.clozeText ? { clozeText: card.clozeText } : {}),
      ...(card.tags && card.tags.length ? { tags: card.tags } : {}),
    })),
  };
}

/**
 * Save an import, or queue it whole.
 *
 * @throws only when the deck could be neither saved nor queued — i.e. the
 *   student's work would have gone nowhere. Everything else is one of the two
 *   outcomes above.
 */
export async function saveImportedDeck(
  input: SaveImportedDeckInput
): Promise<SaveImportedDeckResult> {
  const { userId, deckName, cards, description } = input;
  if (cards.length === 0) throw new Error('There are no cards to import.');

  const store = useFlashcardStore.getState();
  // One key for this import: an online save and its later queued replay are
  // the same write, so a retry can never mint a second deck.
  const clientKey = `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const body = importRequestBody(clientKey, deckName, cards, description);

  try {
    const response = await createDeckWithCards(body);
    const deck = mapDeckFromApi(response.deck) as Deck | null;
    const saved = mapFlashcardsFromApi(
      (response.flashcards ?? response.cards ?? []) as unknown[]
    ) as Flashcard[];
    if (!deck?.id) throw new Error('The server did not return the saved deck.');
    await store.insertSavedDeck(deck, saved);
    return {
      kind: 'saved',
      // What the server actually took, never what we sent.
      count: saved.length || response.cardCount || 0,
      deckName: deck.name || deckName,
      deckId: deck.id,
    };
  } catch (error) {
    // A 4xx is the server refusing this payload, not the network being down:
    // a card over the length limit, a deck of 600. Queueing it would promise
    // "we'll save it later" about a write that can never succeed, so the
    // student is told now, in the server's own words, and nothing is written.
    if (isPermanentSyncError(error)) {
      throw new Error(
        syncErrorMessage(error, "The server wouldn't accept these cards. Nothing was saved.")
      );
    }

    // Otherwise: hold it locally and queue the whole import. The local rows
    // are what make the deck studiable on the spot; the operation is what gets
    // it home.
    const tempDeckId = `temp_deck_${Date.now()}`;
    const now = new Date().toISOString();
    const localDeck: Deck = {
      id: tempDeckId,
      name: deckName,
      description,
      user_id: userId,
      created_at: now,
      updated_at: now,
      card_count: cards.length,
    };
    const localCards = importedCardsToLocalFlashcards(
      cards,
      tempDeckId,
      (index) => `temp_card_import_${Date.now()}_${index}`
    ) as Flashcard[];

    await store.insertImportedDeckLocally(localDeck, localCards);
    try {
      await syncService.queueOperation('deck', tempDeckId, 'create', body as unknown as Record<string, unknown>, userId);
    } catch (queueError) {
      // Nothing to hand back to: the cards are on the device but nothing will
      // ever carry them home, and saying "queued" would be a lie.
      console.error('[importedDeck] Could not queue the import', queueError);
      throw new Error(
        "These cards are on this phone, but we couldn't line them up to save. Try again when you're online."
      );
    }
    return { kind: 'queued', count: cards.length, deckName, deckId: tempDeckId };
  }
}

/**
 * Replay a queued import. Called by the `deck` sync handler when the operation
 * carries cards — never for a plain deck create.
 *
 * @throws so the handler can classify the failure (transient → retry later,
 *   permanent → drop and tell the student).
 */
export async function replayQueuedImport(
  tempDeckId: string,
  body: DeckWithCardsRequest
): Promise<void> {
  const response = await createDeckWithCards(body);
  const deck = mapDeckFromApi(response.deck) as Deck | null;
  const saved = mapFlashcardsFromApi(
    (response.flashcards ?? response.cards ?? []) as unknown[]
  ) as Flashcard[];
  if (!deck?.id) throw new Error('The server did not return the saved deck.');
  await useFlashcardStore.getState().replaceImportedDeck(tempDeckId, deck, saved);
}
