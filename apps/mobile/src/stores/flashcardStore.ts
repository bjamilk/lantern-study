/**
 * Flashcard Store
 * Manages decks and flashcard state with offline-first sync
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../services/api';
import { syncService } from '../services/syncService';

export type { Deck, Flashcard } from '../services/api';

// Storage keys
const DECKS_STORAGE_KEY = 'lantern_decks';
const FLASHCARDS_STORAGE_KEY = 'lantern_flashcards';
// keep track of which decks have been explicitly downloaded for offline use
const OFFLINE_DECKS_KEY = 'lantern_offline_decks';

// Demo mode flag - matches authStore
const DEMO_MODE = false;

// Mock data for demo mode
const DEMO_DECKS: api.Deck[] = [
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

const DEMO_FLASHCARDS: Record<string, api.Flashcard[]> = {
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
  decks: api.Deck[];
  flashcards: Record<string, api.Flashcard[]>; // Keyed by deck ID
  currentDeck: api.Deck | null;
  isLoading: boolean;
  error: string | null;
  // explicitly-downloaded deck ids, used to drive manual offline mode
  offlineDeckIds: string[];
  
  // Actions
  fetchDecks: (userId: string) => Promise<void>;
  fetchFlashcards: (deckId: string) => Promise<void>;
  setCurrentDeck: (deck: api.Deck | null) => void;
  createDeck: (name: string, description: string | undefined, userId: string) => Promise<api.Deck>;
  updateDeck: (deckId: string, updates: { name?: string; description?: string }, userId: string) => Promise<void>;
  deleteDeck: (deckId: string, userId: string) => Promise<void>;
  createFlashcard: (data: {
    deckId: string;
    type: 'BASIC' | 'CLOZE';
    front?: string;
    back?: string;
    clozeText?: string;
    tags?: string[];
    userId: string;
  }) => Promise<api.Flashcard>;
  updateFlashcard: (flashcardId: string, deckId: string, updates: any, userId: string) => Promise<void>;
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
  
  // Load cached data from AsyncStorage
  loadFromStorage: async () => {
    try {
      const [decksJson, flashcardsJson, offlineJson] = await Promise.all([
        AsyncStorage.getItem(DECKS_STORAGE_KEY),
        AsyncStorage.getItem(FLASHCARDS_STORAGE_KEY),
        AsyncStorage.getItem(OFFLINE_DECKS_KEY),
      ]);
      
      if (decksJson) {
        set({ decks: JSON.parse(decksJson) });
      }
      if (flashcardsJson) {
        set({ flashcards: JSON.parse(flashcardsJson) });
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
      
      // Load from local storage first for instant UI
      await get().loadFromStorage();
      
      // Demo mode - use mock data
      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        set({ decks: DEMO_DECKS, isLoading: false });
        return;
      }
      
      // Fetch from API and merge
      try {
        const decks = await api.fetchDecks(userId);
        set({ decks, isLoading: false });
        await get().saveToStorage();
      } catch (apiError) {
        console.warn('Failed to fetch decks from API, using cached:', apiError);
        set({ isLoading: false });
      }
    } catch (error: any) {
      console.error('Failed to fetch decks:', error);
      set({ error: error.message, isLoading: false });
    }
  },
  
  fetchFlashcards: async (deckId: string) => {
    try {
      set({ isLoading: true, error: null });
      
      // Demo mode - use mock data
      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 200));
        set(state => ({
          flashcards: {
            ...state.flashcards,
            [deckId]: DEMO_FLASHCARDS[deckId] || [],
          },
          isLoading: false,
        }));
        return;
      }
      
      // Fetch from API
      try {
        const cards = await api.fetchFlashcards(deckId);
        set(state => ({
          flashcards: {
            ...state.flashcards,
            [deckId]: cards,
          },
          isLoading: false,
        }));
        await get().saveToStorage();
      } catch (apiError) {
        console.warn('Failed to fetch flashcards from API:', apiError);
        set({ isLoading: false });
      }
    } catch (error: any) {
      console.error('Failed to fetch flashcards:', error);
      set({ error: error.message, isLoading: false });
    }
  },
  
  setCurrentDeck: (deck: api.Deck | null) => {
    set({ currentDeck: deck });
  },
  
  createDeck: async (name: string, description: string | undefined, userId: string) => {
    // Optimistic local ID
    const tempId = `temp_deck_${Date.now()}`;
    const tempDeck: api.Deck = {
      id: tempId,
      name,
      description,
      user_id: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      card_count: 0,
    };
    
    // Optimistic update
    set(state => ({
      decks: [...state.decks, tempDeck],
    }));
    await get().saveToStorage();
    
    try {
      // Try API call
      const deck = await api.createDeck(userId, { name, description });
      
      // Replace temp with real deck
      set(state => ({
        decks: state.decks.map(d => d.id === tempId ? deck : d),
      }));
      await get().saveToStorage();
      return deck;
    } catch (error: any) {
      console.error('Failed to create deck on server:', error);
      
      // Queue for later sync
      await syncService.queueOperation('deck', tempId, 'create', { name, description }, userId);
      
      // Return temp deck for now
      return tempDeck;
    }
  },
  
  updateDeck: async (deckId: string, updates: { name?: string; description?: string }, userId: string) => {
    // Store previous state for rollback
    const previousDecks = get().decks;
    
    // Optimistic update
    set(state => ({
      decks: state.decks.map(d => d.id === deckId ? { ...d, ...updates, updated_at: new Date().toISOString() } : d),
      currentDeck: state.currentDeck?.id === deckId 
        ? { ...state.currentDeck, ...updates, updated_at: new Date().toISOString() } 
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
    
    // Optimistic local ID
    const tempId = `temp_card_${Date.now()}`;
    const tempCard: api.Flashcard = {
      id: tempId,
      deck_id: deckId,
      type: data.type,
      front: data.front,
      back: data.back,
      cloze_text: data.clozeText,
      tags: data.tags,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
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
      const card = await api.createFlashcard(userId, deckId, cardData);
      
      // Replace temp with real card
      set(state => ({
        flashcards: {
          ...state.flashcards,
          [deckId]: (state.flashcards[deckId] || []).map(c => c.id === tempId ? card : c),
        },
      }));
      await get().saveToStorage();
      return card;
    } catch (error: any) {
      console.error('Failed to create flashcard on server:', error);
      
      // Queue for later sync
      await syncService.queueOperation('flashcard', tempId, 'create', { ...cardData, deckId }, userId);
      
      return tempCard;
    }
  },
  
  updateFlashcard: async (flashcardId: string, deckId: string, updates: any, userId: string) => {
    // Optimistic update
    set(state => ({
      flashcards: {
        ...state.flashcards,
        [deckId]: (state.flashcards[deckId] || []).map(c => 
          c.id === flashcardId ? { ...c, ...updates, updated_at: new Date().toISOString() } : c
        ),
      },
    }));
    await get().saveToStorage();
    
    try {
      await api.updateFlashcard(flashcardId, updates);
    } catch (error: any) {
      console.error('Failed to update flashcard on server:', error);
      
      // Queue for later sync
      await syncService.queueOperation('flashcard', flashcardId, 'update', updates, userId);
    }
  },
  
  deleteFlashcard: async (flashcardId: string, deckId: string, userId: string) => {
    // Optimistic delete
    set(state => ({
      flashcards: {
        ...state.flashcards,
        [deckId]: (state.flashcards[deckId] || []).filter(c => c.id !== flashcardId),
      },
    }));
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
