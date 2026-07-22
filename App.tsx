import React, { useEffect, useState, Suspense } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useToastStore } from './stores/toastStore';
import { useConfirmStore } from './stores/confirmStore';
import { ToastBanner } from './components/ui/ToastBanner';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import FeatureTipsHost from './components/featureTips/FeatureTipsHost';
import { useFeatureTipStore } from './stores/featureTipStore';
import { setSessionExpiredHandler } from './services/sessionHandler';
import { supabase as supabaseClient, apiLogoutSession, fetchAccountLifecycle } from './services/supabase';
import { getNoteStudyContent } from '@lantern/shared';
import { AppMode, DirectMessage, MessageType, TransactionType, TestResult, User } from './types';
import { useUIStore } from './stores/uiStore';
import { useAuthStore } from './stores/authStore';
import { setSentryUser } from './services/sentry';
import { useGroupStore } from './stores/groupStore';
import { useFlashcardStore } from './stores/flashcardStore';
import { useTestStore } from './stores/testStore';
import { useBudgetStore } from './stores/budgetStore';
import { initialUserStats } from './utils/helpers';
import { getBreadcrumbs } from './utils/breadcrumbs';
import { getTotalActiveUnreadChatCount } from './utils/chatUnread';
import { fetchNotifications, fetchDecks, createDeck, createFlashcard, fetchAllFlashcards, bootstrapAuthFromStorage, fetchUserProfile } from './services/supabase';
import { fetchChallenge } from './services/challenges';
import { aiGenerateFlashcards } from './services/ai';
import { purchaseStreakFreeze } from './services/gamificationStreak';
import ChatWindow from './components/ChatWindow';
import QuestionModal from './components/QuestionModal';
import CreateGroupModal from './components/CreateGroupModal';
import GroupInfoModal from './components/GroupInfoModal';
import { TestConfigModal } from './components/TestConfigModal';
import DashboardScreen from './components/DashboardScreen';
import OfflineModeScreen from './components/OfflineModeScreen';
import AuthScreen from './components/AuthScreen';
import ResetPasswordScreen from './components/ResetPasswordScreen';
import SettingsModal from './components/SettingsModal';
import AccountPausedBanner from './components/AccountPausedBanner';
import DuplicateQuestionModal from './components/DuplicateQuestionModal';
import CreateDeckModal from './components/CreateDeckModal';
import CreateFlashcardModal from './components/CreateFlashcardModal';
import NewDirectMessageModal from './components/NewDirectMessageModal';
import AddMembersModal from './components/AddMembersModal';
import UsernameRequiredModal from './components/UsernameRequiredModal';
import NotificationModal from './components/NotificationModal';
import ChallengesInboxModal from './components/ChallengesInboxModal';
import CreateGroupScreen from './components/CreateGroupScreen';
import InviteJoinScreen from './components/InviteJoinScreen';
import AddExpenseModal from './components/AddExpenseModal';
import AddIncomeModal from './components/AddIncomeModal';
import AddInvestmentModal from './components/AddInvestmentModal';
import SetBudgetModal from './components/SetBudgetModal';
import SetMonthlyPlanModal from './components/SetMonthlyPlanModal';
import SavingsGoalModal from './components/InvestModal';
import WalletModal from './components/WalletModal';
import ExpenseSplitModal from './components/ExpenseSplitModal';
import SimulationControls from './components/SimulationControls';
import TestAnalysisModal from './components/TestAnalysisModal';
import CreateMarketplaceListingModal from './components/CreateMarketplaceListingModal';
import EditMarketplaceListingModal from './components/EditMarketplaceListingModal';
// Heavy screens — loaded on demand to reduce initial bundle size
const FlashcardsScreen = lazyWithRetry(() => import('./components/FlashcardsScreen'));
const DeckDetailScreen = lazyWithRetry(() => import('./components/DeckDetailScreen'));
const FlashcardReviewScreen = lazyWithRetry(() => import('./components/FlashcardReviewScreen'));
const CramSessionScreen = lazyWithRetry(() => import('./components/CramSessionScreen'));
const MatchStudyScreen = lazyWithRetry(() => import('./components/MatchStudyScreen'));
const LearnStudyScreen = lazyWithRetry(() => import('./components/LearnStudyScreen'));
const ImportAndStudyModal = lazyWithRetry(() => import('./components/ImportAndStudyModal'));
const OnboardingFlow = lazyWithRetry(() => import('./components/OnboardingFlow'));
const DailyQuestsWidget = lazyWithRetry(() => import('./components/DailyQuestsWidget'));
const GameScreen = lazyWithRetry(() => import('./components/GameScreen').then(m => ({ default: m.GameScreen })));
const GameResultScreen = lazyWithRetry(() => import('./components/GameResultScreen'));
const TestTakingScreen = lazyWithRetry(() => import('./components/TestTakingScreen').then(m => ({ default: m.TestTakingScreen })));
const TestReviewScreen = lazyWithRetry(() => import('./components/TestReviewScreen'));
const BudgetTrackerScreen = lazyWithRetry(() => import('./components/BudgetTrackerScreen'));
const MarketplaceScreen = lazyWithRetry(() => import('./components/MarketplaceScreen'));
const MarketplaceListingDetailScreen = lazyWithRetry(() => import('./components/MarketplaceListingDetailScreen'));
const MyListingsScreen = lazyWithRetry(() => import('./components/MyListingsScreen'));
const MarketplaceInquiriesScreen = lazyWithRetry(() => import('./components/MarketplaceInquiriesScreen'));
const MarketplaceOrdersScreen = lazyWithRetry(() => import('./components/MarketplaceOrdersScreen'));
const MarketplaceOrderDetailScreen = lazyWithRetry(() => import('./components/MarketplaceOrderDetailScreen'));
const SellerCustomersScreen = lazyWithRetry(() => import('./components/SellerCustomersScreen'));
const SellerProfileScreen = lazyWithRetry(() => import('./components/SellerProfileScreen'));
const AdminScreen = lazyWithRetry(() => import('./components/AdminScreen'));
const NotesScreen = lazyWithRetry(() => import('./components/NotesScreen'));
import NoteEditorScreen from './components/NoteEditorScreen';
const LibraryScreen = lazyWithRetry(() => import('./components/LibraryScreen'));
const StudyHubScreen = lazyWithRetry(() => import('./components/StudyHubScreen'));
const AIToolsHub = lazyWithRetry(() => import('./components/AIToolsHub'));
const LandingPage = lazyWithRetry(() => import('./components/marketing/LandingPage'));
import AppShell from './components/layout/AppShell';
import Breadcrumb from './components/layout/Breadcrumb';
import { useAuthHandlers } from './hooks/useAuthHandlers';
import { useGroupHandlers } from './hooks/useGroupHandlers';
import { useTestHandlers } from './hooks/useTestHandlers';
import { useGameHandlers } from './hooks/useGameHandlers';
import { useFlashcardHandlers } from './hooks/useFlashcardHandlers';
import { useBudgetHandlers } from './hooks/useBudgetHandlers';
import { useOfflineHandlers } from './hooks/useOfflineHandlers';
import { useAppEffects } from './hooks/useAppEffects';
import { useFontMode } from './hooks/useFontMode';
import { useInviteLink } from './hooks/useInviteLink';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useRouteSync } from './hooks/useRouteSync';
import { isPublicMarketplacePath } from './utils/appRoutes';
import GuestMarketplaceShell from './components/marketplace/GuestMarketplaceShell';
import { useAIHandlers } from './hooks/useAIHandlers';
import AIGenerateQuestionsModal from './components/AIGenerateQuestionsModal';
import AICompanionPanel from './components/AICompanionPanel';
import { usePlatformAdmin } from './hooks/usePlatformAdmin';
import { useCompanionStore } from './stores/companionStore';
import { useNotesStore } from './stores/notesStore';
import { useStudyGoalsStore } from './stores/studyGoalsStore';
import { useNoteHandlers } from './hooks/useNoteHandlers';
import { CompanionAction } from './types';
import { buildFlashcardSourceContent } from './utils/buildFlashcardSource';
import { normalizeFlashcardCount } from './utils/flashcardGeneration';

export const App: React.FC = () => {
    const { navigateTo, navigateToPath } = useAppNavigation();
    const { routeHydrating } = useRouteSync();
    const { currentUser, setCurrentUser, setAuthLoading, isAuthLoading, isPasswordRecovery, setPasswordRecovery } = useAuthStore();
    const isPlatformAdmin = usePlatformAdmin();
    const { groups, messages, dmThreads, directMessages, userVotes, notifications, setNotifications } = useGroupStore();
        const { testResults, offlineBundles, pendingSyncResults, userQuestionStats, studyActivityDays,
            activeTestSession, activeStudySession, activeGameSession, setActiveGameSession } = useTestStore();
    const { folders, notes, selectedNote, comments, isLoading: notesLoading, isSaving: notesSaving, error: notesError, selectedFolderId, setSelectedFolderId } = useNotesStore();
    const { toast, showToast, dismissToast } = useToastStore();
    const globalConfirm = useConfirmStore();
    const [myListingsRefreshKey, setMyListingsRefreshKey] = useState(0);
    const [accountLifecycle, setAccountLifecycle] = useState<{
        status: 'active' | 'deactivated';
        deletionScheduledAt?: string | null;
        graceDaysRemaining?: number | null;
    } | null>(null);
    const [reactivatingAccount, setReactivatingAccount] = useState(false);

    useEffect(() => {
        setSessionExpiredHandler(async (message) => {
            showToast(message || 'Your session has expired. Please sign in again.', 'error');
            await apiLogoutSession();
            setCurrentUser(null);
            setAuthLoading(false);
        });
    }, [showToast, setCurrentUser, setAuthLoading]);

    useEffect(() => {
        const sync = (user: User | null) => {
            setSentryUser(user ? { id: user.id } : null);
        };
        sync(useAuthStore.getState().currentUser);
        return useAuthStore.subscribe((state, prev) => {
            const nextId = state.currentUser?.id ?? null;
            const prevId = prev.currentUser?.id ?? null;
            if (nextId !== prevId) {
                sync(state.currentUser);
            }
        });
    }, []);
    const { studyGoal, dailyQuiz, dailyQuizProgress, setStudyGoal, setDailyQuiz, answerDailyQuestion, completeDailyQuiz, getDailyQuizForToday, getQuizForNote } = useStudyGoalsStore();
    const { decks, flashcards, dueCardsCount, offlineDeckIds, pendingFlashcardReviews } = useFlashcardStore();
    const { transactions, budget } = useBudgetStore();
    const { isOpen: isCompanionOpen, toggle: toggleCompanion } = useCompanionStore();
    const markChecklist = useFeatureTipStore((s) => s.markChecklist);

    // ensure offline deck IDs and any cached decks/flashcards are loaded on web
    useEffect(() => {
        const store = useFlashcardStore.getState();
        store.loadOfflineFromStorage();
        store.loadFromStorage();
    }, []);

    const {
        appMode, setAppMode,
        isSidebarExpanded, toggleSidebar,
        theme,
        modals, openModal, closeModal,
        activeTestConfigMode, setActiveTestConfigMode,
        subgroupParentId,
        selectedDeck, setSelectedDeck,
        editingDeck, editingFlashcard, flashcardInitialDeckId,
        activeReviewSession, setActiveReviewSession,
        activeCramSession,
        activeTestResult, setActiveTestResult,
        analyzingResult, setAnalyzingResult,
        challengeOpponent,
        selectedChat, setSelectedChat,
        marketplaceListingCategory, setMarketplaceListingCategory,
        selectedMarketplaceListingId, setSelectedMarketplaceListingId,
        selectedMarketplaceOrderId, setSelectedMarketplaceOrderId,
        editingMarketplaceListing, setEditingMarketplaceListing,
        selectedSellerId, setSelectedSellerId,
        isOnline,
        libraryTab, setLibraryTab,
    } = useUIStore();

    useEffect(() => {
        if (isCompanionOpen) markChecklist('tryCompanion');
    }, [isCompanionOpen, markChecklist]);

    useEffect(() => {
        if (
            appMode === AppMode.LIBRARY ||
            appMode === AppMode.NOTES ||
            appMode === AppMode.FLASHCARDS ||
            appMode === AppMode.NOTE_EDITOR ||
            appMode === AppMode.DECK_DETAIL
        ) {
            markChecklist('openLibrary');
        }
        if (appMode === AppMode.MARKETPLACE || appMode === AppMode.MARKETPLACE_LISTING_DETAIL) {
            markChecklist('exploreMarketplace');
        }
        if (appMode === AppMode.OFFLINE_MODE) markChecklist('tryOffline');
    }, [appMode, markChecklist]);

    const {
        users, dataLoaded, setDataLoaded, bootstrapLoad, setBootstrapLoad,
        toggleTheme, handleLogout,
        getUserSettings, handleUpdateSettingsCategory,
        handleUpdateProfile, handleUpdateCurrentUserAvatar,
        handleUpdatePassword, handlePauseAccount, handleDeleteAccountImmediate,
        handleReactivateAccount, handleImportAccount, handleExportAccount,
        handleResetSettings,
        handleSavePreset, handleDeletePreset
    } = useAuthHandlers();

    useEffect(() => {
        if (!currentUser?.id) {
            setAccountLifecycle(null);
            return;
        }
        void fetchAccountLifecycle(currentUser.id).then(setAccountLifecycle);
    }, [currentUser?.id]);

    const handleReactivateFromBanner = async () => {
        setReactivatingAccount(true);
        try {
            await handleReactivateAccount();
            if (currentUser?.id) {
                const next = await fetchAccountLifecycle(currentUser.id);
                setAccountLifecycle(next);
            }
            showToast('Account reactivated. Welcome back!', 'success');
        } catch (e: unknown) {
            showToast(e instanceof Error ? e.message : 'Could not reactivate account.', 'error');
        } finally {
            setReactivatingAccount(false);
        }
    };

    const {
        handleSelectChat, handleInitiateDm, handleSendDm, handleDeleteDmThread,
        handleArchiveDmThread, handleUnarchiveDmThread, onSendMessage,
        handleCreateSubGroup, handleCreateGroup, handleEnterCreatedGroup, handleCloseCreateGroupModal,
        handleQuestionSubmit, onVoteQuestion, handleUpvoteDuplicateAndClose,
        onFlagAsSimilar, onOpenCreateSubGroupModal,
        handleUpdateGroupDetails, handleUpdateGroupAvatar,
        handleInviteMembers, handleRevokeInvitation, handleRevokePhoneInvitation,
        handlePromoteToAdmin, handleDemoteAdmin, handleDeleteGroup,
        handleToggleArchiveGroup, handleApproveMember, handleRejectMember,
        onOpenQuestionModal, onOpenGroupInfoModal,
        onOpenTestConfigModal, onOpenStudyConfigModal,
        handleChallengeUser, addNotification,
        handleMarkNotificationAsRead, handleMarkAllNotificationsAsRead,
        handleLoadMoreMessages, handleChatBack
    } = useGroupHandlers({ users });
    const {
        handleTestSubmit, handleUpdateAnswer, handleChangeQuestion,
        handleToggleBookmark, handleSubmitTest, handleEndStudySession,
        handleCancelActiveSession, handlePauseSession, handleResumeSession,
        handleRetakeTest, handlePracticeFailedQuestions,
        isSubmittingTest,
    } = useTestHandlers({ addNotification });
    const {
        handleSendChallenge,
        handleStartSoloPractice,
        handleStartChallengePlay,
        handleGameAnswer,
        handleRematch,
        handlePauseGame,
        handleEndGame,
        handleResumeGame,
    } = useGameHandlers({ addNotification, handleChallengeUser });
    const {
        isGeneratingFlashcards,
        handleSelectDeck, handleOpenCreateDeckModal, handleOpenEditDeckModal,
        handleCreateOrUpdateDeck, handleDeleteDeck,
        handleOpenCreateFlashcardModal, handleOpenEditFlashcardModal,
        handleCreateOrUpdateFlashcard, handleDeleteFlashcard,
        handleGenerateFlashcards,
        handleGenerateFlashcardsFromTestResult,
        handleStartReview, handleStartCram, handleCramAnswer, handleCramIncorrect, handleEndCramSession,
        handleUpdateSrsData, handleToggleDeckOffline, handleResetDeckStatistics,
        handleExportDeck, handleImportDeck,
        handleStartMatch, handleStartLearn, handleEndStudyMode,
        handleLoadMoreFlashcards
    } = useFlashcardHandlers();

    const [showImportAndStudy, setShowImportAndStudy] = React.useState(false);
    const [endGameConfirmOpen, setEndGameConfirmOpen] = React.useState(false);
    const [endGameLoading, setEndGameLoading] = React.useState(false);
    const handleResumeAnySession = React.useCallback((mode: AppMode) => {
        if (mode === AppMode.GAME_ACTIVE) {
            handleResumeGame();
        } else {
            handleResumeSession(mode);
        }
    }, [handleResumeGame, handleResumeSession]);

    const handleCancelPausedSession = React.useCallback(() => {
        const gamePaused = !!(
            activeGameSession
            && !activeGameSession.isComplete
            && !activeGameSession.awaitingOpponent
            && appMode !== AppMode.GAME_ACTIVE
        );
        if (gamePaused) {
            setEndGameConfirmOpen(true);
        } else {
            handleCancelActiveSession();
        }
    }, [activeGameSession, appMode, handleCancelActiveSession]);

    const confirmEndGame = React.useCallback(async () => {
        setEndGameLoading(true);
        try {
            await handleEndGame();
            setEndGameConfirmOpen(false);
        } finally {
            setEndGameLoading(false);
        }
    }, [handleEndGame]);

    const endGameConfirmMessage = activeGameSession?.isSoloPractice
        ? 'Are you sure you want to end this practice session? Your progress will not be saved.'
        : 'Are you sure you want to quit this duel? Your opponent will win by default and your progress will be lost.';

    const location = useLocation();
    const [showOnboarding, setShowOnboarding] = React.useState(() => {
        if (typeof window === 'undefined') return false;
        return !localStorage.getItem('lantern_onboarding_complete');
    });

    const { handleNavigateToBudgetTracker, handleSetBudget, handleAddTransaction, handleDeleteTransaction } = useBudgetHandlers();
    const { handleDownloadForOffline, handleStartOfflineSession, handleDeleteBundle, handleSyncResults, handleSyncFlashcardReviews, handleImportBundle, handleRenameBundle } = useOfflineHandlers({ addNotification });
    const handleChallengeNotification = React.useCallback(async (type: string, challengeId: string) => {
        if (type === 'challenge_result') {
            void handleStartChallengePlay(challengeId);
            return;
        }
        if (type === 'challenge_accepted') {
            try {
                const challenge = await fetchChallenge(challengeId);
                const opponentName = challenge.opponent?.name || 'Your opponent';
                const startNow = window.confirm(`${opponentName} accepted your duel! Start playing now?`);
                if (startNow) {
                    void handleStartChallengePlay(challengeId);
                } else {
                    openModal('challenges');
                }
            } catch {
                openModal('challenges');
            }
            return;
        }
        openModal('challenges');
    }, [handleStartChallengePlay, openModal]);

    const {
        refreshDashboardGamification,
        dailyQuests,
        serverStreak,
        streakFreezes,
        questsLoaded,
    } = useAppEffects({
        dataLoaded,
        setDataLoaded,
        bootstrapLoad,
        setBootstrapLoad,
        onChallengeNotification: handleChallengeNotification,
    });

    React.useEffect(() => {
        if (!currentUser?.id || appMode !== AppMode.DASHBOARD) return;
        void refreshDashboardGamification();
    }, [currentUser?.id, appMode, refreshDashboardGamification]);

    const handlePurchaseStreakFreeze = React.useCallback(async () => {
        const { walletBalance, setWalletBalance } = useBudgetStore.getState();
        if (walletBalance < 50) {
            alert('You need 50 wallet coins to buy a streak freeze.');
            return;
        }
        try {
            const result = await purchaseStreakFreeze();
            if (typeof result?.walletBalance === 'number') {
                setWalletBalance(result.walletBalance);
            }
            void refreshDashboardGamification();
        } catch (e: any) {
            alert(e?.message || 'Could not purchase streak freeze');
        }
    }, [refreshDashboardGamification]);

    const handleLogoutAndRedirect = React.useCallback(async () => {
        await handleLogout();
        navigateToPath('/welcome', { replace: true });
    }, [handleLogout, navigateToPath]);

    useFontMode();
    useInviteLink(currentUser?.id);
    const { isAILoading, aiError, setAiError, handleAIGenerateQuestions, handleAIExplainAnswer, handleAIStudyRecommendations, handleAIAskTutor, handleAIEnhanceFlashcard } = useAIHandlers();
    const noteHandlers = useNoteHandlers(currentUser?.id);

    const handleWeakAreaFlashcardsFromAnalysis = React.useCallback(
        async (results: TestResult, weakTopics: string[]) => {
            const ok = await handleGenerateFlashcardsFromTestResult(results, weakTopics);
            if (ok) setAnalyzingResult(null);
        },
        [handleGenerateFlashcardsFromTestResult, setAnalyzingResult]
    );

    // Build context object for the AI companion
    const companionContext = React.useMemo(() => {
        const weakTopics = testResults.flatMap(r => r.tagBreakdown ? Object.entries(r.tagBreakdown)
            .filter(([, s]: [string, any]) => s.total > 0 && s.correct / s.total < 0.6)
            .map(([tag]) => tag) : []);
        const uniqueWeak = [...new Set(weakTopics)].slice(0, 5);
        const recentScore = testResults.length > 0
            ? `Last test: ${Math.round(testResults[testResults.length - 1].score)}%`
            : undefined;
        // Budget summary for current month
        let budgetSummary: string | undefined;
        if (transactions.length > 0) {
            const thisMonth = new Date().toISOString().slice(0, 7);
            const monthlyExpenses = transactions.filter(t => t.type === TransactionType.EXPENSE && t.date?.startsWith(thisMonth));
            const totalSpent = monthlyExpenses.reduce((s, t) => s + (t.amount || 0), 0);
            if (budget?.monthlyLimit && budget.monthlyLimit > 0) {
                budgetSummary = `Spent ₦${totalSpent.toFixed(0)} of ₦${budget.monthlyLimit.toFixed(0)} monthly budget this month`;
            } else if (totalSpent > 0) {
                budgetSummary = `Spent ₦${totalSpent.toFixed(0)} this month (no budget limit set)`;
            }
        }
        return {
            userName: currentUser?.firstName || currentUser?.name,
            groups: groups.filter(g => !g.isArchived).map(g => g.name).slice(0, 5),
            weakTopics: uniqueWeak,
            dueCardsCount,
            recentTestSummary: recentScore,
            budgetSummary,
            currentScreen: (() => {
                switch (appMode) {
                    case AppMode.DASHBOARD: return 'Dashboard';
                    case AppMode.CHAT: return selectedChat ? `Group chat: ${(selectedChat as any).name || 'Chat'}` : 'Chat (no group selected)';
                    case AppMode.FLASHCARDS: return selectedDeck ? `Flashcards – deck: ${selectedDeck.name}` : 'Flashcards (deck list)';
                    case AppMode.TEST_ACTIVE: return 'Active test session';
                    case AppMode.STUDY_ACTIVE: return 'Active study session';
                    case AppMode.GAME: return 'Multiplayer quiz game';
                    case AppMode.MARKETPLACE: return 'Marketplace';
                    case AppMode.BUDGET_TRACKER: return 'Budget Tracker';
                    case AppMode.OFFLINE: return 'Offline mode';
                    case AppMode.NOTES: return 'Notes library';
                    case AppMode.NOTE_EDITOR: return selectedNote ? `Note: ${selectedNote.title}` : 'Note editor';
                    default: return undefined;
                }
            })(),
            noteId: appMode === AppMode.NOTE_EDITOR ? selectedNote?.id : undefined,
            noteContext: appMode === AppMode.NOTE_EDITOR && selectedNote
                ? getNoteStudyContent({
                    sourceType: selectedNote.sourceType,
                    body: selectedNote.body,
                    summary: selectedNote.summary,
                    attachments: selectedNote.attachments,
                  }).substring(0, 6000) || undefined
                : undefined,
            noteTitle: appMode === AppMode.NOTE_EDITOR ? selectedNote?.title : undefined,
            studyGoal,
            activeSessionSummary: activeTestSession
                ? `Taking a ${activeTestSession.config?.mode || 'test'} with ${activeTestSession.questions?.length ?? 0} questions`
                : activeStudySession
                ? `Study session with ${activeStudySession.questions?.length ?? 0} questions`
                : undefined,
        };
    }, [testResults, groups, dueCardsCount, currentUser, transactions, budget, appMode, selectedChat, selectedDeck, activeTestSession, activeStudySession, selectedNote, studyGoal]);

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
                    handleSelectChat({ ...groups[0], chatType: 'group' });
                    setTimeout(() => {
                        setActiveTestConfigMode(getUserSettings().study.defaultTestMode === 'exam' ? 'test' : 'study');
                        openModal('testConfig');
                    }, 50);
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

                        const flashcardStore = useFlashcardStore.getState();
                        const newDeck = await createDeck(
                            { name: deckName, description: `Auto-generated by Lantern for: ${topics || 'weak areas review'}` },
                            currentUser.id
                        );
                        flashcardStore.updateDecks((prev) => [...prev, newDeck]);

                        for (const card of generated) {
                            await createFlashcard({
                                deckId: newDeck.id,
                                type: 'BASIC',
                                front: card.front,
                                back: card.back,
                                userId: currentUser.id,
                            });
                        }

                        flashcardStore.setFlashcards(
                            await fetchAllFlashcards(undefined, currentUser.id)
                        );
                        setSelectedDeck(newDeck);
                        setAppMode(AppMode.DECK_DETAIL);
                        showToast(`Created "${deckName}" with ${generated.length} flashcards`, 'success');
                        addNotification(`Created "${deckName}" with ${generated.length} flashcards!`);
                        useCompanionStore.getState().sendMessageStreaming(
                            `[system] Flashcard generation complete: created ${generated.length} cards in the deck "${deckName}". Confirm to the user in a friendly way, mention they can find the deck in Flashcards.`,
                            companionContext
                        );
                    } catch (err: any) {
                        showToast(err?.message || 'Failed to auto-generate flashcards', 'error');
                    }
                })();
                break;
            }
        }
    }, [selectedChat, groups, setAppMode, setSelectedDeck, openModal, handleSelectChat, currentUser, companionContext, addNotification, noteHandlers, selectedNote, notes, showToast]);
    const duplicateInfo = useUIStore(s => s.duplicateInfo);
    const setDuplicateInfo = useUIStore(s => s.setDuplicateInfo);
    const messagesForChat = !selectedChat ? [] : selectedChat.chatType === 'group'
        ? (Array.isArray(messages[selectedChat.id]) ? messages[selectedChat.id] : [])
        : (Array.isArray(directMessages[selectedChat.id]) ? directMessages[selectedChat.id] : []).map((dm: DirectMessage): any => {
            const dmThread = selectedChat as any;
            const participantInfo = dmThread?.participants?.[dm.senderId];
            const sender = users.find(u => u.id === dm.senderId)
                || groups.flatMap(g => g.members || []).find(m => m.id === dm.senderId)
                || (participantInfo ? { id: dm.senderId, name: participantInfo.name, avatarUrl: participantInfo.avatarUrl, points: 0, badges: [], stats: initialUserStats } : null)
                || { id: dm.senderId, name: 'Unknown User', points: 0, badges: [], stats: initialUserStats };
            return {
                id: dm.id, groupId: dm.threadId, timestamp: dm.timestamp,
                sender, type: MessageType.TEXT, text: dm.text, upvotes: 0, downvotes: 0,
            };
        });

    const handleShellNavigate = React.useCallback((mode: AppMode) => {
        // Tapping Chat in bottom nav should return to the list, not stay on the open thread.
        if (mode === AppMode.CHAT) {
            navigateTo(AppMode.CHAT, {}, { replace: true });
            return;
        }
        navigateTo(mode);
    }, [navigateTo]);

    const findFirstGroup = () => groups.find(g => !g.isArchived && (messages[g.id]?.length ?? 0) > 0) || groups.find(g => !g.isArchived);
    const handleOpenQuickTest = (groupId: string) => { const group = groups.find(g => g.id === groupId); if (!group) { alert('Group not found.'); return; } handleSelectChat({ ...group, chatType: 'group' }); onOpenTestConfigModal(); };
    const handleOpenQuickStudy = (groupId: string) => { const group = groups.find(g => g.id === groupId); if (!group) { alert('Group not found.'); return; } handleSelectChat({ ...group, chatType: 'group' }); onOpenStudyConfigModal(); };
    const handleFlashcardStudy = () => {
        const today = new Date().toISOString().split('T')[0];
        const best = decks.map(d => ({ deck: d, due: flashcards.filter(fc => fc.deckId === d.id && fc.srsData?.nextReviewDate && fc.srsData.nextReviewDate.split('T')[0] <= today).length })).sort((a, b) => b.due - a.due)[0];
        if (best?.deck) { handleSelectDeck(best.deck); handleStartReview(best.deck); }
        else showToast('No flashcard decks available. Create a deck first.', 'error');
    };
    const handleStudyDeck = (deck: import('./types').Deck) => {
        handleSelectDeck(deck);
        handleStartReview(deck);
    };
    // Redirect invalid mode/state combinations
    useEffect(() => {
        if (appMode === AppMode.TEST_ACTIVE && !activeTestSession && !activeTestResult) {
            setAppMode(AppMode.CHAT);
        } else if (appMode === AppMode.STUDY_ACTIVE && !activeStudySession) {
            setAppMode(AppMode.CHAT);
        } else if (appMode === AppMode.GAME_ACTIVE && !activeGameSession) {
            setAppMode(AppMode.CHAT);
        } else if (
            appMode === AppMode.GAME_RESULTS
            && (!activeGameSession || (!activeGameSession.isComplete && !activeGameSession.awaitingOpponent))
        ) {
            setAppMode(AppMode.CHAT);
        } else if (appMode === AppMode.TEST_REVIEW && !activeTestResult) {
            setAppMode(AppMode.CHAT);
        } else if (appMode === AppMode.ADMIN && !isAuthLoading && !isPlatformAdmin) {
            setAppMode(AppMode.DASHBOARD);
        } else if (appMode === AppMode.NOTE_EDITOR && !selectedNote && !useUIStore.getState().importProgress) {
            setAppMode(AppMode.NOTES);
        } else if (appMode === AppMode.DECK_DETAIL && !selectedDeck) {
            setAppMode(AppMode.FLASHCARDS);
        } else if (appMode === AppMode.FLASHCARD_REVIEW && !activeReviewSession) {
            setAppMode(AppMode.FLASHCARDS);
        } else if (appMode === AppMode.FLASHCARD_CRAM && !activeCramSession) {
            setAppMode(AppMode.FLASHCARDS);
        } else if ((appMode === AppMode.FLASHCARD_MATCH || appMode === AppMode.FLASHCARD_LEARN) && !selectedDeck) {
            setAppMode(AppMode.FLASHCARDS);
        } else if (appMode === AppMode.MARKETPLACE_LISTING_DETAIL && !selectedMarketplaceListingId) {
            setAppMode(AppMode.MARKETPLACE);
        } else if (appMode === AppMode.SELLER_PROFILE && !selectedSellerId) {
            setAppMode(AppMode.MARKETPLACE);
        }
    }, [
        appMode, activeTestSession, activeStudySession, activeGameSession, activeTestResult,
        isAuthLoading, isPlatformAdmin, selectedNote, selectedDeck, activeReviewSession,
        activeCramSession, selectedMarketplaceListingId, selectedSellerId, setAppMode,
    ]);

    // Re-fetch notifications from DB when the notification modal opens
    useEffect(() => {
        if (modals.notification && currentUser) {
            fetchNotifications(currentUser.id).then(fetched => {
                setNotifications(Array.isArray(fetched) ? fetched : []);
            }).catch(() => { /* handled in service layer */ });
        }
    }, [modals.notification, currentUser, setNotifications]);

    if (isAuthLoading || (currentUser && routeHydrating)) return (
        <div className="min-h-screen bg-lantern-background flex flex-col items-center justify-center gap-8">
            <img src="/lantern-icon-v2.png" alt="Lantern Study" width={96} height={96} className="rounded-[22%]" draggable={false} />
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-lantern-primary" />
        </div>
    );
    if (isPasswordRecovery) {
        return (
            <ResetPasswordScreen
                onComplete={async () => {
                    setPasswordRecovery(false);
                    const { data: { session } } = await supabaseClient.auth.getSession();
                    if (session?.user) {
                        try {
                            const profile = await fetchUserProfile(session.user.id);
                            if (profile) {
                                setCurrentUser({
                                    id: profile.id,
                                    name: profile.name,
                                    username: profile.username || undefined,
                                    firstName: profile.first_name || undefined,
                                    lastName: profile.last_name || undefined,
                                    avatarUrl: profile.avatar_url || '',
                                    email: session.user.email!,
                                    password: '',
                                    phoneNumber: profile.phone || '',
                                    points: profile.points,
                                    badges: profile.badges as User['badges'],
                                    stats: profile.stats,
                                });
                                bootstrapAuthFromStorage();
                                setAuthLoading(false);
                                navigateToPath('/dashboard', { replace: true });
                            }
                        } catch {
                            setCurrentUser(null);
                        }
                    }
                }}
            />
        );
    }
    if (!currentUser) {
        const path = location.pathname;
        const isLandingPath = path === '/' || path === '/welcome';
        const isAuthPath =
            path === '/login' ||
            path === '/signup' ||
            path === '/forgot-password' ||
            path === '/verify-email';

        if (isLandingPath) {
            return (
                <Suspense fallback={null}>
                    <LandingPage
                        onSignIn={() => navigateToPath('/login')}
                        onContinue={() => navigateToPath('/signup')}
                    />
                </Suspense>
            );
        }

        if (isAuthPath) {
            return (
                <AuthScreen
                    onAuthSuccess={(user) => {
                        bootstrapAuthFromStorage();
                        setCurrentUser(user);
                        setAuthLoading(false);
                        const next = new URLSearchParams(location.search).get('next');
                        if (next && next.startsWith('/') && !next.startsWith('//')) {
                            navigateToPath(next, { replace: true });
                        } else {
                            navigateToPath('/dashboard', { replace: true });
                        }
                    }}
                />
            );
        }

        if (isPublicMarketplacePath(path)) {
            return (
                <GuestMarketplaceShell
                    onSignIn={() => navigateToPath('/login')}
                    onSignUp={() => navigateToPath('/signup')}
                />
            );
        }

        const nextTarget = `${path}${location.search || ''}`;
        return <Navigate to={`/login?next=${encodeURIComponent(nextTarget)}`} replace />;
    }

    const invitePathMatch = location.pathname.match(/^\/invite\/([^/]+)$/);
    if (invitePathMatch) {
        return (
            <InviteJoinScreen
                inviteId={decodeURIComponent(invitePathMatch[1])}
                userId={currentUser.id}
            />
        );
    }

    const renderNotesScreen = (embedded = false) => (
        <NotesScreen
            theme={theme}
            folders={folders}
            notes={notes}
            isLoading={notesLoading}
            error={notesError}
            selectedFolderId={selectedFolderId}
            onSelectFolder={setSelectedFolderId}
            embedded={embedded}
            onCreateNote={async () => {
                try {
                    await noteHandlers.handleCreateNote();
                } catch (e: any) {
                    showToast(e?.message || 'Failed to create note', 'error');
                }
            }}
            onCreateFolder={(name) => {
                void noteHandlers.handleCreateFolder(name).catch((e: any) => {
                    showToast(e?.message || 'Failed to create folder', 'error');
                });
            }}
            onSelectNote={(id) => { void noteHandlers.openNote(id); }}
            onPdfImport={async (file) => {
                try {
                    await noteHandlers.handlePdfImport(file, selectedFolderId || undefined);
                } catch {
                    // Sticky toast shown by runNoteFileImport
                }
            }}
            onPresentationImport={async (file) => {
                try {
                    await noteHandlers.handlePresentationImport(file, selectedFolderId || undefined);
                } catch {
                    // Sticky toast shown by runNoteFileImport
                }
            }}
            onPhotosImport={async (files) => {
                try {
                    await noteHandlers.handlePhotosImport(files, selectedFolderId || undefined);
                } catch {
                    // Sticky toast shown by runNoteImagesImport
                }
            }}
        />
    );

    const renderFlashcardsScreen = (embedded = false) => (
        <FlashcardsScreen
            decks={decks}
            flashcards={flashcards}
            isInitialLoading={
                bootstrapLoad.decks === 'pending' || bootstrapLoad.flashcards === 'pending'
            }
            embedded={embedded}
            onOpenCreateDeck={handleOpenCreateDeckModal}
            onOpenCreateFlashcard={() => handleOpenCreateFlashcardModal()}
            onSelectDeck={handleSelectDeck}
            onImportDeck={handleImportDeck}
            onStartStudy={handleFlashcardStudy}
            onStudyDeck={handleStudyDeck}
            onOfflineToggle={async (deck, enable) => {
                await handleToggleDeckOffline(deck, enable);
                showToast(enable ? 'Deck saved for offline use' : 'Deck removed from offline storage', 'success');
            }}
            onExportDeck={handleExportDeck}
        />
    );

    const mainContent = () => {
        switch (appMode) {
            case AppMode.CREATE_GROUP:
                return (
                    <CreateGroupScreen
                        currentUser={currentUser}
                        allUsers={users}
                        onCreateGroup={handleCreateGroup}
                        onEnterGroup={handleEnterCreatedGroup}
                        onBack={() => navigateTo(AppMode.CHAT)}
                    />
                );
            case AppMode.CHAT:
                return (
                    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                    <ChatWindow chat={selectedChat} messages={messagesForChat} currentUser={currentUser} userVotes={userVotes}
                    onSendMessage={onSendMessage} onOpenQuestionModal={onOpenQuestionModal}
                    onOpenGroupInfoModal={() => selectedChat && selectedChat.chatType === 'group' && onOpenGroupInfoModal()}
                    onOpenTestConfigModal={onOpenTestConfigModal} onOpenStudyConfigModal={onOpenStudyConfigModal}
                    onVoteQuestion={onVoteQuestion} onFlagAsSimilar={onFlagAsSimilar}
                    onOpenCreateSubGroupModal={onOpenCreateSubGroupModal}
                    groups={groups} onToggleArchiveGroup={handleToggleArchiveGroup}
                    onOpenAIGenerateModal={() => openModal('aiGenerateQuestions')}
                    onAIQuery={handleAIAskTutor}
                    dmThreads={dmThreads}
                    onSelectChat={handleSelectChat}
                    onBack={handleChatBack}
                    onCreateGroup={() => navigateTo(AppMode.CREATE_GROUP)}
                    onOpenNewDmModal={() => openModal('newDm')}
                    onDeleteDmThread={handleDeleteDmThread}
                    onArchiveDmThread={handleArchiveDmThread}
                    onUnarchiveDmThread={handleUnarchiveDmThread}
                    onLoadMoreMessages={handleLoadMoreMessages} />
                    </div>
                );
            case AppMode.TEST_ACTIVE:
                if (!activeTestSession) return null;
                return <TestTakingScreen mode="test" session={activeTestSession}
                    onUpdateAnswer={handleUpdateAnswer} onChangeQuestion={handleChangeQuestion}
                    onToggleBookmark={handleToggleBookmark} onSubmitTest={handleSubmitTest}
                    onSubmitOfflineTest={handleSubmitTest} onPauseSession={handlePauseSession}
                    onCancelSession={handleCancelActiveSession} isSubmittingTest={isSubmittingTest} />;
            case AppMode.STUDY_ACTIVE:
                if (!activeStudySession) return null;
                return <TestTakingScreen mode="study" session={activeStudySession}
                    showExplanationsImmediately={getUserSettings().study.showExplanationsImmediately}
                    onUpdateAnswer={handleUpdateAnswer} onChangeQuestion={handleChangeQuestion}
                    onToggleBookmark={handleToggleBookmark} onEndSession={handleEndStudySession}
                    onPauseSession={handlePauseSession} onCancelSession={handleCancelActiveSession} />;
            case AppMode.GAME_ACTIVE:
                if (!activeGameSession) return null;
                return <GameScreen
                    session={activeGameSession}
                    onUpdateAnswer={handleGameAnswer}
                    onPauseSession={handlePauseGame}
                    onRequestEndSession={() => setEndGameConfirmOpen(true)}
                />;
            case AppMode.GAME_RESULTS:
                if (!activeGameSession || (!activeGameSession.isComplete && !activeGameSession.awaitingOpponent)) return null;
                return <GameResultScreen session={activeGameSession} currentUser={currentUser} onRematch={handleRematch}
                    onExit={() => { setActiveGameSession(null); setAppMode(AppMode.CHAT); }} />;
            case AppMode.TEST_REVIEW:
                if (!activeTestResult) return null;
                return <TestReviewScreen results={activeTestResult} allTestResults={testResults} groups={groups}
                    onExit={() => { setActiveTestResult(null); setAppMode(AppMode.CHAT); }}
                    onNavigateToDashboard={() => { setActiveTestResult(null); setAppMode(AppMode.DASHBOARD); }}
                    onRetakeTest={handleRetakeTest} onPracticeFailedQuestions={handlePracticeFailedQuestions}
                    onExplainAnswer={handleAIExplainAnswer} />;
            case AppMode.DASHBOARD:
                return <DashboardScreen theme={theme} testResults={testResults} groups={groups} currentUser={currentUser} offlineBundles={offlineBundles}
                    studyActivityDays={studyActivityDays}
                    onNavigateToChat={() => navigateTo(AppMode.CHAT)} allMessages={messages}
                    userQuestionStats={userQuestionStats} onViewAnalysis={setAnalyzingResult}
                    onNavigateToFlashcards={() => { setLibraryTab('flashcards'); navigateTo(AppMode.LIBRARY); }}
                    onNavigateToMarketplace={() => navigateTo(AppMode.MARKETPLACE)}
                    onNavigateToCreateGroup={() => navigateTo(AppMode.CREATE_GROUP)}
                    onNavigateToBudget={() => navigateTo(AppMode.BUDGET_TRACKER)}
                    onNavigateToStudyHub={() => navigateTo(AppMode.STUDY_HUB)}
                    onNavigateToLibrary={() => navigateTo(AppMode.LIBRARY)}
                    onNavigateToOffline={() => navigateTo(AppMode.OFFLINE_MODE)}
                    onToggleCompanion={toggleCompanion}
                    deckCount={decks.length}
                    hasBudgetSet={!!(budget?.monthlyLimit && budget.monthlyLimit > 0) || transactions.length > 0}
                    hasOpenedLibrary={appMode === AppMode.LIBRARY || appMode === AppMode.NOTES || appMode === AppMode.FLASHCARDS}
                    hasTriedCompanion={isCompanionOpen}
                    hasSubmittedQuestion={Object.values(messages).some((list) =>
                      Array.isArray(list) && list.some((m: any) => m?.senderId === currentUser.id && m?.type === MessageType.QUESTION)
                    )}
                    hasExploredMarketplace={appMode === AppMode.MARKETPLACE || appMode === AppMode.MARKETPLACE_LISTING_DETAIL}
                    hasTriedOffline={appMode === AppMode.OFFLINE_MODE}
                    onNavigateToNotes={() => { setLibraryTab('notes'); navigateTo(AppMode.LIBRARY); }}
                    onOpenImportAndStudy={() => navigateTo(AppMode.AI_TOOLS)}
                    onNavigateToAITools={() => navigateTo(AppMode.AI_TOOLS)}
                    onReviewDueCards={handleFlashcardStudy}
                    onViewTestResult={(result) => { setActiveTestResult(result); setAppMode(AppMode.TEST_REVIEW); }}
                    dailyQuests={dailyQuests}
                    questsLoaded={questsLoaded}
                    onRefreshGamification={refreshDashboardGamification}
                    serverStreak={serverStreak}
                    streakFreezes={streakFreezes}
                    onPurchaseStreakFreeze={handlePurchaseStreakFreeze}
                    dueCardsCount={dueCardsCount} flashcards={flashcards} pendingSyncCount={pendingSyncResults.length + pendingFlashcardReviews.length}
                    unreadNotificationCount={notifications.filter(n => !n.read).length}
                    onOpenQuickTest={handleOpenQuickTest} onOpenQuickStudy={handleOpenQuickStudy}
                    onGetStudyRecommendations={handleAIStudyRecommendations}
                    studyGoal={studyGoal}
                    onStudyGoalChange={setStudyGoal}
                    dailyQuiz={getDailyQuizForToday()}
                    dailyQuizProgress={dailyQuizProgress}
                    onStartDailyQuiz={async () => {
                        const source = notes.find(n => (n.body?.length ?? 0) > 50) || notes[0];
                        const content = source?.body || source?.summary || '';
                        if (content.length < 50) {
                            showToast('Add or import a note with at least 50 characters to generate a daily quiz.', 'info');
                            return;
                        }
                        await noteHandlers.handleStartDailyQuiz(content, source?.id);
                    }}
                    onDailyQuizAnswer={answerDailyQuestion}
                    onCompleteDailyQuiz={completeDailyQuiz}
                    activeTestSession={activeTestSession}
                    activeStudySession={activeStudySession}
                    onResumeSession={() => handleResumeSession(activeTestSession ? AppMode.TEST_ACTIVE : AppMode.STUDY_ACTIVE)}
                />;
            case AppMode.LIBRARY:
                return (
                    <LibraryScreen
                        tab={libraryTab}
                        onTabChange={setLibraryTab}
                        dueCardsCount={dueCardsCount}
                        noteCount={notes.length}
                        deckCount={decks.length}
                        notesContent={renderNotesScreen(true)}
                        flashcardsContent={renderFlashcardsScreen(true)}
                    />
                );
            case AppMode.STUDY_HUB:
                return (
                    <StudyHubScreen
                        dueCardsCount={dueCardsCount}
                        decks={decks}
                        onStartDueReview={handleFlashcardStudy}
                        onOpenLibrary={() => navigateTo(AppMode.LIBRARY)}
                        onOpenAITools={() => navigateTo(AppMode.AI_TOOLS)}
                        onSelectDeck={handleSelectDeck}
                        onStartLearn={handleStartLearn}
                        activeTestSession={activeTestSession}
                        activeStudySession={activeStudySession}
                        onResumeSession={() => handleResumeSession(activeTestSession ? AppMode.TEST_ACTIVE : AppMode.STUDY_ACTIVE)}
                        recentTestCount={testResults.length}
                        onViewRecentTests={() => navigateTo(AppMode.DASHBOARD)}
                    />
                );
            case AppMode.AI_TOOLS:
                return (
                    <AIToolsHub
                        theme={theme}
                        onOpenNote={(noteId) => { void noteHandlers.openNote(noteId); }}
                        onStartLearn={handleFlashcardStudy}
                        onTakePracticeTest={() => navigateTo(AppMode.DASHBOARD)}
                        onComplete={() => showToast('Study materials ready!', 'success')}
                    />
                );
            case AppMode.NOTES:
                return renderNotesScreen(false);
            case AppMode.NOTE_EDITOR:
                if (!selectedNote) return null;
                return (
                    <NoteEditorScreen
                        key={selectedNote.id}
                        theme={theme}
                        note={selectedNote}
                        comments={comments}
                        groups={groups}
                        currentUserId={currentUser.id}
                        isSaving={notesSaving}
                        onBack={() => navigateTo(AppMode.NOTES)}
                        onSave={(updates) => noteHandlers.handleAutoSave(selectedNote.id, updates)}
                        onCancelPendingSave={noteHandlers.cancelAutoSave}
                        onDelete={async () => {
                            if (!confirm('Delete this note?')) return;
                            const noteId = selectedNote.id;
                            noteHandlers.cancelAutoSave();
                            useNotesStore.getState().setSelectedNote(null);
                            navigateTo(AppMode.NOTES);
                            try {
                                await noteHandlers.handleDeleteNote(noteId);
                            } catch (e: any) {
                                showToast(e?.message || 'Failed to delete note', 'error');
                            }
                        }}
                        onSmartNote={async (editorState) => {
                            try {
                                await noteHandlers.handleSmartNote(selectedNote.id, editorState);
                                showToast('Smart notes ready!', 'success');
                            } catch (e: any) {
                                showToast(e?.message || 'Smart note failed', 'error');
                            }
                        }}
                        onChatWithNote={noteHandlers.handleChatWithNote}
                        onGenerateFlashcards={async (editorState) => {
                            try {
                                const result = await noteHandlers.handleCreateFlashcardDeckFromNote(10, editorState);
                                if (result?.deck) {
                                    setSelectedDeck(result.deck);
                                    setAppMode(AppMode.DECK_DETAIL);
                                    showToast(`Created ${result.count} flashcards in "${result.deck.name}"`, 'success');
                                }
                            } catch (e: any) {
                                showToast(e?.message || 'Failed to generate flashcards', 'error');
                            }
                        }}
                        onGenerateQuiz={async (editorState) => {
                            try {
                                const session = await noteHandlers.handleStartNoteQuiz(editorState);
                                if (session?.questions?.length) {
                                    showToast(`Quiz ready — ${session.questions.length} questions below`, 'success');
                                }
                            } catch (e: any) {
                                showToast(e?.message || 'Failed to generate quiz', 'error');
                            }
                        }}
                        studyGoal={studyGoal}
                        dailyQuiz={getQuizForNote(selectedNote.id)}
                        dailyQuizProgress={dailyQuizProgress}
                        onStudyGoalChange={setStudyGoal}
                        onDailyQuizAnswer={answerDailyQuestion}
                        onCompleteDailyQuiz={completeDailyQuiz}
                        onRegenerateQuiz={async () => {
                            try {
                                await noteHandlers.handleStartNoteQuiz({
                                    title: selectedNote.title,
                                    body: selectedNote.body,
                                });
                                showToast('New quiz ready!', 'success');
                            } catch (e: any) {
                                showToast(e?.message || 'Failed to generate quiz', 'error');
                            }
                        }}
                        onPostComment={(text) => { void noteHandlers.handlePostComment(selectedNote.id, text); }}
                        onShareWithGroup={(groupId) => { void noteHandlers.handleShareWithGroup(selectedNote.id, groupId); }}
                        onTranscriptReady={() => {
                            noteHandlers.cancelAutoSave();
                            void useNotesStore.getState().loadNote(selectedNote.id);
                        }}
                    />
                );
            case AppMode.FLASHCARDS:
                return renderFlashcardsScreen(false);
            case AppMode.DECK_DETAIL:
                if (!selectedDeck) return null;
                return <DeckDetailScreen deck={selectedDeck} flashcards={flashcards}
                    onBack={() => { setAppMode(AppMode.FLASHCARDS); setSelectedDeck(null); }}
                    onStartReview={handleStartReview} onStartCram={handleStartCram}
                    onStartMatch={handleStartMatch} onStartLearn={handleStartLearn}
                    onOpenCreateFlashcard={handleOpenCreateFlashcardModal} onOpenEditFlashcard={handleOpenEditFlashcardModal}
                    onDeleteFlashcard={handleDeleteFlashcard} onOpenEditDeck={handleOpenEditDeckModal}
                    onDeleteDeck={handleDeleteDeck} onGenerateFlashcards={handleGenerateFlashcards}
                    isGenerating={isGeneratingFlashcards} onResetStatistics={handleResetDeckStatistics}
                    onExportDeck={handleExportDeck}
                    onLoadMoreCards={handleLoadMoreFlashcards}
                    onEnhanceFlashcard={handleAIEnhanceFlashcard}
                />;
            case AppMode.FLASHCARD_REVIEW:
                if (!activeReviewSession) return null;
                return <FlashcardReviewScreen session={activeReviewSession} onUpdateSrs={handleUpdateSrsData}
                    onEndSession={() => { setAppMode(AppMode.DECK_DETAIL); setActiveReviewSession(null); }} />;
            case AppMode.FLASHCARD_CRAM:
                if (!activeCramSession) return null;
                return <CramSessionScreen session={activeCramSession} onAnswer={handleCramAnswer}
                    onEndSession={handleEndCramSession} onCramIncorrect={handleCramIncorrect} />;
            case AppMode.FLASHCARD_MATCH:
                if (!selectedDeck) return null;
                return <MatchStudyScreen
                    cards={flashcards.filter(fc => fc.deckId === selectedDeck.id)}
                    deckName={selectedDeck.name}
                    onExit={handleEndStudyMode}
                    theme={theme}
                />;
            case AppMode.FLASHCARD_LEARN:
                if (!selectedDeck) return null;
                return <LearnStudyScreen
                    cards={flashcards.filter(fc => fc.deckId === selectedDeck.id)}
                    deckName={selectedDeck.name}
                    onExit={handleEndStudyMode}
                    theme={theme}
                />;
            case AppMode.OFFLINE_MODE:
                return <OfflineModeScreen offlineBundles={offlineBundles}
                    offlineDecks={decks.filter(d => offlineDeckIds.includes(d.id))}
                    pendingSyncResultsCount={pendingSyncResults.length}
                    pendingFlashcardReviewsCount={pendingFlashcardReviews.length}
                    onStartOfflineSession={handleStartOfflineSession} onDeleteBundle={handleDeleteBundle}
                    onSyncPendingResults={handleSyncResults} onSyncFlashcardReviews={handleSyncFlashcardReviews}
                    onImportBundle={handleImportBundle}
                    onRenameBundle={handleRenameBundle} isOnline={isOnline} />;
            case AppMode.BUDGET_TRACKER:
                return <BudgetTrackerScreen currentUser={currentUser}
                    transactions={transactions.filter(t => t.userId === currentUser.id)}
                    budget={budget?.userId === currentUser.id ? budget : null}
                    onOpenAddExpense={() => openModal('addExpense')} onOpenAddIncome={() => openModal('addIncome')}
                    onOpenAddInvestment={() => openModal('addInvestment')}
                    onOpenSetBudget={() => openModal('setBudget')} onDeleteTransaction={handleDeleteTransaction}
                    onToggleSidebar={toggleSidebar}
                    onOpenSetMonthlyPlan={() => openModal('setMonthlyPlan')}
                    onOpenSavingsGoal={() => openModal('savingsGoal')}
                    onOpenWallet={() => openModal('wallet')}
                    onOpenExpenseSplit={() => openModal('expenseSplit')}
                    onOpenFinancialToolkit={() => openModal('financialToolkit')} />;
            case AppMode.MARKETPLACE:
                return <MarketplaceScreen onNavigate={(screen, params) => {
                    if (screen === 'CreateMarketplaceListing') {
                        setMarketplaceListingCategory(params?.category || 'academic');
                        openModal('createMarketplaceListing');
                    } else if (screen === 'MarketplaceListingDetail') {
                        setSelectedMarketplaceListingId(params.listingId);
                        setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                    } else if (screen === 'MyListings') {
                        setAppMode(AppMode.MY_LISTINGS);
                    } else if (screen === 'MarketplaceInquiries') {
                        setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                    } else if (screen === 'MarketplaceOrders') {
                        setAppMode(AppMode.MARKETPLACE_ORDERS);
                    }
                }} />;
            case AppMode.MARKETPLACE_LISTING_DETAIL:
                if (!selectedMarketplaceListingId) return null;
                return <MarketplaceListingDetailScreen listingId={selectedMarketplaceListingId}
                    onBack={() => setAppMode(AppMode.MARKETPLACE)}
                    onNavigate={(screen, params) => {
                        if (screen === 'DirectMessages' && params?.userId) handleInitiateDm(params.userId);
                        else if (screen === 'SellerProfile' && params?.userId) {
                            setSelectedSellerId(params.userId);
                            setAppMode(AppMode.SELLER_PROFILE);
                        } else if (screen === 'MarketplaceTransaction' || screen === 'MarketplaceOrderDetail') {
                            setSelectedMarketplaceOrderId(params?.orderId);
                            setAppMode(AppMode.MARKETPLACE_ORDER_DETAIL);
                        } else if (screen === 'MarketplaceOrders') {
                            setAppMode(AppMode.MARKETPLACE_ORDERS);
                        } else if (screen === 'MyListings') {
                            setAppMode(AppMode.MY_LISTINGS);
                        } else if (screen === 'EditMarketplaceListing' && params?.listing) {
                            setEditingMarketplaceListing(params.listing);
                            openModal('editMarketplaceListing');
                        }
                    }} />;
            case AppMode.MY_LISTINGS:
                return <MyListingsScreen onNavigate={(screen, params) => {
                    if (screen === 'CreateMarketplaceListing') {
                        setMarketplaceListingCategory(params?.category || 'academic');
                        openModal('createMarketplaceListing');
                    } else if (screen === 'EditMarketplaceListing') {
                        setEditingMarketplaceListing(params.listing);
                        openModal('editMarketplaceListing');
                    } else if (screen === 'MarketplaceListingDetail') {
                        setSelectedMarketplaceListingId(params.listingId);
                        setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                    } else if (screen === 'MarketplaceInquiries') {
                        setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                    } else if (screen === 'MarketplaceOrders') {
                        setAppMode(AppMode.MARKETPLACE_ORDERS);
                    } else if (screen === 'SellerCustomers') {
                        setAppMode(AppMode.SELLER_CUSTOMERS);
                    }
                }} onBack={() => setAppMode(AppMode.MARKETPLACE)} refreshKey={myListingsRefreshKey} />;
            case AppMode.MARKETPLACE_ORDERS:
                return <MarketplaceOrdersScreen
                    onBack={() => setAppMode(AppMode.MARKETPLACE)}
                    onNavigate={(screen, params) => {
                        if (screen === 'MarketplaceOrderDetail' && params?.orderId) {
                            setSelectedMarketplaceOrderId(params.orderId);
                            setAppMode(AppMode.MARKETPLACE_ORDER_DETAIL);
                        }
                    }}
                />;
            case AppMode.MARKETPLACE_ORDER_DETAIL:
                if (!selectedMarketplaceOrderId) return null;
                return <MarketplaceOrderDetailScreen
                    orderId={selectedMarketplaceOrderId}
                    onBack={() => setAppMode(AppMode.MARKETPLACE_ORDERS)}
                    onOrderUpdated={() => setMyListingsRefreshKey((k) => k + 1)}
                    onNavigate={(screen, params) => {
                        if (screen === 'MarketplaceListingDetail' && params?.listingId) {
                            setSelectedMarketplaceListingId(params.listingId);
                            setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                        }
                    }}
                />;
            case AppMode.SELLER_CUSTOMERS:
                return <SellerCustomersScreen
                    onBack={() => setAppMode(AppMode.MY_LISTINGS)}
                    onNavigate={(screen, params) => {
                        if (screen === 'DirectMessages' && params?.userId) handleInitiateDm(params.userId);
                    }}
                />;
            case AppMode.MARKETPLACE_INQUIRIES:
                return <MarketplaceInquiriesScreen onNavigate={(screen, params) => {
                    if (screen === 'DirectMessages' && params?.userId) handleInitiateDm(params.userId);
                    else if (screen === 'MarketplaceListingDetail') {
                        setSelectedMarketplaceListingId(params.listingId);
                        setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                    }
                }} onBack={() => setAppMode(AppMode.MARKETPLACE)} userId={currentUser.id} />;
            case AppMode.SELLER_PROFILE:
                if (!selectedSellerId) return null;
                return <SellerProfileScreen userId={selectedSellerId}
                    onBack={() => { setSelectedSellerId(null); setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL); }}
                    onNavigate={(screen, params) => {
                        if (screen === 'MarketplaceListingDetail') {
                            setSelectedMarketplaceListingId(params.listingId);
                            setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                        } else if (screen === 'DirectMessages' && params?.userId) handleInitiateDm(params.userId);
                    }} />;
            case AppMode.CREATE_MARKETPLACE_LISTING:
                if (!modals.createMarketplaceListing) openModal('createMarketplaceListing');
                return <MarketplaceScreen onNavigate={(screen, params) => {
                    if (screen === 'CreateMarketplaceListing') {
                        setMarketplaceListingCategory(params?.category || 'academic');
                        openModal('createMarketplaceListing');
                    } else if (screen === 'MarketplaceListingDetail') {
                        setSelectedMarketplaceListingId(params.listingId);
                        setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                    } else if (screen === 'MyListings') setAppMode(AppMode.MY_LISTINGS);
                    else if (screen === 'MarketplaceInquiries') setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                }} />;
            case AppMode.ADMIN:
                if (!isPlatformAdmin) return null;
                return <AdminScreen onBackToDashboard={() => setAppMode(AppMode.DASHBOARD)} />;
            default:
                return <div className="p-4">Mode not implemented yet.</div>;
        }
    };
    const sidebarProps = {
        currentUser, groups, dmThreads,
        selectedChatId: selectedChat?.id,
        onSelectChat: handleSelectChat,
        onNavigateToCreateGroup: () => navigateTo(AppMode.CREATE_GROUP),
        onNavigateToDashboard: () => navigateTo(AppMode.DASHBOARD),
        onNavigateToOfflineMode: () => navigateTo(AppMode.OFFLINE_MODE),
        onNavigateToLibrary: () => navigateTo(AppMode.LIBRARY),
        onNavigateToBudgetTracker: handleNavigateToBudgetTracker,
        onNavigateToMarketplace: () => navigateTo(AppMode.MARKETPLACE),
        onNavigateToAdmin: () => navigateTo(AppMode.ADMIN),
        pendingSyncCount: pendingSyncResults.length + pendingFlashcardReviews.length, isOnline,
        onSyncPendingResults: handleSyncResults,
        onUpdateCurrentUserAvatar: handleUpdateCurrentUserAvatar,
        onOpenSettingsModal: () => openModal('settings'),
        currentAppMode: appMode, onLogout: handleLogoutAndRedirect,
        isExpanded: isSidebarExpanded, onToggleExpand: toggleSidebar,
        onOpenNewDmModal: () => openModal('newDm'),
        unreadNotificationCount: notifications.filter(n => !n.read).length,
        onOpenNotificationModal: () => openModal('notification'),
        activeTestSession, activeStudySession, activeGameSession,
        onResumeSession: handleResumeAnySession,
        onCancelSession: handleCancelPausedSession,
        theme, onToggleTheme: toggleTheme, dueCardsCount,
        onToggleCompanion: toggleCompanion,
        isCompanionOpen,
    };
    return (
        <ErrorBoundary>
        <Suspense fallback={
            <div className="flex-1 flex items-center justify-center bg-lantern-background">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-lantern-primary/30 border-t-lantern-primary" />
            </div>
        }>
        <AppShell sidebarProps={sidebarProps} dueCardsCount={dueCardsCount}
            unreadChatCount={getTotalActiveUnreadChatCount(groups, dmThreads)}
            hideMobileAiUsageBadge={
                (appMode === AppMode.CHAT && !!selectedChat)
                || appMode === AppMode.GAME_ACTIVE
                || appMode === AppMode.TEST_ACTIVE
                || appMode === AppMode.STUDY_ACTIVE
            }
            onNavigate={handleShellNavigate}>
            <div className={`shrink-0 ${
                appMode === AppMode.CREATE_GROUP || appMode === AppMode.ADMIN
                    ? 'hidden'
                    : appMode === AppMode.CHAT && selectedChat
                        ? 'hidden md:block'
                        : ''
            }`}>
            <Breadcrumb items={getBreadcrumbs({ appMode, selectedDeck, navigateTo, setActiveTestResult })} />
            </div>
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {accountLifecycle?.status === 'deactivated' && (
                <AccountPausedBanner
                    deletionScheduledAt={accountLifecycle.deletionScheduledAt}
                    graceDaysRemaining={accountLifecycle.graceDaysRemaining}
                    onReactivate={() => void handleReactivateFromBanner()}
                    onExport={() => void handleExportAccount()}
                    loading={reactivatingAccount}
                />
            )}
            {mainContent()}
            </div>
            <CreateGroupModal isOpen={modals.createGroup} onClose={handleCloseCreateGroupModal}
                onSubmit={handleCreateSubGroup} parentId={subgroupParentId} allGroups={groups} />
            <QuestionModal isOpen={modals.question} onClose={() => closeModal('question')}
                onSubmit={handleQuestionSubmit} groupName={selectedChat?.chatType === 'group' ? selectedChat.name : ''} />
            {selectedChat?.chatType === 'group' && <GroupInfoModal
                isOpen={modals.groupInfo} onClose={() => closeModal('groupInfo')}
                group={selectedChat} currentUser={currentUser}
                onUpdateDetails={handleUpdateGroupDetails} onUpdateGroupAvatar={handleUpdateGroupAvatar}
                onPromoteToAdmin={handlePromoteToAdmin} onDemoteAdmin={handleDemoteAdmin}
                onDeleteGroup={handleDeleteGroup} onToggleArchiveGroup={handleToggleArchiveGroup}
                onChallengeUser={handleChallengeUser} onApproveMember={handleApproveMember}
                onRejectMember={handleRejectMember} onOpenAddMembersModal={() => openModal('addMembers')}
                onRevokeInvitation={handleRevokeInvitation} onRevokePhoneInvitation={handleRevokePhoneInvitation}
                onInitiateDm={handleInitiateDm} />}
            {selectedChat?.chatType === 'group' && <TestConfigModal
                isOpen={modals.testConfig} onClose={() => closeModal('testConfig')}
                group={selectedChat} allGroups={groups} mode={activeTestConfigMode}
                allMessages={messages} userQuestionStats={userQuestionStats}
                testPresets={currentUser.testPresets || []} challengeOpponent={challengeOpponent}
                onSavePreset={handleSavePreset} onDeletePreset={handleDeletePreset}
                onSubmit={(config, mode, useSpacedRepetition, selectedSubgroupIDs) => {
                    if (mode === 'game') { handleSendChallenge(config); }
                    else { handleTestSubmit(config, mode, useSpacedRepetition, selectedSubgroupIDs); }
                }}
                onSoloPractice={(config) => handleStartSoloPractice(config)}
                onDownloadForOffline={handleDownloadForOffline} />}
            <NewDirectMessageModal isOpen={modals.newDm} onClose={() => closeModal('newDm')}
                currentUser={currentUser}
                onStartDm={(userId) => { handleInitiateDm(userId); closeModal('newDm'); }} />
            <CreateDeckModal isOpen={modals.createDeck} onClose={() => closeModal('createDeck')}
                onSubmit={handleCreateOrUpdateDeck} editingDeck={editingDeck} />
            <CreateFlashcardModal isOpen={modals.createFlashcard} onClose={() => closeModal('createFlashcard')}
                onSubmit={handleCreateOrUpdateFlashcard} decks={decks}
                initialDeckId={flashcardInitialDeckId} editingFlashcard={editingFlashcard}
                onEnhanceFlashcard={handleAIEnhanceFlashcard} />
            {selectedChat?.chatType === 'group' && <AddMembersModal
                isOpen={modals.addMembers} onClose={() => closeModal('addMembers')}
                onSubmit={(userIds) => handleInviteMembers(selectedChat.id, userIds)}
                group={selectedChat} currentUser={currentUser} />}
            <NotificationModal isOpen={modals.notification} onClose={() => closeModal('notification')}
                notifications={notifications} onMarkAsRead={handleMarkNotificationAsRead}
                onMarkAllAsRead={handleMarkAllNotificationsAsRead}
                onNavigate={(screen, params) => {
                    if (screen === 'MarketplaceInquiries') {
                        setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                    } else if (screen === 'MarketplaceListingDetail' && params?.listingId) {
                        setSelectedMarketplaceListingId(params.listingId);
                        setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                    } else if (screen === 'Marketplace') {
                        setAppMode(AppMode.MARKETPLACE);
                    } else if (screen === 'Challenges') {
                        openModal('challenges');
                    } else if (screen === 'PlayChallenge' && params?.challengeId) {
                        void handleStartChallengePlay(params.challengeId);
                    } else if (screen === 'DirectMessages' && params?.userId) {
                        handleInitiateDm(params.userId);
                    }
                }} />
            <ChallengesInboxModal
                isOpen={modals.challenges}
                onClose={() => closeModal('challenges')}
                currentUserId={currentUser.id}
                onPlayChallenge={(id) => { void handleStartChallengePlay(id); }}
            />
            <AddExpenseModal isOpen={modals.addExpense} onClose={() => closeModal('addExpense')} onSubmit={handleAddTransaction} />
            <AddIncomeModal isOpen={modals.addIncome} onClose={() => closeModal('addIncome')} onSubmit={handleAddTransaction} />
            <AddInvestmentModal isOpen={modals.addInvestment} onClose={() => closeModal('addInvestment')} onSubmit={handleAddTransaction} />
            <SetBudgetModal isOpen={modals.setBudget} onClose={() => closeModal('setBudget')} onSubmit={handleSetBudget} currentBudget={budget} />
            <SetMonthlyPlanModal isOpen={modals.setMonthlyPlan} onClose={() => closeModal('setMonthlyPlan')} currentBudget={budget} onSave={(categoryBudgets) => { if (budget) { handleSetBudget({ ...budget, categoryBudgets }); } }} />
            <SavingsGoalModal isOpen={modals.savingsGoal} onClose={() => closeModal('savingsGoal')} currentUserId={currentUser?.id || ''} />
            <WalletModal isOpen={modals.wallet} onClose={() => closeModal('wallet')} />
            <SimulationControls isOpen={modals.financialToolkit} onClose={() => closeModal('financialToolkit')} />
            <ExpenseSplitModal isOpen={modals.expenseSplit} onClose={() => closeModal('expenseSplit')} currentUserId={currentUser?.id || ''} currentUserName={currentUser?.name || ''} />
            {analyzingResult && (
                <TestAnalysisModal
                    isOpen={!!analyzingResult}
                    onClose={() => setAnalyzingResult(null)}
                    results={analyzingResult}
                    onGenerateWeakTopicFlashcards={handleWeakAreaFlashcardsFromAnalysis}
                    isGeneratingFlashcards={isGeneratingFlashcards}
                />
            )}
            {duplicateInfo && <DuplicateQuestionModal isOpen={modals.duplicateQuestion}
                onClose={() => { closeModal('duplicateQuestion'); setDuplicateInfo(null); }}
                duplicateInfo={duplicateInfo} onUpvoteAndClose={handleUpvoteDuplicateAndClose} />}
            <CreateMarketplaceListingModal isOpen={modals.createMarketplaceListing}
                onClose={() => closeModal('createMarketplaceListing')} category={marketplaceListingCategory}
                onSuccess={() => closeModal('createMarketplaceListing')} />
            {editingMarketplaceListing && <EditMarketplaceListingModal
                isOpen={modals.editMarketplaceListing}
                onClose={() => { closeModal('editMarketplaceListing'); setEditingMarketplaceListing(null); }}
                listing={editingMarketplaceListing}
                onSuccess={() => { closeModal('editMarketplaceListing'); setEditingMarketplaceListing(null); }} />}
            <AIGenerateQuestionsModal isOpen={modals.aiGenerateQuestions}
                onClose={() => {
                    setAiError(null);
                    closeModal('aiGenerateQuestions');
                }}
                onSubmit={(notes, options) => handleAIGenerateQuestions(notes, options)}
                isGenerating={isAILoading}
                error={aiError} />
            {currentUser && <UsernameRequiredModal isOpen={modals.usernameRequired}
                onClose={() => closeModal('usernameRequired')} currentUser={currentUser}
                onSuccess={(username, firstName, lastName) => {
                    setCurrentUser({
                        ...currentUser, username, firstName, lastName,
                        name: firstName && lastName ? `${firstName} ${lastName}` : currentUser.name,
                    });
                    closeModal('usernameRequired');
                }} />}
            <AICompanionPanel
                context={companionContext}
                onAction={handleCompanionAction}
                theme={theme}
            />
            {showImportAndStudy && (
                <Suspense fallback={null}>
                    <ImportAndStudyModal
                        isOpen={showImportAndStudy}
                        onClose={() => setShowImportAndStudy(false)}
                        onComplete={() => setShowImportAndStudy(false)}
                        onOpenNote={(noteId) => { noteHandlers.openNote(noteId); setShowImportAndStudy(false); }}
                        theme={theme}
                    />
                </Suspense>
            )}
            {showOnboarding && currentUser && !modals.usernameRequired && (
                <Suspense fallback={null}>
                    <OnboardingFlow
                        isOpen={showOnboarding}
                        onSkip={() => { localStorage.setItem('lantern_onboarding_complete', '1'); setShowOnboarding(false); }}
                        onComplete={({ streakTarget }) => {
                            localStorage.setItem('lantern_onboarding_complete', '1');
                            localStorage.setItem('lantern_streak_target', String(streakTarget));
                            setShowOnboarding(false);
                            void import('./services/productAnalytics').then(({ trackOnboardingCompleted }) => {
                                trackOnboardingCompleted();
                            });
                        }}
                        onGenerateStarter={async (notes) => {
                            const { flashcards: cards } = await aiGenerateFlashcards(notes, {
                                count: normalizeFlashcardCount(),
                            });
                            if (cards?.length && currentUser) {
                                const deck = await createDeck({ name: 'My First Deck', description: 'From onboarding' }, currentUser.id);
                                for (const c of cards) {
                                    await createFlashcard({ deckId: deck.id, type: 'BASIC' as any, front: c.front, back: c.back, userId: currentUser.id });
                                }
                                const allFlashcards = await fetchAllFlashcards(undefined, currentUser.id);
                                useFlashcardStore.getState().setFlashcards(allFlashcards);
                                useFlashcardStore.getState().updateDecks((prev) => [...prev, deck]);
                            }
                        }}
                        onOpenLearnMode={() => {
                            if (decks[0]) {
                                handleSelectDeck(decks[0]);
                                handleStartLearn(decks[0]);
                            } else {
                                navigateTo(AppMode.STUDY_HUB);
                            }
                        }}
                        theme={theme}
                    />
                </Suspense>
            )}
            <ConfirmDialog
                open={endGameConfirmOpen}
                title="End game?"
                message={endGameConfirmMessage}
                confirmLabel="End game"
                danger
                loading={endGameLoading}
                onConfirm={() => void confirmEndGame()}
                onCancel={() => !endGameLoading && setEndGameConfirmOpen(false)}
            />
            <ConfirmDialog
                open={globalConfirm.open}
                title={globalConfirm.options?.title || 'Confirm'}
                message={globalConfirm.options?.message || ''}
                confirmLabel={globalConfirm.options?.confirmLabel}
                cancelLabel={globalConfirm.options?.cancelLabel}
                danger={globalConfirm.options?.danger}
                onConfirm={globalConfirm.handleConfirm}
                onCancel={globalConfirm.handleCancel}
            />
            <ToastBanner toast={toast} onDismiss={dismissToast} />
            <FeatureTipsHost
                onboardingComplete={!showOnboarding && Boolean(typeof localStorage !== 'undefined' && localStorage.getItem('lantern_onboarding_complete'))}
                appMode={appMode}
                isGroupChat={selectedChat?.chatType === 'group'}
                isLibrary={
                    appMode === AppMode.LIBRARY ||
                    appMode === AppMode.NOTES ||
                    appMode === AppMode.FLASHCARDS
                }
                isAdmin={Boolean(
                    selectedChat?.chatType === 'group' &&
                    Array.isArray((selectedChat as any).adminIds) &&
                    (selectedChat as any).adminIds.includes(currentUser.id)
                )}
                userSettings={getUserSettings()}
            />
        </AppShell>
        </Suspense>
        {/* Outside Suspense so lazy screen loads don't remount Settings and reset the active tab */}
        <SettingsModal isOpen={modals.settings} onClose={() => closeModal('settings')}
            currentUser={currentUser} userSettings={getUserSettings()}
            onUpdateSettingsCategory={handleUpdateSettingsCategory}
            onUpdateProfile={handleUpdateProfile}
            onUpdateAvatar={handleUpdateCurrentUserAvatar}
            onUpdatePassword={handleUpdatePassword} onLogout={handleLogoutAndRedirect}
            onPauseAccount={handlePauseAccount}
            onDeleteAccountImmediate={handleDeleteAccountImmediate}
            onImportAccount={handleImportAccount}
            onExportAccount={handleExportAccount}
            onResetSettings={handleResetSettings} />
        </ErrorBoundary>
    );
};
