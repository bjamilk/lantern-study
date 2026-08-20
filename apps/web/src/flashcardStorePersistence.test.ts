/**
 * Flashcard store persistence: every deck/card mutation must land in
 * localStorage so an offline user's library survives a reload. (The old
 * selector-style subscriptions never fired — plain zustand ignores them.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The web suite runs in node; the store only needs the getItem/setItem/
// removeItem surface, so a tiny in-memory stand-in beats a DOM environment.
const memoryStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
vi.stubGlobal('localStorage', memoryStorage);

import { useFlashcardStore } from '../../../stores/flashcardStore';

const DECKS_KEY = 'lantern_decks';
const FLASHCARDS_KEY = 'lantern_flashcards';
const PENDING_KEY = 'lantern_pending_flashcard_reviews';

const deck = (id: string, name = `Deck ${id}`): any => ({
  id,
  name,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const card = (id: string, deckId: string): any => ({
  id,
  deckId,
  type: 'BASIC',
  front: `front ${id}`,
  back: `back ${id}`,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const readKey = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null');

/** Wipe memory without persisting, as a freshly loaded page would start. */
const clearInMemoryState = () => {
  useFlashcardStore.setState({
    decks: [],
    flashcards: [],
    dueCardsCount: 0,
    offlineDeckIds: [],
    pendingFlashcardReviews: [],
  });
};

beforeEach(() => {
  clearInMemoryState();
  localStorage.clear();
});

describe('flashcard store persistence', () => {
  it('persists decks and flashcards on every mutating action', () => {
    const s = useFlashcardStore.getState();

    s.setDecks([deck('d1')]);
    expect(readKey(DECKS_KEY)).toHaveLength(1);

    s.addDeck(deck('d2'));
    expect(readKey(DECKS_KEY).map((d: any) => d.id)).toEqual(['d1', 'd2']);

    s.updateDeckInState('d2', { name: 'renamed' });
    expect(readKey(DECKS_KEY)[1].name).toBe('renamed');

    s.addFlashcard(card('c1', 'd1'));
    s.addFlashcard(card('c2', 'd2'));
    expect(readKey(FLASHCARDS_KEY)).toHaveLength(2);

    s.updateFlashcardInState('c1', { front: 'edited' });
    expect(readKey(FLASHCARDS_KEY)[0].front).toBe('edited');

    s.removeFlashcard('c2');
    expect(readKey(FLASHCARDS_KEY).map((c: any) => c.id)).toEqual(['c1']);

    // removeDeck drops the deck and its cards from storage too
    s.removeDeck('d1');
    expect(readKey(DECKS_KEY).map((d: any) => d.id)).toEqual(['d2']);
    expect(readKey(FLASHCARDS_KEY)).toEqual([]);
  });

  it('persists functional updates (setFlashcards / updateFlashcards / updateDecks)', () => {
    const s = useFlashcardStore.getState();
    s.setFlashcards([card('c1', 'd1')]);
    expect(readKey(FLASHCARDS_KEY)).toHaveLength(1);

    s.updateFlashcards(prev => prev.map(c => ({ ...c, back: 'new back' })));
    expect(readKey(FLASHCARDS_KEY)[0].back).toBe('new back');

    s.setDecks([deck('d1')]);
    s.updateDecks(prev => prev.filter(d => d.id !== 'd1'));
    expect(readKey(DECKS_KEY)).toEqual([]);
  });

  it('round-trips through a simulated reload', () => {
    const s = useFlashcardStore.getState();
    s.setDecks([deck('d1'), deck('d2')]);
    s.setFlashcards([card('c1', 'd1'), card('c2', 'd2')]);
    s.queueFlashcardReview('c1', 'd1', 'good');

    // A reload starts with empty in-memory state and hydrates from storage.
    clearInMemoryState();
    expect(useFlashcardStore.getState().decks).toEqual([]);

    useFlashcardStore.getState().loadFromStorage();
    const restored = useFlashcardStore.getState();
    expect(restored.decks.map(d => d.id)).toEqual(['d1', 'd2']);
    expect(restored.flashcards.map(c => c.id)).toEqual(['c1', 'c2']);
    expect(restored.pendingFlashcardReviews).toHaveLength(1);
    expect(restored.pendingFlashcardReviews[0]?.flashcardId).toBe('c1');
  });

  it('reset clears persisted data as well as memory', () => {
    const s = useFlashcardStore.getState();
    s.setDecks([deck('d1')]);
    s.setFlashcards([card('c1', 'd1')]);

    useFlashcardStore.getState().reset();
    expect(readKey(DECKS_KEY)).toEqual([]);
    expect(readKey(FLASHCARDS_KEY)).toEqual([]);
    expect(readKey(PENDING_KEY)).toEqual([]);
  });
});
