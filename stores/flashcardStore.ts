/**
 * Web Flashcard Store
 * Manages decks, flashcards, and SRS review sessions
 * 
 * Note: This store provides state management for flashcards.
 * API calls should be made through the supabase service functions
 * and then state updated through the store methods.
 */
import { create } from 'zustand';
import type { PendingFlashcardReview } from '@lantern/shared/utils/offlineReview';
import { createPendingFlashcardReview, getCardsDue } from '@lantern/shared/utils';
import { Deck, Flashcard } from '../types';

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
const WEB_PENDING_REVIEWS_KEY = 'lantern_pending_flashcard_reviews';

function readJson<T>(key: string, fallback: T): T {
  try {
    const json = localStorage.getItem(key);
    if (!json) return fallback;
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/** In-flight optimistic grades — prevents fetchAllFlashcards from resurrecting stale due state. */
const pendingLocalReviews = new Map<string, Flashcard>();

function mergeCardsPreferPendingReviews(remoteCards: Flashcard[]): Flashcard[] {
  if (pendingLocalReviews.size === 0) return remoteCards;
  return remoteCards.map((card) => pendingLocalReviews.get(card.id) ?? card);
}

interface FlashcardState {
  // State
  decks: Deck[];
  flashcards: Flashcard[];
  dueCardsCount: number;
  isLoading: boolean;
  error: string | null;

  // offline-related IDs
  offlineDeckIds: string[];
  pendingFlashcardReviews: PendingFlashcardReview[];
  
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
  rememberPendingLocalReview: (flashcardId: string, card: Flashcard) => void;
  clearPendingLocalReview: (flashcardId: string) => void;
  
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
  queueFlashcardReview: (flashcardId: string, deckId: string, rating: PendingFlashcardReview['rating']) => void;
  removePendingReviews: (ids: string[]) => void;
  clearPendingReviews: () => void;
  setPendingFlashcardReviews: (reviews: PendingFlashcardReview[]) => void;
}

export const useFlashcardStore = create<FlashcardState>()((set, get) => ({
  // Initial State
  decks: [],
  flashcards: [],
  dueCardsCount: 0,
  isLoading: false,
  error: null,
  offlineDeckIds: [],
  pendingFlashcardReviews: [],
  
  // State Management - Decks
  // Every mutating action persists via saveToStorage() so offline users keep
  // their library across reloads (plain zustand has no selector subscriptions).
  setDecks: (decks) => {
    set({ decks: sanitizeDecks(decks) });
    get().saveToStorage();
  },

  updateDecks: (updater) => {
    set((state) => ({
      decks: sanitizeDecks(updater(state.decks)),
    }));
    get().saveToStorage();
  },

  addDeck: (deck) => {
    set((state) => ({
      decks: [...state.decks, deck],
    }));
    get().saveToStorage();
  },

  updateDeckInState: (deckId, updates) => {
    set((state) => ({
      decks: state.decks.map(d =>
        d.id === deckId ? { ...d, ...updates } : d
      ),
    }));
    get().saveToStorage();
  },

  removeDeck: (deckId) => {
    set((state) => ({
      decks: state.decks.filter(d => d.id !== deckId),
      flashcards: state.flashcards.filter(f => f.deckId !== deckId),
    }));
    get().calculateDueCardsCount();
    get().saveToStorage();
  },
  
  // State Management - Flashcards
  setFlashcards: (flashcards) => {
    const nextFlashcards = typeof flashcards === 'function'
      ? flashcards(get().flashcards)
      : flashcards;
    const merged = mergeCardsPreferPendingReviews(
      Array.isArray(nextFlashcards) ? nextFlashcards : []
    );

    set({ flashcards: merged });
    get().calculateDueCardsCount();
    get().saveToStorage();
  },

  updateFlashcards: (updater) => {
    set((state) => {
      const updated = updater(state.flashcards);
      return { flashcards: Array.isArray(updated) ? updated : state.flashcards };
    });
    get().calculateDueCardsCount();
    get().saveToStorage();
  },

  addFlashcard: (flashcard) => {
    set((state) => ({
      flashcards: [...state.flashcards, flashcard],
    }));
    get().calculateDueCardsCount();
    get().saveToStorage();
  },

  updateFlashcardInState: (flashcardId, updates) => {
    set((state) => ({
      flashcards: state.flashcards.map(f =>
        f.id === flashcardId ? { ...f, ...updates } : f
      ),
    }));
    get().calculateDueCardsCount();
    get().saveToStorage();
  },

  rememberPendingLocalReview: (flashcardId, card) => {
    pendingLocalReviews.set(flashcardId, card);
  },

  clearPendingLocalReview: (flashcardId) => {
    pendingLocalReviews.delete(flashcardId);
  },
  
  removeFlashcard: (flashcardId) => {
    pendingLocalReviews.delete(flashcardId);
    set((state) => ({
      flashcards: state.flashcards.filter(f => f.id !== flashcardId),
    }));
    get().calculateDueCardsCount();
    get().saveToStorage();
  },
  
  // SRS
  getDueCards: (deckId) => {
    const cards = get().flashcards;
    const scoped = deckId ? cards.filter((f) => f.deckId === deckId) : cards;
    return getCardsDue(scoped);
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
  
  reset: () => {
    pendingLocalReviews.clear();
    set({
      decks: [],
      flashcards: [],
      dueCardsCount: 0,
      isLoading: false,
      error: null,
      offlineDeckIds: [],
      pendingFlashcardReviews: [],
    });
    get().saveToStorage();
  },

  loadFromStorage: () => {
    try {
      const decks = readJson<Deck[]>(WEB_DECKS_KEY, []);
      const flashcards = readJson<Flashcard[]>(WEB_FLASHCARDS_KEY, []);
      const offlineDeckIds = readJson<string[]>(WEB_OFFLINE_KEY, []);
      const pendingFlashcardReviews = readJson<PendingFlashcardReview[]>(WEB_PENDING_REVIEWS_KEY, []);
      set({
        decks: sanitizeDecks(decks),
        flashcards: Array.isArray(flashcards) ? flashcards : [],
        offlineDeckIds: Array.isArray(offlineDeckIds) ? offlineDeckIds : [],
        pendingFlashcardReviews: Array.isArray(pendingFlashcardReviews) ? pendingFlashcardReviews : [],
      });
      get().calculateDueCardsCount();
    } catch (e) {
      console.warn('Could not load flashcard data from storage', e);
    }
  },

  saveToStorage: () => {
    const { decks, flashcards, offlineDeckIds, pendingFlashcardReviews } = get();
    try {
      localStorage.setItem(WEB_DECKS_KEY, JSON.stringify(decks));
      localStorage.setItem(WEB_FLASHCARDS_KEY, JSON.stringify(flashcards));
      localStorage.setItem(WEB_OFFLINE_KEY, JSON.stringify(offlineDeckIds));
      localStorage.setItem(WEB_PENDING_REVIEWS_KEY, JSON.stringify(pendingFlashcardReviews));
    } catch (e) {
      console.warn('Could not save flashcard data to storage', e);
    }
  },

  // offline helper implementations (web)
  loadOfflineFromStorage: () => {
    try {
      const offlineDeckIds = readJson<string[]>(WEB_OFFLINE_KEY, []);
      if (offlineDeckIds.length > 0) {
        set({ offlineDeckIds });
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
        localStorage.setItem(WEB_OFFLINE_KEY, JSON.stringify(newIds));
      } catch {}
      return { offlineDeckIds: newIds };
    });
  },
  unmarkDeckOffline: (deckId: string) => {
    set(state => {
      const newIds = state.offlineDeckIds.filter(id => id !== deckId);
      try {
        localStorage.setItem(WEB_OFFLINE_KEY, JSON.stringify(newIds));
      } catch {}
      return { offlineDeckIds: newIds };
    });
  },

  queueFlashcardReview: (flashcardId, deckId, rating) => {
    const entry = createPendingFlashcardReview(flashcardId, deckId, rating);
    set(state => {
      const pendingFlashcardReviews = [...state.pendingFlashcardReviews, entry];
      try {
        localStorage.setItem(WEB_PENDING_REVIEWS_KEY, JSON.stringify(pendingFlashcardReviews));
      } catch {}
      return { pendingFlashcardReviews };
    });
  },

  removePendingReviews: (ids) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    set(state => {
      const pendingFlashcardReviews = state.pendingFlashcardReviews.filter(r => !idSet.has(r.id));
      try {
        localStorage.setItem(WEB_PENDING_REVIEWS_KEY, JSON.stringify(pendingFlashcardReviews));
      } catch {}
      return { pendingFlashcardReviews };
    });
  },

  clearPendingReviews: () => {
    try {
      localStorage.removeItem(WEB_PENDING_REVIEWS_KEY);
    } catch {}
    set({ pendingFlashcardReviews: [] });
  },

  setPendingFlashcardReviews: (reviews) => {
    try {
      localStorage.setItem(WEB_PENDING_REVIEWS_KEY, JSON.stringify(reviews));
    } catch {}
    set({ pendingFlashcardReviews: reviews });
  },
}));
