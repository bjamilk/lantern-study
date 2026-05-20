import { useState, useCallback } from 'react';
import { AppMode, Deck, Flashcard, FlashcardType } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useUIStore } from '../stores/uiStore';
import { shuffleArray } from '../utils/helpers';
import { calculateSrsData } from '../srs';
import {
    createDeck, updateDeck, deleteDeck,
    createFlashcard, fetchFlashcards, updateFlashcard, deleteFlashcard,
    resetDeckStatistics, exportDeck, importDeck, fetchDecks
} from '../services/supabase';
import { aiGenerateFlashcards } from '../services/ai';

export function useFlashcardHandlers() {
    const { currentUser } = useAuthStore();
    const {
        decks, setDecks, updateDecks,
        flashcards, setFlashcards, updateFlashcards
    } = useFlashcardStore();
    const {
        setAppMode, selectedDeck, setSelectedDeck,
        setEditingDeck, setEditingFlashcard,
        setFlashcardInitialDeckId,
        setActiveReviewSession, setActiveCramSession,
        openModal, closeModal
    } = useUIStore();

    const [isGeneratingFlashcards, setIsGeneratingFlashcards] = useState(false);

    const loadDeckFlashcards = useCallback(async (deckId: string) => {
        if (!currentUser) return;
        try {
            const fetched = await fetchFlashcards(deckId, currentUser.id, { page: 1, limit: 500 });
            const mapped = (fetched || []).map((fc: any) => ({
                id: fc.id,
                deckId: fc.deck_id,
                type: fc.type,
                front: fc.front,
                back: fc.back,
                clozeText: fc.cloze_text,
                imageUrl: fc.image_url,
                occlusionData: fc.occlusion_data,
                srsData: fc.srs_data,
                tags: fc.tags,
                createdAt: fc.created_at
            }));
            updateFlashcards(prev => [
                ...prev.filter(fc => fc.deckId !== deckId),
                ...mapped,
            ]);
        } catch (error) {
            console.warn('Failed to load deck flashcards:', error);
        }
    }, [currentUser, updateFlashcards]);

    const handleSelectDeck = useCallback((deck: Deck) => {
        setSelectedDeck(deck);
        setAppMode(AppMode.DECK_DETAIL);
        loadDeckFlashcards(deck.id);
    }, [setSelectedDeck, setAppMode, loadDeckFlashcards]);

    const handleOpenCreateDeckModal = useCallback(() => {
        setEditingDeck(null);
        openModal('createDeck');
    }, [setEditingDeck, openModal]);
    
    const handleOpenEditDeckModal = useCallback((deck: Deck) => {
        setEditingDeck(deck);
        openModal('createDeck');
    }, [setEditingDeck, openModal]);

    const handleCreateOrUpdateDeck = useCallback(async (data: { id?: string; name: string; description?: string; isShared?: boolean }) => {
        if (!currentUser) return;
        try {
            if (data.id) {
                await updateDeck(data.id, { name: data.name, description: data.description, isShared: data.isShared });
                updateDecks(prev => prev.map(d => d.id === data.id ? { ...d, ...data } : d));
                if (selectedDeck?.id === data.id) {
                    setSelectedDeck({ ...selectedDeck, ...data } as Deck);
                }
            } else {
                const newDeck = await createDeck({ name: data.name, description: data.description, isShared: data.isShared }, currentUser.id);
                updateDecks(prev => [...prev, newDeck]);
            }
            closeModal('createDeck');
        } catch (error) {
            console.error('Error creating/updating deck:', error);
            alert('Failed to create/update deck. Please try again.');
        }
    }, [currentUser, selectedDeck, updateDecks, setSelectedDeck, closeModal]);

    const handleDeleteDeck = useCallback(async (deckId: string) => {
        if (!currentUser) return;
        try {
            await deleteDeck(deckId);
            updateDecks(prev => prev.filter(d => d.id !== deckId));
            updateFlashcards(prev => prev.filter(fc => fc.deckId !== deckId));
            setAppMode(AppMode.FLASHCARDS);
            setSelectedDeck(null);
        } catch (error) {
            console.error('Error deleting deck:', error);
            alert('Failed to delete deck. Please try again.');
        }
    }, [currentUser, updateDecks, updateFlashcards, setAppMode, setSelectedDeck]);

    const handleOpenCreateFlashcardModal = useCallback((deckId?: string) => {
        setEditingFlashcard(null);
        setFlashcardInitialDeckId(deckId || selectedDeck?.id);
        openModal('createFlashcard');
    }, [selectedDeck, setEditingFlashcard, setFlashcardInitialDeckId, openModal]);
    
    const handleOpenEditFlashcardModal = useCallback((flashcard: Flashcard) => {
        setEditingFlashcard(flashcard);
        openModal('createFlashcard');
    }, [setEditingFlashcard, openModal]);

    const handleCreateOrUpdateFlashcard = useCallback(async (data: Partial<Omit<Flashcard, 'createdAt'>> & { id?: string }) => {
        if (!currentUser) return;
        try {
            if (data.id) {
                await updateFlashcard(data.id, {
                    deckId: data.deckId,
                    type: data.type,
                    front: data.front,
                    back: data.back,
                    clozeText: data.clozeText,
                    imageUrl: data.imageUrl,
                    occlusionData: data.occlusionData,
                    srsData: data.srsData,
                    tags: data.tags
                });
                const fetchedFlashcards = await fetchFlashcards(undefined, currentUser.id);
                setFlashcards(fetchedFlashcards.map((fc: any) => ({
                    id: fc.id,
                    deckId: fc.deck_id,
                    type: fc.type,
                    front: fc.front,
                    back: fc.back,
                    clozeText: fc.cloze_text,
                    imageUrl: fc.image_url,
                    occlusionData: fc.occlusion_data,
                    srsData: fc.srs_data,
                    tags: fc.tags,
                    createdAt: fc.created_at
                })));
            } else {
                await createFlashcard({
                    deckId: data.deckId!,
                    type: data.type!,
                    front: data.front,
                    back: data.back,
                    clozeText: data.clozeText,
                    imageUrl: data.imageUrl,
                    occlusionData: data.occlusionData,
                    srsData: data.srsData,
                    tags: data.tags
                });
                const fetchedFlashcards = await fetchFlashcards(undefined, currentUser.id);
                setFlashcards(fetchedFlashcards.map((fc: any) => ({
                    id: fc.id,
                    deckId: fc.deck_id,
                    type: fc.type,
                    front: fc.front,
                    back: fc.back,
                    clozeText: fc.cloze_text,
                    imageUrl: fc.image_url,
                    occlusionData: fc.occlusion_data,
                    srsData: fc.srs_data,
                    tags: fc.tags,
                    createdAt: fc.created_at
                })));
            }
            closeModal('createFlashcard');
        } catch (error) {
            console.error('Error creating/updating flashcard:', error instanceof Error ? error.message : JSON.stringify(error));
            alert('Failed to create/update flashcard. Please try again.');
        }
    }, [currentUser, setFlashcards, closeModal]);
    
    const handleDeleteFlashcard = useCallback(async (flashcardId: string) => {
        if (!currentUser) return;
        try {
            await deleteFlashcard(flashcardId);
            updateFlashcards(prev => prev.filter(fc => fc.id !== flashcardId));
        } catch (error) {
            console.error('Error deleting flashcard:', error);
            alert('Failed to delete flashcard. Please try again.');
        }
    }, [currentUser, updateFlashcards]);

    const handleGenerateFlashcards = useCallback(async (deckId: string, notes: string, count: number) => {
        if (!currentUser) return;
        setIsGeneratingFlashcards(true);
        try {
            let cardsToCreate: { front: string; back: string }[] = [];

            // ── Try AI generation first ────────────────────────────────
            try {
                const { flashcards: aiCards } = await aiGenerateFlashcards(notes, { count });
                cardsToCreate = aiCards.map(c => ({ front: c.front, back: c.back }));
            } catch {
                // AI unavailable → fall back to regex parsing
            }

            // ── Regex fallback when AI returns nothing ─────────────────
            if (cardsToCreate.length === 0) {
                const lines = notes
                    .split(/\n+/)
                    .map(l => l.trim())
                    .filter(l => l.length > 5);

                const generatedCards: { front: string; back: string }[] = [];

                for (const line of lines) {
                    if (generatedCards.length >= count) break;

                    const qaMatch = line.match(/^(?:Q:\s*|Question:\s*)(.+?)\s*(?:A:\s*|Answer:\s*)(.+)$/i);
                    const colonMatch = !qaMatch && line.match(/^([^:]+):\s+(.+)$/);
                    const dashMatch = !qaMatch && !colonMatch && line.match(/^([^-–—]+)\s*[-–—]\s+(.+)$/);
                    const equalsMatch = !qaMatch && !colonMatch && !dashMatch && line.match(/^([^=]+)=\s*(.+)$/);

                    if (qaMatch) {
                        generatedCards.push({ front: qaMatch[1].trim(), back: qaMatch[2].trim() });
                    } else if (colonMatch && colonMatch[1].split(/\s+/).length <= 6) {
                        generatedCards.push({ front: colonMatch[1].trim(), back: colonMatch[2].trim() });
                    } else if (dashMatch && dashMatch[1].split(/\s+/).length <= 6) {
                        generatedCards.push({ front: dashMatch[1].trim(), back: dashMatch[2].trim() });
                    } else if (equalsMatch) {
                        generatedCards.push({ front: equalsMatch[1].trim(), back: equalsMatch[2].trim() });
                    } else if (line.length > 10) {
                        const words = line.split(/\s+/);
                        if (words.length >= 4) {
                            const commonWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'of', 'in', 'to', 'and', 'or', 'for', 'with', 'on', 'at', 'by', 'it', 'its', 'this', 'that', 'from', 'as', 'be', 'has', 'have', 'had', 'not', 'but', 'they', 'we', 'he', 'she', 'you', 'can', 'will', 'do', 'does', 'did']);
                            const keyWords = words.filter(w => w.length > 3 && !commonWords.has(w.toLowerCase()));
                            if (keyWords.length > 0) {
                                const targetWord = keyWords[Math.floor(Math.random() * keyWords.length)];
                                const front = line.replace(targetWord, '______');
                                generatedCards.push({ front, back: targetWord });
                            } else {
                                generatedCards.push({ front: `What does this describe: "${line.substring(0, 50)}..."?`, back: line });
                            }
                        }
                    }
                }

                if (generatedCards.length === 0) {
                    const sentences = notes.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
                    for (const sentence of sentences) {
                        if (generatedCards.length >= count) break;
                        generatedCards.push({ front: `Define/explain: ${sentence.substring(0, 60)}`, back: sentence });
                    }
                }

                cardsToCreate = generatedCards.slice(0, count);
            }
            
            if (cardsToCreate.length === 0) {
                alert('Could not parse any flashcards from the provided notes. Try using "Term: Definition" or "Q: Question A: Answer" format.');
                return;
            }

            for (const card of cardsToCreate) {
                await createFlashcard({
                    deckId,
                    type: FlashcardType.BASIC,
                    front: card.front,
                    back: card.back,
                });
            }

            const fetchedFlashcards = await fetchFlashcards(undefined, currentUser.id);
            setFlashcards(fetchedFlashcards.map((fc: any) => ({
                id: fc.id,
                deckId: fc.deck_id,
                type: fc.type,
                front: fc.front,
                back: fc.back,
                clozeText: fc.cloze_text,
                imageUrl: fc.image_url,
                occlusionData: fc.occlusion_data,
                srsData: fc.srs_data,
                tags: fc.tags,
                createdAt: fc.created_at
            })));

            alert(`Successfully generated ${cardsToCreate.length} flashcard(s)!`);
        } catch (error) {
            console.error('Error generating flashcards:', error);
            alert('Failed to generate flashcards. Please try again.');
        } finally {
            setIsGeneratingFlashcards(false);
        }
    }, [currentUser, setFlashcards]);

    const handleStartReview = useCallback((deck: Deck) => {
        if (!currentUser) return;
        const today = new Date().toISOString().split('T')[0];
        const cardsInDeck = flashcards.filter(fc => fc.deckId === deck.id);
        
        const newCards = cardsInDeck.filter(fc => !fc.srsData?.repetitions);
        const dueCards = cardsInDeck.filter(fc => fc.srsData && fc.srsData.nextReviewDate && fc.srsData.nextReviewDate.split('T')[0] <= today);
        
        const cardQueue = [...dueCards, ...newCards];
        if (cardQueue.length === 0) {
            alert("No new or due cards in this deck to review right now.");
            return;
        }
        setActiveReviewSession({ deck, cardQueue });
        setAppMode(AppMode.FLASHCARD_REVIEW);
    }, [currentUser, flashcards, setActiveReviewSession, setAppMode]);

    const handleStartCram = useCallback((deck: Deck, timerSeconds?: number) => {
        if (!currentUser) return;
        const cardsInDeck = flashcards.filter(fc => fc.deckId === deck.id);
        
        if (cardsInDeck.length === 0) {
            alert("This deck is empty. Add some cards to cram!");
            return;
        }

        const shuffledCards = shuffleArray(cardsInDeck);
        const session: any = { deck, cardQueue: shuffledCards };

        if (timerSeconds && timerSeconds > 0) {
            const endTime = new Date(Date.now() + timerSeconds * 1000).toISOString();
            session.timerSeconds = timerSeconds;
            session.endTime = endTime;
        }

        setActiveCramSession(session);
        setAppMode(AppMode.FLASHCARD_CRAM);
    }, [currentUser, flashcards, setActiveCramSession, setAppMode]);
    
    const handleCramAnswer = useCallback((cardId: string, isCorrect: boolean) => {
        console.log(`Crammed card ${cardId}, Correct: ${isCorrect}`);
    }, []);

    const handleCramIncorrect = useCallback((incorrectCards: Flashcard[]) => {
        const activeCramSession = useUIStore.getState().activeCramSession;
        if (!activeCramSession) return;
        const shuffledIncorrect = shuffleArray(incorrectCards);
        setActiveCramSession({...activeCramSession, cardQueue: shuffledIncorrect});
    }, [setActiveCramSession]);

    const handleEndCramSession = useCallback((stats: { correct: number, incorrect: number }) => {
        alert(`Cram session finished! You got ${stats.correct} correct and ${stats.incorrect} incorrect.`);
        setActiveCramSession(null);
        setAppMode(AppMode.DECK_DETAIL);
    }, [setActiveCramSession, setAppMode]);

    const handleUpdateSrsData = useCallback(async (cardId: string, performanceRating: 'again' | 'hard' | 'good' | 'easy') => {
        if (!currentUser) return;
        const cardIndex = flashcards.findIndex(fc => fc.id === cardId);
        if (cardIndex === -1) return;
        
        const card = flashcards[cardIndex];
        const newSrsData = calculateSrsData(card.srsData, performanceRating);
        
        try {
            await updateFlashcard(cardId, { srsData: newSrsData });
            updateFlashcards(prev => prev.map(fc => fc.id === cardId ? { ...fc, srsData: newSrsData } : fc));
        } catch (error) {
            console.error('Error updating SRS data:', error);
            alert('Failed to update SRS data. Please try again.');
        }
    }, [currentUser, flashcards, updateFlashcards]);

    const handleLoadMoreFlashcards = useCallback(async (deckId: string, page: number, limit = 20) => {
        if (!currentUser) return 0;
        try {
            const fetched = await fetchFlashcards(deckId, currentUser.id, { page, limit });
            const mapped = (fetched || []).map((fc: any) => ({
                id: fc.id,
                deckId: fc.deck_id,
                type: fc.type,
                front: fc.front,
                back: fc.back,
                clozeText: fc.cloze_text,
                srsData: fc.srs_data,
                tags: fc.tags,
                createdAt: fc.created_at
            }));

            if (mapped.length > 0) {
                updateFlashcards(prev => [...prev, ...mapped]);
            }

            return mapped.length;
        } catch (error) {
            console.error('Error loading more flashcards:', error);
            return 0;
        }
    }, [currentUser, updateFlashcards]);

    const handleResetDeckStatistics = useCallback(async (deckId: string) => {
        if (!currentUser) return;
        try {
            await resetDeckStatistics(deckId, currentUser.id);
            // remove statistics from local state
            // clear client state for cards in this deck
            updateFlashcards(prev => prev.map(fc => 
                fc.deckId === deckId ? { ...fc, srsData: undefined } : fc
            ));
            // fetch fresh deck list from server (will include zeroed stats)
            if (currentUser?.id) {
                try {
                    const fresh = await fetchDecks(currentUser.id, { includeShared: true });
                    setDecks(fresh);
                } catch (e) {
                    console.warn('Failed to refresh decks after reset', e);
                }
            }
            // persist mobile storage
            if (typeof window === 'undefined') {
                try {
                    await Promise.resolve(useFlashcardStore.getState().saveToStorage());
                } catch {
                    // ignore failures in persistence
                }
            }
            alert('Deck statistics have been reset. All cards are now marked as new.');
        } catch (error) {
            console.error('Error resetting deck statistics:', error);
            alert('Failed to reset deck statistics. Please try again.');
        }
    }, [currentUser, updateFlashcards]);

    const handleExportDeck = useCallback(async (deckId: string) => {
        if (!currentUser) return;
        try {
            const exportData = await exportDeck(deckId);
            const dataStr = JSON.stringify(exportData, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            
            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${exportData.deck.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_export.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            
            alert('Deck exported successfully!');
        } catch (error) {
            console.error('Error exporting deck:', error);
            alert('Failed to export deck. Please try again.');
        }
    }, [currentUser]);

    const handleImportDeck = useCallback(async (file: File) => {
        if (!currentUser) return;
        try {
            const fileContent = await file.text();
            const importData = JSON.parse(fileContent);
            
            const importResult: any = await importDeck(importData, currentUser.id);
            // importResult now contains { deck, flashcards }
            const newDeck = importResult.deck || importResult; // fall back for older clients
            const insertedCards = importResult.flashcards || [];
            
            // refresh deck list (cache should already have been invalidated server-side)
            const fetchedDecks = await fetchDecks(currentUser.id, { includeShared: true });
            setDecks(fetchedDecks.map((d: any) => ({
                id: d.id,
                name: d.name,
                description: d.description,
                createdAt: d.created_at || d.createdAt,
                userId: d.user_id || d.userId,
                isShared: d.is_shared || d.isShared,
            })));

            // optimistically merge imported cards into state to avoid a momentary
            // gap if the fetch below returns stale data
            if (insertedCards.length > 0) {
                // Use the updater version to avoid accidentally setting flashcards to a non-array value
                updateFlashcards(prev => [
                    ...prev,
                    ...insertedCards.map((fc: any) => ({
                        id: fc.id,
                        deckId: fc.deck_id,
                        type: fc.type,
                        front: fc.front,
                        back: fc.back,
                        clozeText: fc.cloze_text,
                        imageUrl: fc.image_url,
                        occlusionData: fc.occlusion_data,
                        srsData: fc.srs_data,
                        tags: fc.tags,
                        createdAt: fc.created_at
                    }))
                ]);
            }

            // re‑fetch to ensure full consistency (clears any stale cache)
            const fetchedFlashcardsResult = await fetchFlashcards(undefined, currentUser.id);
            setFlashcards(fetchedFlashcardsResult.map((fc: any) => ({
                id: fc.id,
                deckId: fc.deck_id,
                type: fc.type,
                front: fc.front,
                back: fc.back,
                clozeText: fc.cloze_text,
                imageUrl: fc.image_url,
                occlusionData: fc.occlusion_data,
                srsData: fc.srs_data,
                tags: fc.tags,
                createdAt: fc.created_at
            })));
            
            alert(`Deck "${newDeck?.name || 'Unknown'}" imported successfully with ${insertedCards.length} cards!`);
        } catch (error) {
            console.error('Error importing deck:', error);
            alert('Failed to import deck. Please check the file format and try again.');
        }
    }, [currentUser, setDecks, setFlashcards]);

    return {
        isGeneratingFlashcards,
        handleSelectDeck,
        handleOpenCreateDeckModal,
        handleOpenEditDeckModal,
        handleCreateOrUpdateDeck,
        handleDeleteDeck,
        handleOpenCreateFlashcardModal,
        handleOpenEditFlashcardModal,
        handleCreateOrUpdateFlashcard,
        handleDeleteFlashcard,
        handleGenerateFlashcards,
        handleStartReview,
        handleStartCram,
        handleCramAnswer,
        handleCramIncorrect,
        handleEndCramSession,
        handleUpdateSrsData,
        handleResetDeckStatistics,
        handleExportDeck,
        handleImportDeck,
        handleLoadMoreFlashcards,
    };
}

