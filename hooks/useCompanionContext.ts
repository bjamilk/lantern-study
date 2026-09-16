/**
 * The AI companion's two halves that only App.tsx could host: the context it is
 * told about the student, and the tool calls it asks for.
 *
 * Exports: `useCompanionContext`, returning `{ companionContext,
 *  handleCompanionAction }` — exactly what `AICompanionPanel` is handed.
 * Touches: `stores/companionStore` (the streamed system message after a
 *  generation), `stores/flashcardStore` (reading back the saved deck),
 *  `services/ai` + `services/jobArtifacts` (generate and save), and the
 *  navigation / modal callbacks App.tsx passes in.
 * Gotchas:
 *  - Moved verbatim out of App.tsx (M7). The context builder itself is next
 *    door in utils/companionContext.ts, as a pure function, so it can be
 *    asserted without any of the above.
 *  - Anything the model can ask for must appear in the executor's switch; an
 *    unhandled `action.type` falls out of it silently and the student sees
 *    nothing happen.
 *  - The pending-group effect below is why `open_test_config` has no timer:
 *    the test-config modal reads the SELECTED chat, so it must not mount
 *    before the selection it is meant to describe has landed.
 *  - Its contract test is apps/web/src/useCompanionContext.test.ts.
 */
import React from 'react';
import { AppMode, CompanionAction } from '../types';
import type {
    Budget,
    ChatItem,
    Deck,
    Group,
    NoteAttachment,
    StudyGoalMode,
    StudyNote,
    StudySessionData,
    TestResult,
    TestSessionData,
    Transaction,
    User,
    UserSettings,
} from '../types';
import { buildCompanionContext } from '../utils/companionContext';
import type { CompanionContext } from '../utils/companionContext';
import { buildFlashcardSourceContent } from '../utils/buildFlashcardSource';
import { normalizeFlashcardCount } from '../utils/flashcardGeneration';
import { aiGenerateFlashcards } from '../services/ai';
import { saveGeneratedDeck } from '../services/jobArtifacts';
import { useCompanionStore } from '../stores/companionStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import type { AppRouteParams } from '../utils/appRoutes';
import type { ToastType } from '../components/ui/ToastBanner';
import type { useNoteHandlers } from './useNoteHandlers';
import { useUIStore } from '../stores/uiStore';

/** Exactly what App.tsx hands this hook. */
export interface UseCompanionContextParams {
    testResults: TestResult[];
    groups: Group[];
    dueCardsCount: number;
    currentUser: User | null;
    transactions: Transaction[];
    budget: Budget | null;
    appMode: AppMode;
    selectedChat: ChatItem | null;
    selectedDeck: Deck | null;
    activeTestSession: TestSessionData | null;
    activeStudySession: StudySessionData | null;
    selectedNote: (StudyNote & { attachments?: NoteAttachment[] }) | null;
    notes: StudyNote[];
    studyGoal: StudyGoalMode;
    pathname: string;
    setAppMode: (mode: AppMode) => void;
    setSelectedDeck: (deck: Deck | null) => void;
    setActiveTestConfigMode: (mode: 'test' | 'study') => void;
    /** The UI store's own modal key union — kept in step by construction. */
    openModal: ReturnType<typeof useUIStore.getState>['openModal'];
    getUserSettings: () => UserSettings;
    handleSelectChat: (chat: ChatItem, options?: { keepSurface?: boolean }) => void;
    navigateTo: (mode: AppMode, params?: AppRouteParams, options?: { replace?: boolean }) => void;
    showToast: (message: string, type?: ToastType) => void;
    addNotification: (message: string) => void;
    noteHandlers: ReturnType<typeof useNoteHandlers>;
}

/** What App.tsx reads back. */
export interface UseCompanionContextResult {
    companionContext: CompanionContext;
    handleCompanionAction: (action: CompanionAction) => void;
}

export function useCompanionContext({
    testResults,
    groups,
    dueCardsCount,
    currentUser,
    transactions,
    budget,
    appMode,
    selectedChat,
    selectedDeck,
    activeTestSession,
    activeStudySession,
    selectedNote,
    notes,
    studyGoal,
    pathname,
    setAppMode,
    setSelectedDeck,
    setActiveTestConfigMode,
    openModal,
    getUserSettings,
    handleSelectChat,
    navigateTo,
    showToast,
    addNotification,
    noteHandlers,
}: UseCompanionContextParams): UseCompanionContextResult {
    // Build context object for the AI companion
    // Everything the companion is told about the student, rebuilt whenever any
    // of it changes. `currentScreen`, `courseId`, `noteId` and `noteContext` are
    // what make its answers about the page in front of the student, so the memo
    // deliberately depends on `appMode`, `selectedNote` and `location.pathname`.
    // `noteContext` is capped at 6000 chars — the note body is untrusted length.
    const companionContext = React.useMemo(
        () =>
            buildCompanionContext({
                testResults,
                groups,
                dueCardsCount,
                currentUser,
                transactions,
                budget,
                appMode,
                selectedChat,
                selectedDeck,
                activeTestSession,
                activeStudySession,
                selectedNote,
                studyGoal,
                pathname,
            }),
        [testResults, groups, dueCardsCount, currentUser, transactions, budget, appMode, selectedChat, selectedDeck, activeTestSession, activeStudySession, selectedNote, studyGoal, pathname],
    );

    /**
     * Group the companion asked to build a test in, while its selection is
     * still landing (F9). The test-config modal reads the SELECTED chat, so it
     * must not mount before the selection it is meant to describe.
     */
    const pendingTestConfigGroupRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        const pending = pendingTestConfigGroupRef.current;
        if (!pending) return;
        if (selectedChat?.chatType !== 'group' || selectedChat.id !== pending) return;
        pendingTestConfigGroupRef.current = null;
        setActiveTestConfigMode(getUserSettings().study.defaultTestMode === 'exam' ? 'test' : 'study');
        openModal('testConfig');
    }, [selectedChat, setActiveTestConfigMode, openModal, getUserSettings]);
    // The companion's tool calls, executed in App because they are navigations
    // and modal opens the panel itself cannot perform. Anything the model can
    // ask for must appear here; an unhandled `action.type` falls out of the
    // switch silently and the student sees nothing happen.
    const handleCompanionAction = React.useCallback((action: CompanionAction) => {
        switch (action.type) {
            case 'navigate_to_flashcards':
                setAppMode(AppMode.FLASHCARDS);
                setSelectedDeck(null);
                break;
            case 'open_test_config':
                if (selectedChat?.chatType === 'group') {
                    setActiveTestConfigMode(getUserSettings().study.defaultTestMode === 'exam' ? 'test' : 'study');
                    openModal('testConfig');
                } else if (groups.length > 0) {
                    // FIXED (F9): the modal used to be opened on a fixed 50 ms
                    // timer after selecting the first group. On a slow render it
                    // mounted while `selectedChat` was still the previous chat
                    // (or none), so it built the test against the wrong group or
                    // rendered nothing. The group is now recorded as PENDING and
                    // the effect above opens the modal when that selection has
                    // actually landed — no timer, and no wrong-group window.
                    pendingTestConfigGroupRef.current = groups[0].id;
                    handleSelectChat({ ...groups[0], chatType: 'group' });
                }
                break;
            case 'open_create_flashcard':
                openModal('createFlashcard');
                break;
            case 'navigate_to_dashboard':
                setAppMode(AppMode.DASHBOARD);
                break;
            case 'navigate_to_chat':
                if (action.payload?.groupId) {
                    const targetGroup = groups.find(g => g.id === action.payload!.groupId);
                    if (targetGroup) { handleSelectChat({ ...targetGroup, chatType: 'group' }); setAppMode(AppMode.CHAT); }
                } else {
                    setAppMode(AppMode.CHAT);
                }
                break;
            case 'navigate_to_notes':
                noteHandlers.navigateToNotes();
                break;
            case 'open_note_learn':
                if (selectedNote) setAppMode(AppMode.NOTE_EDITOR);
                else noteHandlers.navigateToNotes();
                break;
            // The one action that does work rather than navigate: generate cards
            // from the student's weak topics or an explicit topic list, save them
            // atomically, land on the result, and tell the companion what
            // happened so its next message matches what the student can see.
            case 'auto_generate_flashcards': {
                if (!currentUser) break;
                const topicsRaw = action.payload?.topics || '';
                const deckName = action.payload?.deckName || (topicsRaw ? `Weak Areas: ${topicsRaw.split(',').slice(0, 2).join(', ')}` : 'Weak Areas Review');
                const topics = topicsRaw || (companionContext.weakTopics?.join(', ') || '');

                (async () => {
                    try {
                        const sourceContent = buildFlashcardSourceContent({
                            topics,
                            weakTopics: companionContext.weakTopics,
                            selectedNote,
                            notes,
                        });
                        if (sourceContent.trim().length < 50) {
                            showToast('Add a note with at least 50 characters, or specify topics to generate flashcards.', 'error');
                            return;
                        }

                        const topicList = (topics || companionContext.weakTopics?.join(', ') || 'review')
                            .split(',')
                            .map((t: string) => t.trim())
                            .filter(Boolean);
                        const cardCount = normalizeFlashcardCount(topicList.length * 4 || 10);

                        const { flashcards: generated } = await aiGenerateFlashcards(sourceContent, {
                            count: cardCount,
                            style: 'concise',
                        });
                        if (!generated?.length) {
                            showToast('Could not generate flashcards. Try again with more study material.', 'error');
                            return;
                        }

                        // One atomic request: the deck and its cards land together
                        // or neither does. The old loop left a deck announcing
                        // cards it did not contain whenever the connection went
                        // partway through.
                        const fileCourseId = companionContext.courseId;
                        const saved = await saveGeneratedDeck({
                            jobId: `companion-${currentUser.id}-${Date.now()}`,
                            userId: currentUser.id,
                            deckName,
                            description: `Auto-generated by Lantern for: ${topics || 'weak areas review'}`,
                            courseId: fileCourseId,
                            cards: generated.map((card) => ({ front: card.front, back: card.back })),
                        });
                        const newDeck =
                            useFlashcardStore.getState().decks.find((d) => d.id === saved.ref.id) ??
                            ({ id: saved.ref.id, name: saved.ref.name || deckName } as any);
                        if (fileCourseId) {
                            navigateTo(AppMode.COURSE_WORKSPACE, { courseId: fileCourseId });
                        } else {
                            setSelectedDeck(newDeck);
                            setAppMode(AppMode.DECK_DETAIL);
                        }
                        showToast(`Created "${deckName}" with ${saved.saved} flashcards`, 'success');
                        addNotification(`Created "${deckName}" with ${saved.saved} flashcards!`);
                        useCompanionStore.getState().sendMessageStreaming(
                            `[system] Flashcard generation complete: created ${generated.length} cards in the deck "${deckName}". Confirm to the user in a friendly way, mention they can find the deck ${fileCourseId ? 'in this course under Cards' : 'in Flashcards'}.`,
                            companionContext
                        );
                    } catch (err: any) {
                        showToast(err?.message || 'Failed to auto-generate flashcards', 'error');
                    }
                })();
                break;
            }
        }
    }, [selectedChat, groups, setAppMode, setSelectedDeck, openModal, handleSelectChat, currentUser, companionContext, addNotification, noteHandlers, selectedNote, notes, showToast, navigateTo]);

    return { companionContext, handleCompanionAction };
}
