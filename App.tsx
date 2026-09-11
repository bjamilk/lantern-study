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
import { supabase as supabaseClient, apiLogoutSession, fetchAccountLifecycle, fetchGroups } from './services/supabase';
import {
    ONBOARDING_COMPLETE_STORAGE_KEY,
    ONBOARDING_COMPLETE_VALUE,
    isOnboardingCompleteFlag,
} from '@lantern/shared/settings';
import { getNoteStudyContent, isQuizzableNote } from '@lantern/shared';
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
import { fetchTestSessionById, fetchNotifications, fetchDecks, fetchAllFlashcards, bootstrapAuthFromStorage, fetchUserProfile, fetchMarketplaceAccess, resetMarketplaceAccessCache, joinDiscoverableGroup, openCommunityLounge, sendMessage as sendGroupMessage } from './services/supabase';
import { saveGeneratedDeck } from './services/jobArtifacts';
import { useCommunityStore } from './stores/communityStore';
import { COMMUNITY_COPY, studyGroupAnnouncement } from '@lantern/shared/network';
import { canOpenCommunities } from './components/community/communityAccess';
import { collectKnownLounges, isBoardGroup } from './utils/communityBoards';
import { useCommunityPresence } from './hooks/useCommunityPresence';
import type { CommunityNavigate } from './components/community/communityNavigation';
import MarketplacePrivatePilot, { GOODS_MARKETPLACE_MODES } from './components/marketplace/MarketplacePrivatePilot';
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
const SemesterProductsScreen = lazyWithRetry(() => import('./components/SemesterProductsScreen'));
const StudyRoomScreen = lazyWithRetry(() => import('./components/StudyRoomScreen'));
const CreatorProfileScreen = lazyWithRetry(() => import('./components/CreatorProfileScreen'));
const DiscoverScreen = lazyWithRetry(() => import('./components/DiscoverScreen'));
const InviteFriendsScreen = lazyWithRetry(() => import('./components/InviteFriendsScreen'));
const CampusScreen = lazyWithRetry(() => import('./components/CampusScreen'));
const CommunityDetailScreen = lazyWithRetry(() => import('./components/CommunityDetailScreen'));
const CommunityChannelPane = lazyWithRetry(() => import('./components/community/CommunityChannelPane'));
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
const TeachApp = lazyWithRetry(() => import('./components/teach/TeachApp'));
const JoinClassPage = lazyWithRetry(() => import('./components/teach/JoinClassPage'));
const NotesScreen = lazyWithRetry(() => import('./components/NotesScreen'));
import NoteEditorScreen from './components/NoteEditorScreen';
const LibraryScreen = lazyWithRetry(() => import('./components/LibraryScreen'));
const StudyHubScreen = lazyWithRetry(() => import('./components/StudyHubScreen'));
const CourseWorkspace = lazyWithRetry(() => import('./components/study/CourseWorkspace'));
const TestsHomeScreen = lazyWithRetry(() => import('./components/TestsHomeScreen'));
const TestBuilderScreen = lazyWithRetry(() => import('./components/TestBuilderScreen'));
const AIToolsHub = lazyWithRetry(() => import('./components/AIToolsHub'));
const LandingPage = lazyWithRetry(() => import('./components/marketing/LandingPage'));
const TeachLandingPage = lazyWithRetry(() => import('./components/marketing/TeachLandingPage'));
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
import { useModalHistory } from './components/layout/useModalHistory';
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
import { AI_CREDIT_COSTS } from '@lantern/shared';
import { CompanionAction, type TestSessionData } from './types';
import { buildFlashcardSourceContent } from './utils/buildFlashcardSource';
import { normalizeFlashcardCount } from './utils/flashcardGeneration';
import { buildRetakeSession, planRetake } from './utils/testRetake';
import { attemptKindFromConfig, type TestPlanDraft } from './utils/testBuilder';
import { runTestGenerator } from './hooks/useStudyGenerators';
import { runAiJob } from './stores/aiJobRunner';

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
    // Marketplace private pilot: ask the API whether this viewer (guest or
    // signed-in) may see the goods marketplace. The server enforces the gate
    // with 403s either way — this only picks which UI to render.
    const [marketplaceAccess, setMarketplaceAccess] = useState<boolean | null>(null);
    // Separate from the verdict: the probe could not answer. Collapsing the two
    // meant any outage — cold API, dropped wifi, token not yet restored — told
    // an allowlisted account it was not on the pilot, and the 5-minute cache
    // kept saying it.
    const [marketplaceAccessUnavailable, setMarketplaceAccessUnavailable] = useState(false);
    const [marketplaceProbeAttempt, setMarketplaceProbeAttempt] = useState(0);
    const retryMarketplaceAccess = useCallback(() => {
        resetMarketplaceAccessCache();
        setMarketplaceProbeAttempt(n => n + 1);
    }, []);
    useEffect(() => {
        let cancelled = false;
        setMarketplaceAccess(null);
        setMarketplaceAccessUnavailable(false);
        const probe = (attemptsLeft: number): void => {
            fetchMarketplaceAccess(currentUser?.id ?? 'anon')
                .then(enabled => {
                    if (!cancelled) {
                        setMarketplaceAccess(enabled);
                        setMarketplaceAccessUnavailable(false);
                    }
                })
                .catch(() => {
                    if (cancelled) return;
                    if (attemptsLeft > 0) {
                        window.setTimeout(() => { if (!cancelled) probe(attemptsLeft - 1); }, 1200);
                        return;
                    }
                    // Unknown, not denied. The API is the enforcement point and
                    // 403s regardless, so the UI says what actually happened.
                    setMarketplaceAccess(null);
                    setMarketplaceAccessUnavailable(true);
                });
        };
        probe(1);
        return () => { cancelled = true; };
    }, [currentUser?.id, marketplaceProbeAttempt]);
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
    const communityActionBusy = React.useRef(false);

    useEffect(() => {
        if (isCompanionOpen) markChecklist('tryCompanion');
    }, [isCompanionOpen, markChecklist]);

    // The community column lives only on the community's own modes (its home,
    // its channels, a room opened from it). Anything else closes it.
    useEffect(() => {
        if (appMode === AppMode.COMMUNITY_DETAIL || appMode === AppMode.STUDY_ROOM) return;
        // Route hydration seeds the community a microtask before it flips the
        // mode; a render in between must not wipe what it just set.
        if (parseAppRoute(window.location.pathname).mode === AppMode.COMMUNITY_DETAIL) return;
        if (useUIStore.getState().activeCommunity) setActiveCommunity(null);
    }, [appMode, setActiveCommunity]);
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
    // The membership list carries each community's lounge pointer, so the chat
    // list can tell a lounge from a board on a cold page load. Until it lands,
    // a community's groups stay chats — never the reverse (§0a decision 1).
    React.useEffect(() => {
        if (!currentUser?.id) return;
        void useCommunityStore.getState().loadMine().catch(() => {});
    }, [currentUser?.id]);
    const chatListGroups = React.useMemo(
        () => (Array.isArray(groups) ? groups.filter((g) => !isBoardGroup(g, knownLounges)) : []),
        [groups, knownLounges]
    );
    const selectedChatIsBoard =
        appMode === AppMode.CHAT &&
        selectedChat?.chatType === 'group' &&
        isBoardGroup(selectedChat as unknown as Group, knownLounges);
    // Closing the Chat-tab bypass (spec §5.2 / §4.5): a board reached by a
    // direct route replaces itself with the community page, which renders the
    // board. It is not refused and it never falls back to a chat.
    useEffect(() => {
        if (!selectedChatIsBoard || !selectedChat) return;
        const communityId = (selectedChat as unknown as Group).communityId;
        const slug = myCommunities.find((c) => c.id === communityId)?.slug;
        if (!slug) {
            void useCommunityStore.getState().loadMine().catch(() => {});
            return;
        }
        navigateTo(AppMode.COMMUNITY_DETAIL, { slug, groupId: selectedChat.id });
    }, [selectedChatIsBoard, selectedChat, myCommunities, navigateTo]);
    // A community channel opened from the plain chats list shows `in <Community>`
    // in its header; memberships resolve the id to a name + slug.
    const selectedChatCommunityId =
        selectedChat?.chatType === 'group' ? (selectedChat.communityId ?? null) : null;
    useEffect(() => {
        if (!selectedChatCommunityId || !currentUser?.id) return;
        void useCommunityStore.getState().loadMine().catch(() => {});
    }, [selectedChatCommunityId, currentUser?.id]);

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
    // `/discover/c/:slug/ch/:groupId` — the community owns its chat, so the
    // channel id is read from the URL, never from a switch to AppMode.CHAT.
    const communityRoute = appMode === AppMode.COMMUNITY_DETAIL ? parseAppRoute(location.pathname) : null;
    const communityChannelId = communityRoute?.params?.groupId ?? null;
    const communityRouteSlug = communityRoute?.params?.slug ?? null;
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
    // Belt and braces for the column: whatever path led here, the community
    // page always has an active community matching its URL (the column then
    // resolves the placeholder by slug).
    useEffect(() => {
        if (!communityRouteSlug) return;
        const current = useUIStore.getState().activeCommunity;
        if (!current || current.slug !== communityRouteSlug) {
            setActiveCommunity({ id: '', slug: communityRouteSlug, name: '', loungeGroupId: null });
        }
    }, [communityRouteSlug, setActiveCommunity]);
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
                    case AppMode.COURSE_WORKSPACE: return selectedNote ? `Course – ${selectedNote.title}` : 'Course workspace';
                    default: return undefined;
                }
            })(),
            noteId: appMode === AppMode.NOTE_EDITOR || appMode === AppMode.COURSE_WORKSPACE ? selectedNote?.id : undefined,
            noteContext: (appMode === AppMode.NOTE_EDITOR || appMode === AppMode.COURSE_WORKSPACE) && selectedNote
                ? getNoteStudyContent({
                    sourceType: selectedNote.sourceType,
                    body: selectedNote.body,
                    summary: selectedNote.summary,
                    attachments: selectedNote.attachments,
                  }).substring(0, 6000) || undefined
                : undefined,
            noteTitle: appMode === AppMode.NOTE_EDITOR || appMode === AppMode.COURSE_WORKSPACE ? selectedNote?.title : undefined,
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

                        // One atomic request: the deck and its cards land together
                        // or neither does. The old loop left a deck announcing
                        // cards it did not contain whenever the connection went
                        // partway through.
                        const saved = await saveGeneratedDeck({
                            jobId: `companion-${currentUser.id}-${Date.now()}`,
                            userId: currentUser.id,
                            deckName,
                            description: `Auto-generated by Lantern for: ${topics || 'weak areas review'}`,
                            cards: generated.map((card) => ({ front: card.front, back: card.back })),
                        });
                        const newDeck =
                            useFlashcardStore.getState().decks.find((d) => d.id === saved.ref.id) ??
                            ({ id: saved.ref.id, name: saved.ref.name || deckName } as any);
                        setSelectedDeck(newDeck);
                        setAppMode(AppMode.DECK_DETAIL);
                        showToast(`Created "${deckName}" with ${saved.saved} flashcards`, 'success');
                        addNotification(`Created "${deckName}" with ${saved.saved} flashcards!`);
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
    const onMePath = normalizedPath === ME_PATH;
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
    const onTestBuilderPath = normalizedPath === TEST_BUILDER_PATH;
    const testDetailId = (() => {
        const parsed = parseAppRoute(location.pathname);
        return parsed.standalone === 'test-detail' ? parsed.params.testId ?? null : null;
    })();

    const [testDetailError, setTestDetailError] = useState<string | null>(null);
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
            navigateToPath(buildTestDetailPath(created.testId), { replace: true });
        } catch (error: any) {
            setTestBuilderError(error?.message || 'Could not build that test. Please try again.');
        } finally {
            setIsBuildingTest(false);
        }
    }, [currentUser, studyGoal, navigateToPath]);

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
        void noteHandlers.handleCreateNote(newLectureNoteTitle(), { courseId })
            .then(() => showToast('New note ready \u2014 press Record to start.', 'info'))
            .catch((e: any) => showToast(e?.message || 'Failed to create note', 'error'));
    };

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
            // Private pilot: public marketplace browsing is paused too.
            if (marketplaceAccess !== true) {
                return (
                    <MarketplacePrivatePilot
                        checking={marketplaceAccess === null && !marketplaceAccessUnavailable}
                        unavailable={marketplaceAccessUnavailable}
                        onRetry={retryMarketplaceAccess}
                        onBack={() => navigateToPath('/')}
                        backLabel="Back to the homepage"
                        onSignIn={() => navigateToPath('/login')}
                    />
                );
            }
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
     * Where the Campus tab lands. Never a closed segment: Communities needs
     * an institution and a programme on the profile and Shop is a private
     * pilot, so a student who has neither opens on Jobs rather than on an
     * apology.
     */
    const campusEntrySegment: CampusSegment = communitiesSegmentOpen
        ? 'communities'
        : marketplaceAccess !== false
            ? 'shop'
            : 'jobs';
    const goToCampus = () => navigateToPath(campusSegmentPath(campusEntrySegment));
    const selectCampusSegment = (segment: CampusSegment, options?: { replace?: boolean }) => {
        navigateToPath(campusSegmentPath(segment), options);
    };

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

    // A just-joined discoverable group is not in `groups[]` until the next
    // fetch; this stand-in carries enough (communityId above all) for the
    // chat and the community column to render until the store reconciles.
    const buildDiscoverGroupStub = (params: Record<string, unknown>) => ({
        id: String(params.groupId),
        name: String(params.groupName || 'Group'),
        members: [] as User[],
        adminIds: [] as string[],
        unreadCount: 0,
        description: '',
        communityId: params.communityId ? String(params.communityId) : null,
        visibility: (params.communityId ? 'community' : 'public') as 'community' | 'public',
        memberCount: typeof params.memberCount === 'number' ? params.memberCount : undefined,
    });

    const openDiscoverGroup = (params?: Record<string, unknown>) => {
        const groupId = String(params?.groupId || '');
        if (!groupId) return;
        const target = groups.find((x) => x.id === groupId);
        if (target) {
            handleSelectChat({ ...target, chatType: 'group' });
            setAppMode(AppMode.CHAT);
            return;
        }
        if (!params?.joined) return;
        const stub = buildDiscoverGroupStub(params);
        useGroupStore.getState().updateGroups((prev) =>
            prev.some((g) => g.id === groupId) ? prev : [...prev, stub]
        );
        handleSelectChat({ ...stub, chatType: 'group' });
        setAppMode(AppMode.CHAT);
    };

    /**
     * Open a channel INSIDE its community (founder rule §0a): the group is
     * selected through the same path the chats list uses — read-marking,
     * unread reset and realtime attach behave identically — but the app stays
     * on the community's own URL, `/discover/c/:slug/ch/:groupId`.
     */
    const openCommunityChannel = (params: Record<string, unknown>) => {
        const groupId = String(params.groupId || '');
        if (!groupId) return;
        const slug = String(
            params.communitySlug || activeCommunity?.slug || parseAppRoute(location.pathname).params?.slug || ''
        );
        if (!slug) {
            openDiscoverGroup(params);
            return;
        }
        let target = useGroupStore.getState().groups.find((x) => x.id === groupId);
        if (!target) {
            if (!params.joined) return;
            const stub = buildDiscoverGroupStub(params);
            useGroupStore.getState().updateGroups((prev) =>
                prev.some((g) => g.id === groupId) ? prev : [...prev, stub]
            );
            target = stub;
        }
        handleSelectChat({ ...target, chatType: 'group' }, { keepSurface: true });
        navigateTo(AppMode.COMMUNITY_DETAIL, { slug, groupId });
    };

    const scrollToCommunityMembers = () => {
        let tries = 0;
        const tick = () => {
            const el = document.getElementById('community-members');
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
            if (tries++ < 20) window.setTimeout(tick, 100);
        };
        tick();
    };

    // The one navigation contract for the community column and page (spec §5.1).
    const handleCommunityNavigate: CommunityNavigate = async (screen, params = {}) => {
        const slugParam = String(params.slug || params.communitySlug || activeCommunity?.slug || '');
        switch (screen) {
            case 'Dashboard':
                navigateTo(AppMode.DASHBOARD);
                return;
            case 'Discover':
                setDiscoverSection('communities');
                navigateTo(AppMode.DISCOVER);
                return;
            case 'Home':
                if (slugParam) navigateTo(AppMode.COMMUNITY_DETAIL, { slug: slugParam });
                return;
            case 'CloseCommunity':
                setActiveCommunity(null);
                navigateTo(AppMode.CHAT, {});
                return;
            case 'Members':
                if (!slugParam) return;
                if (appMode !== AppMode.COMMUNITY_DETAIL || communityChannelId) {
                    navigateTo(AppMode.COMMUNITY_DETAIL, { slug: slugParam });
                }
                scrollToCommunityMembers();
                return;
            case 'GroupChat':
                openCommunityChannel(params);
                return;
            case 'JoinChannel': {
                const groupId = String(params.groupId || '');
                const communityId = String(params.communityId || '');
                if (!groupId || communityActionBusy.current) return;
                // Guests see public channels but join the community first (§6,
                // same as mobile's "Join the community to open" alert).
                if (activeCommunityDetail && activeCommunityDetail.id === communityId && !activeCommunityDetail.isMember) {
                    showToast(COMMUNITY_COPY.joinToOpen, 'info');
                    return;
                }
                communityActionBusy.current = true;
                try {
                    await joinDiscoverableGroup(groupId);
                    if (communityId) useCommunityStore.getState().invalidate(communityId);
                    openCommunityChannel({ ...params, joined: true });
                } catch (err) {
                    showToast(err instanceof Error ? err.message : 'Could not join this channel', 'error');
                } finally {
                    communityActionBusy.current = false;
                }
                return;
            }
            case 'OpenLounge': {
                const communityId = String(params.communityId || activeCommunity?.id || '');
                if (!communityId || communityActionBusy.current) return;
                const known = useUIStore.getState().activeCommunity;
                const loungeId = known?.id === communityId ? known.loungeGroupId : null;
                const inStore = loungeId
                    ? useGroupStore.getState().groups.find((g) => g.id === loungeId && !g.isArchived)
                    : undefined;
                if (inStore) {
                    openCommunityChannel({
                        groupId: inStore.id,
                        groupName: inStore.name,
                        communityId,
                        communitySlug: slugParam,
                        joined: true,
                    });
                    return;
                }
                communityActionBusy.current = true;
                try {
                    // Idempotent: mints on first use, joins the caller either way.
                    const lounge = await openCommunityLounge(communityId);
                    const current = useUIStore.getState().activeCommunity;
                    if (current && current.id === communityId && current.loungeGroupId !== lounge.groupId) {
                        setActiveCommunity({ ...current, loungeGroupId: lounge.groupId });
                    }
                    useCommunityStore.getState().invalidate(communityId);
                    // Pull the real group in before selecting it. Minting the
                    // lounge joins the caller server-side, but the local groups
                    // list does not know that yet, so without this the first tap
                    // selected a stub with no members or messages and the pane
                    // stayed on the community home while the URL said channel.
                    // Mobile has always done this (CommunityDetailScreen).
                    const userId = useAuthStore.getState().currentUser?.id;
                    if (userId) {
                        try {
                            const refreshed = await fetchGroups(userId);
                            if (refreshed) useGroupStore.getState().setGroups(refreshed);
                        } catch {
                            // A failed refresh still opens the channel: the stub
                            // below keeps the tap working, and hydration retries.
                        }
                    }
                    openCommunityChannel({
                        groupId: lounge.groupId,
                        groupName: lounge.name,
                        communityId,
                        communitySlug: slugParam,
                        joined: true,
                    });
                } catch (err) {
                    showToast(err instanceof Error ? err.message : 'Could not open the community chat', 'error');
                } finally {
                    communityActionBusy.current = false;
                }
                return;
            }
            case 'StudyRoom':
                if (params.roomId) {
                    setStudyRoomJoin(null);
                    setSelectedStudyRoomId(String(params.roomId));
                    navigateTo(AppMode.STUDY_ROOM, { roomId: String(params.roomId) });
                } else {
                    setSelectedStudyRoomId(null);
                    setStudyRoomJoin({
                        communityId: params.communityId ? String(params.communityId) : null,
                        courseId: params.courseId ? String(params.courseId) : null,
                        topic: params.topic ? String(params.topic) : null,
                    });
                    navigateTo(AppMode.STUDY_ROOM, {});
                }
                return;
            case 'CreateLab':
                setCreateLabCommunity({
                    id: String(params.communityId || activeCommunity?.id || ''),
                    name: String(params.communityName || activeCommunity?.name || activeCommunityDetail?.name || 'Community'),
                    courseId: params.courseId ? String(params.courseId) : null,
                });
                setCreateLabOpen(true);
                return;
            case 'OpenStudyGroup': {
                // A study group lives in Chat with the full study surface (§7).
                // Unjoined rows join first, then land in Chat — never on a board.
                const groupId = String(params.groupId || '');
                if (!groupId || communityActionBusy.current) return;
                const communityId = String(params.communityId || '');
                const openInChat = () => {
                    const target = useGroupStore.getState().groups.find((x) => x.id === groupId);
                    if (target) handleSelectChat({ ...target, chatType: 'group' });
                    navigateTo(AppMode.CHAT, {});
                };
                if (params.joined) {
                    openInChat();
                    return;
                }
                communityActionBusy.current = true;
                try {
                    await joinDiscoverableGroup(groupId);
                    if (communityId) useCommunityStore.getState().invalidate(communityId);
                    const userId = useAuthStore.getState().currentUser?.id;
                    if (userId) {
                        try {
                            const refreshed = await fetchGroups(userId);
                            if (refreshed) useGroupStore.getState().setGroups(refreshed);
                        } catch {
                            // A failed refresh still opens Chat; hydration retries.
                        }
                    }
                    openInChat();
                } catch (err) {
                    showToast(err instanceof Error ? err.message : 'Could not open this study group', 'error');
                } finally {
                    communityActionBusy.current = false;
                }
                return;
            }
            case 'CreateGroup':
            case 'StartStudyGroup':
                setCreateGroupPreset({
                    communityId: String(params.communityId || activeCommunity?.id || ''),
                    communityName: String(params.communityName || activeCommunity?.name || activeCommunityDetail?.name || 'Community'),
                    communitySlug: slugParam,
                    communitySurface:
                        screen === 'StartStudyGroup' || params.communitySurface === 'study_group'
                            ? 'study_group'
                            : 'board',
                    prefillName: params.prefillName ? String(params.prefillName) : undefined,
                    announceInGroupId: params.announceInGroupId
                        ? String(params.announceInGroupId)
                        : undefined,
                });
                setCreateGroupReturnMode(AppMode.COMMUNITY_DETAIL);
                navigateTo(AppMode.CREATE_GROUP);
                return;
            default:
                return;
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
        communityContext={opts?.communityContext} />
        </div>
    );

    const renderScreen = () => {
        // Marketplace private pilot: every goods-commerce mode renders the
        // honest explanation for accounts outside the allowlist (the API
        // 403s them regardless). Jobs modes are not in the set and stay open.
        if (GOODS_MARKETPLACE_MODES.has(appMode) && marketplaceAccess !== true) {
            return (
                <MarketplacePrivatePilot
                    checking={marketplaceAccess === null && !marketplaceAccessUnavailable}
                    unavailable={marketplaceAccessUnavailable}
                    onRetry={retryMarketplaceAccess}
                    onBack={() => navigateTo(AppMode.DASHBOARD)}
                />
            );
        }
        switch (appMode) {
            case AppMode.CREATE_GROUP:
                return (
                    <CreateGroupScreen
                        currentUser={currentUser}
                        allUsers={users}
                        onCreateGroup={handleCreateGroup}
                        initialDiscovery={createGroupPreset
                            ? { visibility: 'community', communityId: createGroupPreset.communityId }
                            : undefined}
                        lockedCommunity={createGroupPreset
                            ? { id: createGroupPreset.communityId, name: createGroupPreset.communityName }
                            : undefined}
                        communitySurface={createGroupPreset?.communitySurface}
                        initialName={createGroupPreset?.prefillName}
                        onEnterGroup={(group) => {
                            if (createGroupPreset) {
                                const preset = createGroupPreset;
                                setCreateGroupPreset(null);
                                if (preset.communitySurface === 'study_group') {
                                    // §7 entry point 3: a group spawned from a board post
                                    // leaves a plain TEXT pointer behind on that board, so
                                    // the conversation keeps a link to what it produced.
                                    // Fire-and-forget — the handoff must not wait on it.
                                    if (preset.announceInGroupId && currentUser) {
                                        void sendGroupMessage(
                                            preset.announceInGroupId,
                                            currentUser.id,
                                            studyGroupAnnouncement(currentUser.name, group.name),
                                        ).catch(() => undefined);
                                    }
                                    // The handoff is SHOWN, not inferred (§7): the user
                                    // physically lands in the Chat tab, with a toast that
                                    // says the group is also listed in the community.
                                    const created = useGroupStore.getState().groups.find((g) => g.id === group.id);
                                    if (created) handleSelectChat({ ...created, chatType: 'group' });
                                    navigateTo(AppMode.CHAT, {});
                                    showToast(COMMUNITY_COPY.createdInChat(group.name), 'success');
                                    return;
                                }
                                // A board created from its community opens INSIDE the
                                // community (founder rule §0a), not on the chat screen.
                                openCommunityChannel({
                                    groupId: group.id,
                                    groupName: group.name,
                                    joined: true,
                                    communityId: preset.communityId,
                                    communitySlug: preset.communitySlug,
                                });
                                return;
                            }
                            handleEnterCreatedGroup(group);
                        }}
                        onBack={() => {
                            if (createGroupReturnMode === AppMode.COMMUNITY_DETAIL && createGroupPreset) {
                                const slug = createGroupPreset.communitySlug;
                                setCreateGroupPreset(null);
                                navigateTo(AppMode.COMMUNITY_DETAIL, { slug });
                                return;
                            }
                            setCreateGroupPreset(null);
                            navigateTo(createGroupReturnMode || AppMode.CHAT);
                        }}
                    />
                );
            case AppMode.CHAT: {
                // A board never renders here — the effect above is replacing this
                // route with the community page.
                if (selectedChatIsBoard) return <AppContentLoadingFallback />;
                // Reached from the chats flyout: a community study group keeps the
                // chat surface but its header links back to the community.
                const chatCommunity = selectedChatCommunityId
                    ? myCommunities.find((c) => c.id === selectedChatCommunityId)
                    : undefined;
                return renderChatWindow(
                    chatCommunity
                        ? {
                            communityContext: {
                                name: chatCommunity.name,
                                onOpen: () => navigateTo(AppMode.COMMUNITY_DETAIL, { slug: chatCommunity.slug }),
                            },
                        }
                        : undefined
                );
            }
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
                    onRetakeTest={(session) => { void handleRetakeTestFromResult(session, activeTestResult?.id); }}
                    onPracticeFailedQuestions={handlePracticeFailedQuestions}
                    onExplainAnswer={handleAIExplainAnswer} />;
            case AppMode.DASHBOARD:
                return <DashboardScreen theme={theme} testResults={testResults} groups={groups} currentUser={currentUser} offlineBundles={offlineBundles}
                    studyActivityDays={studyActivityDays}
                    onNavigateToChat={() => navigateTo(AppMode.CHAT)} allMessages={messages}
                    userQuestionStats={userQuestionStats} onViewAnalysis={setAnalyzingResult}
                    onNavigateToFlashcards={() => navigateTo(AppMode.LIBRARY, { libraryTab: 'flashcards' })}
                    onOpenCreateDeck={handleOpenCreateDeckModal}
                    onNavigateToMarketplace={() => navigateTo(AppMode.MARKETPLACE)}
                    onNavigateToInvite={() => navigateTo(AppMode.INVITE_FRIENDS)}
                    onNavigateToCreateGroup={() => {
                        setCreateGroupReturnMode(AppMode.CHAT);
                        navigateTo(AppMode.CREATE_GROUP);
                    }}
                    onNavigateToBudget={() => navigateTo(AppMode.BUDGET_TRACKER)}
                    onNavigateToStudyHub={() => navigateTo(AppMode.STUDY_HUB)}
                    onOpenCourseWorkspace={(courseId) => navigateTo(AppMode.COURSE_WORKSPACE, { courseId })}
                    onNavigateToTests={() => navigateTo(AppMode.TESTS_HOME)}
                    onOpenDeckById={(deckId) => {
                        const deck = decks.find((d) => d.id === deckId);
                        if (deck) handleSelectDeck(deck);
                        else navigateTo(AppMode.DECK_DETAIL, { deckId });
                    }}
                    onOpenNoteById={(noteId) => { void noteHandlers.openNote(noteId); }}
                    // The readiness card's "Add your exam date" lands on the tab
                    // that edits it, not merely inside Settings.
                    onOpenAcademicSettings={() => {
                        // openModal resets the tab to 'profile', so the tab is
                        // chosen after it, not before.
                        openModal('settings');
                        useUIStore.getState().setSettingsTab('academic');
                    }}
                    onRecordLecture={handleRecordLecture}
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
                        onOpenTests={() => navigateTo(AppMode.TESTS_HOME)}
                        onCreateStudyPackFromCourse={(courseId, courseLabel) => {
                            setStudyProductSource({ courseId, title: courseLabel });
                            setAppMode(AppMode.STUDY_PRODUCT_DRAFTS);
                        }}
                        onTurnSemesterIntoProducts={() => setAppMode(AppMode.SEMESTER_PRODUCTS)}
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
                        onViewRecentTests={() => navigateTo(AppMode.TESTS_HOME)}
                        onOpenFlashcards={() => navigateTo(AppMode.LIBRARY, { libraryTab: 'flashcards' })}
                        onOpenTests={() => navigateTo(AppMode.TESTS_HOME)}
                        onRecordLecture={handleRecordLecture}
                        noteCount={notes.length}
                        onOpenCourse={(courseId) => navigateTo(AppMode.COURSE_WORKSPACE, { courseId })}
                        onOpenImport={() => setShowImportAndStudy(true)}
                    />
                );
            case AppMode.COURSE_WORKSPACE: {
                const workspaceCourseId = parseAppRoute(location.pathname).params.courseId;
                if (!workspaceCourseId) {
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
                        onViewRecentTests={() => navigateTo(AppMode.TESTS_HOME)}
                        onOpenCourse={(courseId) => navigateTo(AppMode.COURSE_WORKSPACE, { courseId })}
                        onOpenImport={() => setShowImportAndStudy(true)}
                    />
                    );
                }
                return (
                    <CourseWorkspace
                        courseId={workspaceCourseId}
                        theme={theme}
                        companionContext={companionContext}
                        onCompanionAction={handleCompanionAction}
                        onSelectDeck={handleSelectDeck}
                        onStartMatch={handleStartMatch}
                        onOpenNote={(noteId) => { void noteHandlers.openNote(noteId); }}
                        onNewTest={handleStartNewTest}
                        onOpenTest={(testId) => navigateToPath(buildTestDetailPath(testId))}
                        onOpenLibrary={() => navigateTo(AppMode.LIBRARY)}
                    />
                );
            }
            case AppMode.TESTS_HOME:
                return (
                    <TestsHomeScreen
                        results={testResults}
                        pausedSessions={pausedSessions}
                        onResumePausedSession={handleResumePausedSession}
                        onAbandonPausedSession={handleAbandonPausedSession}
                        availableBundles={offlineBundles}
                        onStartBundle={(bundleId) => handleStartOfflineSession(bundleId, 'test')}
                        onNewTest={handleStartNewTest}
                        onViewResult={(result) => { setActiveTestResult(result); setAppMode(AppMode.TEST_REVIEW); }}
                        onRetakeResult={(result) => { void handleRetakeTestFromResult(result.session, result.id); }}
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
                        onGenerateFlashcards={async (editorState, jobHooks) => {
                            try {
                                const result = await noteHandlers.handleCreateFlashcardDeckFromNote(10, editorState, jobHooks);
                                if (result?.deck) {
                                    setSelectedDeck(result.deck as any);
                                    setAppMode(AppMode.DECK_DETAIL);
                                    // The count is of cards that exist server-side, never of
                                    // cards that were merely generated: the save is atomic, so
                                    // a short count means the model produced fewer, not that
                                    // some were lost on the way to the library.
                                    showToast(`Created ${result.savedCount} flashcards in "${result.deck.name}"`, 'success');
                                }
                            } catch (e: any) {
                                showToast(e?.message || 'Failed to generate flashcards', 'error');
                            }
                        }}
                        onGenerateQuiz={async (editorState, jobHooks) => {
                            try {
                                const session = await noteHandlers.handleStartNoteQuiz(editorState, jobHooks);
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
            // The Sell sheet has its own url (`/campus/shop/sell`) and opens
            // over the Shop, so both paths render the same screen; the sheet
            // itself is mounted from the route below.
            case AppMode.CREATE_MARKETPLACE_LISTING:
            case AppMode.MARKETPLACE:
                return <MarketplaceScreen
                    refreshKey={myListingsRefreshKey}
                    initialBrowseNodeId={marketplaceBrowseIntent?.browseNodeId}
                    initialTab={marketplaceBrowseIntent?.tab}
                    initialCategory={marketplaceBrowseIntent?.category}
                    courseBrowseOpen={shopRoute.view === 'courses'}
                    courseBrowseCourseId={shopRoute.courseId}
                    onOpenCourseBrowse={() => navigateToPath(SHOP_COURSES_PATH)}
                    onOpenCourse={(courseId) => navigateToPath(
                        `${SHOP_COURSES_PATH}/${encodeURIComponent(courseId)}`
                    )}
                    onOpenCourseIndex={() => leaveShopSubState(SHOP_COURSES_PATH)}
                    onCloseCourseBrowse={() => leaveShopSubState(SHOP_PATH)}
                    onNavigate={(screen, params) => {
                    if (screen === 'CreateMarketplaceListing') {
                        setMarketplaceListingCategory(params?.category || 'academic');
                        navigateTo(AppMode.CREATE_MARKETPLACE_LISTING);
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
                        } else if (screen === 'MarketplaceListingDetail' && params?.listingId) {
                            setSelectedMarketplaceListingId(String(params.listingId));
                            setSelectedMarketplaceListingInitialQuantity(
                              params?.quantity != null ? Number(params.quantity) : null
                            );
                        } else if (screen === 'Marketplace') {
                            setMarketplaceBrowseIntent({
                                browseNodeId: params?.browseNodeId ? String(params.browseNodeId) : '',
                                tab: params?.tab,
                                category: params?.category ? String(params.category) : '',
                            });
                            setAppMode(AppMode.MARKETPLACE);
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
                // The URL is the authority: `/discover/c/:slug` is the community
                // home, `/discover/c/:slug/ch/:groupId` is one of its channels
                // rendered in this same mode with the column still out.
                const slug = String(communityRoute?.params?.slug || '');
                if (!slug) return null;
                if (communityChannelId) {
                    const backToCommunity = () => navigateTo(AppMode.COMMUNITY_DETAIL, { slug });
                    // The community decides the surface, never the screen that
                    // navigated here (spec §5.2): its lounge stays a live chat
                    // ("General"), every other community group is a board.
                    const renderLounge = () => {
                        if (selectedChat?.chatType !== 'group' || selectedChat.id !== communityChannelId) {
                            // Route hydration selects the group (or redirects to the
                            // home when it is not one of the user's groups).
                            return <AppContentLoadingFallback />;
                        }
                        return renderChatWindow({
                            communityContext: {
                                name: activeCommunity?.name || activeCommunityDetail?.name || 'Community',
                                onOpen: backToCommunity,
                            },
                            onBack: backToCommunity,
                        });
                    };
                    return <CommunityChannelPane
                        slug={slug}
                        groupId={communityChannelId}
                        renderLounge={renderLounge}
                        fallback={<AppContentLoadingFallback />}
                        onBack={backToCommunity}
                        onOpenMembers={() => void handleCommunityNavigate('Members', { slug })}
                        onStartStudyGroup={(prefillName, fromPost) =>
                            void handleCommunityNavigate('StartStudyGroup', {
                                slug,
                                communitySlug: slug,
                                communityId: activeCommunityDetail?.id || activeCommunity?.id || '',
                                communityName: activeCommunityDetail?.name || activeCommunity?.name || 'Community',
                                ...(prefillName ? { prefillName } : {}),
                                // §7 entry point 3 only — a group started from a POST
                                // leaves a pointer behind; one started from the header
                                // or the study nudge does not.
                                ...(fromPost ? { announceInGroupId: communityChannelId } : {}),
                            })
                        } />;
                }
                return <CommunityDetailScreen
                    slug={slug}
                    onBack={() => void handleCommunityNavigate('Discover')}
                    onNavigate={handleCommunityNavigate} />;
            }
            case AppMode.DISCOVER:
                // Hub is gated inside DiscoverScreen: admins get the full
                // communities/groups/people UI; everyone else gets coming soon.
                // `/discover` and `/discover/c/:slug` stay routable either way.
                return <DiscoverScreen
                    initialSection={discoverSection === 'marketplace' ? 'communities' : discoverSection}
                    // `/discover/new` and `/discover/join/:code` open a modal
                    // over the hub — the two community actions one student
                    // sends another, so both are links.
                    initialAction={standaloneRoute.params.communityAction}
                    initialCode={standaloneRoute.params.communityCode ?? null}
                    onNavigate={(screen, params) => {
                        if (screen === 'Marketplace') {
                            setAppMode(AppMode.MARKETPLACE);
                        } else if (screen === 'CommunityDetail' && params?.slug) {
                            navigateTo(AppMode.COMMUNITY_DETAIL, { slug: String(params.slug) });
                        } else if (screen === 'CreatorProfile' && params?.userId) {
                            setSelectedSellerId(String(params.userId));
                            setSellerProfileReturnMode(AppMode.DISCOVER);
                            setAppMode(AppMode.CREATOR_PROFILE);
                        } else if (screen === 'GroupChat' && params?.groupId) {
                            openDiscoverGroup(params);
                        } else if (screen === 'StudyRoom') {
                            setStudyRoomJoin({
                                courseId: params?.courseId ? String(params.courseId) : null,
                                topic: params?.topic ? String(params.topic) : null,
                            });
                            if (params?.roomId) setSelectedStudyRoomId(String(params.roomId));
                            else setSelectedStudyRoomId(null);
                            setAppMode(AppMode.STUDY_ROOM);
                        } else if (screen === 'CreateLab') {
                            setCreateLabOpen(true);
                        } else if (screen === 'AcademicSetup') {
                            useUIStore.getState().setSettingsTab('academic');
                            openModal('settings');
                        } else if (screen === 'CreateGroup') {
                            setCreateGroupReturnMode(AppMode.DISCOVER);
                            navigateTo(AppMode.CREATE_GROUP);
                        } else if (screen === 'Library') {
                            navigateTo(AppMode.LIBRARY);
                        } else if (screen === 'Dashboard') {
                            navigateTo(AppMode.DASHBOARD);
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
            case AppMode.SEMESTER_PRODUCTS:
                return (
                    <SemesterProductsScreen
                        onBack={() => setAppMode(AppMode.LIBRARY)}
                        onNavigateToDrafts={() => {
                            setStudyProductSource(null);
                            setAppMode(AppMode.STUDY_PRODUCT_DRAFTS);
                        }}
                    />
                );
            case AppMode.STUDY_ROOM:
                return (
                    <StudyRoomScreen
                        roomId={selectedStudyRoomId}
                        join={studyRoomJoin}
                        onBack={() => {
                            // Back returns to the community the room was opened
                            // from; otherwise to the hub's Room tab.
                            if (activeCommunity) {
                                navigateTo(AppMode.COMMUNITY_DETAIL, { slug: activeCommunity.slug });
                                return;
                            }
                            setDiscoverSection('rooms');
                            navigateTo(AppMode.DISCOVER);
                        }}
                        onNeedCourse={() => setCreateLabOpen(true)}
                        onRoomReady={(id) => setSelectedStudyRoomId(id)}
                        communityName={activeCommunity?.name || activeCommunityDetail?.name}
                    />
                );
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

    // Campus is one destination with three segments; each segment renders the
    // screen that already existed, inside one shared strip. Only the three
    // ENTRY modes get the strip — a listing, a job posting or a community page
    // is a screen you opened from a segment, with its own back arrow.
    const CAMPUS_SEGMENT_BY_MODE: Partial<Record<AppMode, CampusSegment>> = {
        [AppMode.DISCOVER]: 'communities',
        [AppMode.MARKETPLACE]: 'shop',
        [AppMode.MARKETPLACE_JOBS]: 'jobs',
    };

    const mainContent = () => {
        // `/me` has no AppMode: it is the one destination that is about the
        // student rather than about a part of the app, so it renders from the
        // path and leaves whatever mode they came from untouched underneath.
        if (onMePath) {
            return (
                <MeScreen
                    currentUser={currentUser}
                    theme={theme}
                    onToggleTheme={toggleTheme}
                    onNavigate={(mode) => navigateTo(mode)}
                    onOpenTeach={() => navigateToPath('/teach')}
                    onOpenSettings={() => openModal('settings')}
                    onLogout={handleLogoutAndRedirect}
                    pendingSyncCount={pendingSyncResults.length + pendingFlashcardReviews.length}
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
                shopOpen={marketplaceAccess}
            >
                {screen}
            </CampusHubScreen>
        );
    };
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
        onNavigateToStudy: () => navigateTo(AppMode.STUDY_HUB),
        onNavigateToChat: () => navigateTo(AppMode.CHAT),
        onNavigateToCampus: goToCampus,
        onNavigateToMe: () => navigateToPath(ME_PATH),
        currentPath: location.pathname,
        pendingSyncCount: pendingSyncResults.length + pendingFlashcardReviews.length, isOnline,
        onUpdateCurrentUserAvatar: handleUpdateCurrentUserAvatar,
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
    };
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
            <Suspense fallback={<AppContentLoadingFallback />}>
            {routeHydrating ? (
                <AppContentLoadingFallback />
            ) : (
            <>
            <div className={`shrink-0 ${
                onMePath || onTestBuilderPath || Boolean(testDetailId)
                    || appMode === AppMode.CREATE_GROUP || appMode === AppMode.ADMIN
                    ? 'hidden'
                    : (appMode === AppMode.CHAT && selectedChat)
                        || (appMode === AppMode.COMMUNITY_DETAIL && communityChannelId)
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
            {appMode !== AppMode.COURSE_WORKSPACE && (
            <AICompanionPanel
                context={companionContext}
                onAction={handleCompanionAction}
                theme={theme}
            />
            )}
            {showImportAndStudy && (
                <Suspense fallback={null}>
                    <ImportAndStudyModal
                        isOpen={showImportAndStudy}
                        onClose={() => setShowImportAndStudy(false)}
                        onComplete={() => undefined}
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
