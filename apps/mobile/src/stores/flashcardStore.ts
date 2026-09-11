/**
 * Flashcard Store
 * Manages decks and flashcard state with offline-first sync
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlashcardType, type Flashcard as SharedFlashcard, type OcclusionData } from '@lantern/shared';
import { mapFlashcardFromApi, mapFlashcardsFromApi } from '@lantern/shared';
import { applyLocalFlashcardReview } from '@lantern/shared/utils/offlineReview';
import * as api from '../services/api';
import { syncService } from '../services/syncService';
import { isSyncOpOrphanedByDeckDelete } from './jobsCore';
import { trackDeckCreated, trackFirstCardAdded } from '../services/productAnalytics';
import { useSettingsStore } from './settingsStore';
import { getDeckCardStats, groupFlashcardsByDeck } from '../utils/flashcardHelpers';

export interface Deck {
  id: string;
  name: string;
  description?: string;
  user_id?: string;
  is_shared?: boolean;
  /** Academic archive: decks.course_id (raw rows come back snake_case). */
  course_id?: string | null;
  study_set_id?: string | null;
  /** Syllabus topic inside `course_id`; absent until 20260826120000 is applied. */
  topic_id?: string | null;
  created_at?: string;
  updated_at?: string;
  card_count?: number;
  due_count?: number;
  new_count?: number;
  mastered_count?: number;
}

export type Flashcard = SharedFlashcard;

// Storage keys
const DECKS_STORAGE_KEY = 'lantern_decks';
const FLASHCARDS_STORAGE_KEY = 'lantern_flashcards';
// keep track of which decks have been explicitly downloaded for offline use
const OFFLINE_DECKS_KEY = 'lantern_offline_decks';

// Debounce AsyncStorage writes during rapid SRS grading
let saveStorageTimer: ReturnType<typeof setTimeout> | null = null;
/** Keep local SRS updates while an API review/refetch is in flight so due counts don't regress. */
const pendingLocalReviews = new Map<string, Flashcard>();

function scheduleSaveToStorage(saveFn: () => Promise<void>) {
  if (saveStorageTimer) clearTimeout(saveStorageTimer);
  saveStorageTimer = setTimeout(() => {
    saveStorageTimer = null;
    void saveFn();
  }, 400);
}

function flushScheduledSave(saveFn: () => Promise<void>) {
  if (saveStorageTimer) {
    clearTimeout(saveStorageTimer);
    saveStorageTimer = null;
  }
  void saveFn();
}

function mergeCardsPreferPendingReviews(remoteCards: Flashcard[]): Flashcard[] {
  if (pendingLocalReviews.size === 0) return remoteCards;
  return remoteCards.map(card => pendingLocalReviews.get(card.id) ?? card);
}

function applyPendingToFlashcardMap(
  map: Record<string, Flashcard[]>
): Record<string, Flashcard[]> {
  if (pendingLocalReviews.size === 0) return map;
  const next: Record<string, Flashcard[]> = {};
  for (const [deckId, cards] of Object.entries(map)) {
    next[deckId] = cards.map(card => pendingLocalReviews.get(card.id) ?? card);
  }
  return next;
}

// Demo mode flag - matches authStore
const DEMO_MODE = false;

function isValidDeck(deck: Deck | null | undefined): deck is Deck {
  return Boolean(deck && typeof deck.id === 'string' && deck.id && typeof deck.name === 'string');
}

function sanitizeDecks(decks: Deck[]): Deck[] {
  return decks.filter(isValidDeck);
}

function mapDeckFromApi(data: any): Deck | null {
  if (!data || typeof data.id !== 'string' || !data.id) return null;
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    user_id: data.user_id,
    is_shared: data.is_shared ?? data.isShared,
    course_id: data.course_id ?? data.courseId ?? null,
    study_set_id: data.study_set_id ?? data.studySetId ?? null,
    // Dropping this made a deck's topic vanish from the local row on every
    // fetchDecks, so the picker read empty after any refresh.
    topic_id: data.topic_id ?? data.topicId ?? null,
    created_at: data.created_at,
    updated_at: data.updated_at,
    card_count: data.card_count ?? data.cardCount,
  };
}

function enrichDecksWithStats(decks: Deck[], flashcards: Record<string, Flashcard[]>): Deck[] {
  return decks.map(deck => {
    const stats = getDeckCardStats(deck.id, flashcards);
    const cachedTotal = stats.total;
    return {
      ...deck,
      card_count: cachedTotal > 0 ? cachedTotal : (deck.card_count ?? 0),
      due_count: stats.dueCards,
      new_count: stats.newCards,
      mastered_count: stats.mastered,
    };
  });
}

function unwrapFlashcardResponse(response: unknown): any[] {
  if (Array.isArray(response)) return response;
  if (response && typeof response === 'object' && Array.isArray((response as { data?: unknown }).data)) {
    return (response as { data: any[] }).data;
  }
  return [];
}

async function fetchFlashcardPages(deckId?: string): Promise<Flashcard[]> {
  if (deckId) {
    const response = await api.fetchFlashcards(deckId);
    return mapFlashcardsFromApi(unwrapFlashcardResponse(response));
  }

  const collected: any[] = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const response = await api.fetchFlashcards(undefined, { page, limit });
    const batch = unwrapFlashcardResponse(response);
    collected.push(...batch);
    if (batch.length < limit) break;
    page += 1;
  }

  return mapFlashcardsFromApi(collected);
}

// Mock data for demo mode
const DEMO_DECKS: Deck[] = [
  {
    id: 'demo-deck-1',
    name: 'Biology 101',
    description: 'Cell structure, genetics, and evolution',
    user_id: 'demo-user-123',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    card_count: 45,
  },
  {
    id: 'demo-deck-2',
    name: 'Chemistry Fundamentals',
    description: 'Atomic structure and chemical reactions',
    user_id: 'demo-user-123',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    card_count: 62,
  },
  {
    id: 'demo-deck-3',
    name: 'Physics Mechanics',
    description: "Newton's laws, motion, and energy",
    user_id: 'demo-user-123',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    card_count: 38,
  },
  {
    id: 'demo-deck-4',
    name: 'Spanish Vocabulary',
    description: 'Common words and phrases',
    user_id: 'demo-user-123',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    card_count: 120,
  },
];

const DEMO_FLASHCARDS: Record<string, Array<{
  id: string;
  deck_id: string;
  type: 'BASIC' | 'CLOZE';
  front?: string;
  back?: string;
  cloze_text?: string;
  created_at: string;
  updated_at: string;
}>> = {
  'demo-deck-1': [
    { id: 'card-1', deck_id: 'demo-deck-1', type: 'BASIC', front: 'What is the powerhouse of the cell?', back: 'Mitochondria', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'card-2', deck_id: 'demo-deck-1', type: 'BASIC', front: 'What is DNA?', back: 'Deoxyribonucleic acid - carries genetic information', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'card-3', deck_id: 'demo-deck-1', type: 'BASIC', front: 'What is photosynthesis?', back: 'Process by which plants convert light to energy', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ],
  'demo-deck-2': [
    { id: 'card-4', deck_id: 'demo-deck-2', type: 'BASIC', front: 'What is the atomic number?', back: 'Number of protons in an atom', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'card-5', deck_id: 'demo-deck-2', type: 'BASIC', front: 'What is a covalent bond?', back: 'A bond formed by sharing electrons', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ],
  'demo-deck-3': [
    { id: 'card-6', deck_id: 'demo-deck-3', type: 'BASIC', front: "Newton's First Law", back: 'An object at rest stays at rest unless acted upon', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'card-7', deck_id: 'demo-deck-3', type: 'BASIC', front: 'What is kinetic energy?', back: 'Energy of motion: KE = ½mv²', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ],
  'demo-deck-4': [
    { id: 'card-8', deck_id: 'demo-deck-4', type: 'BASIC', front: 'Hello', back: 'Hola', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'card-9', deck_id: 'demo-deck-4', type: 'BASIC', front: 'Thank you', back: 'Gracias', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'card-10', deck_id: 'demo-deck-4', type: 'BASIC', front: 'Good morning', back: 'Buenos días', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ],
};

interface FlashcardState {
  decks: Deck[];
  flashcards: Record<string, Flashcard[]>;
  currentDeck: Deck | null;
  isLoading: boolean;
  error: string | null;
  // explicitly-downloaded deck ids, used to drive manual offline mode
  offlineDeckIds: string[];
  /**
   * Cards whose queued write the server refused outright, by card id → the
   * reason it gave. A refused write is dropped from the sync queue (it can
   * only ever be refused again), so this is the only remaining record that
   * the card is local-only.
   */
  cardSyncFailures: Record<string, string>;
  
  // Actions
  // No course/topic filter: decks load whole into a shared store (Dashboard, the
  // deck detail screen, offline all read it) and FlashcardsScreen narrows by the
  // Library filter client-side in `filteredDecks`. A server-side filter here
  // would only have been a dead second path with no caller.
  fetchDecks: (userId: string) => Promise<void>;
  fetchFlashcards: (deckId: string) => Promise<void>;
  syncAllFlashcards: (userId: string) => Promise<void>;
  setCurrentDeck: (deck: Deck | null) => void;
  createDeck: (
    name: string,
    description: string | undefined,
    userId: string,
    options?: { courseId?: string | null; topicId?: string | null }
  ) => Promise<Deck>;
  updateDeck: (
    deckId: string,
    updates: { name?: string; description?: string; courseId?: string | null; topicId?: string | null },
    userId: string
  ) => Promise<void>;
  deleteDeck: (deckId: string, userId: string) => Promise<void>;
  /**
   * Put a deck the SERVER has already written into the local store.
   *
   * The counterpart to `createDeck`, for material that is saved in one whole
   * request (a generation). It is deliberately not optimistic and queues
   * nothing: the rows it is given exist server-side, so there is no write to
   * replay and no `temp_` id to rebind. Every optimistic path here ends in a
   * `syncService.queueOperation`, and that queued create is what survived the
   * rollback of a failed generation and minted the empty "From: …" decks.
   */
  insertSavedDeck: (deck: Deck, cards: Flashcard[]) => Promise<void>;
  /**
   * A deck IMPORTED offline: held whole on this device, with its cards, until
   * one queued `deck` create can write both together.
   *
   * Not `createDeck` + `createFlashcard` in a loop. That pair queues a `deck`
   * create whose server id is never bound back, plus one `flashcard` create
   * per card aimed at the `temp_deck_…` id — writes the server refuses every
   * time and `isDoomedTempDeckOp` purges on the next launch. A 200-card import
   * down that path shows 200 cards, syncs an empty deck, and loses all 200.
   * The queued operation this writes carries the cards with it, and the deck
   * handler in services/syncService.ts sends the whole thing to
   * `POST /decks/with-cards`.
   */
  insertImportedDeckLocally: (deck: Deck, cards: Flashcard[]) => Promise<void>;
  /**
   * The queued import landed: swap the local `temp_` deck and its cards for
   * the rows the server issued, keeping the deck in place in the list.
   */
  replaceImportedDeck: (tempDeckId: string, deck: Deck, cards: Flashcard[]) => Promise<void>;
  /**
   * The server has permanently refused this card's queued write.
   *
   * Recorded rather than retried: the operation is dropped from the queue by
   * the sync handler, and this is what is left to tell the student with.
   */
  markCardSyncFailed: (cardId: string, message: string) => void;
  createFlashcard: (data: {
    deckId: string;
    type: FlashcardType;
    front?: string;
    back?: string;
    clozeText?: string;
    tags?: string[];
    imageUrl?: string;
    occlusionData?: OcclusionData;
    userId: string;
  }) => Promise<Flashcard>;
  updateFlashcard: (flashcardId: string, deckId: string, updates: any, userId: string) => Promise<void>;
  reviewFlashcard: (
    flashcardId: string,
    deckId: string,
    rating: 'again' | 'hard' | 'good' | 'easy',
    userId: string
  ) => Promise<void>;
  deleteFlashcard: (flashcardId: string, deckId: string, userId: string) => Promise<void>;
  clearError: () => void;
  // Local storage helpers
  loadFromStorage: () => Promise<void>;
  saveToStorage: () => Promise<void>;
  
  // offline download helpers
  isDeckOffline: (deckId: string) => boolean;
  markDeckOffline: (deckId: string, userId: string) => Promise<void>;
  unmarkDeckOffline: (deckId: string) => Promise<void>;
  refreshOfflineDecks: (userId: string) => Promise<void>;
}

export const useFlashcardStore = create<FlashcardState>((set, get) => ({
  decks: [],
  flashcards: {},
  currentDeck: null,
  isLoading: false,
  error: null,
  offlineDeckIds: [],
  cardSyncFailures: {},

  // Load cached data from AsyncStorage
  loadFromStorage: async () => {
    try {
      const [decksJson, flashcardsJson, offlineJson] = await Promise.all([
        AsyncStorage.getItem(DECKS_STORAGE_KEY),
        AsyncStorage.getItem(FLASHCARDS_STORAGE_KEY),
        AsyncStorage.getItem(OFFLINE_DECKS_KEY),
      ]);
      
      if (decksJson) {
        set({ decks: sanitizeDecks(JSON.parse(decksJson)) });
      }
      if (flashcardsJson) {
        const parsed = JSON.parse(flashcardsJson) as Record<string, any[]>;
        const normalized: Record<string, Flashcard[]> = {};
        for (const [key, cards] of Object.entries(parsed)) {
          normalized[key] = mapFlashcardsFromApi(Array.isArray(cards) ? cards : []);
        }
        set({ flashcards: applyPendingToFlashcardMap(normalized) });
      }
      if (offlineJson) {
        set({ offlineDeckIds: JSON.parse(offlineJson) });
      }
    } catch (error) {
      console.error('Failed to load from storage:', error);
    }
  },
  
  // Save current state to AsyncStorage
  saveToStorage: async () => {
    try {
      const { decks, flashcards, offlineDeckIds } = get();
      await Promise.all([
        AsyncStorage.setItem(DECKS_STORAGE_KEY, JSON.stringify(decks)),
        AsyncStorage.setItem(FLASHCARDS_STORAGE_KEY, JSON.stringify(flashcards)),
        AsyncStorage.setItem(OFFLINE_DECKS_KEY, JSON.stringify(offlineDeckIds)),
      ]);
    } catch (error) {
      console.error('Failed to save to storage:', error);
    }
  },
  
  fetchDecks: async (userId: string) => {
    try {
      set({ isLoading: true, error: null });
      // Don't clobber in-memory SRS updates with stale disk cache when decks
      // are already loaded (common after exiting a review session early).
      if (get().decks.length === 0) {
        await get().loadFromStorage();
      }

      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        set({ decks: DEMO_DECKS, isLoading: false });
        return;
      }

      try {
        const rawDecks = await api.fetchDecks(userId, { includeShared: true });
        const decks = enrichDecksWithStats(
          sanitizeDecks((rawDecks || []).map(mapDeckFromApi).filter((d): d is Deck => d !== null)),
          get().flashcards
        );
        set({ decks, isLoading: false, error: null });
        await get().saveToStorage();
        // Await sync so due/new counts match the API (and web) before UI settles
        await get().syncAllFlashcards(userId);
      } catch (apiError: any) {
        console.warn('Failed to fetch decks from API, using cached:', apiError);
        set({
          isLoading: false,
          error: apiError?.message || 'Could not load decks. Showing cached data.',
        });
      }
    } catch (error: any) {
      console.error('Failed to fetch decks:', error);
      set({ error: error.message, isLoading: false });
    }
  },

  fetchFlashcards: async (deckId: string) => {
    try {
      const hasCached = (get().flashcards[deckId] || []).length > 0;
      if (!hasCached) {
        set({ isLoading: true, error: null });
        await get().loadFromStorage();
      } else {
        set({ error: null });
        // Avoid reloading stale storage over in-memory SRS updates mid-session.
      }

      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 200));
        const demoCards = mapFlashcardsFromApi(
          (DEMO_FLASHCARDS[deckId] || []).map(card => ({
            ...card,
            deck_id: card.deck_id,
          }))
        );
        set(state => ({
          flashcards: { ...state.flashcards, [deckId]: demoCards },
          decks: enrichDecksWithStats(state.decks, {
            ...state.flashcards,
            [deckId]: demoCards,
          }),
          isLoading: false,
        }));
        return;
      }

      try {
        const cards = mergeCardsPreferPendingReviews(await fetchFlashcardPages(deckId));
        set(state => {
          const flashcards = { ...state.flashcards, [deckId]: cards };
          return {
            flashcards,
            decks: enrichDecksWithStats(state.decks, flashcards),
            isLoading: false,
            error: null,
          };
        });
        await get().saveToStorage();
      } catch (apiError: any) {
        console.warn('Failed to fetch flashcards from API:', apiError);
        const cached = get().flashcards[deckId] || [];
        set({
          isLoading: false,
          error: cached.length
            ? `${apiError?.message || 'Could not refresh cards.'} Showing cached cards.`
            : apiError?.message || 'Could not load flashcards for this deck.',
        });
      }
    } catch (error: any) {
      console.error('Failed to fetch flashcards:', error);
      set({ error: error.message, isLoading: false });
    }
  },

  syncAllFlashcards: async (_userId: string) => {
    if (DEMO_MODE) return;

    try {
      const cards = mergeCardsPreferPendingReviews(await fetchFlashcardPages());
      // Full replace (not merge) so deleted cards/decks cannot inflate due counts.
      const grouped = groupFlashcardsByDeck(cards);
      set(state => ({
        flashcards: grouped,
        decks: enrichDecksWithStats(state.decks, grouped),
        error: null,
      }));
      await get().saveToStorage();
    } catch (apiError: any) {
      console.warn('Failed to sync all flashcards:', apiError);
      set(state => ({
        error: state.error || apiError?.message || 'Could not sync flashcard data.',
      }));
    }
  },
  
  setCurrentDeck: (deck: Deck | null) => {
    set({ currentDeck: deck });
  },
  
  createDeck: async (name: string, description: string | undefined, userId: string, options) => {
    const courseId = options?.courseId ?? null;
    // A topic without its course is the one state the server refuses.
    const topicId = courseId ? options?.topicId ?? null : null;
    // Optimistic local ID
    const tempId = `temp_deck_${Date.now()}`;
    const tempDeck: Deck = {
      id: tempId,
      name,
      description,
      user_id: userId,
      course_id: courseId,
      topic_id: topicId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      card_count: 0,
    };

    // Optimistic update
    set(state => ({
      decks: [...state.decks, tempDeck],
    }));
    await get().saveToStorage();

    // Carried on the create itself so the online POST and the queued offline
    // create both file the deck, with no follow-up updateDeck.
    const payload = courseId
      ? { name, description, courseId, ...(topicId ? { topicId } : {}) }
      : { name, description };
    try {
      // Try API call
      const created = await api.createDeck(userId, payload);
      const mapped = mapDeckFromApi(created);
      const deck = mapped ?? tempDeck;

      set(state => ({
        decks: state.decks.map(d => (d.id === tempId ? deck : d)),
      }));
      await get().saveToStorage();
      trackDeckCreated(deck.id);
      return deck;
    } catch (error: any) {
      console.error('Failed to create deck on server:', error);

      // Queue for later sync
      await syncService.queueOperation('deck', tempId, 'create', payload, userId);
      trackDeckCreated(tempId);

      // Return temp deck for now
      return tempDeck;
    }
  },

  /**
   * A deck the server has already written, dropped straight into the store.
   *
   * No optimistic row, no `temp_` id, no queued operation — the cards came
   * back from the API with ids, so there is nothing left to sync. This is the
   * whole point of the one-request save: what the student sees in the library
   * is what the server holds, or the save failed and they see nothing.
   */
  insertSavedDeck: async (deck: Deck, cards: Flashcard[]) => {
    const isNewDeck = !get().decks.some(d => d.id === deck.id);
    set(state => {
      // Merged, not replaced: a generation can be saved INTO a deck the
      // student already has, and its existing cards are not this run's to drop.
      const byId = new Map((state.flashcards[deck.id] || []).map(c => [c.id, c]));
      for (const card of cards) byId.set(card.id, card);
      const flashcards = { ...state.flashcards, [deck.id]: Array.from(byId.values()) };
      const decks = state.decks.some(d => d.id === deck.id)
        ? state.decks.map(d => (d.id === deck.id ? { ...d, ...deck } : d))
        : [...state.decks, deck];
      return { flashcards, decks: enrichDecksWithStats(decks, flashcards) };
    });
    await get().saveToStorage();
    if (isNewDeck) {
      trackDeckCreated(deck.id);
      if (cards.length > 0) trackFirstCardAdded(deck.id);
    }
  },

  insertImportedDeckLocally: async (deck: Deck, cards: Flashcard[]) => {
    set(state => {
      const flashcards = { ...state.flashcards, [deck.id]: cards };
      const decks = state.decks.some(d => d.id === deck.id)
        ? state.decks.map(d => (d.id === deck.id ? { ...d, ...deck } : d))
        : [...state.decks, deck];
      return { flashcards, decks: enrichDecksWithStats(decks, flashcards) };
    });
    await get().saveToStorage();
    trackDeckCreated(deck.id);
    if (cards.length > 0) trackFirstCardAdded(deck.id);
  },

  replaceImportedDeck: async (tempDeckId: string, deck: Deck, cards: Flashcard[]) => {
    set(state => {
      const { [tempDeckId]: _dropped, ...rest } = state.flashcards;
      // Merged, not replaced: the student may have added cards to the deck by
      // hand while it was still local, and those are not this import's to drop.
      const byId = new Map((rest[deck.id] || []).map(c => [c.id, c]));
      for (const card of cards) byId.set(card.id, card);
      const flashcards = { ...rest, [deck.id]: Array.from(byId.values()) };
      const withoutTemp = state.decks.filter(d => d.id !== tempDeckId);
      const decks = withoutTemp.some(d => d.id === deck.id)
        ? withoutTemp.map(d => (d.id === deck.id ? { ...d, ...deck } : d))
        : [...withoutTemp, deck];
      return {
        flashcards,
        decks: enrichDecksWithStats(decks, flashcards),
        currentDeck: state.currentDeck?.id === tempDeckId ? deck : state.currentDeck,
      };
    });
    await get().saveToStorage();
  },

  markCardSyncFailed: (cardId: string, message: string) => {
    set(state => ({
      cardSyncFailures: { ...state.cardSyncFailures, [cardId]: message },
      // Surfaced through the same field every other write failure uses, so
      // the student is told once rather than never.
      error: message,
    }));
  },

  updateDeck: async (deckId, updates, userId) => {
    // Store previous state for rollback
    const previousDecks = get().decks;

    // Local rows keep the raw column names; the API payload uses camelCase.
    const { courseId, topicId, ...rest } = updates;
    const localPatch: Partial<Deck> = {
      ...rest,
      ...(courseId === undefined ? {} : { course_id: courseId }),
      ...(topicId === undefined ? {} : { topic_id: topicId }),
    };
    // Optimistic update
    set(state => ({
      decks: state.decks.map(d => d.id === deckId ? { ...d, ...localPatch, updated_at: new Date().toISOString() } : d),
      currentDeck: state.currentDeck?.id === deckId
        ? { ...state.currentDeck, ...localPatch, updated_at: new Date().toISOString() }
        : state.currentDeck,
    }));
    await get().saveToStorage();

    try {
      await api.updateDeck(deckId, updates);
    } catch (error: any) {
      console.error('Failed to update deck on server:', error);
      
      // Queue for later sync (don't rollback - keep local changes)
      await syncService.queueOperation('deck', deckId, 'update', updates, userId);
    }
  },
  
  deleteDeck: async (deckId: string, userId: string) => {
    // Store previous state for rollback
    const previousDecks = get().decks;
    const previousFlashcards = get().flashcards;
    
    // Optimistic delete
    set(state => ({
      decks: state.decks.filter(d => d.id !== deckId),
      flashcards: Object.fromEntries(
        Object.entries(state.flashcards).filter(([key]) => key !== deckId)
      ),
      currentDeck: state.currentDeck?.id === deckId ? null : state.currentDeck,
    }));
    await get().saveToStorage();
    
    // Nothing queued for this deck may replay now: its own offline `create`
    // would mint an EMPTY copy of it on the server after the delete, and the
    // card creates aimed at it would fail against an id that never existed.
    await syncService
      .removeQueuedOperations((op) => isSyncOpOrphanedByDeckDelete(op, deckId))
      .catch(() => {});

    // A deck the server never issued an id for has nothing to delete there.
    if (deckId.startsWith('temp_')) return;

    try {
      await api.deleteDeck(deckId);
    } catch (error: any) {
      console.error('Failed to delete deck on server:', error);

      // Queue for later sync
      await syncService.queueOperation('deck', deckId, 'delete', {}, userId);
    }
  },
  
  createFlashcard: async (data) => {
    const { deckId, userId, ...cardData } = data;
    const cardsInDeckBefore = (get().flashcards[deckId] || []).length;
    
    // Optimistic local ID
    const tempId = `temp_card_${Date.now()}`;
    const tempCard: Flashcard = {
      id: tempId,
      deckId,
      type: data.type as FlashcardType,
      front: data.front,
      back: data.back,
      clozeText: data.clozeText,
      tags: data.tags,
      imageUrl: data.imageUrl,
      occlusionData: data.occlusionData,
      createdAt: new Date().toISOString(),
    };
    
    // Optimistic update
    set(state => ({
      flashcards: {
        ...state.flashcards,
        [deckId]: [...(state.flashcards[deckId] || []), tempCard],
      },
    }));
    await get().saveToStorage();
    
    try {
      const created = await api.createFlashcard(userId, deckId, {
        ...cardData,
        type: cardData.type as 'BASIC' | 'CLOZE' | 'IMAGE_OCCLUSION',
      });
      const card = mapFlashcardFromApi(created);

      set(state => {
        const flashcards = {
          ...state.flashcards,
          [deckId]: (state.flashcards[deckId] || []).map(c => (c.id === tempId ? card : c)),
        };
        return {
          flashcards,
          decks: enrichDecksWithStats(state.decks, flashcards),
        };
      });
      await get().saveToStorage();
      if (cardsInDeckBefore === 0) {
        trackFirstCardAdded(deckId);
      }
      return card;
    } catch (error: any) {
      console.error('Failed to create flashcard on server:', error);
      
      // Queue for later sync
      await syncService.queueOperation('flashcard', tempId, 'create', { ...cardData, deckId }, userId);
      if (cardsInDeckBefore === 0) {
        trackFirstCardAdded(deckId);
      }
      
      return tempCard;
    }
  },
  
  updateFlashcard: async (flashcardId: string, deckId: string, updates: Partial<Flashcard>, userId: string) => {
    set(state => {
      const flashcards = {
        ...state.flashcards,
        [deckId]: (state.flashcards[deckId] || []).map(c =>
          c.id === flashcardId ? { ...c, ...updates } : c
        ),
      };
      return {
        flashcards,
        decks: enrichDecksWithStats(state.decks, flashcards),
      };
    });
    scheduleSaveToStorage(() => get().saveToStorage());

    try {
      const updated = await api.updateFlashcard(flashcardId, updates);
      const mapped = mapFlashcardFromApi(updated);
      set(state => {
        const flashcards = {
          ...state.flashcards,
          [deckId]: (state.flashcards[deckId] || []).map(c =>
            c.id === flashcardId ? mapped : c
          ),
        };
        return {
          flashcards,
          decks: enrichDecksWithStats(state.decks, flashcards),
        };
      });
      flushScheduledSave(() => get().saveToStorage());
    } catch (error: any) {
      console.error('Failed to update flashcard on server:', error);
      await syncService.queueOperation('flashcard', flashcardId, 'update', updates, userId);
      flushScheduledSave(() => get().saveToStorage());
    }
  },

  reviewFlashcard: async (
    flashcardId: string,
    deckId: string,
    rating: 'again' | 'hard' | 'good' | 'easy',
    userId: string
  ) => {
    const state = get();
    const card = (state.flashcards[deckId] || []).find(c => c.id === flashcardId);
    if (!card) {
      throw new Error('Flashcard not found');
    }

    const studySettings = useSettingsStore.getState().settings.study;
    const locallyUpdated = applyLocalFlashcardReview(card, rating, studySettings);
    pendingLocalReviews.set(flashcardId, locallyUpdated);

    set(current => {
      const flashcards = {
        ...current.flashcards,
        [deckId]: (current.flashcards[deckId] || []).map(c =>
          c.id === flashcardId ? locallyUpdated : c
        ),
      };
      return {
        flashcards,
        decks: enrichDecksWithStats(current.decks, flashcards),
      };
    });
    // Persist immediately so early exit / remount cannot lose graded cards.
    await get().saveToStorage();

    const isOnline = syncService.getStatus().isOnline;
    const useOfflinePath = !isOnline || get().isDeckOffline(deckId);

    if (useOfflinePath) {
      await syncService.queueOperation(
        'flashcard_review',
        flashcardId,
        'create',
        {
          rating,
          deckId,
          expectedVersion: card.version,
          // Phase 1 C: stamp WHEN the grade was given. Without it the replayed
          // review lands with occurred_at = SYNC time, so a week of offline
          // study collapses onto the day the phone came back online. Web
          // already sends this (services/offlineFlashcardSync.ts).
          reviewedAt: new Date().toISOString(),
        },
        userId
      );
      // Keep pending until sync confirms — due count stays correct offline.
      return;
    }

    try {
      const updated = await api.reviewFlashcard(flashcardId, rating, card.version);
      const mapped = mapFlashcardFromApi(updated);
      // Prefer server SRS when present; otherwise keep the local FSRS result.
      const finalCard =
        mapped?.srsData?.nextReviewDate != null
          ? { ...locallyUpdated, ...mapped, srsData: mapped.srsData }
          : locallyUpdated;
      pendingLocalReviews.delete(flashcardId);
      set(current => {
        const flashcards = {
          ...current.flashcards,
          [deckId]: (current.flashcards[deckId] || []).map(c =>
            c.id === flashcardId ? finalCard : c
          ),
        };
        return {
          flashcards,
          decks: enrichDecksWithStats(current.decks, flashcards),
        };
      });
      await get().saveToStorage();
    } catch (error: any) {
      if (error?.code === 'version_conflict' || error?.status === 409) {
        // Drop local optimistic grade; refetch would win — clear pending.
        pendingLocalReviews.delete(flashcardId);
        if (error.current) {
          const mapped = mapFlashcardFromApi(error.current);
          if (mapped?.id) {
            set(current => {
              const flashcards = {
                ...current.flashcards,
                [deckId]: (current.flashcards[deckId] || []).map(c =>
                  c.id === flashcardId ? { ...c, ...mapped } : c
                ),
              };
              return {
                flashcards,
                decks: enrichDecksWithStats(current.decks, flashcards),
              };
            });
          }
        }
        await get().saveToStorage();
        return;
      }
      console.error('Failed to review flashcard on server:', error);
      await syncService.queueOperation(
        'flashcard_review',
        flashcardId,
        'create',
        {
          rating,
          deckId,
          expectedVersion: card.version,
          // Phase 1 C: stamp WHEN the grade was given. Without it the replayed
          // review lands with occurred_at = SYNC time, so a week of offline
          // study collapses onto the day the phone came back online. Web
          // already sends this (services/offlineFlashcardSync.ts).
          reviewedAt: new Date().toISOString(),
        },
        userId
      );
      // Keep pendingLocalReviews so refetch/sync cannot resurrect the old due state.
    }
  },
  
  deleteFlashcard: async (flashcardId: string, deckId: string, userId: string) => {
    // Optimistic delete
    set(state => {
      const flashcards = {
        ...state.flashcards,
        [deckId]: (state.flashcards[deckId] || []).filter(c => c.id !== flashcardId),
      };
      return {
        flashcards,
        decks: enrichDecksWithStats(state.decks, flashcards),
      };
    });
    await get().saveToStorage();

    try {
      await api.deleteFlashcard(flashcardId);
    } catch (error: any) {
      console.error('Failed to delete flashcard on server:', error);
      
      // Queue for later sync
      await syncService.queueOperation('flashcard', flashcardId, 'delete', {}, userId);
    }
  },
  
  clearError: () => set({ error: null }),
  
  // ---- offline helpers ----
  isDeckOffline: (deckId: string) => {
    const { offlineDeckIds } = get();
    return offlineDeckIds.includes(deckId);
  },

  markDeckOffline: async (deckId: string, userId: string) => {
    set(state => ({
      offlineDeckIds: Array.from(new Set([...state.offlineDeckIds, deckId])),
    }));
    // make sure we have the latest data locally
    try {
      await get().fetchFlashcards(deckId);
      await get().fetchDecks(userId); // refresh deck list in case it changed
    } catch (e) {
      console.warn('[FlashcardStore] failed to pre‑fetch offline deck', e);
    }
    await get().saveToStorage();
  },

  unmarkDeckOffline: async (deckId: string) => {
    set(state => ({
      offlineDeckIds: state.offlineDeckIds.filter(id => id !== deckId),
    }));
    await get().saveToStorage();
  },

  refreshOfflineDecks: async (userId: string) => {
    const { offlineDeckIds } = get();
    if (offlineDeckIds.length === 0) return;

    // fetch deck info once (could be cached above) and flashcards individually
    if (userId) {
      try {
        await get().fetchDecks(userId);
      } catch {}
    }

    for (const id of offlineDeckIds) {
      try {
        await get().fetchFlashcards(id);
      } catch (e) {
        console.warn('[FlashcardStore] refreshOfflineDecks failed for', id, e);
      }
    }
  },
}));
