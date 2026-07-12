import { useState, useCallback } from 'react';
import { AppMode, Deck, Flashcard, FlashcardType, TestResult } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useUIStore } from '../stores/uiStore';
import { shuffleArray } from '../utils/helpers';
import {
  buildFlashcardReviewQueue,
  getTodayStudyCounts,
  isNewFlashcard,
} from '@lantern/shared/settings';
import { applyLocalFlashcardReview } from '@lantern/shared/utils/offlineReview';
import { syncPendingFlashcardReviews } from '../services/offlineFlashcardSync';
import { normalizeUserSettings } from '@lantern/shared/settings/userSettings';
import { trackQuestProgress } from '../services/questProgress';
import { trackStudyActivity } from '../services/studyActivity';
import { useTestStore } from '../stores/testStore';
import {
    createDeck, updateDeck, deleteDeck,
    createFlashcard, fetchFlashcards, updateFlashcard, reviewFlashcard, deleteFlashcard,
    resetDeckStatistics, exportDeck, importDeck, exportDeckCsv, importDeckCsv, importDeckApkg, fetchDecks
} from '../services/supabase';
import { aiGenerateFlashcards } from '../services/ai';
import { buildFlashcardSourceFromTestResult } from '../utils/buildFlashcardSource';
import { normalizeFlashcardCount } from '../utils/flashcardGeneration';
import { navigateForAppMode } from '../utils/appNavigation';

const srsReviewInFlight = new Set<string>();

export function useFlashcardHandlers() {
    const { currentUser } = useAuthStore();
    const {
        decks, setDecks, updateDecks,
        flashcards, setFlashcards, updateFlashcards,
        isDeckOffline, markDeckOffline, unmarkDeckOffline, queueFlashcardReview,
    } = useFlashcardStore();
    const {
        setAppMode, selectedDeck, setSelectedDeck,
        setEditingDeck, setEditingFlashcard,
        setFlashcardInitialDeckId,
        setActiveReviewSession, setActiveCramSession,
        openModal, closeModal,
        isOnline,
    } = useUIStore();

    const [isGeneratingFlashcards, setIsGeneratingFlashcards] = useState(false);

    const loadDeckFlashcards = useCallback(async (deckId: string) => {
        if (!currentUser) return;
        try {
            const mapFetched = (fetched: any[]) => (fetched || []).map((fc: any) => ({
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

            let page = 1;
            let allMapped: ReturnType<typeof mapFetched> = [];
            let batchSize = 0;
            do {
                const fetched = await fetchFlashcards(deckId, currentUser.id, { page, limit: 500 });
                const mapped = mapFetched(fetched);
                batchSize = mapped.length;
                allMapped = [...allMapped, ...mapped];
                page += 1;
            } while (batchSize === 500);

            updateFlashcards(prev => [
                ...prev.filter(fc => fc.deckId !== deckId),
                ...allMapped,
            ]);
        } catch (error) {
            console.warn('Failed to load deck flashcards:', error);
            throw error;
        }
    }, [currentUser, updateFlashcards]);

    const handleToggleDeckOffline = useCallback(async (deck: Deck, enable: boolean) => {
        if (!currentUser) return;
        if (enable) {
            try {
                await loadDeckFlashcards(deck.id);
                markDeckOffline(deck.id);
            } catch {
                alert('Failed to download deck for offline use. Check your connection and try again.');
            }
        } else {
            unmarkDeckOffline(deck.id);
        }
    }, [currentUser, loadDeckFlashcards, markDeckOffline, unmarkDeckOffline]);

    const handleSelectDeck = useCallback((deck: Deck) => {
        setSelectedDeck(deck);
        navigateForAppMode(AppMode.DECK_DETAIL, { deckId: deck.id });
        loadDeckFlashcards(deck.id);
    }, [setSelectedDeck, loadDeckFlashcards]);

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
                    tags: data.tags,
                    userId: currentUser.id,
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
        const cardCount = normalizeFlashcardCount(count);
        setIsGeneratingFlashcards(true);
        try {
            let cardsToCreate: { front: string; back: string }[] = [];

            // ── Try AI generation first ────────────────────────────────
            try {
                const { flashcards: aiCards } = await aiGenerateFlashcards(notes, { count: cardCount });
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
                    if (generatedCards.length >= cardCount) break;

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
                        if (generatedCards.length >= cardCount) break;
                        generatedCards.push({ front: `Define/explain: ${sentence.substring(0, 60)}`, back: sentence });
                    }
                }

                cardsToCreate = generatedCards.slice(0, cardCount);
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
                    userId: currentUser.id,
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

    const handleGenerateFlashcardsFromTestResult = useCallback(
        async (results: TestResult, weakTopics: string[]): Promise<boolean> => {
            if (!currentUser) return false;
            setIsGeneratingFlashcards(true);
            try {
                const sourceContent = buildFlashcardSourceFromTestResult(results, weakTopics);
                if (sourceContent.trim().length < 50) {
                    alert('Not enough test data to generate flashcards. Try a test with tagged questions or missed answers.');
                    return false;
                }

                const missedCount = results.totalQuestions - results.correctAnswersCount;
                const cardCount = normalizeFlashcardCount(
                    Math.max(10, weakTopics.length * 4 || missedCount || 10)
                );

                const { flashcards: generated } = await aiGenerateFlashcards(sourceContent, {
                    count: cardCount,
                    style: 'concise',
                });
                if (!generated?.length) {
                    alert('Could not generate flashcards. Please try again.');
                    return false;
                }

                const deckLabel = weakTopics.length
                    ? weakTopics.slice(0, 2).join(', ')
                    : 'Missed Questions';
                const deckName = `Weak Areas: ${deckLabel}`.slice(0, 80);

                const newDeck = await createDeck(
                    {
                        name: deckName,
                        description: `Auto-generated from test review (${Math.round(results.score)}% score)`,
                    },
                    currentUser.id
                );
                updateDecks((prev) => [...prev, newDeck]);

                for (const card of generated) {
                    await createFlashcard({
                        deckId: newDeck.id,
                        type: FlashcardType.BASIC,
                        front: card.front,
                        back: card.back,
                        userId: currentUser.id,
                    });
                }

                const fetchedFlashcards = await fetchFlashcards(undefined, currentUser.id);
                setFlashcards(
                    fetchedFlashcards.map((fc: any) => ({
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
                        createdAt: fc.created_at,
                    }))
                );

                setSelectedDeck(newDeck);
                setAppMode(AppMode.DECK_DETAIL);
                alert(`Created "${deckName}" with ${generated.length} flashcards.`);
                return true;
            } catch (error) {
                console.error('Error generating flashcards from test:', error);
                alert('Failed to generate flashcards from test analysis. Please try again.');
                return false;
            } finally {
                setIsGeneratingFlashcards(false);
            }
        },
        [currentUser, updateDecks, setFlashcards, setSelectedDeck, setAppMode]
    );

    const handleStartReview = useCallback((deck: Deck) => {
        if (!currentUser) return;
        const settings = normalizeUserSettings(currentUser.settings);
        const cardsInDeck = flashcards.filter(fc => fc.deckId === deck.id);
        const today = getTodayStudyCounts(useTestStore.getState().studyActivityDays);

        const cardQueue = buildFlashcardReviewQueue(cardsInDeck, {
            srsNewCardsPerDay: settings.study.srsNewCardsPerDay,
            newCardsIntroducedToday: today.newFlashcards,
        });

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
        if (srsReviewInFlight.has(cardId)) return;
        srsReviewInFlight.add(cardId);

        const cardIndex = flashcards.findIndex(fc => fc.id === cardId);
        if (cardIndex === -1) {
            srsReviewInFlight.delete(cardId);
            return;
        }

        const card = flashcards[cardIndex];
        const wasNew = isNewFlashcard(card);
        const settings = normalizeUserSettings(currentUser.settings);
        const useOfflinePath = !isOnline || isDeckOffline(card.deckId);

        try {
            if (useOfflinePath) {
                const updatedCard = applyLocalFlashcardReview(card, performanceRating, settings.study);
                updateFlashcards(prev => prev.map(fc => fc.id === cardId ? updatedCard : fc));
                queueFlashcardReview(cardId, card.deckId, performanceRating);
                if (isOnline) {
                    void syncPendingFlashcardReviews();
                }
                trackQuestProgress('review_cards');
                trackStudyActivity('flashcard', 1);
                if (wasNew) {
                    trackStudyActivity('flashcard_new', 1);
                }
            } else {
                const updated = await reviewFlashcard(cardId, performanceRating);
                const newSrsData = updated?.srs_data ?? updated?.srsData;
                if (newSrsData) {
                    updateFlashcards(prev => prev.map(fc => fc.id === cardId ? { ...fc, srsData: newSrsData } : fc));
                }
                trackQuestProgress('review_cards');
                trackStudyActivity('flashcard', 1);
                if (wasNew) {
                    trackStudyActivity('flashcard_new', 1);
                }
            }
        } catch (error) {
            console.error('Error updating SRS data:', error);
            try {
                const updatedCard = applyLocalFlashcardReview(card, performanceRating, settings.study);
                updateFlashcards(prev => prev.map(fc => fc.id === cardId ? updatedCard : fc));
                queueFlashcardReview(cardId, card.deckId, performanceRating);
                if (isOnline) {
                    void syncPendingFlashcardReviews();
                }
                trackQuestProgress('review_cards');
                trackStudyActivity('flashcard', 1);
                if (wasNew) {
                    trackStudyActivity('flashcard_new', 1);
                }
            } catch (fallbackError) {
                console.error('Offline SRS fallback failed:', fallbackError);
                alert('Failed to update SRS data. Please try again.');
            }
        } finally {
            srsReviewInFlight.delete(cardId);
        }
    }, [currentUser, flashcards, updateFlashcards, isOnline, isDeckOffline, queueFlashcardReview]);

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

    const handleStartLearn = useCallback((deck: Deck) => {
        setSelectedDeck(deck);
        setAppMode(AppMode.FLASHCARD_LEARN);
    }, [setSelectedDeck, setAppMode]);

    const handleStartMatch = useCallback((deck: Deck) => {
        setSelectedDeck(deck);
        setAppMode(AppMode.FLASHCARD_MATCH);
    }, [setSelectedDeck, setAppMode]);

    const handleEndStudyMode = useCallback(() => {
        setAppMode(AppMode.DECK_DETAIL);
    }, [setAppMode]);

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

    const handleExportDeck = useCallback(async (deckId: string, format: 'json' | 'csv' = 'json') => {
        if (!currentUser) return;
        try {
            if (format === 'csv') {
                const csv = await exportDeckCsv(deckId);
                const deck = decks.find(d => d.id === deckId);
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${(deck?.name || 'deck').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } else {
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
            }
            alert('Deck exported successfully!');
        } catch (error) {
            console.error('Error exporting deck:', error);
            alert('Failed to export deck. Please try again.');
        }
    }, [currentUser, decks]);

    const mergeImportedDeck = useCallback(async (importResult: any) => {
        const newDeck = importResult.deck || importResult;
        const insertedCards = importResult.flashcards || [];
        const fetchedDecks = await fetchDecks(currentUser!.id, { includeShared: true });
        setDecks(fetchedDecks
            .filter((d: any) => d && d.id)
            .map((d: any) => ({
            id: d.id,
            name: d.name,
            description: d.description,
            createdAt: d.created_at || d.createdAt,
            userId: d.user_id || d.userId,
            isShared: d.is_shared || d.isShared,
        })));
        if (insertedCards.length > 0) {
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
        const fetchedFlashcardsResult = await fetchFlashcards(undefined, currentUser!.id);
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
    }, [currentUser, setDecks, setFlashcards, updateFlashcards]);

    const handleImportDeck = useCallback(async (file: File) => {
        if (!currentUser) return;
        try {
            const ext = file.name.split('.').pop()?.toLowerCase() || '';
            let importResult: any;

            if (ext === 'csv') {
                const csv = await file.text();
                importResult = await importDeckCsv(csv, currentUser.id, file.name.replace(/\.csv$/i, ''));
            } else if (ext === 'apkg') {
                const buffer = await file.arrayBuffer();
                const bytes = new Uint8Array(buffer);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                const apkgBase64 = btoa(binary);
                importResult = await importDeckApkg(apkgBase64, currentUser.id);
            } else {
                const fileContent = await file.text();
                const importData = JSON.parse(fileContent);
                importResult = await importDeck(importData, currentUser.id);
            }

            await mergeImportedDeck(importResult);
        } catch (error) {
            console.error('Error importing deck:', error);
            alert('Failed to import deck. Please check the file format and try again.');
        }
    }, [currentUser, mergeImportedDeck]);

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
        handleGenerateFlashcardsFromTestResult,
        handleStartReview,
        handleStartCram,
        handleCramAnswer,
        handleCramIncorrect,
        handleEndCramSession,
        handleUpdateSrsData,
        handleToggleDeckOffline,
        handleResetDeckStatistics,
        handleExportDeck,
        handleImportDeck,
        handleStartMatch,
        handleStartLearn,
        handleEndStudyMode,
        handleLoadMoreFlashcards,
    };
}

