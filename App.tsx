/**
 * The web app's root component: the auth gate, the route/AppMode screen switch,
 * and the single host for every shared modal, overlay and app-wide effect.
 *
 * Exports: `App` — mounted by index.tsx on the catch-all '/*' route. The legal
 *  pages are the only paths that never reach it.
 * Touches: most zustand stores (auth, ui, group, test, flashcard, notes,
 *  community, budget, companion, studySet, studyGoals, academic, library,
 *  toast, confirm, featureTip, lectureRecording, accountSuspension); the
 *  handler hooks in hooks/ (useAuthHandlers, useGroupHandlers, useTestHandlers,
 *  useGameHandlers, useFlashcardHandlers, useBudgetHandlers, useOfflineHandlers,
 *  useNoteHandlers, useAIHandlers, useAppEffects); services/supabase
 *  (fetchGroups, fetchNotifications, fetchTestSessionById, fetchUserProfile,
 *  fetchAccountLifecycle, fetchMyInquiries,
 *  joinDiscoverableGroup, openCommunityLounge, sendMessage, apiLogoutSession),
 *  services/sentry, services/jobArtifacts, services/ai, services/challenges;
 *  localStorage (ONBOARDING_COMPLETE_STORAGE_KEY, 'lantern_streak_target');
 *  window.location, window.history and document.title.
 * Gotchas:
 *  - Three early returns sit between the hook block and the render:
 *    `isAuthLoading`, `isPasswordRecovery`, and `!currentUser`. Every hook must
 *    stay ABOVE them or the hook order changes across renders.
 *  - The `!currentUser` branch ends in <Navigate to="/login?next=…">. Any boot
 *    path that finishes without setting `currentUser` therefore presents as an
 *    unexplained bounce to /login rather than as an auth error.
 *  - For communities, the Shop sub-states, study sets, `/me` and the two Tests
 *    routes the URL is the authority; several effects re-derive state from
 *    `location.pathname` on purpose and must not be collapsed into local flags.
 *  - Effects that react to a user switch read `useXStore.getState()` inside the
 *    effect body rather than closing over a store array: a captured pre-purge
 *    array resurrects the previous account's data.
 *  - `useFontMode()` changes a root class that remounts the subtree below it, so
 *    state held only inside a child screen does not survive a font change.
 *  - Screens are lazy (`lazyWithRetry`); `<Suspense>` boundaries are placed so a
 *    chunk load never remounts SettingsModal (see the note at its render site).
 */
import React, { useCallback, useEffect, useState, Suspense } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useToastStore } from './stores/toastStore';
import { confirmDialog, useConfirmStore } from './stores/confirmStore';
import { planStartDuelConfirm, planAcceptGroupInviteConfirm, planDeclineGroupInviteConfirm } from './utils/destructiveConfirm';
import { useLectureRecordingStore } from './stores/lectureRecordingStore';
import { ToastBanner } from './components/ui/ToastBanner';
import AiJobProgressPanel from './components/jobs/AiJobProgressPanel';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import FeatureTipsHost from './components/featureTips/FeatureTipsHost';
import { useFeatureTipStore } from './stores/featureTipStore';
import { setSessionExpiredHandler } from './services/sessionHandler';
import { supabase as supabaseClient, apiLogoutSession, fetchAccountLifecycle, fetchGroups, fetchMyInquiries } from './services/supabase';
import {
    ONBOARDING_COMPLETE_STORAGE_KEY,
    ONBOARDING_COMPLETE_VALUE,
    isOnboardingCompleteFlag,
} from '@lantern/shared/settings';
import { buildStudySetPath, dueReviewPlan, getNoteStudyContent, isLectureNote, isQuizzableNote, parseStudySetPath, pickOpenStudySetId, resolveLectureStudioNote, TURN_INTO_TARGETS } from '@lantern/shared';
import type { MessageNoteDraft, TurnIntoTargetId } from '@lantern/shared';
import { buildFlashcardReviewQueue, getTodayStudyCounts, isNewFlashcard, normalizeUserSettings } from '@lantern/shared/settings';
import { AppMode, DirectMessage, MessageType, TransactionType, TestResult, User } from './types';
import { useUIStore } from './stores/uiStore';
import { useAuthStore } from './stores/authStore';
import { useAcademicStore } from './stores/academicStore';
import { useLibraryStore } from './stores/libraryStore';
import { activeUserCourses, readAcademicSetupDismissed, shouldOpenAcademicSetup } from './utils/academicSetup';
import {
    completeTeachOnboarding,
    consumeTeachSignupIntent,
    isTeachAuthRequest,
} from './utils/teachIntent';
import { setSentryUser } from './services/sentry';
import { useGroupStore } from './stores/groupStore';
import { useFlashcardStore } from './stores/flashcardStore';
import { useTestStore } from './stores/testStore';
import { useBudgetStore } from './stores/budgetStore';
import { initialUserStats } from './utils/helpers';
import { getBreadcrumbs } from './utils/breadcrumbs';
import { getTotalActiveUnreadChatCount } from './utils/chatUnread';
import { fetchTestSessionById, fetchNotifications, fetchDecks, fetchAllFlashcards, bootstrapAuthFromStorage, fetchUserProfile, joinDiscoverableGroup, openCommunityLounge, sendMessage as sendGroupMessage } from './services/supabase';
import { saveGeneratedDeck } from './services/jobArtifacts';
import { useCommunityStore } from './stores/communityStore';
import { COMMUNITY_COPY, isHiddenFromChatInbox, studyGroupAnnouncement } from '@lantern/shared/network';
import { canOpenCommunities } from './components/community/communityAccess';
import { collectKnownLounges, isBoardGroup } from './utils/communityBoards';
import { useCommunityPresence } from './hooks/useCommunityPresence';
import { useCommunityNavigation } from './hooks/useCommunityNavigation';
import { useCompanionContext } from './hooks/useCompanionContext';
import type { CommunityNavigate } from './components/community/communityNavigation';
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
import ExpenseSplitModal from './components/ExpenseSplitModal';
import SimulationControls from './components/SimulationControls';
import TestAnalysisModal from './components/TestAnalysisModal';
import CreateMarketplaceListingModal from './components/CreateMarketplaceListingModal';
import EditMarketplaceListingModal from './components/EditMarketplaceListingModal';
import CreateLabModal from './components/CreateLabModal';
import {
    FlashcardsScreen,
    ImportAndStudyModal,
    OnboardingFlow,
    CommunityDetailScreen,
    TeachApp,
    JoinClassPage,
    NotesScreen,
    TestBuilderScreen,
    LandingPage,
    TeachLandingPage,
    AppContentLoadingFallback,
} from './routes/lazyScreens';
import { SCREEN_REGISTRY } from './routes/screenRegistry';
import type { ScreenContext } from './routes/screenRegistry';
import NoteEditorScreen from './components/NoteEditorScreen';
import AppShell from './components/layout/AppShell';
import Breadcrumb from './components/layout/Breadcrumb';
import { useAuthHandlers, INITIAL_BOOTSTRAP_LOAD_STATE } from './hooks/useAuthHandlers';
import { useGroupHandlers } from './hooks/useGroupHandlers';
import { newLectureNoteTitle } from './components/study/recorderDoor';
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
import {
    ME_PATH,
    ME_PROGRESS_PATH,
    SHOP_COURSES_PATH,
    SHOP_PATH,
    TEST_BUILDER_PATH,
    buildTestDetailPath,
    campusSegmentPath,
    isPublicMarketplacePath,
    parseAppRoute,
    parseShopRoute,
    type CampusSegment,
} from './utils/appRoutes';
import { Button } from './components/ui';
import CampusHubScreen from './components/campus/CampusHubScreen';
import MeScreen from './components/layout/MeScreen';
import { MeProgress } from './components/me/MeProgress';
import { useModalHistory } from './components/layout/useModalHistory';
import { peekStashedAuthLinkError } from './utils/authErrorHash';
import GuestMarketplaceShell from './components/marketplace/GuestMarketplaceShell';
import { useAIHandlers } from './hooks/useAIHandlers';
import AIGenerateQuestionsModal from './components/AIGenerateQuestionsModal';
import AICompanionPanel from './components/AICompanionPanel';
import { usePlatformAdmin } from './hooks/usePlatformAdmin';
import { useCompanionStore } from './stores/companionStore';
import { useNotesStore } from './stores/notesStore';
import { useStudySetStore } from './stores/studySetStore';
import { useStudyGoalsStore } from './stores/studyGoalsStore';
import { useNoteHandlers } from './hooks/useNoteHandlers';
import { AI_CREDIT_COSTS } from '@lantern/shared';
import { CompanionAction, type TestSessionData } from './types';
import { buildFlashcardSourceContent } from './utils/buildFlashcardSource';
import { normalizeFlashcardCount } from './utils/flashcardGeneration';
import { buildRetakeSession, planRetake } from './utils/testRetake';
import { attemptKindFromConfig, type TestPlanDraft } from './utils/testBuilder';
import { runTestGenerator } from './hooks/useStudyGenerators';
import { runAiJob } from './stores/aiJobRunner';

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
    const { currentUser, setCurrentUser, setAuthLoading, isAuthLoading, isPasswordRecovery, setPasswordRecovery, sessionRestoreFailed } = useAuthStore();
    const isPlatformAdmin = usePlatformAdmin();
    // ---- Store subscriptions. These are the re-render triggers for the whole
    // screen switch below; anything pulled in here re-renders every mode. ----
    const { groups, messages, dmThreads, directMessages, userVotes, notifications, setNotifications } = useGroupStore();
        const { testResults, offlineBundles, pendingSyncResults, userQuestionStats, studyActivityDays,
            activeTestSession, activeStudySession, activeGameSession, setActiveGameSession, pausedSessions } = useTestStore();
    const { folders, notes, selectedNote, comments, isLoading: notesLoading, isSaving: notesSaving, error: notesError, selectedFolderId, setSelectedFolderId } = useNotesStore();
    const { toast, showToast, dismissToast } = useToastStore();
    const globalConfirm = useConfirmStore();
    const [myListingsRefreshKey, setMyListingsRefreshKey] = useState(0);
    const [marketplaceBrowseIntent, setMarketplaceBrowseIntent] = useState<{
        browseNodeId?: string;
        tab?: 'academic' | 'student-life' | 'shops';
        category?: string;
    } | null>(null);
    const [sellerProfileReturnMode, setSellerProfileReturnMode] = useState<AppMode>(AppMode.MARKETPLACE);
    const [createGroupReturnMode, setCreateGroupReturnMode] = useState<AppMode>(AppMode.CHAT);
    const [startingDailyQuiz, setStartingDailyQuiz] = useState(false);
    const [accountLifecycle, setAccountLifecycle] = useState<{
        status: 'active' | 'deactivated';
        deletionScheduledAt?: string | null;
        graceDaysRemaining?: number | null;
    } | null>(null);
    const [reactivatingAccount, setReactivatingAccount] = useState(false);

    // Mirrors the signed-in account into Sentry. Mount-only (empty deps) on
    // purpose: it subscribes to the auth store directly and pushes only when the
    // *id* changes, so a profile edit or a settings write does not churn Sentry,
    // and the subscription survives every unrelated re-render of this component.
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
    // Mount-only: this is a localStorage read, so it must not depend on the user
    // (the store's own owner check is what scopes the cache to an account).
    useEffect(() => {
        const store = useFlashcardStore.getState();
        store.loadOfflineFromStorage();
        store.loadFromStorage();
    }, []);

    // The UI store holds everything that is "where the user currently is" but has
    // no URL of its own: the AppMode, the modal map, and the per-mode selection
    // (selected deck/chat/listing/order/community, the active session objects).
    // Route hydration (useRouteSync) writes into it; the switch below reads it.
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
        selectedStudyRoomId, setSelectedStudyRoomId,
        studyRoomJoin, setStudyRoomJoin,
        activeCommunity, setActiveCommunity,
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
        'communities' | 'groups' | 'people' | 'marketplace' | 'rooms'
    >('communities');
    const [createLabOpen, setCreateLabOpen] = useState(false);
    // Community server view (spec §5): "Start a room" / "New channel" from
    // inside a community carry the community into the modal / screen.
    const [createLabCommunity, setCreateLabCommunity] = useState<
        { id: string; name: string; courseId: string | null } | null
    >(null);
    const [createGroupPreset, setCreateGroupPreset] = useState<
        {
            communityId: string;
            communityName: string;
            communitySlug: string;
            /** Board (stays in the community) vs study group (lands in Chat) — spec §4.6. */
            communitySurface: 'board' | 'study_group';
            /** Seed from "Start a study group about this" on a board post (§7). */
            prefillName?: string;
            /**
             * The board the flow was launched from. §7 entry point 3: on success
             * the board keeps a plain TEXT pointer to the group its post spawned.
             * Mobile threads the same value as `announceInGroupId`.
             */
            announceInGroupId?: string;
        } | null
    >(null);

    // Feature-tip checklist ticks. Driven by `isCompanionOpen` — opening the
    // companion once is the whole condition; `markChecklist` is idempotent.
    useEffect(() => {
        if (isCompanionOpen) markChecklist('tryCompanion');
    }, [isCompanionOpen, markChecklist]);

    // The ONE live-presence subscription for the active community (spec §3).
    useCommunityPresence();
    const myCommunities = useCommunityStore((s) => s.myCommunities);
    const activeCommunityDetail = useCommunityStore((s) =>
        activeCommunity ? s.detailBySlug[activeCommunity.slug] : undefined
    );
    // Boards leave the Chat tab entirely (spec §5.2 / §4.5): they are the
    // community's surface, and a direct route to one redirects there. The one
    // exception is the community's live chat, which stays a chat.
    const communityDetailBySlug = useCommunityStore((s) => s.detailBySlug);
    const communityChannelsById = useCommunityStore((s) => s.channelsById);
    const knownLounges = React.useMemo(
        () =>
            collectKnownLounges(
                communityDetailBySlug,
                communityChannelsById,
                activeCommunity?.loungeGroupId,
                myCommunities
            ),
        [communityDetailBySlug, communityChannelsById, activeCommunity?.loungeGroupId, myCommunities]
    );
    const chatListGroups = React.useMemo(
        () =>
            (Array.isArray(groups)
                ? groups.filter((g) => !isHiddenFromChatInbox(g, knownLounges))
                : []),
        [groups, knownLounges]
    );
    const selectedChatIsBoard =
        appMode === AppMode.CHAT &&
        selectedChat?.chatType === 'group' &&
        isBoardGroup(selectedChat as unknown as Group, knownLounges);

    // Marks the three "you have been here" checklist items. Driven by `appMode`:
    // arriving at any of the listed modes is the whole condition.
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

    // ---- Handler hooks. Each owns one feature's mutations and the store writes
    // they imply; App only wires them to screens and modals. Ordering between
    // them matters where one feeds the next: `useGroupHandlers` produces
    // `addNotification`, which the test, game and offline handlers take. ----
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

    // Installs the ONE global "session expired" reaction, called from the service
    // layer when the BFF answers a genuine 401/403 (a transient failure must not
    // reach here — see the fetch interceptor in services/supabase.ts). It tears
    // down the whole signed-in surface — user, auth-loading flag, the
    // data-loaded and bootstrap-load gates — before sending the user to
    // /welcome, so the next sign-in re-runs bootstrap instead of reusing state
    // belonging to the expired session. Re-registers whenever one of the setters
    // it closes over changes identity.
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

    // "Reactivate" on the deactivated-account banner. Re-reads the lifecycle from
    // the server afterwards rather than assuming success locally, so the banner
    // disappears only once the API agrees the account is active again.
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

    // ---- Session resume / abandon. A paused duel is not the same thing as a
    // paused test: ending one forfeits it to the opponent, so the shared
    // "cancel session" control routes through a confirm for games only. ----
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

    // ---- Path-derived state. Everything below reads `location.pathname` on
    // every render instead of mirroring it into state, so a reload, a deep link
    // and a Back step all resolve to the same place. ----
    const location = useLocation();
    // Communities: the navigation contract, the route-derived channel id and
    // the five effects that keep the column, the URL and the chats list in step
    // (M7 — hooks/useCommunityNavigation.ts). Called HERE, immediately after
    // `useLocation()`, because that is the first point every input exists and
    // because the effects it registers must stay ahead of nothing in
    // particular: see the note in that file about what they used to interleave
    // with.
    const {
        communityRoute,
        communityChannelId,
        selectedChatCommunityId,
        handleCommunityNavigate,
        openCommunityChannel,
        openDiscoverGroup,
    } = useCommunityNavigation({
        appMode,
        currentUser,
        location,
        groups,
        selectedChat,
        setSelectedChat,
        selectedChatIsBoard,
        myCommunities,
        activeCommunity,
        activeCommunityDetail,
        setActiveCommunity,
        handleSelectChat,
        handleInitiateDm,
        setAppMode,
        navigateTo,
        showToast,
        setDiscoverSection,
        setStudyRoomJoin,
        setSelectedStudyRoomId,
        setCreateLabCommunity,
        setCreateLabOpen,
        setCreateGroupPreset,
        setCreateGroupReturnMode,
    });
    /**
     * The Shop's sub-states are read off the URL, never held in a local flag:
     * the By-course panel, one course inside it and the Sell sheet are places,
     * so a refresh re-opens exactly what the address bar names and Back leaves
     * it. `useModalHistory` is not involved for the Sell sheet — the route
     * entry IS its history entry, and a second push would take two Backs to
     * close one sheet.
     */
    const shopRoute = React.useMemo(() => parseShopRoute(location.pathname), [location.pathname]);
    const isSellRoute = shopRoute.view === 'sell';
    // Remembers the path the reader came FROM. The write lives in the effect's
    // cleanup, which runs with the OLD `location.pathname` still closed over —
    // that is what makes this the previous path rather than the current one.
    const previousPathRef = React.useRef<string | null>(null);
    React.useEffect(() => () => { previousPathRef.current = location.pathname; }, [location.pathname]);
    /**
     * Leave a sub-state by its own control (the sheet's X, "All courses").
     *
     * If the reader stepped INTO it from the place we are returning to, give
     * that history entry back — the same bargain `useModalHistory` strikes, so
     * Back never has to walk through a dead entry that looks like it did
     * nothing. A reader who arrived by deep link has no entry to give back, so
     * the url is rewritten in place instead.
     */
    const leaveShopSubState = React.useCallback((to: string) => {
        if (previousPathRef.current === to && typeof window !== 'undefined') {
            window.history.back();
            return;
        }
        navigateToPath(to, { replace: true });
    }, [navigateToPath]);
    // Decided once, in a lazy initialiser, so the onboarding overlay cannot flash
    // on a returning student between mount and the first localStorage read. A
    // lecturer arriving through the teach signup is marked complete and skipped.
    const [showOnboarding, setShowOnboarding] = React.useState(() => {
        if (typeof window === 'undefined') return false;
        if (isTeachAuthRequest(window.location.pathname, window.location.search)) {
            completeTeachOnboarding();
            return false;
        }
        return !isOnboardingCompleteFlag(localStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY));
    });
    // Starter-deck pre-seed: the first active enrolment (Phase 1 onboarding).
    const myAcademicCourses = useAcademicStore((s) => s.myCourses);
    const onboardingFirstCourse = React.useMemo(() => {
        const first = activeUserCourses(myAcademicCourses)[0];
        return first ? { id: first.course.id, code: first.course.code, title: first.course.title } : null;
    }, [myAcademicCourses]);
    // Loads enrolments only while onboarding is actually on screen: the starter
    // deck is filed under the first one, and nothing else here needs them.
    // Driven by `showOnboarding` + `currentUser?.id`; the store is read through
    // getState() so the effect does not re-run on unrelated academic writes.
    React.useEffect(() => {
        if (showOnboarding && currentUser?.id) void useAcademicStore.getState().loadMyCourses();
    }, [showOnboarding, currentUser?.id]);

    /**
     * Back closes the open sheet instead of leaving the section.
     *
     * Driven off the ui store's modal map, which is where every shared sheet on
     * web is registered — one place, so a new modal is covered the moment it is
     * added to that map rather than needing its own history wiring. One is
     * excluded on purpose: `usernameRequired` is the account-setup gate, and
     * Back must not be a way past it.
     */
    const openModalKeys = React.useMemo(
        () => [
            ...(Object.keys(modals) as Array<keyof typeof modals>)
                .filter((key) => modals[key] && key !== 'usernameRequired')
                .map((key) => String(key)),
            // Two full-screen sheets App owns outside the store's map.
            ...(showImportAndStudy ? ['importAndStudy'] : []),
            ...(createLabOpen ? ['createLab'] : []),
        ],
        [modals, showImportAndStudy, createLabOpen],
    );
    useModalHistory(
        openModalKeys,
        React.useCallback(
            (key: string) => {
                if (key === 'importAndStudy') { setShowImportAndStudy(false); return; }
                if (key === 'createLab') { setCreateLabOpen(false); setCreateLabCommunity(null); return; }
                closeModal(key as keyof typeof modals);
            },
            [closeModal],
        ),
        location.pathname,
    );

    const { handleNavigateToBudgetTracker, handleSetBudget, handleAddTransaction, handleDeleteTransaction, materializeRecurring } = useBudgetHandlers();
    const { isDownloadingBundle, handleDownloadForOffline, handleStartOfflineSession, handleDeleteBundle, handleSyncResults, handleSyncFlashcardReviews, handleImportBundle, handleRenameBundle } = useOfflineHandlers({ addNotification });
    // What tapping a challenge push/notification does, by notification type:
    // a result opens the duel screen directly, an acceptance asks first (so the
    // student is not dropped into a timed duel), and anything else — including a
    // failed challenge fetch — falls back to the challenges inbox.
    const handleChallengeNotification = React.useCallback(async (type: string, challengeId: string) => {
        if (type === 'challenge_result') {
            void handleStartChallengePlay(challengeId);
            return;
        }
        if (type === 'challenge_accepted') {
            try {
                const challenge = await fetchChallenge(challengeId);
                const opponentName = challenge.opponent?.name || 'Your opponent';
                const startNow = await confirmDialog(planStartDuelConfirm({ opponentName }));
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

    // The boot/bootstrap hook: it owns the data load, the realtime subscriptions
    // and the gamification fetches, and reports `authTokenReady` — the signal
    // that an auth header can actually be produced. The three effects below gate
    // on it, because firing on `currentUser` alone sends requests before the
    // cookie session has been restored.
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

    // Account lifecycle (active vs deactivated-with-grace) for the paused banner.
    // Re-runs on `currentUser?.id` / `authTokenReady`; signing out clears it
    // locally so the banner cannot outlive the account it describes.
    useEffect(() => {
        if (!currentUser?.id || !authTokenReady) {
            setAccountLifecycle(null);
            return;
        }
        void fetchAccountLifecycle(currentUser.id).then(setAccountLifecycle);
    }, [currentUser?.id, authTokenReady]);

    // Paused sessions live server-side so they survive a device change; pulled
    // once per signed-in boot, keyed on `currentUser?.id` + `authTokenReady`.
    React.useEffect(() => {
        if (!currentUser?.id || !authTokenReady) return;
        void refreshPausedSessions();
    }, [currentUser?.id, authTokenReady, refreshPausedSessions]);

    // Streak / quests / freezes are only rendered on Home, so `appMode` gates the
    // fetch: every return to the dashboard refreshes, no other mode pays for it.
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

    // `useFontMode` applies the font-family setting to the document root. A font
    // change remounts the subtree below this component, so anything a screen
    // holds in local state (scroll position, an open picker, an unsaved draft
    // that has not reached a store) is lost across it — state that must survive
    // belongs in a store, not in the screen.
    useFontMode();
    // Consume a pending /invite or /notes/share link once an account exists.
    // Both key on `currentUser?.id`: a link followed while signed out is stashed
    // and replayed here after sign-in.
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



    // The companion: what it is told about the student, and the tool calls it
    // asks for (M7 — hooks/useCompanionContext.ts). Called where the memo and
    // the executor used to sit, so the pending-group effect registers in the
    // same place in the order as before.
    const { companionContext, handleCompanionAction } = useCompanionContext({
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
        pathname: location.pathname,
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
    });
    const duplicateInfo = useUIStore(s => s.duplicateInfo);
    const setDuplicateInfo = useUIStore(s => s.setDuplicateInfo);
    // Normalises whatever the open chat is into the ONE shape ChatWindow renders.
    // Group messages already have it; DMs are mapped into a Message-alike, with
    // the sender resolved by preference order — the live roster first (it has the
    // current avatar), then the thread's participant record, then the fields
    // stamped on the DM row itself, then a placeholder. Every DM is typed
    // MessageType.TEXT here: DM threads carry no questions.
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

    // Where "Study" in the nav actually goes: back into the set the student last
    // had open, so the tab resumes rather than restarting. Falls through to the
    // hub when there is no set, and also when the list cannot load — the picker
    // there can still show the failure, whereas navigating nowhere cannot.
    const openStudyDestination = useCallback(async () => {
        const store = useStudySetStore.getState();
        store.closePicker();
        try {
            const sets = await store.loadSets();
            const id = pickOpenStudySetId(sets, store.lastOpenedId);
            if (id) {
                store.touchOpened(id);
                navigateTo(AppMode.STUDY_SET_WORKSPACE, { studySetId: id });
                return;
            }
        } catch {
            // Show the picker if the list cannot load.
        }
        navigateTo(AppMode.STUDY_HUB);
    }, [navigateTo]);

    const handleShellNavigate = React.useCallback((mode: AppMode) => {
        // Tapping Chat in bottom nav should return to the list, not stay on the open thread.
        if (mode === AppMode.CHAT) {
            navigateTo(AppMode.CHAT, {}, { replace: true });
            return;
        }
        if (mode === AppMode.STUDY_HUB) {
            void openStudyDestination();
            return;
        }
        navigateTo(mode);
    }, [navigateTo, openStudyDestination]);

    // FIXED (F9): `findFirstGroup` is deleted. It had no callers left since
    // "New test" stopped reaching into the group chat (see below) — it read as
    // live logic to anyone opening this file, and it was never evaluated.
    /**
     * The Tests home's "New test".
     *
     * It used to reach into the group chat: pick the first group, switch the
     * global tab to Chat and open the group's test-config modal. So pressing
     * "New test" inside Study left Study, and a student with no group could not
     * make a test at all. It now opens the builder page, which owns all three
     * sources and is the only one of them that stays inside Study.
     */
    const handleStartNewTest = () => {
        const setPath = parseStudySetPath(location.pathname);
        if (setPath?.studySetId) {
            navigateTo(AppMode.STUDY_SET_WORKSPACE, {
                studySetId: setPath.studySetId,
                workspaceActivity: 'test',
                createNew: true,
            });
            return;
        }
        navigateToPath(TEST_BUILDER_PATH);
    };

    /**
     * "With your group" from the builder. Group tests really are set up in the
     * group's chat, so this is a door out and the page says so before taking
     * it — the toast names where the student is about to land.
     */
    const handleBuildTestWithGroup = () => {
        const group = groups.find(g => !g.isArchived) ?? groups[0];
        if (!group) {
            showToast('Group tests are built from a group\u2019s questions. Join or create a group first.', 'info');
            navigateTo(AppMode.CHAT);
            return;
        }
        showToast(`Opening ${group.name} \u2014 set the test up there.`, 'info');
        handleOpenQuickTest(group.id);
    };

    /**
     * Retake, with the questions actually in hand.
     *
     * Every retake from history failed with "Question data is no longer
     * available for this test" — including yesterday's attempt. The reason was
     * never missing data: the tests list returns LEAN rows (score, date, id, no
     * questions, because the server mirrors questions only onto launchable
     * rows) and retake read `session.questions` straight off one. The planner
     * says which of the three states a row is in; a lean row is fetched once
     * before anything is declared gone.
     */
    const handleRetakeTestFromResult = useCallback(async (session: TestSessionData, rowId?: string) => {
        // The row's own id matters: a lean history row carries the session id
        // there, and `session.id` on it can be empty. Losing it is the
        // difference between one fetch and "no longer available".
        const plan = planRetake({ id: rowId ?? session.id ?? '', session });
        if (plan.kind === 'ready') {
            handleRetakeTest(session);
            return;
        }
        if (plan.kind === 'unavailable') {
            showToast(plan.reason, 'error');
            return;
        }
        showToast('Fetching this test\u2019s questions\u2026', 'info');
        const full = await fetchTestSessionById(plan.sessionId);
        const second = planRetake(full ? { id: full.id, session: full.session } : null, {
            alreadyFetched: true,
        });
        if (second.kind === 'ready' && full) {
            handleRetakeTest(full.session);
            return;
        }
        showToast(
            second.kind === 'unavailable'
                ? second.reason
                : 'Could not load that test right now. Check your connection and try again.',
            'error'
        );
    }, [handleRetakeTest, showToast]);

    /**
     * `/study/tests/:testId` — one test, by id.
     *
     * This is what makes a personal test linkable: a generated test, a push
     * notification and the job runner's "Open" all land here. A finished
     * attempt opens its review; an unsat one starts. The route resolves and
     * then replaces itself, so Back never returns to a URL that would
     * immediately re-launch the test.
     */
    const normalizedPath = location.pathname.replace(/\/$/, '');
    const onMePath = normalizedPath === ME_PATH || normalizedPath === ME_PROGRESS_PATH;
    const meSection = normalizedPath === ME_PROGRESS_PATH ? 'progress' : 'profile';
    const standaloneRoute = parseAppRoute(location.pathname);
    const onTeachPath = standaloneRoute.standalone === 'teach';
    const joinCode = standaloneRoute.standalone === 'join' ? standaloneRoute.params.joinCode ?? '' : null;
    /**
     * The two Tests routes that render from the PATH rather than from an
     * AppMode — the same shape `/me` uses. A builder page and one particular
     * test are places a student can be linked to, so they need URLs; neither is
     * a mode, because neither replaces the section underneath.
     *
     * Declared HERE, above the effect that depends on `testDetailId`: a `const`
     * named in a dependency list before its declaration throws at render.
     */
    const studySetPath = parseStudySetPath(location.pathname);
    const onTestBuilderPath = normalizedPath === TEST_BUILDER_PATH;
    const testDetailId = (() => {
        const parsed = parseAppRoute(location.pathname);
        return parsed.standalone === 'test-detail' ? parsed.params.testId ?? null : null;
    })();
    const setScopedTestId = studySetPath?.testId ?? null;

    const [testDetailError, setTestDetailError] = useState<string | null>(null);
    // Resolves `/study/tests/:testId` into a screen. Driven by `testDetailId` —
    // the id parsed out of the path — plus `currentUser`, because the fetch is
    // account-scoped and must not run before sign-in. Three outcomes: not found
    // and no questions become `testDetailError` (rendered in place of the
    // screen); a finished attempt replaces the route with its review; an unsat
    // one launches as practice or exam per `attemptKindFromConfig`. Every
    // navigation here is `replace`, so Back cannot land on a URL that instantly
    // re-launches the test. `cancelled` guards a route change mid-fetch.
    useEffect(() => {
        if (!testDetailId || !currentUser) return;
        let cancelled = false;
        setTestDetailError(null);
        void (async () => {
            const result = await fetchTestSessionById(testDetailId);
            if (cancelled) return;
            if (!result) {
                setTestDetailError('That test could not be found. It may have been removed.');
                return;
            }
            const isFinished =
                result.session?.status === 'completed' || Boolean(result.session?.endTime);
            if (isFinished) {
                setActiveTestResult(result);
                navigateTo(AppMode.TEST_REVIEW, {}, { replace: true });
                return;
            }
            const plan = planRetake({ id: result.id, session: result.session }, { alreadyFetched: true });
            if (plan.kind !== 'ready') {
                setTestDetailError(
                    plan.kind === 'unavailable' ? plan.reason : 'That test has no questions yet.'
                );
                return;
            }
            // Practice and exam are two different screens, not one screen with a
            // flag: STUDY_ACTIVE renders `mode="study"`, which is what reveals
            // each answer as it is committed and (spec §9 #5) asks how sure the
            // student was first. Launching every built test as TEST_ACTIVE is
            // how a test built as practice came out as a plain exam.
            const session = { ...buildRetakeSession(plan), id: result.id };
            const store = useTestStore.getState();
            if (attemptKindFromConfig(plan.config) === 'practice') {
                store.setActiveStudySession(session);
                store.setActiveTestSession(null);
                setActiveTestResult(null);
                navigateTo(AppMode.STUDY_ACTIVE, {}, { replace: true });
                return;
            }
            store.setActiveTestSession(session);
            store.setActiveStudySession(null);
            setActiveTestResult(null);
            navigateTo(AppMode.TEST_ACTIVE, {}, { replace: true });
        })();
        return () => { cancelled = true; };
    }, [testDetailId, currentUser, navigateTo, setActiveTestResult]);

    // The same resolution for a test opened INSIDE a study set
    // (`/study/sets/:id/test/:testId`), driven by `setScopedTestId`. It only
    // seeds the store — it never navigates and it reports no error, because the
    // set's own workspace stays on screen around it and owns the empty state.
    useEffect(() => {
        if (!setScopedTestId || !currentUser) return;
        let cancelled = false;
        void (async () => {
            const result = await fetchTestSessionById(setScopedTestId);
            if (cancelled || !result) return;
            const isFinished =
                result.session?.status === 'completed' || Boolean(result.session?.endTime);
            if (isFinished) {
                setActiveTestResult(result);
                return;
            }
            const plan = planRetake({ id: result.id, session: result.session }, { alreadyFetched: true });
            if (plan.kind !== 'ready') return;
            const session = { ...buildRetakeSession(plan), id: result.id };
            const store = useTestStore.getState();
            if (attemptKindFromConfig(plan.config) === 'practice') {
                store.setActiveStudySession(session);
                store.setActiveTestSession(null);
                return;
            }
            store.setActiveTestSession(session);
            store.setActiveStudySession(null);
        })();
        return () => { cancelled = true; };
    }, [setScopedTestId, currentUser, setActiveTestResult]);

    /**
     * "Start" on the builder page, for the deck and note sources.
     *
     * It runs on the shared job runner rather than a bare await, so the
     * generation keeps its staged progress, its budget and its notification
     * (Wave G) — and so navigating away mid-generation does not throw the
     * result on the floor after the credits were spent.
     */
    const [isBuildingTest, setIsBuildingTest] = useState(false);
    const [testBuilderError, setTestBuilderError] = useState<string | null>(null);
    const handleStartBuiltTest = useCallback(async (plan: TestPlanDraft) => {
        if (!currentUser) return;
        setTestBuilderError(null);
        setIsBuildingTest(true);
        try {
            const created = await runAiJob(
                {
                    userId: currentUser.id,
                    kind: 'quiz',
                    title: plan.sourceTitle || 'New test',
                    stages: ['Reading your material', 'Writing questions', 'Saving your test'],
                    creditCost: AI_CREDIT_COSTS.generate_questions,
                    // A fallback only — the save replaces this with the test's own route.
                    target: { path: '/tests', label: 'Open tests' },
                },
                async (report, hooks) => {
                    const result = await runTestGenerator(plan, {
                        studyGoal,
                        hooks,
                        onStage: (stage) => report(stage === 'reading' ? 0 : stage === 'generating' ? 1 : 2),
                    });
                    return result;
                },
                {
                    resolveTarget: (result) => ({
                        path: buildTestDetailPath(result.testId),
                        label: 'Open test',
                    }),
                }
            );
            const setPath = parseStudySetPath(location.pathname);
            navigateToPath(
              setPath?.studySetId
                ? buildStudySetPath({
                    studySetId: setPath.studySetId,
                    activity: 'test',
                    testId: created.testId,
                  })
                : buildTestDetailPath(created.testId),
              { replace: true }
            );
        } catch (error: any) {
            setTestBuilderError(error?.message || 'Could not build that test. Please try again.');
        } finally {
            setIsBuildingTest(false);
        }
    }, [currentUser, studyGoal, navigateToPath]);

    /**
     * Turn one chat answer from the GLOBAL companion into study material.
     *
     * Outside a room there is no workspace to file into, so the answer lands
     * in the set the student last opened (the same rule the Record door uses)
     * and, failing that, unfiled in the Library. A lesson, recap, essay or
     * play only exists inside a set, so those four navigate into the set's own
     * studio; with no set to navigate to, the answer is still saved and the
     * toast says what to do next rather than opening nothing.
     */
    const [pendingMessageTurnInto, setPendingMessageTurnInto] = useState<
        { target: TurnIntoTargetId; noteId: string } | null
    >(null);

    // Save the answer as a note first, confirm it is the note now selected, and
    // only then act on the target. A failure to save and a failure to open are
    // reported separately — the second still leaves the note on the server.
    const handleCompanionMessageTurnInto = async (
        target: TurnIntoTargetId,
        draft: MessageNoteDraft
    ) => {
        const setId = useStudySetStore.getState().lastOpenedId || undefined;
        let created;
        try {
            created = await useNotesStore.getState().createNote({
                ...draft,
                ...(setId ? { studySetId: setId } : {}),
            });
        } catch (error: any) {
            showToast(error?.message || 'Could not save that answer as a note.', 'error');
            return;
        }
        await noteHandlers.openNote(created.id);
        if (useNotesStore.getState().selectedNote?.id !== created.id) {
            showToast('Saved the answer, but could not open it.', 'error');
            return;
        }
        showToast('Answer saved as a note.', 'success');
        if (target === 'cards' || target === 'test' || target === 'quiz') {
            // Deferred, not immediate: the note handlers close over the note
            // selected at RENDER time, so running in this tick would generate
            // from whatever note was open before this one.
            setPendingMessageTurnInto({ target, noteId: created.id });
            return;
        }
        if (setId) {
            navigateToPath(
                buildStudySetPath({ studySetId: setId, activity: target, noteId: created.id })
            );
            return;
        }
        const label = TURN_INTO_TARGETS.find((row) => row.id === target)?.label ?? target;
        showToast(`Saved as a note. Add it to a study set to open ${label}.`, 'info');
    };

    // Runs the deferred cards/test/quiz generation from the handler above. The
    // guard is the whole point: it fires only once `selectedNote.id` matches the
    // note that was just created, so the note handlers generate from THAT note
    // rather than from whatever was selected when they were created. Clears the
    // pending marker before the async work, so a re-render cannot start it twice.
    useEffect(() => {
        if (!pendingMessageTurnInto || selectedNote?.id !== pendingMessageTurnInto.noteId) return;
        const { target } = pendingMessageTurnInto;
        setPendingMessageTurnInto(null);
        void (async () => {
            try {
                if (target === 'cards') {
                    const result = await noteHandlers.handleCreateFlashcardDeckFromNote(10);
                    if (result?.deck) {
                        setSelectedDeck(result.deck as any);
                        setAppMode(AppMode.DECK_DETAIL);
                        showToast(
                            `Created ${result.savedCount} flashcards in "${result.deck.name}"`,
                            'success'
                        );
                    }
                } else {
                    const session = await noteHandlers.handleStartNoteQuiz(
                        undefined,
                        undefined,
                        { studyDoor: target === 'quiz' ? 'quiz' : 'test' }
                    );
                    if (session?.questions?.length) {
                        showToast(`Quiz ready — ${session.questions.length} questions below`, 'success');
                    }
                }
            } catch (error: any) {
                showToast(error?.message || 'Could not generate that.', 'error');
            }
        })();
        // noteHandlers is re-created every render; keying on its identity would
        // fire the job twice.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingMessageTurnInto, selectedNote?.id]);

    /**
     * The Record door (Home tile and Study hub tile). Parity with mobile
     * (`apps/mobile/src/screens/study/recorderDoor.ts`): the note is named for
     * the lecture it is about to hold, not "Untitled Note", so it is findable
     * in the Library afterwards.
     *
     * The toast names "Record" — the label the button actually carries on a
     * phone, where "Record lecture" is the wide-screen label and pointing at it
     * sent students looking for a control that was not on their screen.
     */
    // Three paths, in order: a recording already in flight returns to its note
    // (never starts a second one); otherwise `resolveLectureStudioNote` says
    // whether today's lecture note already exists (resume) or must be created.
    // Either way the student lands with the recorder ready but NOT started.
    const handleRecordLecture = (courseId?: string) => {
        const lecture = useLectureRecordingStore.getState();
        if (lecture.status !== 'idle' && lecture.noteId) {
            const notesState = useNotesStore.getState();
            const openExisting = async () => {
                if (notesState.selectedNote?.id !== lecture.noteId) {
                    await notesState.loadNote(lecture.noteId!);
                }
                const note = useNotesStore.getState().selectedNote;
                if (note?.id === lecture.noteId && note.courseId) {
                    navigateTo(AppMode.COURSE_WORKSPACE, { courseId: note.courseId });
                    return;
                }
                await noteHandlers.openNote(lecture.noteId!);
            };
            void openExisting().catch((e: any) => showToast(e?.message || 'Could not return to the lecture.', 'error'));
            return;
        }
        const lastSetId = useStudySetStore.getState().lastOpenedId;
        const notesState = useNotesStore.getState();
        const todayTitle = newLectureNoteTitle();
        const decision = resolveLectureStudioNote({
            lectures: notesState.notes.filter(isLectureNote),
            recordingNoteId: lecture.noteId,
            todayTitle,
        });
        const landOnLecture = (noteId?: string, resumed = false) => {
            if (lastSetId) {
                navigateTo(AppMode.STUDY_SET_WORKSPACE, {
                    studySetId: lastSetId,
                    workspaceActivity: 'lecture',
                });
            } else if (noteId) {
                void noteHandlers.openNote(noteId);
            }
            showToast(
                resumed
                    ? 'Lecture ready \u2014 press Record to start.'
                    : 'New note ready \u2014 press Record to start.',
                'info'
            );
        };
        if (decision.action === 'resume') {
            void (async () => {
                if (notesState.selectedNote?.id !== decision.noteId) {
                    await notesState.loadNote(decision.noteId);
                }
                landOnLecture(decision.noteId, true);
            })().catch((e: any) => showToast(e?.message || 'Could not open the lecture.', 'error'));
            return;
        }
        void noteHandlers.handleCreateNote(decision.title, {
            courseId,
            studySetId: lastSetId,
        })
            .then((created) => {
                landOnLecture(created?.id, false);
            })
            .catch((e: any) => showToast(e?.message || 'Failed to create note', 'error'));
    };

    const handleOpenQuickTest = (groupId: string) => { const group = groups.find(g => g.id === groupId); if (!group) { alert('Group not found.'); return; } handleSelectChat({ ...group, chatType: 'group' }); onOpenTestConfigModal(); };
    // FIXED (F9): `handleOpenQuickStudy` is deleted. It was passed to no screen
    // — only `handleOpenQuickTest` above is wired up (DashboardScreen,
    // handleBuildTestWithGroup) — and being kept "as the study-mode twin" only
    // made the study door look wired when nothing could reach it.
    /**
     * "Study all N due" — all N of them, across every deck.
     *
     * This used to rank the decks by due count and open the biggest one, so a
     * button that said 68 started a session of 17 and ended there; the other 51
     * cards were counted, promised, and then unreachable from the door that
     * counted them. `FlashcardSession.cardQueue` is a list of cards, not a deck,
     * so the web review screen can carry the whole cross-deck queue — it only
     * needs `deck` for its title and its presence intent, which is why the
     * largest pile is still what names the session.
     *
     * Each deck's share is built with the SAME rule a single-deck review uses,
     * so the session never deals a card `handleStartReview` would have held
     * back. The new-card allowance is spent across the whole plan rather than
     * per deck: it is a daily budget, and giving every deck a fresh one would
     * introduce many times the student's configured limit in a single sitting.
     */
    const buildHomeReviewPlan = React.useCallback(() => {
        const settings = normalizeUserSettings(currentUser?.settings);
        let newIntroducedToday = getTodayStudyCounts(useTestStore.getState().studyActivityDays).newFlashcards;
        return dueReviewPlan(decks, (deckId) => {
            const queue = buildFlashcardReviewQueue(
                flashcards.filter(fc => fc.deckId === deckId),
                {
                    srsNewCardsPerDay: settings.study.srsNewCardsPerDay,
                    newCardsIntroducedToday: newIntroducedToday,
                }
            );
            newIntroducedToday += queue.filter(isNewFlashcard).length;
            return queue;
        });
    }, [decks, flashcards, currentUser?.settings]);

    /**
     * The number Home's button is allowed to say. It is the plan's own total,
     * not the store's `dueCardsCount` aggregate: the store counts cards that
     * are due by date, the plan also deals each deck's new-card allowance, and
     * live the two disagreed by ten ("Study all 68 due" → "1 / 78 across 8
     * decks"). One tally, one promise.
     */
    const homeReviewPlan = React.useMemo(() => buildHomeReviewPlan(), [buildHomeReviewPlan]);

    // "Study all due". One deck due takes the ordinary single-deck path, which
    // keeps its own new-card-limit messaging; two or more are merged into one
    // cross-deck `cardQueue` and the largest deck names the session.
    const handleFlashcardStudy = () => {
        if (decks.length === 0) {
            showToast('No flashcard decks available. Create a deck first.', 'error');
            return;
        }
        const plan = buildHomeReviewPlan();

        const topDeck = plan.first ? decks.find(d => d.id === plan.first!.deckId) : undefined;
        if (!plan.first || !topDeck) {
            showToast('No cards ready to review right now.', 'info');
            return;
        }

        handleSelectDeck(topDeck);
        // One deck due: the ordinary path, which keeps its own "new-card limit
        // reached" explanations.
        if (plan.legs.length === 1) {
            handleStartReview(topDeck);
            return;
        }
        setActiveReviewSession({ deck: topDeck, cardQueue: plan.queue });
        setAppMode(AppMode.FLASHCARD_REVIEW);
    };
    const handleStudyDeck = (deck: import('./types').Deck) => {
        handleSelectDeck(deck);
        handleStartReview(deck);
    };
    // Redirect invalid mode/state combinations
    // The safety net for every mode that needs a companion object to render:
    // a session, a result, a selected deck/note/listing/seller/company. Reached
    // after a reload, a store purge, a cancelled session or a Back step, and it
    // re-runs on `appMode` plus each of those objects. It only ever sends the
    // user to a parent mode — it must not try to re-fetch what is missing, or a
    // failed fetch would trap the app in the mode this exists to leave.
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

    // ================= THE AUTH GATE =================
    // No hook may be added below this line: these three early returns change
    // which JSX tree renders, and a hook after them would run conditionally.
    //
    // The order is the boot sequence itself:
    //  1. `isAuthLoading` — the session restore has not finished. Splash only;
    //     nothing is fetched and no route decision is made yet.
    //  2. `isPasswordRecovery` — a recovery link was consumed, so the whole app
    //     is replaced by the reset screen until a new password is set.
    //  3. `!currentUser` — restore finished without an account.
    //
    // FIXED (F9): branch 3 used to be indistinguishable from "signed out". A
    // restore that never reached a verdict — the 5 s `getSession` timeout, or a
    // throw (the 2026-09-12 boot storm: a session payload without `user`) —
    // landed on the same <Navigate to="/login?next=…"> as a genuine sign-out,
    // so a session failure surfaced as a silent bounce to /login with no error
    // anywhere on screen. `authStore.sessionRestoreFailed` now separates the
    // two, and the redirect at the end of branch 3 becomes a stated failure
    // with a Try again. Only the redirect changes: the landing, teach, auth and
    // public-marketplace paths below are all legitimate signed-out
    // destinations and still render.
    if (isAuthLoading) return (
        <div className="min-h-screen bg-lantern-background flex flex-col items-center justify-center gap-8">
            <img src="/lantern-icon-v2.png" alt="Lantern Study" width={96} height={96} className="rounded-[22%]" draggable={false} />
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-lantern-primary" />
        </div>
    );
    // After the new password is saved, the recovery session IS the signed-in
    // session: read it back, hydrate the profile, re-seed supabase-js from
    // storage and go to the dashboard. A failed profile fetch clears the user
    // rather than continuing half-signed-in, which drops through to branch 3.
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
    // Signed out. Only four kinds of path render anything: the marketing pages,
    // the teach landing, the auth screens, and the public marketplace paths.
    // Everything else redirects to /login carrying `next`, which the auth screen
    // replays — after validating it is a same-origin relative path, so the
    // parameter cannot be used as an open redirect.
    if (!currentUser) {
        const path = location.pathname;
        const isLandingPath = path === '/' || path === '/welcome';
        const isAuthPath =
            path === '/login' ||
            path === '/signup' ||
            path === '/signup/teach' ||
            path === '/forgot-password' ||
            path === '/verify-email';
        const isTeachLanding = path === '/teach';

        if (isLandingPath) {
            return (
                <Suspense fallback={null}>
                    <LandingPage
                        onSignIn={() => navigateToPath('/login')}
                        onContinue={() => navigateToPath('/signup')}
                        onOpenTeach={() => navigateToPath('/teach')}
                    />
                </Suspense>
            );
        }

        if (isTeachLanding) {
            return (
                <Suspense fallback={null}>
                    <TeachLandingPage />
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
                        const teach = consumeTeachSignupIntent(user.id);
                        if (teach) setShowOnboarding(false);
                        const next = new URLSearchParams(location.search).get('next');
                        if (next && next.startsWith('/') && !next.startsWith('//') && !next.includes('://') && !next.includes('\\')) {
                            navigateToPath(next, { replace: true });
                        } else if (teach) {
                            navigateToPath('/teach', { replace: true });
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

        if (sessionRestoreFailed) {
            return (
                <div className="min-h-screen bg-lantern-background flex flex-col items-center justify-center gap-4 px-6 text-center">
                    <img src="/lantern-icon-v2.png" alt="" width={72} height={72} className="rounded-[22%]" draggable={false} />
                    <h1 className="text-title font-semibold text-lantern-text">
                        We couldn't check your session
                    </h1>
                    <p className="max-w-sm text-body text-lantern-text-secondary">
                        This is usually a dropped connection rather than a sign-out. Try again, or
                        sign in if it keeps happening.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        <button
                            type="button"
                            onClick={() => { void useAuthStore.getState().checkAuthState(); }}
                            className="rounded-lantern bg-lantern-primary px-4 py-2 text-body font-medium text-white"
                        >
                            Try again
                        </button>
                        <button
                            type="button"
                            onClick={() => navigateToPath('/login')}
                            className="rounded-lantern border border-lantern-border px-4 py-2 text-body font-medium text-lantern-text"
                        >
                            Sign in
                        </button>
                    </div>
                </div>
            );
        }

        const nextTarget = `${path}${location.search || ''}`;
        return <Navigate to={`/login?next=${encodeURIComponent(nextTarget)}`} replace />;
    }

    // ---- Signed in. Four standalone routes render INSTEAD of the AppShell:
    // an invite acceptance, a note-share acceptance, the lecturer portal and the
    // class join page. Each is a one-off destination with its own chrome. ----
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

    // Isolated lecturer portal — no student AppShell, campus, marketplace, or
    // gamification chrome (docs/phase-teach-portal-contract.md §5).
    if (onTeachPath) {
        return (
            <ErrorBoundary>
                <Suspense fallback={<AppContentLoadingFallback />}>
                    <TeachApp onLeave={() => navigateToPath('/dashboard')} />
                </Suspense>
            </ErrorBoundary>
        );
    }
    if (joinCode !== null) {
        return (
            <ErrorBoundary>
                <Suspense fallback={<AppContentLoadingFallback />}>
                    <JoinClassPage code={joinCode} onJoined={() => navigateToPath('/dashboard')} />
                </Suspense>
            </ErrorBoundary>
        );
    }

    /**
     * Onboarding is over — ask for anything it could not collect.
     *
     * The profile-setup modal is deferred while onboarding is pending (see
     * hooks/useAppEffects.ts), so this is where it gets its one chance. In
     * practice it stays shut: onboarding's academic step writes the institution,
     * and the only thing left to ask about is a username on an account that
     * never had one.
     */
    const finishOnboarding = () => {
        const user = useAuthStore.getState().currentUser;
        if (!user) return;
        if (shouldOpenAcademicSetup(user, readAcademicSetupDismissed(user.id))) {
            openModal('usernameRequired');
        }
    };

    // ---- The five destinations ----
    // `normalizedPath`, `onMePath`, `onTestBuilderPath` and `testDetailId` are
    // derived further up, before the `/study/tests/:testId` effect that reads
    // them: a `const` read in that effect's dependency list before its own
    // declaration is a TDZ ReferenceError on every render.
    const communitiesSegmentOpen = canOpenCommunities({ isPlatformAdmin, user: currentUser });
    /**
     * Where the Campus tab lands. Shop and Jobs are open to everyone, so the
     * only segment that can be closed is Communities — it needs an institution
     * and a programme on the profile. A student who has neither opens on Shop
     * rather than on an apology.
     */
    const campusEntrySegment: CampusSegment = communitiesSegmentOpen ? 'communities' : 'shop';
    const goToCampus = () => navigateToPath(campusSegmentPath(campusEntrySegment));
    const selectCampusSegment = (segment: CampusSegment, options?: { replace?: boolean }) => {
        navigateToPath(campusSegmentPath(segment), options);
    };

    // ---- Screen renderers ----
    // Notes renders in two places — standalone (`AppMode.NOTES`) and embedded in
    // the Library's Notes tab — hence one builder with an `embedded` flag rather
    // than two call sites that would drift. Every handler here converts a
    // rejection into a toast; the three that `throw e` again do so because the
    // child screen needs the failure to keep its own row selection or draft.
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
            onMoveNotesToCourse={(noteIds, courseId, topicId) =>
                noteHandlers.handleMoveNotesToCourse(noteIds, courseId, topicId ?? null).catch((e: any) => {
                    showToast(e?.message || 'Failed to move notes', 'error');
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

    // The same two-places arrangement for Flashcards. `isInitialLoading` reads
    // the bootstrap gates rather than a local flag, so an empty library during
    // boot shows a skeleton instead of "no decks yet".
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






    // The ONE ChatWindow wiring, hosted by the chat screen and by the community
    // page (a channel renders inside COMMUNITY_DETAIL — never AppMode.CHAT).
    const renderChatWindow = (opts?: {
        communityContext?: { name: string; onOpen: () => void };
        onBack?: () => void;
    }) => (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <ChatWindow chat={selectedChat} messages={messagesForChat} currentUser={currentUser} userVotes={userVotes}
        onSendMessage={onSendMessage} onOpenQuestionModal={onOpenQuestionModal}
        onEditMessage={handleEditChatMessage} onRemoveMessage={handleRemoveChatMessage}
        onOpenGroupInfoModal={() => selectedChat && selectedChat.chatType === 'group' && onOpenGroupInfoModal()}
        onOpenTestConfigModal={onOpenTestConfigModal} onOpenStudyConfigModal={onOpenStudyConfigModal}
        onVoteQuestion={onVoteQuestion} onFlagAsSimilar={onFlagAsSimilar}
        onOpenCreateSubGroupModal={onOpenCreateSubGroupModal}
        groups={chatListGroups} onToggleArchiveGroup={handleToggleArchiveGroup}
        onOpenAIGenerateModal={() => openModal('aiGenerateQuestions')}
        onAIQuery={handleAIAskTutor}
        dmThreads={dmThreads}
        onSelectChat={handleSelectChat}
        onBack={opts?.onBack ?? handleChatBack}
        onCreateGroup={() => {
            setCreateGroupReturnMode(AppMode.CHAT);
            navigateTo(AppMode.CREATE_GROUP);
        }}
        onOpenNewDmModal={() => openModal('newDm')}
        onDeleteDmThread={handleDeleteDmThread}
        onArchiveDmThread={handleArchiveDmThread}
        onUnarchiveDmThread={handleUnarchiveDmThread}
        onDmThreadStatusChange={handleDmThreadStatusChange}
        onLoadMoreMessages={handleLoadMoreMessages}
        onLoadMoreDirectMessages={handleLoadMoreDirectMessages}
        unreadAnchorAt={unreadAnchorAt}
        onPeerChatRead={onPeerChatRead}
        communityContext={opts?.communityContext}
        onOpenLounge={(lounge) => navigateTo(AppMode.COMMUNITY_DETAIL, { slug: lounge.slug })}
        onOpenInquiries={() => navigateTo(AppMode.MARKETPLACE_INQUIRIES)} />
        </div>
    );

    // ================= THE SCREEN SWITCH =================
    // One `appMode` → one screen. The mode is the app's location for everything
    // that is not path-driven; `useRouteSync` keeps it and the URL in step, so
    // the registry never reads the URL except where a screen genuinely needs a
    // parameter the mode cannot carry (community slug, shop sub-state, study-set
    // activity, campus slug). Entries that need a companion object return null
    // and let the redirect effect above move the user out.
    //
    // The 56 case bodies live in routes/screenRegistry.tsx (M7); this builds the
    // context they read and looks the current mode up. `screenContext` is wide
    // because the switch's closure was — see the note on `ScreenContext`.
    const screenContext: ScreenContext = {
        appMode, currentUser, users, handleCreateGroup, createGroupPreset, setCreateGroupPreset,
        handleSelectChat, navigateTo, showToast, openCommunityChannel, handleEnterCreatedGroup,
        createGroupReturnMode, selectedChatIsBoard, selectedChatCommunityId, myCommunities,
        renderChatWindow, activeTestSession, handleUpdateAnswer, handleChangeQuestion,
        handleToggleBookmark, handleSubmitTest, handlePauseSession, handleCancelActiveSession,
        isSubmittingTest, activeStudySession, getUserSettings, handleEndStudySession,
        activeGameSession, handleGameAnswer, handlePauseGame, setEndGameConfirmOpen, handleRematch,
        setActiveGameSession, setAppMode, activeTestResult, testResults, groups,
        setActiveTestResult, noteHandlers, handleRetakeTestFromResult,
        handlePracticeFailedQuestions, handleAIExplainAnswer, theme, studyActivityDays,
        handleOpenCreateDeckModal, setCreateGroupReturnMode, openStudyDestination, decks,
        handleSelectDeck, openModal, handleRecordLecture, navigateToPath, toggleCompanion, budget,
        transactions, isCompanionOpen, messages, setShowImportAndStudy, handleFlashcardStudy,
        serverStreak, dueCardsCount, homeReviewPlan, handleOpenQuickTest, handleResumeSession,
        pausedSessions, handleResumePausedSession, handleAbandonPausedSession, libraryTab,
        handleLibraryTabChange, notes, renderNotesScreen, renderFlashcardsScreen,
        setStudyProductSource, location, selectedDeck, flashcards, activeReviewSession,
        handleUpdateSrsData, setActiveReviewSession, activeCramSession, handleCramAnswer,
        handleEndCramSession, handleCramIncorrect, isBuildingTest, testBuilderError,
        handleStartBuiltTest, handleBuildTestWithGroup, handleStartReview, handleStartCram,
        handleStartMatch, handleStartLearn, handleOpenCreateFlashcardModal,
        handleOpenEditFlashcardModal, handleDeleteFlashcard, handleOpenEditDeckModal,
        handleMoveDeckToCourse, handleDeleteDeck, handleGenerateFlashcards, isGeneratingFlashcards,
        handleResetDeckStatistics, handleExportDeck, handleLoadMoreFlashcards,
        handleAIEnhanceFlashcard, companionContext, handleCompanionAction, setSelectedDeck,
        handleStartNewTest, offlineBundles, handleStartOfflineSession, handleStudyDeck,
        selectedNote, comments, notesSaving, getQuizForNote, studyGoal, dailyQuizProgress,
        setStudyGoal, answerDailyQuestion, completeDailyQuiz, handleEndStudyMode, offlineDeckIds,
        pendingSyncResults, pendingFlashcardReviews, handleDeleteBundle, handleSyncResults,
        handleSyncFlashcardReviews, handleImportBundle, handleRenameBundle, isOnline,
        setAddTransactionType, handleDeleteTransaction, toggleSidebar, myListingsRefreshKey,
        marketplaceBrowseIntent, shopRoute, leaveShopSubState, setMarketplaceListingCategory,
        setSelectedMarketplaceListingId, setSelectedMarketplaceListingInitialQuantity,
        setSellerProfileReturnMode, setSelectedSellerId, selectedMarketplaceListingId,
        selectedMarketplaceListingInitialQuantity, handleInitiateDm, setSelectedMarketplaceOrderId,
        setMarketplaceBrowseIntent, setEditingMarketplaceListing, communityRoute,
        communityChannelId, selectedChat, activeCommunity, activeCommunityDetail,
        handleCommunityNavigate, discoverSection, standaloneRoute, openDiscoverGroup,
        setStudyRoomJoin, setSelectedStudyRoomId, setCreateLabOpen, selectedSellerId,
        sellerProfileReturnMode, studyProductSource, selectedStudyRoomId, studyRoomJoin,
        setDiscoverSection, selectedMarketplaceOrderId, setMyListingsRefreshKey,
        handleJobsNavigate, selectedJobId, selectedCompanyId, isPlatformAdmin,
    };

    const renderScreen = () => {
        const entry = SCREEN_REGISTRY[appMode];
        // Unreachable through `AppMode`, kept because `appMode` can hold a value
        // restored from an older build's URL or storage.
        if (!entry) return <div className="p-4">Mode not implemented yet.</div>;
        return entry(screenContext);
    };

    // Campus is one destination with three segments; each segment renders the
    // screen that already existed, inside one shared strip. Only the three
    // ENTRY modes get the strip — a listing, a job posting or a community page
    // is a screen you opened from a segment, with its own back arrow.
    const CAMPUS_SEGMENT_BY_MODE: Partial<Record<AppMode, CampusSegment>> = {
        [AppMode.DISCOVER]: 'communities',
        [AppMode.MARKETPLACE]: 'shop',
        [AppMode.MARKETPLACE_JOBS]: 'jobs',
    };

    // What actually goes in the shell's content slot. The three path-rendered
    // destinations are checked FIRST and short-circuit the AppMode switch
    // entirely — they are places the student is linked to, not sections, so they
    // leave whatever mode is underneath untouched. Only then does `renderScreen`
    // run, optionally wrapped in the Campus segment strip.
    const mainContent = () => {
        // `/me` has no AppMode: it is the one destination that is about the
        // student rather than about a part of the app, so it renders from the
        // path and leaves whatever mode they came from untouched underneath.
        if (onMePath) {
            return (
                <MeScreen
                    section={meSection}
                    onSelectSection={(next) => {
                        navigateToPath(next === 'progress' ? ME_PROGRESS_PATH : ME_PATH);
                    }}
                    currentUser={currentUser}
                    onNavigate={(mode) => navigateTo(mode)}
                    onOpenTeach={() => navigateToPath('/teach')}
                    onOpenSettings={(tab) => {
                        openModal('settings');
                        useUIStore.getState().setSettingsTab(tab ?? 'profile');
                    }}
                    onLogout={handleLogoutAndRedirect}
                    pendingSyncCount={pendingSyncResults.length + pendingFlashcardReviews.length}
                    progress={
                        <MeProgress
                            currentUser={currentUser}
                            groups={groups}
                            testResults={testResults}
                            theme={theme}
                            offlineBundles={offlineBundles}
                            studyActivityDays={studyActivityDays}
                            dailyQuests={dailyQuests}
                            questsLoaded={questsLoaded}
                            onRefreshGamification={refreshDashboardGamification}
                            serverStreak={serverStreak}
                            streakFreezes={streakFreezes}
                            onPurchaseStreakFreeze={handlePurchaseStreakFreeze}
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
                            onViewAnalysis={setAnalyzingResult}
                            onViewTestResult={(result) => { setActiveTestResult(result); setAppMode(AppMode.TEST_REVIEW); }}
                        />
                    }
                />
            );
        }
        // `/study/tests/new` — the builder, likewise rendered from the path.
        if (onTestBuilderPath) {
            return (
                <TestBuilderScreen
                    decks={decks.map((deck) => ({
                        id: deck.id,
                        name: deck.name,
                        cardCount: flashcards.filter((card) => card.deckId === deck.id).length,
                    }))}
                    notes={notes
                        .filter((note) => isQuizzableNote(note))
                        .map((note) => ({ id: note.id, title: note.title }))}
                    isBusy={isBuildingTest}
                    busyLabel="Writing your questions\u2026 this keeps running if you leave the page."
                    error={testBuilderError}
                    onBack={() => navigateTo(AppMode.TESTS_HOME)}
                    onStart={(plan) => { void handleStartBuiltTest(plan); }}
                    onOpenGroupChat={handleBuildTestWithGroup}
                />
            );
        }
        // `/study/tests/:testId` resolves and then replaces itself with the
        // test or its review. Until it does, the only honest thing on screen is
        // that it is loading — or why it could not.
        if (testDetailId) {
            return testDetailError ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 bg-lantern-background text-lantern-text text-center">
                    <p className="text-body text-lantern-text-secondary max-w-md">{testDetailError}</p>
                    <Button variant="secondary" onClick={() => navigateTo(AppMode.TESTS_HOME)}>
                        Back to Tests
                    </Button>
                </div>
            ) : (
                <AppContentLoadingFallback />
            );
        }
        const screen = renderScreen();
        const segment = CAMPUS_SEGMENT_BY_MODE[appMode];
        if (!segment) return screen;
        return (
            <CampusHubScreen
                segment={segment}
                onSelectSegment={selectCampusSegment}
                communitiesOpen={communitiesSegmentOpen}
            >
                {screen}
            </CampusHubScreen>
        );
    };
    // Everything the sidebar/rail needs, built here because the shell is
    // presentational: it renders what it is handed and owns no navigation of its
    // own. `currentPath` is passed so the rail derives its lit row from the URL
    // by the same parse this file uses, rather than from a second source.
    const sidebarProps = {
        // Boards are not chats — they live on the community page (§5.2).
        currentUser, groups: chatListGroups, dmThreads,
        selectedChatId: selectedChat?.id,
        onSelectChat: handleSelectChat,
        onNavigateToCreateGroup: () => {
            setCreateGroupReturnMode(AppMode.CHAT);
            navigateTo(AppMode.CREATE_GROUP);
        },
        onNavigateToDashboard: () => navigateTo(AppMode.DASHBOARD),
        onNavigateToStudy: () => { void openStudyDestination(); },
        onNavigateToChat: () => navigateTo(AppMode.CHAT),
        onNavigateToCampus: goToCampus,
        onNavigateToMe: () => navigateToPath(ME_PATH),
        currentPath: location.pathname,
        pendingSyncCount: pendingSyncResults.length + pendingFlashcardReviews.length, isOnline,
        currentAppMode: appMode,
        isExpanded: isSidebarExpanded, onToggleExpand: toggleSidebar,
        onOpenNewDmModal: () => openModal('newDm'),
        unreadNotificationCount: notifications.filter(n => !n.read).length,
        onOpenNotificationModal: () => openModal('notification'),
        activeTestSession, activeStudySession, activeGameSession,
        onResumeSession: handleResumeAnySession,
        onCancelSession: handleCancelPausedSession,
        dueCardsCount,
        onToggleCompanion: toggleCompanion,
        isCompanionOpen,
        onCommunityNavigate: handleCommunityNavigate,
        onOpenLounge: (lounge: { slug: string }) => navigateTo(AppMode.COMMUNITY_DETAIL, { slug: lounge.slug }),
        onOpenInquiries: () => navigateTo(AppMode.MARKETPLACE_INQUIRIES),
        // The rail's set section navigates by path, because a set activity is
        // a route under `/study/sets/:id` and not an AppMode of its own. The
        // Sidebar derives WHICH set from `currentPath` above — one parse, so
        // the lit row can never drift from the address bar.
        onNavigateToPath: (path: string) => navigateToPath(path),
    };
    // ================= RENDER =================
    // AppShell (nav chrome) wraps three layers: the breadcrumb strip, the
    // content slot from `mainContent()`, and — below the Suspense boundary — the
    // flat modal/overlay layer. Every shared modal is mounted here unconditionally
    // and controlled by the ui store's `modals` map, which is also what
    // `useModalHistory` reads to make Back close a sheet.
    return (
        <ErrorBoundary>
        <AppShell sidebarProps={sidebarProps} dueCardsCount={dueCardsCount}
            unreadChatCount={getTotalActiveUnreadChatCount(chatListGroups, dmThreads)}
            onOpenLectureNote={(noteId) => {
                void (async () => {
                    const notesState = useNotesStore.getState();
                    if (notesState.selectedNote?.id !== noteId) {
                        await notesState.loadNote(noteId);
                    }
                    const note = useNotesStore.getState().selectedNote;
                    if (note?.id === noteId && note.courseId) {
                        navigateTo(AppMode.COURSE_WORKSPACE, { courseId: note.courseId });
                        return;
                    }
                    await noteHandlers.openNote(noteId);
                })();
            }}
            onNavigateToMe={() => navigateToPath(ME_PATH)}
            onNavigateToCampus={goToCampus}
            onNavigate={handleShellNavigate}>
            {/* `routeHydrating` covers the window where useRouteSync is still
                turning the URL into a mode + selection. Rendering the switch
                during it would flash the default mode (and can fire a screen's
                own fetches against the wrong id). */}
            <Suspense fallback={<AppContentLoadingFallback />}>
            {routeHydrating ? (
                <AppContentLoadingFallback />
            ) : (
            <>
            {/* Breadcrumb strip. `shrink-0` is required, not cosmetic: this sits
                in a flex column whose sibling scrolls, and without it the flex
                shrink pass crushes the strip as the content grows. Hidden
                outright on the path-rendered destinations and on Create group /
                Admin, and hidden only on narrow screens for an open chat or
                community channel, where the chat header is the back control. */}
            <div className={`shrink-0 ${
                onMePath || onTestBuilderPath || Boolean(testDetailId)
                    || appMode === AppMode.CREATE_GROUP || appMode === AppMode.ADMIN
                    ? 'hidden'
                    : (appMode === AppMode.CHAT && selectedChat)
                        || (appMode === AppMode.COMMUNITY_DETAIL && communityChannelId)
                        ? 'hidden md:block'
                        : ''
            }`}>
            <Breadcrumb items={getBreadcrumbs({
                appMode,
                selectedDeck,
                libraryTab,
                navigateTo,
                setActiveTestResult,
                studySetTitle: useStudySetStore.getState().resolveSet(parseAppRoute(location.pathname).params.studySetId)?.title,
                studySetId: parseAppRoute(location.pathname).params.studySetId,
                workspaceActivity: parseAppRoute(location.pathname).params.workspaceActivity,
            })} />
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
            {/* ---- The modal / overlay layer. Flat and always mounted, keyed off
                `modals.*`; the ones guarded by `selectedChat?.chatType === 'group'`
                or by a non-null selection are guarded because their props cannot
                be satisfied otherwise, not to save a render. ---- */}
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
                // The widest navigation table in the file: every notification
                // type that is tappable resolves here. Two need work before they
                // can navigate — a group invite asks accept/decline first, and an
                // inquiry with only an `inquiryId` fetches both sides of the
                // user's inquiries to find the DM peer, falling back to the
                // inquiries list when that cannot be resolved.
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
                        void (async () => {
                            if (await confirmDialog(planAcceptGroupInviteConfirm())) {
                                try {
                                    await handleAcceptGroupInvite(groupId);
                                    const g = useGroupStore.getState().groups.find((x) => x.id === groupId);
                                    if (g) handleSelectChat({ ...g, chatType: 'group' });
                                    setAppMode(AppMode.CHAT);
                                } catch (err) {
                                    showToast(err instanceof Error ? err.message : 'Failed to accept invite', 'error');
                                }
                            } else if (await confirmDialog(planDeclineGroupInviteConfirm())) {
                                try {
                                    await handleDeclineGroupInvite(groupId);
                                } catch (err) {
                                    showToast(err instanceof Error ? err.message : 'Failed to decline invite', 'error');
                                }
                            }
                        })();
                    } else if (screen === 'GroupChat' && params?.groupId) {
                        const g = groups.find((x) => x.id === params.groupId);
                        if (g) {
                            handleSelectChat({ ...g, chatType: 'group' });
                            setAppMode(AppMode.CHAT);
                        }
                    } else if (screen === 'CreatorProfile' && params?.userId) {
                        setSelectedSellerId(String(params.userId));
                        setSellerProfileReturnMode(AppMode.DASHBOARD);
                        setAppMode(AppMode.CREATOR_PROFILE);
                    } else if (screen === 'MarketplaceJobDetail' && params?.jobId) {
                        navigateTo(AppMode.MARKETPLACE_JOB_DETAIL, { jobId: String(params.jobId) });
                    } else if (screen === 'MyJobApplications') {
                        navigateTo(AppMode.MY_JOB_APPLICATIONS);
                    } else if (screen === 'JobEmployerPipeline' && params?.jobId) {
                        navigateTo(AppMode.JOB_EMPLOYER_PIPELINE, { jobId: String(params.jobId) });
                    } else if (screen === 'CommunityPost' && params?.slug && params?.groupId && params?.id) {
                        navigateTo(AppMode.COMMUNITY_DETAIL, {
                            slug: String(params.slug),
                            groupId: String(params.groupId),
                            postId: String(params.id),
                        });
                    } else if (screen === 'InquiryChat') {
                        const threadId = params?.threadId ? String(params.threadId) : '';
                        const otherUserId = params?.userId ? String(params.userId) : '';
                        if (otherUserId) {
                            handleInitiateDm(otherUserId);
                        } else if (threadId) {
                            handleSelectChat({ id: threadId, chatType: 'dm' } as any);
                            navigateTo(AppMode.CHAT, { threadId });
                        } else if (params?.inquiryId) {
                            void (async () => {
                                try {
                                    const [buyer, seller] = await Promise.all([
                                        fetchMyInquiries('buyer'),
                                        fetchMyInquiries('seller'),
                                    ]);
                                    const { findInquiryRecord, inquiryThreadId, resolveInquiryDmTarget, inquiryBuyerId, inquirySellerId } = await import('@lantern/shared/chat');
                                    const row = findInquiryRecord([...(buyer || []), ...(seller || [])], {
                                        inquiryId: String(params.inquiryId),
                                    });
                                    const resolved = resolveInquiryDmTarget({
                                        viewerId: currentUser?.id,
                                        inquiryId: row?.id,
                                        threadId: inquiryThreadId(row),
                                        buyerId: inquiryBuyerId(row),
                                        sellerId: inquirySellerId(row),
                                    });
                                    if (resolved.otherUserId) handleInitiateDm(resolved.otherUserId);
                                    else if (resolved.threadId) {
                                        handleSelectChat({ id: resolved.threadId, chatType: 'dm' } as any);
                                        navigateTo(AppMode.CHAT, { threadId: resolved.threadId });
                                    }
                                    else setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                                } catch {
                                    setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                                }
                            })();
                        } else {
                            setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                        }
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
            {/* Opened either as a route (`/campus/shop/sell`, from the Shop) or
                as a plain sheet over My listings and Favorites, which keep
                their own urls. Closing the routed one leaves by the url, so
                Back and the sheet's own X agree. */}
            <CreateMarketplaceListingModal isOpen={modals.createMarketplaceListing || isSellRoute}
                onClose={() => {
                    if (isSellRoute) leaveShopSubState(SHOP_PATH);
                    closeModal('createMarketplaceListing');
                }} category={marketplaceListingCategory}
                onOpenStudyProducts={() => {
                    closeModal('createMarketplaceListing');
                    setStudyProductSource(null);
                    navigateTo(AppMode.STUDY_PRODUCT_DRAFTS);
                }}
                onSuccess={() => {
                    if (isSellRoute) leaveShopSubState(SHOP_PATH);
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
            {/* The global companion is suppressed on the three surfaces that
                embed their own companion pane, so the student never sees two. */}
            {appMode !== AppMode.COURSE_WORKSPACE && appMode !== AppMode.STUDY_SET_WORKSPACE && appMode !== AppMode.NOTE_EDITOR && (
            <AICompanionPanel
                context={companionContext}
                onAction={handleCompanionAction}
                onOpenNote={(noteId) => { void noteHandlers.openNote(noteId); }}
                onTurnIntoMessage={(target, draft) => handleCompanionMessageTurnInto(target, draft)}
                theme={theme}
            />
            )}
            {showImportAndStudy && (
                <Suspense fallback={null}>
                    <ImportAndStudyModal
                        isOpen={showImportAndStudy}
                        onClose={() => setShowImportAndStudy(false)}
                        onComplete={() => {
                            setShowImportAndStudy(false);
                        }}
                        onOpenNote={(noteId) => { noteHandlers.openNote(noteId); setShowImportAndStudy(false); }}
                        onTurnIntoStudyProduct={(result) => {
                            setStudyProductSource({ noteIds: [result.noteId], title: result.noteTitle });
                            setShowImportAndStudy(false);
                            setAppMode(AppMode.STUDY_PRODUCT_DRAFTS);
                        }}
                    />
                </Suspense>
            )}
            <CreateLabModal
                isOpen={createLabOpen}
                community={createLabCommunity}
                onClose={() => {
                    setCreateLabOpen(false);
                    setCreateLabCommunity(null);
                }}
                onCreated={(room) => {
                    setSelectedStudyRoomId(room.id);
                    setStudyRoomJoin(null);
                    setAppMode(AppMode.STUDY_ROOM);
                }}
            />
            {/* Onboarding stands down while the username gate is open: they are
                both full-screen and the gate is the one that blocks progress.
                Both exits write the completion flag before closing, so a crash
                mid-flow cannot re-show onboarding on the next boot. */}
            {showOnboarding && currentUser && !modals.usernameRequired && (
                <Suspense fallback={null}>
                    <OnboardingFlow
                        isOpen={showOnboarding}
                        programme={currentUser.programme ?? null}
                        studyLevel={currentUser.studyLevel ?? null}
                        firstCourse={onboardingFirstCourse}
                        onSkip={() => { localStorage.setItem(ONBOARDING_COMPLETE_STORAGE_KEY, ONBOARDING_COMPLETE_VALUE); setShowOnboarding(false); finishOnboarding(); }}
                        onComplete={({ streakTarget }) => {
                            localStorage.setItem(ONBOARDING_COMPLETE_STORAGE_KEY, ONBOARDING_COMPLETE_VALUE);
                            localStorage.setItem('lantern_streak_target', String(streakTarget));
                            setShowOnboarding(false);
                            finishOnboarding();
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
                                // Atomic: a starter deck is the first thing a new
                                // student sees, and an empty one is a worse first
                                // impression than an honest failure.
                                await saveGeneratedDeck({
                                    jobId: `onboarding-${currentUser.id}`,
                                    userId: currentUser.id,
                                    deckName,
                                    description: 'From onboarding',
                                    courseId: starterCourse?.id ?? null,
                                    cards: cards.map((c) => ({ front: c.front, back: c.back })),
                                });
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
            {/* The one host for `confirmDialog()` from stores/confirmStore: any
                module can await a confirmation and this renders it. Distinct
                from the end-game dialog above, which owns its own loading state
                because the forfeit is an async server call. */}
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
            <AiJobProgressPanel />
            <AccountSuspendedNotice variant="modal" />
            <FeatureTipsHost
                onboardingComplete={!showOnboarding && typeof localStorage !== 'undefined' && isOnboardingCompleteFlag(localStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY))}
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
            onResetSettings={handleResetSettings}
            // The Usage & limits tab's at-zero step: earn AI uses by inviting
            // someone, never buy them.
            onNavigateToInvite={() => { closeModal('settings'); navigateTo(AppMode.INVITE_FRIENDS); }} />
        </ErrorBoundary>
    );
};
