/**
 * Web Flashcard Store
 * Manages decks, flashcards, and SRS review sessions
 * 
 * Note: This store provides state management for flashcards.
 * API calls should be made through the supabase service functions
 * and then state updated through the store methods.
 */
import { create } from 'zustand';
import { Deck, Flashcard, SrsData } from '../types';

function isValidDeck(deck: Deck | null | undefined): deck is Deck {
  return Boolean(deck && typeof deck.id === 'string' && deck.id && typeof deck.name === 'string');
}

function sanitizeDecks(decks: Deck[]): Deck[] {
  return decks.filter(isValidDeck);
}

// storage keys mirror mobile keys for simplicity
const WEB_DECKS_KEY = 'lantern_decks';
const WEB_FLASHCARDS_KEY = 'lantern_flashcards';
const WEB_OFFLINE_KEY = 'lantern_offline_decks';

interface FlashcardState {
  // State
  decks: Deck[];
  flashcards: Flashcard[];
  dueCardsCount: number;
  isLoading: boolean;
  error: string | null;

  // offline-related IDs
  offlineDeckIds: string[];
  
  // Actions - State Management
  setDecks: (decks: Deck[]) => void;
  updateDecks: (updater: (prev: Deck[]) => Deck[]) => void;
  addDeck: (deck: Deck) => void;
  updateDeckInState: (deckId: string, updates: Partial<Deck>) => void;
  removeDeck: (deckId: string) => void;
  
  setFlashcards: (flashcards: Flashcard[] | ((prev: Flashcard[]) => Flashcard[])) => void;
  updateFlashcards: (updater: (prev: Flashcard[]) => Flashcard[]) => void;
  addFlashcard: (flashcard: Flashcard) => void;
  updateFlashcardInState: (flashcardId: string, updates: Partial<Flashcard>) => void;
  removeFlashcard: (flashcardId: string) => void;
  
  // SRS
  getDueCards: (deckId?: string) => Flashcard[];
  calculateDueCardsCount: () => void;
  setDueCardsCount: (count: number) => void;
  
  // Utility
  getFlashcardsByDeck: (deckId: string) => Flashcard[];
  getDeckById: (deckId: string) => Deck | undefined;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  reset: () => void;
  
  // persistence helpers
  loadFromStorage: () => void;
  saveToStorage: () => void;
  
  // offline helpers
  isDeckOffline: (deckId: string) => boolean;
  markDeckOffline: (deckId: string) => void;
  unmarkDeckOffline: (deckId: string) => void;
  loadOfflineFromStorage: () => void;
}

export const useFlashcardStore = create<FlashcardState>()((set, get) => ({
  // Initial State
  decks: [],
  flashcards: [],
  dueCardsCount: 0,
  isLoading: false,
  error: null,
  offlineDeckIds: [],
  
  // State Management - Decks
  setDecks: (decks) => set({ decks: sanitizeDecks(decks) }),
  
  updateDecks: (updater) => set((state) => ({
    decks: sanitizeDecks(updater(state.decks)),
  })),
  
  addDeck: (deck) => set((state) => ({
    decks: [...state.decks, deck],
  })),
  
  updateDeckInState: (deckId, updates) => set((state) => ({
    decks: state.decks.map(d => 
      d.id === deckId ? { ...d, ...updates } : d
    ),
  })),
  
  removeDeck: (deckId) => {
    set((state) => ({
      decks: state.decks.filter(d => d.id !== deckId),
      flashcards: state.flashcards.filter(f => f.deckId !== deckId),
    }));
    get().calculateDueCardsCount();
  },
  
  // State Management - Flashcards
  setFlashcards: (flashcards) => {
    const nextFlashcards = typeof flashcards === 'function'
      ? flashcards(get().flashcards)
      : flashcards;

    set({ flashcards: Array.isArray(nextFlashcards) ? nextFlashcards : [] });
    get().calculateDueCardsCount();
  },
  
  updateFlashcards: (updater) => {
    set((state) => {
      const updated = updater(state.flashcards);
      return { flashcards: Array.isArray(updated) ? updated : state.flashcards };
    });
    get().calculateDueCardsCount();
  },
  
  addFlashcard: (flashcard) => {
    set((state) => ({
      flashcards: [...state.flashcards, flashcard],
    }));
    get().calculateDueCardsCount();
  },
  
  updateFlashcardInState: (flashcardId, updates) => set((state) => ({
    flashcards: state.flashcards.map(f =>
      f.id === flashcardId ? { ...f, ...updates } : f
    ),
  })),
  
  removeFlashcard: (flashcardId) => {
    set((state) => ({
      flashcards: state.flashcards.filter(f => f.id !== flashcardId),
    }));
    get().calculateDueCardsCount();
  },
  
  // SRS
  getDueCards: (deckId) => {
    const now = new Date();
    return get().flashcards.filter(f => {
      if (deckId && f.deckId !== deckId) return false;
      if (!f.srsData?.nextReviewDate) return true;
      return new Date(f.srsData.nextReviewDate) <= now;
    });
  },
  
  setDueCardsCount: (count) => set({ dueCardsCount: count }),
  
  calculateDueCardsCount: () => {
    const dueCards = get().getDueCards();
    set({ dueCardsCount: dueCards.length });
  },
  
  // Utility
  getFlashcardsByDeck: (deckId) => {
    return get().flashcards.filter(f => f.deckId === deckId);
  },
  
  getDeckById: (deckId) => {
    return get().decks.find(d => d.id === deckId);
  },
  
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  
  reset: () => set({
    decks: [],
    flashcards: [],
    dueCardsCount: 0,
    isLoading: false,
    error: null,
    offlineDeckIds: [],
  }),

  // offline helper implementations (web)
  loadOfflineFromStorage: () => {
    try {
      const json = localStorage.getItem('lantern_offline_decks');
      if (json) {
        set({ offlineDeckIds: JSON.parse(json) });
      }
    } catch (e) {
      console.warn('Could not load offline decks from storage', e);
    }
  },
  isDeckOffline: (deckId: string) => {
    return get().offlineDeckIds.includes(deckId);
  },
  markDeckOffline: (deckId: string) => {
    set(state => {
      const newIds = Array.from(new Set([...state.offlineDeckIds, deckId]));
      try {
        localStorage.setItem('lantern_offline_decks', JSON.stringify(newIds));
      } catch {}
      return { offlineDeckIds: newIds };
    });
  },
  unmarkDeckOffline: (deckId: string) => {
    set(state => {
      const newIds = state.offlineDeckIds.filter(id => id !== deckId);
      try {
        localStorage.setItem('lantern_offline_decks', JSON.stringify(newIds));
      } catch {}
      return { offlineDeckIds: newIds };
    });
  },
}));

// subscribe to state changes to persist data to localStorage
const webStore = useFlashcardStore;
webStore.subscribe(state => state.decks, decks => {
  try { localStorage.setItem(WEB_DECKS_KEY, JSON.stringify(decks)); } catch {}
});
webStore.subscribe(state => state.flashcards, flashcards => {
  try { localStorage.setItem(WEB_FLASHCARDS_KEY, JSON.stringify(flashcards)); } catch {}
});
