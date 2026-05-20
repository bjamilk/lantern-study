// ===========================================
// Lantern Study - Flashcard Store (Zustand)
// ===========================================
// Cross-platform flashcard state management

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Flashcard, Deck, SrsData } from '../types';
import { calculateSrsData, isCardDue, getCardsDue, sortCardsByDueDate } from '../utils/srs';
import { getDefaultStorageAdapter, STORAGE_KEYS } from '../storage';

interface FlashcardState {
    flashcards: Flashcard[];
    decks: Deck[];
    currentDeckId: string | null;
    isLoading: boolean;
    error: string | null;

    // Deck actions
    setDecks: (decks: Deck[]) => void;
    addDeck: (deck: Deck) => void;
    updateDeck: (id: string, updates: Partial<Deck>) => void;
    deleteDeck: (id: string) => void;
    setCurrentDeck: (deckId: string | null) => void;

    // Flashcard actions
    setFlashcards: (flashcards: Flashcard[]) => void;
    addFlashcard: (flashcard: Flashcard) => void;
    updateFlashcard: (id: string, updates: Partial<Flashcard>) => void;
    deleteFlashcard: (id: string) => void;
    updateSrs: (id: string, rating: 'again' | 'hard' | 'good' | 'easy') => void;

    // Computed getters
    getFlashcardsForDeck: (deckId: string) => Flashcard[];
    getDueCards: (deckId?: string) => Flashcard[];
    getDeckStats: (deckId: string) => { total: number; due: number; new: number };

    // State management
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    reset: () => void;
}

const initialState = {
    flashcards: [] as Flashcard[],
    decks: [] as Deck[],
    currentDeckId: null as string | null,
    isLoading: false,
    error: null as string | null,
};

export const useFlashcardStore = create<FlashcardState>()(
    persist(
        (set, get) => ({
            ...initialState,

            // Deck actions
            setDecks: (decks: Deck[]) => set({ decks }),

            addDeck: (deck: Deck) => set((state) => ({
                decks: [...state.decks, deck]
            })),

            updateDeck: (id: string, updates: Partial<Deck>) => set((state) => ({
                decks: state.decks.map(d => 
                    d.id === id ? { ...d, ...updates } : d
                )
            })),

            deleteDeck: (id: string) => set((state) => ({
                decks: state.decks.filter(d => d.id !== id),
                flashcards: state.flashcards.filter(f => f.deckId !== id),
                currentDeckId: state.currentDeckId === id ? null : state.currentDeckId
            })),

            setCurrentDeck: (deckId: string | null) => set({ currentDeckId: deckId }),

            // Flashcard actions
            setFlashcards: (flashcards: Flashcard[]) => set({ flashcards }),

            addFlashcard: (flashcard: Flashcard) => set((state) => ({
                flashcards: [...state.flashcards, flashcard]
            })),

            updateFlashcard: (id: string, updates: Partial<Flashcard>) => set((state) => ({
                flashcards: state.flashcards.map(f =>
                    f.id === id ? { ...f, ...updates } : f
                )
            })),

            deleteFlashcard: (id: string) => set((state) => ({
                flashcards: state.flashcards.filter(f => f.id !== id)
            })),

            updateSrs: (id: string, rating: 'again' | 'hard' | 'good' | 'easy') => {
                const { flashcards } = get();
                const card = flashcards.find(f => f.id === id);
                if (!card) return;

                const newSrsData = calculateSrsData(card.srsData, rating);
                set((state) => ({
                    flashcards: state.flashcards.map(f =>
                        f.id === id ? { ...f, srsData: newSrsData } : f
                    )
                }));
            },

            // Computed getters
            getFlashcardsForDeck: (deckId: string) => {
                return get().flashcards.filter(f => f.deckId === deckId);
            },

            getDueCards: (deckId?: string) => {
                const { flashcards } = get();
                const filtered = deckId 
                    ? flashcards.filter(f => f.deckId === deckId)
                    : flashcards;
                return sortCardsByDueDate(getCardsDue(filtered));
            },

            getDeckStats: (deckId: string) => {
                const cards = get().getFlashcardsForDeck(deckId);
                const dueCards = cards.filter(c => isCardDue(c.srsData));
                const newCards = cards.filter(c => !c.srsData || c.srsData.repetitions === 0);
                
                return {
                    total: cards.length,
                    due: dueCards.length,
                    new: newCards.length,
                };
            },

            // State management
            setLoading: (isLoading: boolean) => set({ isLoading }),
            setError: (error: string | null) => set({ error, isLoading: false }),
            reset: () => set(initialState),
        }),
        {
            name: STORAGE_KEYS.FLASHCARDS,
            storage: createJSONStorage(() => ({
                getItem: async (name: string) => {
                    const adapter = getDefaultStorageAdapter();
                    return adapter.getItem(name);
                },
                setItem: async (name: string, value: string) => {
                    const adapter = getDefaultStorageAdapter();
                    await adapter.setItem(name, value);
                },
                removeItem: async (name: string) => {
                    const adapter = getDefaultStorageAdapter();
                    await adapter.removeItem(name);
                },
            })),
            partialize: (state) => ({
                flashcards: state.flashcards,
                decks: state.decks,
            }),
        }
    )
);
