import React, { useEffect, useState, Suspense } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useToastStore } from './stores/toastStore';
import { confirmDialog, useConfirmStore } from './stores/confirmStore';
import { useLectureRecordingStore } from './stores/lectureRecordingStore';
import { ToastBanner } from './components/ui/ToastBanner';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import FeatureTipsHost from './components/featureTips/FeatureTipsHost';
import { useFeatureTipStore } from './stores/featureTipStore';
import { setSessionExpiredHandler } from './services/sessionHandler';
import { supabase as supabaseClient, apiLogoutSession, fetchAccountLifecycle } from './services/supabase';
import { getNoteStudyContent, isQuizzableNote } from '@lantern/shared';
import { AppMode, DirectMessage, MessageType, TransactionType, TestResult, User } from './types';
import { useUIStore } from './stores/uiStore';
import { useAuthStore } from './stores/authStore';
import { useAcademicStore } from './stores/academicStore';
import { useLibraryStore } from './stores/libraryStore';
import { activeUserCourses } from './utils/academicSetup';
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
import AccountSuspendedNotice from './components/AccountSuspendedNotice';
import { useAccountSuspensionStore } from './services/accountSuspension';
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
import NoteShareAcceptScreen from './components/NoteShareAcceptScreen';
import AddTransactionModal from './components/AddTransactionModal';
import SetBudgetModal from './components/SetBudgetModal';
import SetMonthlyPlanModal from './components/SetMonthlyPlanModal';
import RecurringModal from './components/RecurringModal';
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
const MarketplacePurchasesScreen = lazyWithRetry(() => import('./components/MarketplacePurchasesScreen'));
const StudyProductDraftsScreen = lazyWithRetry(() => import('./components/StudyProductDraftsScreen'));
const CreatorProfileScreen = lazyWithRetry(() => import('./components/CreatorProfileScreen'));
const DiscoverScreen = lazyWithRetry(() => import('./components/DiscoverScreen'));
const InviteFriendsScreen = lazyWithRetry(() => import('./components/InviteFriendsScreen'));
const CampusScreen = lazyWithRetry(() => import('./components/CampusScreen'));
const CommunityDetailScreen = lazyWithRetry(() => import('./components/CommunityDetailScreen'));
const MarketplaceFavoritesScreen = lazyWithRetry(() => import('./components/MarketplaceFavoritesScreen'));
const MarketplaceInquiriesScreen = lazyWithRetry(() => import('./components/MarketplaceInquiriesScreen'));
const MarketplaceOrdersScreen = lazyWithRetry(() => import('./components/MarketplaceOrdersScreen'));
const MarketplaceCartScreen = lazyWithRetry(() => import('./components/MarketplaceCartScreen'));
const MarketplaceOrderDetailScreen = lazyWithRetry(() => import('./components/MarketplaceOrderDetailScreen'));
const SellerCustomersScreen = lazyWithRetry(() => import('./components/SellerCustomersScreen'));
const SellerProfileScreen = lazyWithRetry(() => import('./components/SellerProfileScreen'));
const JobsBoardScreen = lazyWithRetry(() => import('./components/JobsBoardScreen'));
const JobDetailScreen = lazyWithRetry(() => import('./components/JobDetailScreen'));
const CreateJobScreen = lazyWithRetry(() => import('./components/CreateJobScreen'));
const MyJobPostingsScreen = lazyWithRetry(() => import('./components/MyJobPostingsScreen'));
const MyJobApplicationsScreen = lazyWithRetry(() => import('./components/MyJobApplicationsScreen'));
const JobEmployerScreen = lazyWithRetry(() => import('./components/JobEmployerScreen'));
const JobEmployerPipelineScreen = lazyWithRetry(() => import('./components/JobEmployerPipelineScreen'));
const JobCompanyScreen = lazyWithRetry(() => import('./components/JobCompanyScreen'));
const AdminScreen = lazyWithRetry(() => import('./components/AdminScreen'));
const NotesScreen = lazyWithRetry(() => import('./components/NotesScreen'));
import NoteEditorScreen from './components/NoteEditorScreen';
const LibraryScreen = lazyWithRetry(() => import('./components/LibraryScreen'));
const StudyHubScreen = lazyWithRetry(() => import('./components/StudyHubScreen'));
const AIToolsHub = lazyWithRetry(() => import('./components/AIToolsHub'));
const LandingPage = lazyWithRetry(() => import('./components/marketing/LandingPage'));
import AppShell from './components/layout/AppShell';
import Breadcrumb from './components/layout/Breadcrumb';
import { useAuthHandlers, INITIAL_BOOTSTRAP_LOAD_STATE } from './hooks/useAuthHandlers';
import { useGroupHandlers } from './hooks/useGroupHandlers';
import { useTestHandlers } from './hooks/useTestHandlers';
import { useGameHandlers } from './hooks/useGameHandlers';
import { useFlashcardHandlers } from './hooks/useFlashcardHandlers';
import { useBudgetHandlers } from './hooks/useBudgetHandlers';
import { useOfflineHandlers } from './hooks/useOfflineHandlers';
import { useAppEffects } from './hooks/useAppEffects';
import { useFontMode } from './hooks/useFontMode';
import { useInviteLink } from './hooks/useInviteLink';
import { useNoteShareLink } from './hooks/useNoteShareLink';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useRouteSync } from './hooks/useRouteSync';
import { isPublicMarketplacePath, parseAppRoute } from './utils/appRoutes';
import { peekStashedAuthLinkError } from './utils/authErrorHash';
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

const AppContentLoadingFallback: React.FC = () => (
    <div
        className="flex-1 min-h-0 flex items-center justify-center bg-lantern-background"
        role="status"
        aria-label="Loading page"
    >
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-lantern-primary/30 border-t-lantern-primary" />
        <span className="sr-only">Loading page</span>
    </div>
);

export const App: React.FC = () => {
    const { navigateTo, navigateToPath } = useAppNavigation();
    const { routeHydrating } = useRouteSync();

    // A failed auth link was captured at boot (index.tsx) — route to the
    // login screen so its message is actually seen, instead of landing on
    // the marketing page with the explanation stuck in storage.
    useEffect(() => {
        if (peekStashedAuthLinkError()) {
            navigateToPath('/login', { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot at mount
    }, []);
    const { currentUser, setCurrentUser, setAuthLoading, isAuthLoading, isPasswordRecovery, setPasswordRecovery } = useAuthStore();
    const isPlatformAdmin = usePlatformAdmin();
    const { groups, messages, dmThreads, directMessages, userVotes, notifications, setNotifications } = useGroupStore();
        const { testResults, offlineBundles, pendingSyncResults, userQuestionStats, studyActivityDays,
            activeTestSession, activeStudySession, activeGameSession, setActiveGameSession, pausedSessions } = useTestStore();
    const { folders, notes, selectedNote, comments, isLoading: notesLoading, isSaving: notesSaving, error: notesError, selectedFolderId, setSelectedFolderId } = useNotesStore();
    const { toast, showToast, dismissToast } = useToastStore();
    const globalConfirm = useConfirmStore();
    const [myListingsRefreshKey, setMyListingsRefreshKey] = useState(0);
    const [sellerProfileReturnMode, setSellerProfileReturnMode] = useState<AppMode>(AppMode.MARKETPLACE);
    const [startingDailyQuiz, setStartingDailyQuiz] = useState(false);
    const [accountLifecycle, setAccountLifecycle] = useState<{
        status: 'active' | 'deactivated';
        deletionScheduledAt?: string | null;
        graceDaysRemaining?: number | null;
    } | null>(null);
    const [reactivatingAccount, setReactivatingAccount] = useState(false);

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
        addTransactionType, setAddTransactionType,
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
        selectedMarketplaceListingInitialQuantity, setSelectedMarketplaceListingInitialQuantity,
        selectedJobId, setSelectedJobId,
        selectedMarketplaceOrderId, setSelectedMarketplaceOrderId,
        editingMarketplaceListing, setEditingMarketplaceListing,
        selectedSellerId, setSelectedSellerId,
        selectedCompanyId, setSelectedCompanyId,
        isOnline,
        libraryTab, setLibraryTab,
    } = useUIStore();

    // Source handed to the Study Product Drafts screen by a "Turn into a Study
    // Product" entry (a note / folder / course); null = just view past drafts.
    const [studyProductSource, setStudyProductSource] = useState<
        { noteIds?: string[]; folderId?: string | null; courseId?: string | null; title?: string } | null
    >(null);

    // Phase 3 L: which Discover tab to land on. Set when leaving the nested
    // marketplace so the user returns to the tab they clicked, not to the top.
    const [discoverSection, setDiscoverSection] = useState<
        'communities' | 'groups' | 'people' | 'marketplace'
    >('communities');
    const [communitySlug, setCommunitySlug] = useState<string | null>(null);

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

    // The Library tab lives in the URL (`/library/notes`), and route hydration
    // treats the path as the authority, so switching tabs has to move the URL or
    // the next reload / Back step would snap the user to the other tab. Push
    // rather than replace, so Back undoes the last thing the student did: from
    // Flashcards it returns to Notes rather than throwing them out of the
    // Library entirely, which is the behaviour that made these tabs worth
    // addressing. The cost is that repeated toggling stacks entries; that is the
    // ordinary trade every tabbed page on the web makes, and Back-and-hold skips
    // the stack.
    const handleLibraryTabChange = React.useCallback((tab: 'notes' | 'flashcards') => {
        if (tab === libraryTab) return; // no-op click: never stack a duplicate entry
        setLibraryTab(tab);
        navigateToPath(`/library/${tab}`);
    }, [libraryTab, setLibraryTab, navigateToPath]);

    // /library is auth-gated: it is deliberately absent from PUBLIC_PATH_PREFIXES
    // and from public/sitemap.xml, so this sets the document title and nothing
    // else — no canonical link, no og/meta tags, nothing that invites a crawler.
    // It exists so the two tabs are tellable apart in the browser tab strip and
    // in the Back/Forward history menu, which is the point of giving them URLs.
    useEffect(() => {
        if (appMode !== AppMode.LIBRARY) return;
        const previousTitle = document.title;
        document.title = `Library · ${libraryTab === 'flashcards' ? 'Flashcards' : 'Notes'} — Lantern Study`;
        return () => { document.title = previousTitle; };
    }, [appMode, libraryTab]);

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
        setSessionExpiredHandler(async (message) => {
            showToast(message || 'Your session has expired. Please sign in again.', 'error');
            try {
                await apiLogoutSession();
            } finally {
                setCurrentUser(null);
                setAuthLoading(false);
                setDataLoaded(false);
                setBootstrapLoad(INITIAL_BOOTSTRAP_LOAD_STATE);
                navigateToPath('/welcome', { replace: true });
            }
        });
    }, [showToast, setCurrentUser, setAuthLoading, setDataLoaded, setBootstrapLoad, navigateToPath]);

    // The ACCOUNT_SUSPENDED notice belongs to one signed-in account: drop it
    // when the user signs out (or another account signs in).
    useEffect(() => {
        if (!currentUser?.id) useAccountSuspensionStore.getState().clear();
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
        handleArchiveDmThread, handleUnarchiveDmThread, handleDmThreadStatusChange, onSendMessage,
        handleEditChatMessage, handleRemoveChatMessage, onPeerChatRead,
        handleCreateSubGroup, handleCreateGroup, handleEnterCreatedGroup, handleCloseCreateGroupModal,
        handleQuestionSubmit, onVoteQuestion, handleUpvoteDuplicateAndClose,
        onFlagAsSimilar, onOpenCreateSubGroupModal,
        handleUpdateGroupDetails, handleUpdateGroupAvatar,
        handleInviteMembers, handleAcceptGroupInvite, handleDeclineGroupInvite,
        handleRevokeInvitation, handleRevokePhoneInvitation,
        handlePromoteToAdmin, handleDemoteAdmin, handleRemoveGroupMember, handleLeaveGroup, handleDeleteGroup,
        handleToggleArchiveGroup, handleApproveMember, handleRejectMember,
        onOpenQuestionModal, onOpenGroupInfoModal,
        onOpenTestConfigModal, onOpenStudyConfigModal,
        handleChallengeUser, addNotification,
        handleMarkNotificationAsRead, handleMarkAllNotificationsAsRead,
        handleLoadMoreMessages, handleLoadMoreDirectMessages, handleChatBack, unreadAnchorAt,
    } = useGroupHandlers({ users });
    const {
        handleTestSubmit, handleUpdateAnswer, handleChangeQuestion,
        handleToggleBookmark, handleSubmitTest, handleEndStudySession,
        handleCancelActiveSession, handlePauseSession, handleResumeSession,
        handleResumePausedSession, handleAbandonPausedSession, refreshPausedSessions,
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
        handleCreateOrUpdateDeck, handleMoveDeckToCourse, handleDeleteDeck,
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
    // Starter-deck pre-seed: the first active enrolment (Phase 1 onboarding).
    const myAcademicCourses = useAcademicStore((s) => s.myCourses);
    const onboardingFirstCourse = React.useMemo(() => {
        const first = activeUserCourses(myAcademicCourses)[0];
        return first ? { id: first.course.id, code: first.course.code, title: first.course.title } : null;
    }, [myAcademicCourses]);
    React.useEffect(() => {
        if (showOnboarding && currentUser?.id) void useAcademicStore.getState().loadMyCourses();
    }, [showOnboarding, currentUser?.id]);

    const { handleNavigateToBudgetTracker, handleSetBudget, handleAddTransaction, handleDeleteTransaction, materializeRecurring } = useBudgetHandlers();
    const { isDownloadingBundle, handleDownloadForOffline, handleStartOfflineSession, handleDeleteBundle, handleSyncResults, handleSyncFlashcardReviews, handleImportBundle, handleRenameBundle } = useOfflineHandlers({ addNotification });
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
        authTokenReady,
    } = useAppEffects({
        dataLoaded,
        setDataLoaded,
        bootstrapLoad,
        setBootstrapLoad,
        onChallengeNotification: handleChallengeNotification,
    });

    useEffect(() => {
        if (!currentUser?.id || !authTokenReady) {
            setAccountLifecycle(null);
            return;
        }
        void fetchAccountLifecycle(currentUser.id).then(setAccountLifecycle);
    }, [currentUser?.id, authTokenReady]);

    React.useEffect(() => {
        if (!currentUser?.id || !authTokenReady) return;
        void refreshPausedSessions();
    }, [currentUser?.id, authTokenReady, refreshPausedSessions]);

    React.useEffect(() => {
        if (!currentUser?.id || !authTokenReady || appMode !== AppMode.DASHBOARD) return;
        void refreshDashboardGamification();
    }, [currentUser?.id, authTokenReady, appMode, refreshDashboardGamification]);

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
    useNoteShareLink(currentUser?.id);
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
            const fromRoster = users.find(u => u.id === dm.senderId)
                || groups.flatMap(g => g.members || []).find(m => m.id === dm.senderId);
            const avatarUrl =
                fromRoster?.avatarUrl
                || participantInfo?.avatarUrl
                || dm.senderAvatar
                || undefined;
            const sender = fromRoster
                ? { ...fromRoster, avatarUrl: fromRoster.avatarUrl || avatarUrl }
                : participantInfo
                    ? {
                        id: dm.senderId,
                        name: participantInfo.name || dm.senderName || 'User',
                        avatarUrl,
                        points: 0,
                        badges: [],
                        stats: initialUserStats,
                      }
                    : {
                        id: dm.senderId,
                        name: dm.senderName || 'Unknown User',
                        avatarUrl,
                        points: 0,
                        badges: [],
                        stats: initialUserStats,
                      };
            return {
                id: dm.id, groupId: dm.threadId, timestamp: dm.timestamp,
                sender, type: MessageType.TEXT, text: dm.text, upvotes: 0, downvotes: 0,
                editedAt: dm.editedAt,
                removedAt: dm.removedAt,
                isRemoved: dm.isRemoved,
                replyToMessageId: dm.replyToMessageId,
                replyTo: dm.replyTo,
                threadRootId: dm.threadRootId,
                replyCount: dm.replyCount,
                receiptStatus: dm.receiptStatus,
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
        const getDueCards = useFlashcardStore.getState().getDueCards;
        const ranked = decks
            .map(d => ({ deck: d, due: getDueCards(d.id).length }))
            .filter(x => x.due > 0)
            .sort((a, b) => b.due - a.due);
        const best = ranked[0];
        if (best?.deck) {
            handleSelectDeck(best.deck);
            handleStartReview(best.deck);
        } else if (decks.length === 0) {
            showToast('No flashcard decks available. Create a deck first.', 'error');
        } else {
            showToast('No cards ready to review right now.', 'info');
        }
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
        } else if (appMode === AppMode.JOB_COMPANY && !selectedCompanyId) {
            setAppMode(AppMode.MARKETPLACE_JOBS);
        }
    }, [
        appMode, activeTestSession, activeStudySession, activeGameSession, activeTestResult,
        isAuthLoading, isPlatformAdmin, selectedNote, selectedDeck, activeReviewSession,
        activeCramSession, selectedMarketplaceListingId, selectedSellerId, selectedCompanyId, setAppMode,
    ]);

    // Re-fetch notifications from DB when the notification modal opens
    useEffect(() => {
        if (modals.notification && currentUser) {
            fetchNotifications(currentUser.id).then(fetched => {
                setNotifications(Array.isArray(fetched) ? fetched : []);
            }).catch(() => { /* handled in service layer */ });
        }
    }, [modals.notification, currentUser, setNotifications]);

    if (isAuthLoading) return (
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
                                    firstName: profile.firstName || profile.first_name || undefined,
                                    lastName: profile.lastName || profile.last_name || undefined,
                                    avatarUrl: profile.avatarUrl || profile.avatar_url || '',
                                    email: session.user.email!,
                                    password: '',
                                    phoneNumber: profile.phoneNumber || profile.phone || '',
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
                        if (next && next.startsWith('/') && !next.startsWith('//') && !next.includes('://') && !next.includes('\\')) {
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

    const noteSharePathMatch = location.pathname.match(/^\/notes\/share\/([^/]+)$/);
    if (noteSharePathMatch) {
        return <NoteShareAcceptScreen token={decodeURIComponent(noteSharePathMatch[1])} />;
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
            onCreateFolder={(name, parentId) => {
                void noteHandlers.handleCreateFolder(name, undefined, parentId ?? undefined).catch((e: any) => {
                    showToast(e?.message || 'Failed to create folder', 'error');
                });
            }}
            onMoveNoteToCourse={(noteId, courseId, topicId) =>
                noteHandlers.handleMoveNoteToCourse(noteId, courseId, topicId ?? null).catch((e: any) => {
                    showToast(e?.message || 'Failed to move note', 'error');
                    throw e;
                })
            }
            onRenameFolder={(folderId, name) => {
                void noteHandlers.handleRenameFolder(folderId, name).catch((e: any) => {
                    showToast(e?.message || 'Failed to rename folder', 'error');
                });
            }}
            onDeleteFolder={(folderId) => {
                void noteHandlers.handleDeleteFolder(folderId).catch((e: any) => {
                    showToast(e?.message || 'Failed to delete folder', 'error');
                });
            }}
            onTogglePinNote={(noteId, isPinned) => {
                void noteHandlers.handleTogglePinNote(noteId, isPinned).catch((e: any) => {
                    showToast(e?.message || 'Failed to update pin', 'error');
                });
            }}
            onArchiveNote={(noteId, isArchived) => {
                void noteHandlers.handleArchiveNote(noteId, isArchived).catch((e: any) => {
                    showToast(e?.message || 'Failed to update archive', 'error');
                });
            }}
            onMoveNotesToFolder={(noteIds, folderId) => {
                return noteHandlers.handleMoveNotesToFolder(noteIds, folderId).catch((e: any) => {
                    showToast(e?.message || 'Failed to move notes', 'error');
                    throw e;
                });
            }}
            onDeleteNotes={(noteIds) => {
                return noteHandlers.handleDeleteNotes(noteIds).catch((e: any) => {
                    showToast(e?.message || 'Failed to delete notes', 'error');
                    throw e;
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
            onYoutubeImport={async (url) => {
                try {
                    await noteHandlers.handleYoutubeImport(url, selectedFolderId || undefined);
                } catch {
                    // Sticky toast shown by runNoteYoutubeImport
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
            onMoveDeckToCourse={handleMoveDeckToCourse}
        />
    );

    // One handler for every jobs-workspace screen. The per-case copies it
    // replaces had drifted, leaving nav buttons dead on some screens.
    const handleJobsNavigate = (screen: string, params?: Record<string, unknown>) => {
        if (screen === 'Marketplace') navigateTo(AppMode.MARKETPLACE);
        else if (screen === 'MarketplaceJobs') navigateTo(AppMode.MARKETPLACE_JOBS);
        else if (screen === 'CreateMarketplaceJob') navigateTo(AppMode.CREATE_MARKETPLACE_JOB);
        else if (screen === 'MyJobPostings') navigateTo(AppMode.MY_JOB_POSTINGS);
        else if (screen === 'MyJobApplications') navigateTo(AppMode.MY_JOB_APPLICATIONS);
        else if (screen === 'JobEmployer') navigateTo(AppMode.JOB_EMPLOYER);
        else if (screen === 'JobCompany' && params?.companyId) {
            navigateTo(AppMode.JOB_COMPANY, { companyId: String(params.companyId) });
        } else if (screen === 'JobEmployerPipeline' && params?.jobId) {
            navigateTo(AppMode.JOB_EMPLOYER_PIPELINE, { jobId: String(params.jobId) });
        } else if (screen === 'EditMarketplaceJob' && params?.jobId) {
            navigateTo(AppMode.CREATE_MARKETPLACE_JOB, { jobId: String(params.jobId) });
        } else if (screen === 'MarketplaceJobDetail' && params?.jobId) {
            navigateTo(AppMode.MARKETPLACE_JOB_DETAIL, { jobId: String(params.jobId) });
        }
    };

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
                    onEditMessage={handleEditChatMessage} onRemoveMessage={handleRemoveChatMessage}
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
                    onDmThreadStatusChange={handleDmThreadStatusChange}
                    onLoadMoreMessages={handleLoadMoreMessages}
                    onLoadMoreDirectMessages={handleLoadMoreDirectMessages}
                    unreadAnchorAt={unreadAnchorAt}
                    onPeerChatRead={onPeerChatRead} />
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
                    onNavigateFromFeed={(screen, params) => {
                        // Feed rows point at objects that already have homes.
                        if (screen === 'MarketplaceListingDetail' && params?.listingId) {
                            setSelectedMarketplaceListingId(String(params.listingId));
                            setSelectedMarketplaceListingInitialQuantity(null);
                            setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                        } else if (screen === 'CreatorProfile' && params?.userId) {
                            setSelectedSellerId(String(params.userId));
                            setSellerProfileReturnMode(AppMode.DASHBOARD);
                            setAppMode(AppMode.CREATOR_PROFILE);
                        } else if (screen === 'GroupChat' && params?.groupId) {
                            const target = groups.find((x) => x.id === params.groupId);
                            if (target) {
                                handleSelectChat({ ...target, chatType: 'group' });
                                setAppMode(AppMode.CHAT);
                            }
                        }
                    }}
                    studyActivityDays={studyActivityDays}
                    onNavigateToChat={() => navigateTo(AppMode.CHAT)} allMessages={messages}
                    userQuestionStats={userQuestionStats} onViewAnalysis={setAnalyzingResult}
                    onNavigateToFlashcards={() => navigateTo(AppMode.LIBRARY, { libraryTab: 'flashcards' })}
                    onOpenCreateDeck={handleOpenCreateDeckModal}
                    onNavigateToMarketplace={() => navigateTo(AppMode.MARKETPLACE)}
                    onNavigateToDiscover={() => navigateTo(AppMode.DISCOVER)}
                    onNavigateToInvite={() => navigateTo(AppMode.INVITE_FRIENDS)}
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
                    onNavigateToNotes={() => navigateTo(AppMode.LIBRARY, { libraryTab: 'notes' })}
                    onOpenImportAndStudy={() => setShowImportAndStudy(true)}
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
                    dailyQuiz={(() => {
                        const quiz = getDailyQuizForToday();
                        if (!quiz || quiz.sourceNoteTitle || !quiz.noteId) return quiz;
                        const note = notes.find((n) => n.id === quiz.noteId);
                        return note
                            ? { ...quiz, sourceNoteTitle: note.title?.trim() || 'Untitled note' }
                            : quiz;
                    })()}
                    dailyQuizProgress={dailyQuizProgress}
                    dailyQuizNoteOptions={notes
                        .filter(isQuizzableNote)
                        .map((n) => ({
                            id: n.id,
                            title: n.title?.trim() || 'Untitled note',
                        }))}
                    startingDailyQuiz={startingDailyQuiz}
                    onStartDailyQuiz={async (noteId) => {
                        const source = notes.find((n) => n.id === noteId);
                        // Re-check on start, not just when the list was built: a note
                        // can be archived (or emptied) in another tab between render
                        // and click, and the picker would still be holding its id.
                        if (!source || !isQuizzableNote(source)) {
                            showToast(
                                source?.isArchived
                                    ? 'That note is archived. Unarchive it to quiz from it.'
                                    : 'Add or import a note with at least 50 characters to generate a daily quiz.',
                                'info'
                            );
                            return;
                        }
                        setStartingDailyQuiz(true);
                        try {
                            await noteHandlers.handleStartDailyQuiz(noteId, source.title);
                        } catch (e: any) {
                            showToast(e?.message || 'Failed to generate daily quiz.', 'error');
                        } finally {
                            setStartingDailyQuiz(false);
                        }
                    }}
                    onDailyQuizAnswer={answerDailyQuestion}
                    onCompleteDailyQuiz={completeDailyQuiz}
                    activeTestSession={activeTestSession}
                    activeStudySession={activeStudySession}
                    onResumeSession={() => handleResumeSession(activeTestSession ? AppMode.TEST_ACTIVE : AppMode.STUDY_ACTIVE)}
                    pausedSessions={pausedSessions}
                    onResumePausedSession={handleResumePausedSession}
                    onAbandonPausedSession={handleAbandonPausedSession}
                />;
            case AppMode.LIBRARY:
                return (
                    <LibraryScreen
                        tab={libraryTab}
                        onTabChange={handleLibraryTabChange}
                        dueCardsCount={dueCardsCount}
                        noteCount={notes.length}
                        deckCount={decks.length}
                        notesContent={renderNotesScreen(true)}
                        flashcardsContent={renderFlashcardsScreen(true)}
                        onOpenNote={(noteId) => { void noteHandlers.openNote(noteId); }}
                        onOpenDeck={(deckId) => {
                            const deck = decks.find((d) => d.id === deckId);
                            // Route hydration fetches a deck that is not in the store yet (e.g. shared).
                            if (deck) handleSelectDeck(deck);
                            else navigateTo(AppMode.DECK_DETAIL, { deckId });
                        }}
                        onOpenOffline={() => navigateTo(AppMode.OFFLINE_MODE)}
                        onOpenTests={() => navigateTo(AppMode.DASHBOARD)}
                        onCreateStudyPackFromCourse={(courseId, courseLabel) => {
                            setStudyProductSource({ courseId, title: courseLabel });
                            setAppMode(AppMode.STUDY_PRODUCT_DRAFTS);
                        }}
                    />
                );
            case AppMode.STUDY_HUB:
                return (
                    <StudyHubScreen
                        dueCardsCount={dueCardsCount}
                        decks={decks}
                        flashcards={flashcards}
                        onStartDueReview={handleFlashcardStudy}
                        onOpenLibrary={() => navigateTo(AppMode.LIBRARY)}
                        onOpenAITools={() => navigateTo(AppMode.AI_TOOLS)}
                        onSelectDeck={handleSelectDeck}
                        onStartLearn={handleStartLearn}
                        onStartReview={(deckId) => {
                            const deck = decks.find((d) => d.id === deckId);
                            if (deck) handleStudyDeck(deck);
                        }}
                        activeTestSession={activeTestSession}
                        activeStudySession={activeStudySession}
                        onResumeSession={() => handleResumeSession(activeTestSession ? AppMode.TEST_ACTIVE : AppMode.STUDY_ACTIVE)}
                        pausedSessions={pausedSessions}
                        onResumePausedSession={handleResumePausedSession}
                        onAbandonPausedSession={handleAbandonPausedSession}
                        recentTestCount={testResults.length}
                        onViewRecentTests={() => navigateTo(AppMode.DASHBOARD)}
                    />
                );
            case AppMode.AI_TOOLS:
                return (
                    <AIToolsHub
                        theme={theme}
                        onOpenNote={(noteId) => { void noteHandlers.openNote(noteId); }}
                        onStartLearn={(result) => {
                            // Review the deck the import JUST created — not whichever
                            // deck happens to have the most due cards globally.
                            const created = result.deckId
                                ? useFlashcardStore.getState().decks.find(d => d.id === result.deckId)
                                : undefined;
                            if (created) handleStudyDeck(created);
                            else handleFlashcardStudy();
                        }}
                        onTakePracticeTest={(result) => {
                            navigateTo(AppMode.DASHBOARD);
                            showToast(
                                `Your ${result.quizQuestionCount}-question quiz is ready in the Daily quiz card.`,
                                'success'
                            );
                        }}
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
                        // The Library's Notes tab, not standalone `/notes`: that
                        // screen has no entry in the sidebar or bottom nav, so
                        // this button was the only way in — and it is the same
                        // list, one course rail short. Every other "go to notes"
                        // in this file already lands on the Library tab.
                        onBack={() => navigateTo(AppMode.LIBRARY, { libraryTab: 'notes' })}
                        onSave={(updates) => noteHandlers.handleAutoSave(selectedNote.id, updates)}
                        onCancelPendingSave={noteHandlers.cancelAutoSave}
                        onSellAsStudyPack={() => {
                            setStudyProductSource({ noteIds: [selectedNote.id], title: selectedNote.title });
                            setAppMode(AppMode.STUDY_PRODUCT_DRAFTS);
                        }}
                        onDelete={async () => {
                            const noteId = selectedNote.id;
                            const lecture = useLectureRecordingStore.getState();
                            if (lecture.noteId === noteId && lecture.status !== 'idle') {
                                const ok = await confirmDialog({
                                    title: 'Recording in progress',
                                    message:
                                        'This note has an active lecture recording. Delete the note and discard the recording?',
                                    confirmLabel: 'Discard & delete',
                                    danger: true,
                                });
                                if (!ok) return;
                                lecture.discard();
                            } else if (!(await confirmDialog({
                                title: 'Delete note',
                                message: 'Delete this note? This cannot be undone.',
                                confirmLabel: 'Delete',
                                danger: true,
                            }))) {
                                return;
                            }
                            noteHandlers.cancelAutoSave();
                            useNotesStore.getState().setSelectedNote(null);
                            navigateTo(AppMode.LIBRARY, { libraryTab: 'notes' });
                            try {
                                await noteHandlers.handleDeleteNote(noteId);
                            } catch (e: any) {
                                showToast(e?.message || 'Failed to delete note', 'error');
                            }
                        }}
                        onSmartNote={async (editorState, options) => {
                            try {
                                const summary = await noteHandlers.handleSmartNote(selectedNote.id, editorState, options);
                                if (summary && String(summary).trim().length >= 50) {
                                    showToast('Smart notes ready!', 'success');
                                } else {
                                    showToast(
                                      'Smart Notes returned thin content. Add more source text or wait for OCR.',
                                      'error'
                                    );
                                }
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
                                    if (result.savedCount < result.count) {
                                        showToast(`Saved ${result.savedCount} of ${result.count} cards to "${result.deck.name}"`, 'info');
                                    } else {
                                        showToast(`Created ${result.count} flashcards in "${result.deck.name}"`, 'success');
                                    }
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
                                const session = await noteHandlers.handleStartNoteQuiz({
                                    title: selectedNote.title,
                                    body: selectedNote.body,
                                });
                                // The API marks an unchanged existing quiz with `reused: true`.
                                // Older API versions omit the field — treat absent as fresh.
                                const reused =
                                    (session as null | (typeof session & { reused?: boolean }))?.reused === true;
                                if (reused) {
                                    showToast('Kept your existing quiz — finish or reset it to get new questions', 'info');
                                } else {
                                    showToast('New quiz ready!', 'success');
                                }
                            } catch (e: any) {
                                showToast(e?.message || 'Failed to generate quiz', 'error');
                            }
                        }}
                        onPostComment={async (text) => {
                            try {
                                await noteHandlers.handlePostComment(selectedNote.id, text);
                            } catch (e: any) {
                                // Rethrow a real Error so the editor keeps the draft and
                                // shows its inline composer error (which catches this).
                                throw e instanceof Error ? e : new Error(e?.message || 'Failed to post comment');
                            }
                        }}
                        onRefreshComments={() => useNotesStore.getState().loadComments(selectedNote.id)}
                        onShareWithGroup={async (groupId) => {
                            try {
                                await noteHandlers.handleShareWithGroup(selectedNote.id, groupId);
                                const groupName = groups.find((g) => g.id === groupId)?.name;
                                showToast(groupName ? `Shared to ${groupName}` : 'Note shared', 'success');
                            } catch (e: any) {
                                showToast(e?.message || 'Failed to share note with group', 'error');
                            }
                        }}
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
                    onMoveDeckToCourse={handleMoveDeckToCourse}
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
                    onOpenAddExpense={() => { setAddTransactionType('expense'); openModal('addTransaction'); }} onOpenAddIncome={() => { setAddTransactionType('income'); openModal('addTransaction'); }}
                    onOpenSetBudget={() => openModal('setBudget')} onDeleteTransaction={handleDeleteTransaction}
                    onToggleSidebar={toggleSidebar}
                    onOpenSetMonthlyPlan={() => openModal('setMonthlyPlan')}
                    onOpenSavingsGoal={() => openModal('savingsGoal')}
                    onOpenRecurring={() => openModal('recurring')}
                    onOpenExpenseSplit={() => openModal('expenseSplit')}
                    onOpenFinancialToolkit={() => openModal('financialToolkit')} />;
            case AppMode.MARKETPLACE:
                return <MarketplaceScreen
                    refreshKey={myListingsRefreshKey}
                    onNavigateToDiscover={(section) => {
                        setDiscoverSection(section as any);
                        setAppMode(AppMode.DISCOVER);
                    }}
                    onNavigate={(screen, params) => {
                    if (screen === 'CreateMarketplaceListing') {
                        setMarketplaceListingCategory(params?.category || 'academic');
                        openModal('createMarketplaceListing');
                    } else if (screen === 'MarketplaceListingDetail') {
                        setSelectedMarketplaceListingId(params.listingId);
                        setSelectedMarketplaceListingInitialQuantity(
                          params?.quantity != null ? Number(params.quantity) : null
                        );
                        setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                    } else if (screen === 'MyListings') {
                        setAppMode(AppMode.MY_LISTINGS);
                    } else if (screen === 'MarketplacePurchases') {
                        setAppMode(AppMode.MARKETPLACE_PURCHASES);
                    } else if (screen === 'StudyProductDrafts') {
                        // No source: list existing drafts instead of generating a new one.
                        setStudyProductSource(null);
                        setAppMode(AppMode.STUDY_PRODUCT_DRAFTS);
                    } else if (screen === 'MarketplaceFavorites') {
                        setAppMode(AppMode.MARKETPLACE_FAVORITES);
                    } else if (screen === 'MarketplaceInquiries') {
                        setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                    } else if (screen === 'MarketplaceOrders') {
                        setAppMode(AppMode.MARKETPLACE_ORDERS);
                    } else if (screen === 'MarketplaceCart') {
                        setAppMode(AppMode.MARKETPLACE_CART);
                    } else if (screen === 'SellerProfile' && (params?.userId || params?.sellerId)) {
                        setSellerProfileReturnMode(AppMode.MARKETPLACE);
                        setSelectedSellerId(params.userId || params.sellerId);
                        setAppMode(AppMode.SELLER_PROFILE);
                    } else if (screen === 'MarketplaceJobs') {
                        navigateTo(AppMode.MARKETPLACE_JOBS);
                    } else if (screen === 'Marketplace') {
                        setAppMode(AppMode.MARKETPLACE);
                    }
                }} />;
            case AppMode.MARKETPLACE_LISTING_DETAIL:
                if (!selectedMarketplaceListingId) return null;
                return <MarketplaceListingDetailScreen listingId={selectedMarketplaceListingId}
                    initialQuantity={selectedMarketplaceListingInitialQuantity ?? undefined}
                    onBack={() => {
                        setSelectedMarketplaceListingInitialQuantity(null);
                        setAppMode(AppMode.MARKETPLACE);
                    }}
                    onNavigate={(screen, params) => {
                        if (screen === 'DirectMessages' && params?.userId) handleInitiateDm(params.userId);
                        else if (screen === 'CreatorProfile' && (params?.userId || params?.sellerId)) {
                            setSellerProfileReturnMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                            setSelectedSellerId(params.userId || params.sellerId);
                            setAppMode(AppMode.CREATOR_PROFILE);
                        } else if (screen === 'SellerProfile' && (params?.userId || params?.sellerId)) {
                            setSellerProfileReturnMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                            setSelectedSellerId(params.userId || params.sellerId);
                            setAppMode(AppMode.SELLER_PROFILE);
                        } else if (screen === 'MarketplaceTransaction' || screen === 'MarketplaceOrderDetail') {
                            setSelectedMarketplaceOrderId(params?.orderId);
                            setAppMode(AppMode.MARKETPLACE_ORDER_DETAIL);
                        } else if (screen === 'MarketplaceOrders') {
                            setAppMode(AppMode.MARKETPLACE_ORDERS);
                        } else if (screen === 'MarketplaceCart') {
                            setAppMode(AppMode.MARKETPLACE_CART);
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
                        setSelectedMarketplaceListingInitialQuantity(
                          params?.quantity != null ? Number(params.quantity) : null
                        );
                        setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                    } else if (screen === 'MarketplaceInquiries') {
                        setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                    } else if (screen === 'MarketplaceOrders') {
                        setAppMode(AppMode.MARKETPLACE_ORDERS);
                    } else if (screen === 'MarketplaceCart') {
                        setAppMode(AppMode.MARKETPLACE_CART);
                    } else if (screen === 'MarketplaceOrderDetail' && params?.orderId) {
                        setSelectedMarketplaceOrderId(params.orderId);
                        setAppMode(AppMode.MARKETPLACE_ORDER_DETAIL);
                    } else if (screen === 'SellerProfile' && (params?.userId || params?.sellerId)) {
                        setSellerProfileReturnMode(AppMode.MY_LISTINGS);
                        setSelectedSellerId(params.userId || params.sellerId);
                        setAppMode(AppMode.SELLER_PROFILE);
                    } else if (screen === 'SellerCustomers') {
                        setAppMode(AppMode.SELLER_CUSTOMERS);
                    } else if (screen === 'Marketplace') {
                        setAppMode(AppMode.MARKETPLACE);
                    }
                }} onBack={() => setAppMode(AppMode.MARKETPLACE)} refreshKey={myListingsRefreshKey} />;
            case AppMode.MARKETPLACE_PURCHASES:
                return <MarketplacePurchasesScreen
                    onBack={() => setAppMode(AppMode.MARKETPLACE)}
                    onNavigate={(screen, params) => {
                        if (screen === 'MarketplaceListingDetail' && params?.listingId) {
                            setSelectedMarketplaceListingId(params.listingId);
                            setSelectedMarketplaceListingInitialQuantity(null);
                            setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                        } else if (screen === 'Marketplace') {
                            setAppMode(AppMode.MARKETPLACE);
                        }
                    }} />;
            case AppMode.CAMPUS_PAGE: {
                // Phase 4 R: guest-visible, so the slug is read straight from the
                // URL rather than plumbed through the UI store — a public page
                // always has it in the path, and this works before any hydration.
                const campusRoute = parseAppRoute(window.location.pathname);
                const campusSlug = String(campusRoute.params?.slug || '');
                if (!campusSlug) return null;
                return <CampusScreen
                    slug={campusSlug}
                    programme={(campusRoute.params as { programme?: string })?.programme ?? null}
                    onSignUp={() => { window.location.assign('/signup'); }}
                    onBack={() => { window.location.assign('/'); }}
                />;
            }
            case AppMode.INVITE_FRIENDS:
                return <InviteFriendsScreen onBack={() => setAppMode(AppMode.DASHBOARD)} />;
            case AppMode.COMMUNITY_DETAIL: {
                // Slug comes from state when arriving from Discover, or straight
                // from the URL on a cold load of /discover/c/:slug.
                const slugFromRoute = String(parseAppRoute(window.location.pathname).params?.slug || '');
                const slug = communitySlug || slugFromRoute;
                if (!slug) return null;
                return <CommunityDetailScreen
                    slug={slug}
                    onBack={() => setAppMode(AppMode.DISCOVER)}
                    onNavigate={(screen, params) => {
                        if (screen === 'GroupChat' && params?.groupId) {
                            const target = groups.find((x) => x.id === params.groupId);
                            if (target) {
                                handleSelectChat({ ...target, chatType: 'group' });
                                setAppMode(AppMode.CHAT);
                            }
                        }
                    }} />;
            }
            case AppMode.DISCOVER:
                // Phase 3 L / decision D12: Discover is the hub and the
                // marketplace is one of its tabs, so 'Marketplace' here is a
                // move WITHIN Discover, not a departure from it.
                return <DiscoverScreen
                    initialSection={discoverSection === 'marketplace' ? 'communities' : discoverSection}
                    onNavigate={(screen, params) => {
                        if (screen === 'Marketplace') {
                            setAppMode(AppMode.MARKETPLACE);
                        } else if (screen === 'CommunityDetail' && params?.slug) {
                            setCommunitySlug(String(params.slug));
                            setAppMode(AppMode.COMMUNITY_DETAIL);
                        } else if (screen === 'CreatorProfile' && params?.userId) {
                            setSelectedSellerId(String(params.userId));
                            setSellerProfileReturnMode(AppMode.DISCOVER);
                            setAppMode(AppMode.CREATOR_PROFILE);
                        } else if (screen === 'GroupChat' && params?.groupId) {
                            // Discover can surface a group the user has not
                            // joined yet, so it may not be in `groups`. Only
                            // open the chat when they are actually a member —
                            // otherwise leave them in Discover rather than
                            // dropping them on an empty chat screen.
                            const target = groups.find((x) => x.id === params.groupId);
                            if (target) {
                                handleSelectChat({ ...target, chatType: 'group' });
                                setAppMode(AppMode.CHAT);
                            }
                        }
                    }} />;
            case AppMode.CREATOR_PROFILE:
                if (!selectedSellerId) return null;
                return <CreatorProfileScreen
                    userId={selectedSellerId}
                    currentUserId={currentUser?.id}
                    onBack={() => setAppMode(sellerProfileReturnMode || AppMode.MARKETPLACE)}
                    onNavigate={(screen, params) => {
                        if (screen === 'MarketplaceListingDetail' && params?.listingId) {
                            setSelectedMarketplaceListingId(params.listingId);
                            setSelectedMarketplaceListingInitialQuantity(null);
                            setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                        }
                    }} />;
            case AppMode.STUDY_PRODUCT_DRAFTS:
                return <StudyProductDraftsScreen
                    initialSource={studyProductSource}
                    onSourceConsumed={() => setStudyProductSource(null)}
                    onBack={() => { setStudyProductSource(null); setAppMode(AppMode.LIBRARY); }}
                    onNavigate={(screen, params) => {
                        if (screen === 'MarketplaceListingDetail' && params?.listingId) {
                            setStudyProductSource(null);
                            setSelectedMarketplaceListingId(params.listingId);
                            setSelectedMarketplaceListingInitialQuantity(null);
                            setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                        }
                    }} />;
            case AppMode.MARKETPLACE_FAVORITES:
                return <MarketplaceFavoritesScreen
                    onBack={() => setAppMode(AppMode.MARKETPLACE)}
                    onNavigate={(screen, params) => {
                        if (screen === 'MarketplaceListingDetail' && params?.listingId) {
                            setSelectedMarketplaceListingId(params.listingId);
                            setSelectedMarketplaceListingInitialQuantity(
                              params?.quantity != null ? Number(params.quantity) : null
                            );
                            setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                        } else if (screen === 'CreateMarketplaceListing') {
                            setMarketplaceListingCategory(params?.category || 'academic');
                            openModal('createMarketplaceListing');
                        } else if (screen === 'MyListings') {
                            setAppMode(AppMode.MY_LISTINGS);
                        } else if (screen === 'MarketplaceInquiries') {
                            setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                        } else if (screen === 'MarketplaceOrders') {
                            setAppMode(AppMode.MARKETPLACE_ORDERS);
                        } else if (screen === 'MarketplaceCart') {
                            setAppMode(AppMode.MARKETPLACE_CART);
                        } else if (screen === 'MarketplaceJobs') {
                            navigateTo(AppMode.MARKETPLACE_JOBS);
                        } else if (screen === 'Marketplace') {
                            setAppMode(AppMode.MARKETPLACE);
                        }
                    }} />;
            case AppMode.MARKETPLACE_ORDERS:
                return <MarketplaceOrdersScreen
                    onBack={() => setAppMode(AppMode.MARKETPLACE)}
                    onNavigate={(screen, params) => {
                        if (screen === 'MarketplaceOrderDetail' && params?.orderId) {
                            setSelectedMarketplaceOrderId(params.orderId);
                            setAppMode(AppMode.MARKETPLACE_ORDER_DETAIL);
                        } else if (screen === 'MarketplaceListingDetail' && params?.listingId) {
                            setSelectedMarketplaceListingId(params.listingId);
                            setSelectedMarketplaceListingInitialQuantity(
                              params?.quantity != null ? Number(params.quantity) : null
                            );
                            setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                        }
                    }}
                />;
            case AppMode.MARKETPLACE_CART:
                return <MarketplaceCartScreen
                    onBack={() => setAppMode(AppMode.MARKETPLACE)}
                    onNavigate={(screen, params) => {
                        if (screen === 'Marketplace') {
                            setAppMode(AppMode.MARKETPLACE);
                        } else if (screen === 'MarketplaceOrders') {
                            setAppMode(AppMode.MARKETPLACE_ORDERS);
                        } else if (screen === 'MarketplaceOrderDetail' && params?.orderId) {
                            setSelectedMarketplaceOrderId(String(params.orderId));
                            setAppMode(AppMode.MARKETPLACE_ORDER_DETAIL);
                        } else if (screen === 'MarketplaceListingDetail' && params?.listingId) {
                            setSelectedMarketplaceListingId(String(params.listingId));
                            setSelectedMarketplaceListingInitialQuantity(null);
                            setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
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
                    else if (screen === 'MarketplaceOrderDetail' && params?.orderId) {
                        setSelectedMarketplaceOrderId(params.orderId);
                        setAppMode(AppMode.MARKETPLACE_ORDER_DETAIL);
                    }
                }} onBack={() => setAppMode(AppMode.MARKETPLACE)} userId={currentUser.id} />;
            case AppMode.SELLER_PROFILE:
                if (!selectedSellerId) return null;
                return <SellerProfileScreen userId={selectedSellerId}
                    onBack={() => {
                        setSelectedSellerId(null);
                        const backMode = sellerProfileReturnMode;
                        if (backMode === AppMode.MARKETPLACE_LISTING_DETAIL && !selectedMarketplaceListingId) {
                            setAppMode(AppMode.MARKETPLACE);
                            return;
                        }
                        setAppMode(backMode);
                    }}
                    onNavigate={(screen, params) => {
                        if (screen === 'MarketplaceListingDetail') {
                            setSelectedMarketplaceListingId(params.listingId);
                            setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                        } else if (screen === 'DirectMessages' && params?.userId) handleInitiateDm(params.userId);
                        else if (screen === 'MarketplaceOrders') {
                            setAppMode(AppMode.MARKETPLACE_ORDERS);
                        } else if (screen === 'MarketplaceOrderDetail' && params?.orderId) {
                            setSelectedMarketplaceOrderId(params.orderId);
                            setAppMode(AppMode.MARKETPLACE_ORDER_DETAIL);
                        }
                    }} />;
            case AppMode.CREATE_MARKETPLACE_LISTING:
                if (!modals.createMarketplaceListing) openModal('createMarketplaceListing');
                return <MarketplaceScreen
                    refreshKey={myListingsRefreshKey}
                    onNavigateToDiscover={(section) => {
                        setDiscoverSection(section as any);
                        setAppMode(AppMode.DISCOVER);
                    }}
                    onNavigate={(screen, params) => {
                    if (screen === 'CreateMarketplaceListing') {
                        setMarketplaceListingCategory(params?.category || 'academic');
                        openModal('createMarketplaceListing');
                    } else if (screen === 'MarketplaceListingDetail') {
                        setSelectedMarketplaceListingId(params.listingId);
                        setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                    } else if (screen === 'MyListings') setAppMode(AppMode.MY_LISTINGS);
                    else if (screen === 'MarketplaceInquiries') setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                    else if (screen === 'SellerProfile' && (params?.userId || params?.sellerId)) {
                        setSellerProfileReturnMode(AppMode.MARKETPLACE);
                        setSelectedSellerId(params.userId || params.sellerId);
                        setAppMode(AppMode.SELLER_PROFILE);
                    }
                    else if (screen === 'MarketplaceJobs') navigateTo(AppMode.MARKETPLACE_JOBS);
                }} />;
            case AppMode.MARKETPLACE_JOBS:
                return (
                    <JobsBoardScreen onNavigate={handleJobsNavigate} />
                );
            case AppMode.MARKETPLACE_JOB_DETAIL:
                if (!selectedJobId) return null;
                return (
                    <JobDetailScreen
                        jobId={selectedJobId}
                        onNavigate={handleJobsNavigate}
                        onOpenDm={(threadId) => {
                            handleSelectChat({ id: threadId, chatType: 'dm' } as any);
                            navigateTo(AppMode.CHAT, { threadId });
                        }}
                    />
                );
            case AppMode.JOB_COMPANY:
                if (!selectedCompanyId) return null;
                return (
                    <JobCompanyScreen
                        companyId={selectedCompanyId}
                        onNavigate={handleJobsNavigate}
                    />
                );
            case AppMode.CREATE_MARKETPLACE_JOB:
                return (
                    <CreateJobScreen
                        jobId={selectedJobId}
                        onNavigate={handleJobsNavigate}
                    />
                );
            case AppMode.MY_JOB_POSTINGS:
                return (
                    <MyJobPostingsScreen onNavigate={handleJobsNavigate} />
                );
            case AppMode.MY_JOB_APPLICATIONS:
                return (
                    <MyJobApplicationsScreen
                        onNavigate={handleJobsNavigate}
                        onOpenDm={(threadId) => {
                            handleSelectChat({ id: threadId, chatType: 'dm' } as any);
                            navigateTo(AppMode.CHAT, { threadId });
                        }}
                    />
                );
            case AppMode.JOB_EMPLOYER:
                return (
                    <JobEmployerScreen onNavigate={handleJobsNavigate} />
                );
            case AppMode.JOB_EMPLOYER_PIPELINE:
                if (!selectedJobId) return null;
                return (
                    <JobEmployerPipelineScreen
                        jobId={selectedJobId}
                        onNavigate={handleJobsNavigate}
                        onOpenDm={(threadId) => {
                            handleSelectChat({ id: threadId, chatType: 'dm' } as any);
                            navigateTo(AppMode.CHAT, { threadId });
                        }}
                    />
                );
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
        onNavigateToDiscover: () => navigateTo(AppMode.DISCOVER),
        onNavigateToInvite: () => navigateTo(AppMode.INVITE_FRIENDS),
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
        onOpenWallet: () => openModal('wallet'),
        activeTestSession, activeStudySession, activeGameSession,
        onResumeSession: handleResumeAnySession,
        onCancelSession: handleCancelPausedSession,
        theme, onToggleTheme: toggleTheme, dueCardsCount,
        onToggleCompanion: toggleCompanion,
        isCompanionOpen,
    };
    return (
        <ErrorBoundary>
        <AppShell sidebarProps={sidebarProps} dueCardsCount={dueCardsCount}
            unreadChatCount={getTotalActiveUnreadChatCount(groups, dmThreads)}
            hideMobileAiUsageBadge={
                (appMode === AppMode.CHAT && !!selectedChat)
                || appMode === AppMode.GAME_ACTIVE
                || appMode === AppMode.TEST_ACTIVE
                || appMode === AppMode.STUDY_ACTIVE
            }
            onOpenLectureNote={(noteId) => { void noteHandlers.openNote(noteId); }}
            onNavigate={handleShellNavigate}>
            <Suspense fallback={<AppContentLoadingFallback />}>
            {routeHydrating ? (
                <AppContentLoadingFallback />
            ) : (
            <>
            <div className={`shrink-0 ${
                appMode === AppMode.CREATE_GROUP || appMode === AppMode.ADMIN
                    ? 'hidden'
                    : appMode === AppMode.CHAT && selectedChat
                        ? 'hidden md:block'
                        : ''
            }`}>
            <Breadcrumb items={getBreadcrumbs({ appMode, selectedDeck, libraryTab, navigateTo, setActiveTestResult })} />
            </div>
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <AccountSuspendedNotice variant="banner" />
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
            </>
            )}
            </Suspense>
            <CreateGroupModal isOpen={modals.createGroup} onClose={handleCloseCreateGroupModal}
                onSubmit={handleCreateSubGroup} parentId={subgroupParentId} allGroups={groups} />
            <QuestionModal isOpen={modals.question} onClose={() => closeModal('question')}
                onSubmit={handleQuestionSubmit} groupName={selectedChat?.chatType === 'group' ? selectedChat.name : ''} />
            {selectedChat?.chatType === 'group' && <GroupInfoModal
                isOpen={modals.groupInfo} onClose={() => closeModal('groupInfo')}
                group={selectedChat} currentUser={currentUser}
                onUpdateDetails={handleUpdateGroupDetails} onUpdateGroupAvatar={handleUpdateGroupAvatar}
                onPromoteToAdmin={handlePromoteToAdmin} onDemoteAdmin={handleDemoteAdmin}
                onRemoveMember={handleRemoveGroupMember}
                onLeaveGroup={handleLeaveGroup}
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
                defaultLockAnswered={getUserSettings().study.lockAnsweredQuestions}
                onDownloadForOffline={handleDownloadForOffline}
                isDownloading={isDownloadingBundle} />}
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
                    } else if (screen === 'GroupInvite' && params?.groupId) {
                        const groupId = params.groupId as string;
                        if (window.confirm('Accept this group invite and join the chat?')) {
                            void handleAcceptGroupInvite(groupId)
                                .then(() => {
                                    const g = useGroupStore.getState().groups.find((x) => x.id === groupId);
                                    if (g) handleSelectChat({ ...g, chatType: 'group' });
                                    setAppMode(AppMode.CHAT);
                                })
                                .catch((err) => {
                                    alert(err instanceof Error ? err.message : 'Failed to accept invite');
                                });
                        } else if (window.confirm('Decline this group invite?')) {
                            void handleDeclineGroupInvite(groupId).catch((err) => {
                                alert(err instanceof Error ? err.message : 'Failed to decline invite');
                            });
                        }
                    } else if (screen === 'GroupChat' && params?.groupId) {
                        const g = groups.find((x) => x.id === params.groupId);
                        if (g) {
                            handleSelectChat({ ...g, chatType: 'group' });
                            setAppMode(AppMode.CHAT);
                        }
                    } else if (screen === 'MarketplaceJobDetail' && params?.jobId) {
                        navigateTo(AppMode.MARKETPLACE_JOB_DETAIL, { jobId: String(params.jobId) });
                    } else if (screen === 'MyJobApplications') {
                        navigateTo(AppMode.MY_JOB_APPLICATIONS);
                    } else if (screen === 'JobEmployerPipeline' && params?.jobId) {
                        navigateTo(AppMode.JOB_EMPLOYER_PIPELINE, { jobId: String(params.jobId) });
                    }
                }} />
            <ChallengesInboxModal
                isOpen={modals.challenges}
                onClose={() => closeModal('challenges')}
                currentUserId={currentUser.id}
                onPlayChallenge={(id) => { void handleStartChallengePlay(id); }}
            />
            <AddTransactionModal isOpen={modals.addTransaction} initialType={addTransactionType} onClose={() => closeModal('addTransaction')} onSubmit={handleAddTransaction} />
            <SetBudgetModal isOpen={modals.setBudget} onClose={() => closeModal('setBudget')} onSubmit={handleSetBudget} currentBudget={budget} />
            <SetMonthlyPlanModal isOpen={modals.setMonthlyPlan} onClose={() => closeModal('setMonthlyPlan')} currentBudget={budget} onSave={(categoryBudgets) => { if (budget) { handleSetBudget({ ...budget, categoryBudgets }); } }} />
            <RecurringModal isOpen={modals.recurring} onClose={() => closeModal('recurring')} onChanged={() => void materializeRecurring()} />
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
                onSuccess={() => {
                    closeModal('createMarketplaceListing');
                    setMyListingsRefreshKey((k) => k + 1);
                }} />
            {editingMarketplaceListing && <EditMarketplaceListingModal
                isOpen={modals.editMarketplaceListing}
                onClose={() => { closeModal('editMarketplaceListing'); setEditingMarketplaceListing(null); }}
                listing={editingMarketplaceListing}
                onSuccess={() => {
                    closeModal('editMarketplaceListing');
                    setEditingMarketplaceListing(null);
                    setMyListingsRefreshKey((k) => k + 1);
                }} />}
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
                onSuccess={(updates) => {
                    const latest = useAuthStore.getState().currentUser || currentUser;
                    const firstName = updates.firstName ?? latest.firstName;
                    const lastName = updates.lastName ?? latest.lastName;
                    setCurrentUser({
                        ...latest,
                        ...updates,
                        name: firstName && lastName ? `${firstName} ${lastName}` : latest.name,
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
                        onComplete={() => undefined}
                        onOpenNote={(noteId) => { noteHandlers.openNote(noteId); setShowImportAndStudy(false); }}
                        theme={theme}
                    />
                </Suspense>
            )}
            {showOnboarding && currentUser && !modals.usernameRequired && (
                <Suspense fallback={null}>
                    <OnboardingFlow
                        isOpen={showOnboarding}
                        programme={currentUser.programme ?? null}
                        studyLevel={currentUser.studyLevel ?? null}
                        firstCourse={onboardingFirstCourse}
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
                                // File the starter deck under the onboarding course (as promised
                                // by "we'll file it under {course}") and name it after that course
                                // like mobile does, else fall back to a friendly default.
                                const starterCourse = onboardingFirstCourse;
                                const deckName = starterCourse?.code
                                    ? `${starterCourse.code} starter deck`
                                    : 'My First Deck';
                                const deck = await createDeck(
                                    { name: deckName, description: 'From onboarding', courseId: starterCourse?.id ?? null },
                                    currentUser.id
                                );
                                for (const c of cards) {
                                    await createFlashcard({ deckId: deck.id, type: 'BASIC' as any, front: c.front, back: c.back, userId: currentUser.id });
                                }
                                const allFlashcards = await fetchAllFlashcards(undefined, currentUser.id);
                                useFlashcardStore.getState().setFlashcards(allFlashcards);
                                useFlashcardStore.getState().updateDecks((prev) => [...prev, deck]);
                                // The new course-filed deck changes the library overview counts.
                                useLibraryStore.getState().invalidateOverview();
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
            <AccountSuspendedNotice variant="modal" />
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
        {/* Outside the content Suspense so lazy screen loads don't remount Settings and reset the active tab */}
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
