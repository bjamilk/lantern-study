/**
 * The web app's screen table: one `AppMode` → one screen.
 *
 * Exports: `ScreenContext` (everything a screen needs from App.tsx),
 *  `ScreenEntry`, and `SCREEN_REGISTRY` — a `Record<AppMode, ScreenEntry>`
 *  that App.tsx looks the current mode up in.
 * Touches: no stores of its own beyond the four `getState()` reads the bodies
 *  already made (group, notes, studySet, flashcard, ui, lectureRecording); the
 *  lazy screens in ./lazyScreens; `services/supabase.sendMessage` for the board
 *  handoff; `window.location` where a screen already reached for it.
 * Gotchas:
 *  - This was App.tsx's `renderScreen` switch, moved verbatim (M7): every case
 *    body, comment included, is byte-for-byte what the switch ran. The only
 *    edit is the `const { … } = ctx` line each entry opens with, which replaces
 *    the closure the switch used to read from. Keep it that way — a "while I'm
 *    here" change here is a change to a screen, not to a router.
 *  - The record is exhaustive over `AppMode` BY TYPE, which is the point of the
 *    move: the switch's `default:` could silently swallow a mode, a missing
 *    `Record` key cannot compile. App.tsx still renders the old default for a
 *    mode value that is not an `AppMode` at runtime.
 *  - `ScreenContext` is deliberately wide (171 fields). It is the whole of what
 *    the switch closed over; narrowing it is a later step, and narrowing it
 *    early would mean changing screens rather than moving them.
 *  - Two modes share one entry because the switch fell through: STUDY_SET_
 *    WORKSPACE/COURSE_WORKSPACE and CREATE_MARKETPLACE_LISTING/MARKETPLACE.
 *    They are `const`s above the record so the sharing stays visible.
 *  - `apps/web/src/screenRegistry.surface.test.ts` pins the mode set; read it
 *    before changing anything here.
 */
import React from 'react';
import { AppMode, MessageType } from '../types';
import type {
    Budget,
    ChatItem,
    CompanionAction,
    DailyQuizSession,
    Deck,
    Flashcard,
    FlashcardSession,
    GameSession,
    Group,
    GroupPermissions,
    Message,
    NoteAttachment,
    NoteComment,
    OfflineSessionBundle,
    PausedSessionSummary,
    StudyActivityDay,
    StudyGoalMode,
    StudyNote,
    StudySessionData,
    TestQuestion,
    TestResult,
    TestSessionData,
    Transaction,
    User,
    UserAnswerRecord,
} from '../types';
import type { Location } from 'react-router-dom';
import { COMMUNITY_COPY } from '@lantern/shared/network';
import type { CommunityDetail, MyCommunity } from '@lantern/shared/network';
import { isQuizzableNote, parseStudySetPath } from '@lantern/shared';
import type { AIGeneratedFlashcard } from '../services/ai';
import type { DueReviewPlan } from '@lantern/shared/learning/dueReview';
import type { PendingFlashcardReview } from '@lantern/shared/utils/offlineReview';
import type { UserSettings } from '@lantern/shared/settings/userSettings';
import { confirmDialog } from '../stores/confirmStore';
import { sendMessage as sendGroupMessage } from '../services/supabase';
import { announceStudyGroupToBoard } from '../utils/boardHandoff';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useGroupStore } from '../stores/groupStore';
import { useLectureRecordingStore } from '../stores/lectureRecordingStore';
import { useNotesStore } from '../stores/notesStore';
import { useStudySetStore } from '../stores/studySetStore';
import { useUIStore } from '../stores/uiStore';
import type { ActiveCommunity, StudyRoomJoin } from '../stores/uiStore';
import {
    SHOP_COURSES_PATH,
    SHOP_PATH,
    buildTestDetailPath,
    parseAppRoute,
} from '../utils/appRoutes';
import type { AppRouteParams, ParsedAppRoute, ShopRoute } from '../utils/appRoutes';
import type { TestPlanDraft } from '../utils/testBuilder';
import type { ToastType } from '../components/ui/ToastBanner';
import type { CommunityNavigate } from '../components/community/communityNavigation';
import type { useNoteHandlers } from '../hooks/useNoteHandlers';
import CreateGroupScreen from '../components/CreateGroupScreen';
import DashboardScreen from '../components/DashboardScreen';
import NoteEditorScreen from '../components/NoteEditorScreen';
import OfflineModeScreen from '../components/OfflineModeScreen';
import {
    AppContentLoadingFallback,
    FlashcardsScreen,
    DeckDetailScreen,
    FlashcardReviewScreen,
    CramSessionScreen,
    MatchStudyScreen,
    LearnStudyScreen,
    ImportAndStudyModal,
    OnboardingFlow,
    DailyQuestsWidget,
    GameScreen,
    GameResultScreen,
    TestTakingScreen,
    TestReviewScreen,
    BudgetTrackerScreen,
    MarketplaceScreen,
    MarketplaceListingDetailScreen,
    MyListingsScreen,
    MarketplacePurchasesScreen,
    StudyProductDraftsScreen,
    SemesterProductsScreen,
    StudyRoomScreen,
    CreatorProfileScreen,
    DiscoverScreen,
    InviteFriendsScreen,
    CampusScreen,
    CommunityDetailScreen,
    CommunityChannelPane,
    MarketplaceFavoritesScreen,
    MarketplaceInquiriesScreen,
    MarketplaceOrdersScreen,
    MarketplaceCartScreen,
    MarketplaceCheckoutScreen,
    ShopAccountScreen,
    MarketplaceAddressesScreen,
    MarketplaceOrderDetailScreen,
    SellerCustomersScreen,
    SellerProfileScreen,
    JobsBoardScreen,
    JobDetailScreen,
    CreateJobScreen,
    MyJobPostingsScreen,
    MyJobApplicationsScreen,
    JobEmployerScreen,
    JobEmployerPipelineScreen,
    JobCompanyScreen,
    AdminScreen,
    TeachApp,
    JoinClassPage,
    NotesScreen,
    LibraryScreen,
    StudyHubScreen,
    CourseWorkspace,
    TestsHomeScreen,
    TestBuilderScreen,
    AIToolsHub,
    LandingPage,
    TeachLandingPage,
} from './lazyScreens';

/**
 * Everything a screen reads out of App.tsx.
 *
 * Wide on purpose: this is exactly the closure the `renderScreen` switch had,
 * so the move changed no screen's inputs. Each entry destructures only its own
 * share of it, which is what a later step narrows this interface down to.
 */
export interface ScreenContext {
    appMode: AppMode;
    /**
     * Never null here. App.tsx's `!currentUser` early return sits ABOVE the
     * point where this context is built, so a screen only ever renders for a
     * signed-in student — the switch relied on that narrowing and the screens
     * are typed for it.
     */
    currentUser: User;
    users: User[];
    handleCreateGroup: (details: { name: string; description: string; avatarFile: File | null; memberIds: string[]; permissions: GroupPermissions; courseId?: string | null | undefined; visibility?: "public" | "private" | "community" | undefined; communityId?: string | null | undefined; communitySurface?: "board" | "study_group" | undefined; }) => Promise<{ id: string; name: string; inviteId: string; } | undefined>;
    createGroupPreset: { communityId: string; communityName: string; communitySlug: string; communitySurface: "board" | "study_group"; prefillName?: string | undefined; announceInGroupId?: string | undefined; } | null;
    setCreateGroupPreset: React.Dispatch<React.SetStateAction<{ communityId: string; communityName: string; communitySlug: string; communitySurface: "board" | "study_group"; prefillName?: string | undefined; announceInGroupId?: string | undefined; } | null>>;
    handleSelectChat: (chat: ChatItem, options?: { keepSurface?: boolean | undefined; } | undefined) => void;
    navigateTo: (mode: AppMode, params?: AppRouteParams | undefined, options?: { replace?: boolean | undefined; } | undefined) => void;
    showToast: (message: string, type?: ToastType | undefined) => void;
    openCommunityChannel: (params: Record<string, unknown>) => void;
    handleEnterCreatedGroup: (summary: { id: string; name: string; inviteId: string; }) => void;
    createGroupReturnMode: AppMode;
    selectedChatIsBoard: boolean;
    selectedChatCommunityId: string | null;
    myCommunities: MyCommunity[];
    renderChatWindow: (opts?: { communityContext?: { name: string; onOpen: () => void; } | undefined; onBack?: (() => void) | undefined; } | undefined) => React.ReactNode;
    activeTestSession: TestSessionData | null;
    handleUpdateAnswer: (questionId: string, answerData: Partial<Omit<UserAnswerRecord, "questionId">> & { revealAnswer?: boolean | undefined; }) => void;
    handleChangeQuestion: (newIndex: number) => void;
    handleToggleBookmark: (questionId: string) => void;
    handleSubmitTest: () => Promise<void>;
    handlePauseSession: () => void;
    handleCancelActiveSession: () => Promise<void>;
    isSubmittingTest: boolean;
    activeStudySession: StudySessionData | null;
    getUserSettings: () => UserSettings;
    handleEndStudySession: () => Promise<void>;
    activeGameSession: GameSession | null;
    handleGameAnswer: (questionId: string, answerData: Partial<Omit<UserAnswerRecord, "questionId">>, timeTaken: number) => void;
    handlePauseGame: () => void;
    setEndGameConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>;
    handleRematch: (opponent: User) => void;
    setActiveGameSession: (session: GameSession | null) => void;
    setAppMode: (mode: AppMode) => void;
    activeTestResult: TestResult | null;
    testResults: TestResult[];
    groups: Group[];
    setActiveTestResult: (result: TestResult | null) => void;
    noteHandlers: ReturnType<typeof useNoteHandlers>;
    handleRetakeTestFromResult: (session: TestSessionData, rowId?: string | undefined) => Promise<void>;
    handlePracticeFailedQuestions: (failedQuestions: TestQuestion[]) => void;
    handleAIExplainAnswer: (question: string, userAnswer: string, correctAnswer: string, options?: string[] | undefined) => Promise<string | null>;
    theme: "light" | "dark";
    studyActivityDays: StudyActivityDay[];
    handleOpenCreateDeckModal: () => void;
    setCreateGroupReturnMode: React.Dispatch<React.SetStateAction<AppMode>>;
    openStudyDestination: () => Promise<void>;
    decks: Deck[];
    handleSelectDeck: (deck: Deck) => void;
    openModal: (modal: "wallet" | "createGroup" | "createDeck" | "createFlashcard" | "newDm" | "settings" | "question" | "groupInfo" | "testConfig" | "addMembers" | "notification" | "duplicateQuestion" | "addExpense" | "addIncome" | "addTransaction" | "addInvestment" | "setBudget" | "setMonthlyPlan" | "savingsGoal" | "financialToolkit" | "expenseSplit" | "recurring" | "createMarketplaceListing" | "editMarketplaceListing" | "testAnalysis" | "usernameRequired" | "aiGenerateQuestions" | "challenges") => void;
    handleRecordLecture: (courseId?: string | undefined) => void;
    navigateToPath: (path: string, options?: { replace?: boolean | undefined; } | undefined) => void;
    toggleCompanion: () => void;
    budget: Budget | null;
    transactions: Transaction[];
    isCompanionOpen: boolean;
    messages: Record<string, Message[]>;
    setShowImportAndStudy: React.Dispatch<React.SetStateAction<boolean>>;
    handleFlashcardStudy: () => void;
    serverStreak: number;
    dueCardsCount: number;
    homeReviewPlan: DueReviewPlan<Flashcard>;
    handleOpenQuickTest: (groupId: string) => void;
    handleResumeSession: (mode: AppMode) => void;
    pausedSessions: PausedSessionSummary[];
    handleResumePausedSession: (sessionId: string) => Promise<void>;
    handleAbandonPausedSession: (sessionId: string) => Promise<void>;
    libraryTab: "notes" | "flashcards";
    handleLibraryTabChange: (tab: "notes" | "flashcards") => void;
    notes: StudyNote[];
    renderNotesScreen: (embedded?: boolean) => React.ReactNode;
    renderFlashcardsScreen: (embedded?: boolean) => React.ReactNode;
    setStudyProductSource: React.Dispatch<React.SetStateAction<{ noteIds?: string[] | undefined; folderId?: string | null | undefined; courseId?: string | null | undefined; title?: string | undefined; } | null>>;
    location: Location<any>;
    selectedDeck: Deck | null;
    flashcards: Flashcard[];
    activeReviewSession: FlashcardSession | null;
    handleUpdateSrsData: (cardId: string, performanceRating: "again" | "hard" | "good" | "easy") => Promise<void>;
    setActiveReviewSession: (session: FlashcardSession | null) => void;
    activeCramSession: FlashcardSession | null;
    handleCramAnswer: (cardId: string, isCorrect: boolean) => void;
    handleEndCramSession: (stats: { correct: number; incorrect: number; }) => void;
    handleCramIncorrect: (incorrectCards: Flashcard[]) => void;
    isBuildingTest: boolean;
    testBuilderError: string | null;
    handleStartBuiltTest: (plan: TestPlanDraft) => Promise<void>;
    handleBuildTestWithGroup: () => void;
    handleStartReview: (deck: Deck) => void;
    handleStartCram: (deck: Deck, timerSeconds?: number | undefined, cardIds?: string[] | undefined) => void;
    handleStartMatch: (deck: Deck) => void;
    handleStartLearn: (deck: Deck) => void;
    handleOpenCreateFlashcardModal: (deckId?: string | undefined) => void;
    handleOpenEditFlashcardModal: (flashcard: Flashcard) => void;
    handleDeleteFlashcard: (flashcardId: string) => Promise<void>;
    handleOpenEditDeckModal: (deck: Deck) => void;
    handleMoveDeckToCourse: (deck: Deck, courseId: string | null, topicId?: string | null) => Promise<void>;
    handleDeleteDeck: (deckId: string) => Promise<void>;
    handleGenerateFlashcards: (deckId: string, notes: string, count: number, options?: { style?: "concise" | "detailed" | undefined; } | undefined) => Promise<void>;
    isGeneratingFlashcards: boolean;
    handleResetDeckStatistics: (deckId: string) => Promise<void>;
    handleExportDeck: (deckId: string, format?: "json" | "csv") => Promise<void>;
    handleLoadMoreFlashcards: (deckId: string, page: number, limit?: number) => Promise<number>;
    handleAIEnhanceFlashcard: (front: string, back: string) => Promise<AIGeneratedFlashcard | null>;
    companionContext: { userName: string | undefined; groups: string[]; weakTopics: string[]; dueCardsCount: number; recentTestSummary: string | undefined; budgetSummary: string | undefined; currentScreen: string | undefined; courseId: string | undefined; noteId: string | undefined; noteContext: string | undefined; noteTitle: string | undefined; studyGoal: StudyGoalMode; activeSessionSummary: string | undefined; };
    handleCompanionAction: (action: CompanionAction) => void;
    setSelectedDeck: (deck: Deck | null) => void;
    handleStartNewTest: () => void;
    offlineBundles: OfflineSessionBundle[];
    handleStartOfflineSession: (bundleId: string, mode: "study" | "test") => void;
    handleStudyDeck: (deck: Deck) => void;
    selectedNote: (StudyNote & { attachments?: NoteAttachment[] | undefined; }) | null;
    comments: NoteComment[];
    notesSaving: boolean;
    getQuizForNote: (noteId: string) => DailyQuizSession | null;
    studyGoal: StudyGoalMode;
    dailyQuizProgress: number;
    setStudyGoal: (goal: StudyGoalMode) => void;
    answerDailyQuestion: (questionId: string, answer: string) => void;
    completeDailyQuiz: () => void;
    handleEndStudyMode: () => void;
    offlineDeckIds: string[];
    pendingSyncResults: TestResult[];
    pendingFlashcardReviews: PendingFlashcardReview[];
    handleDeleteBundle: (bundleId: string) => Promise<void>;
    handleSyncResults: () => Promise<void>;
    handleSyncFlashcardReviews: () => Promise<void>;
    handleImportBundle: (bundle: OfflineSessionBundle) => string | null;
    handleRenameBundle: (bundleId: string, newName: string) => void;
    isOnline: boolean;
    setAddTransactionType: (t: "expense" | "income") => void;
    handleDeleteTransaction: (transactionId: string) => void;
    toggleSidebar: () => void;
    myListingsRefreshKey: number;
    marketplaceBrowseIntent: { browseNodeId?: string | undefined; tab?: "academic" | "student-life" | "shops" | undefined; category?: string | undefined; } | null;
    shopRoute: ShopRoute;
    leaveShopSubState: (to: string) => void;
    setMarketplaceListingCategory: (category: "academic" | "student-life") => void;
    setSelectedMarketplaceListingId: (id: string | null) => void;
    setSelectedMarketplaceListingInitialQuantity: (qty: number | null) => void;
    setSellerProfileReturnMode: React.Dispatch<React.SetStateAction<AppMode>>;
    setSelectedSellerId: (id: string | null) => void;
    selectedMarketplaceListingId: string | null;
    selectedMarketplaceListingInitialQuantity: number | null;
    handleInitiateDm: (otherUserId: string) => Promise<void>;
    setSelectedMarketplaceOrderId: (id: string | null) => void;
    setMarketplaceBrowseIntent: React.Dispatch<React.SetStateAction<{ browseNodeId?: string | undefined; tab?: "academic" | "student-life" | "shops" | undefined; category?: string | undefined; } | null>>;
    setEditingMarketplaceListing: (listing: any) => void;
    communityRoute: ParsedAppRoute | null;
    communityChannelId: string | null;
    selectedChat: ChatItem | null;
    activeCommunity: ActiveCommunity | null;
    activeCommunityDetail: CommunityDetail | undefined;
    handleCommunityNavigate: CommunityNavigate;
    discoverSection: "marketplace" | "groups" | "communities" | "people" | "rooms";
    standaloneRoute: ParsedAppRoute;
    openDiscoverGroup: (params?: Record<string, unknown> | undefined) => void;
    setStudyRoomJoin: (join: StudyRoomJoin | null) => void;
    setSelectedStudyRoomId: (id: string | null) => void;
    setCreateLabOpen: React.Dispatch<React.SetStateAction<boolean>>;
    selectedSellerId: string | null;
    sellerProfileReturnMode: AppMode;
    studyProductSource: { noteIds?: string[] | undefined; folderId?: string | null | undefined; courseId?: string | null | undefined; title?: string | undefined; } | null;
    selectedStudyRoomId: string | null;
    studyRoomJoin: StudyRoomJoin | null;
    setDiscoverSection: React.Dispatch<React.SetStateAction<"marketplace" | "groups" | "communities" | "people" | "rooms">>;
    selectedMarketplaceOrderId: string | null;
    setMyListingsRefreshKey: React.Dispatch<React.SetStateAction<number>>;
    handleJobsNavigate: (screen: string, params?: Record<string, unknown> | undefined) => void;
    selectedJobId: string | null;
    selectedCompanyId: string | null;
    isPlatformAdmin: boolean;
}

/** One screen, rendered from the context App.tsx hands it. */
export type ScreenEntry = (ctx: ScreenContext) => React.ReactNode;

const renderStudyRoom: ScreenEntry = (ctx) => {
    const {
        location, navigateTo, selectedDeck, decks, flashcards, theme, activeReviewSession,
        handleUpdateSrsData, setActiveReviewSession, activeCramSession, handleCramAnswer,
        handleEndCramSession, handleCramIncorrect, notes, isBuildingTest, testBuilderError,
        handleStartBuiltTest, handleBuildTestWithGroup, activeTestSession, activeStudySession,
        handleUpdateAnswer, handleChangeQuestion, handleToggleBookmark, handleSubmitTest,
        handleEndStudySession, handlePauseSession, handleCancelActiveSession, isSubmittingTest,
        handleStartReview, handleStartCram, handleStartMatch, handleStartLearn,
        handleOpenCreateFlashcardModal, handleOpenEditFlashcardModal, handleDeleteFlashcard,
        handleOpenEditDeckModal, handleMoveDeckToCourse, handleDeleteDeck, handleGenerateFlashcards,
        isGeneratingFlashcards, handleResetDeckStatistics, handleExportDeck,
        handleLoadMoreFlashcards, handleAIEnhanceFlashcard, handleResumeSession, pausedSessions,
        handleResumePausedSession, handleAbandonPausedSession, companionContext,
        handleCompanionAction, setSelectedDeck, handleSelectDeck, noteHandlers, handleStartNewTest,
        navigateToPath
    } = ctx;
    const workspaceRoute = parseAppRoute(location.pathname).params;
    const workspaceCourseId = workspaceRoute.courseId;
    const workspaceSetId = workspaceRoute.studySetId;
    const setPath = parseStudySetPath(location.pathname);
    if (workspaceSetId && setPath) {
        const backToSet = (activity: typeof setPath.activity, extras: Record<string, unknown> = {}) =>
            navigateTo(AppMode.STUDY_SET_WORKSPACE, {
                studySetId: workspaceSetId,
                workspaceActivity: activity,
                ...extras,
            });
        if (setPath.playSession === 'match') {
            const deck = selectedDeck || decks.find((row) => row.studySetId === workspaceSetId) || decks[0];
            if (deck) {
                return (
                    <MatchStudyScreen
                        cards={flashcards.filter((fc) => fc.deckId === deck.id)}
                        deckName={deck.name}
                        onExit={() => backToSet('play')}
                        theme={theme}
                    />
                );
            }
        }
        if (setPath.cardSession === 'review' && activeReviewSession) {
            return (
                <FlashcardReviewScreen
                    session={activeReviewSession}
                    onUpdateSrs={handleUpdateSrsData}
                    onEndSession={() => {
                        setActiveReviewSession(null);
                        backToSet('cards', { deckId: setPath.deckId });
                    }}
                />
            );
        }
        if (setPath.cardSession === 'cram' && activeCramSession) {
            return (
                <CramSessionScreen
                    session={activeCramSession}
                    onAnswer={handleCramAnswer}
                    onEndSession={(stats) => {
                        handleEndCramSession(stats);
                        backToSet('cards', { deckId: setPath.deckId });
                    }}
                    onCramIncorrect={handleCramIncorrect}
                />
            );
        }
        if (setPath.cardSession === 'learn') {
            const deck = selectedDeck || decks.find((row) => row.id === setPath.deckId);
            if (deck) {
                return (
                    <LearnStudyScreen
                        cards={flashcards.filter((fc) => fc.deckId === deck.id)}
                        deckName={deck.name}
                        onExit={() => backToSet('cards', { deckId: deck.id })}
                        theme={theme}
                    />
                );
            }
        }
        if (setPath.activity === 'test' && setPath.createNew) {
            return (
                <TestBuilderScreen
                    decks={decks
                        .filter((deck) => !deck.studySetId || deck.studySetId === workspaceSetId)
                        .map((deck) => ({
                            id: deck.id,
                            name: deck.name,
                            cardCount: flashcards.filter((card) => card.deckId === deck.id).length,
                        }))}
                    notes={notes
                        .filter((note) => isQuizzableNote(note) && (!note.studySetId || note.studySetId === workspaceSetId))
                        .map((note) => ({ id: note.id, title: note.title }))}
                    isBusy={isBuildingTest}
                    busyLabel="Writing your questions\u2026 this keeps running if you leave the page."
                    error={testBuilderError}
                    onBack={() => backToSet('test')}
                    onStart={(plan) => { void handleStartBuiltTest(plan); }}
                    onOpenGroupChat={handleBuildTestWithGroup}
                    // Built here, filed here: without this a test
                    // built inside a set from an unfiled deck or
                    // note belonged to no set, and the room's Test
                    // tab could never list it.
                    studySetId={workspaceSetId}
                />
            );
        }
        if (setPath.testId && (activeTestSession || activeStudySession)) {
            const session = activeTestSession || activeStudySession;
            if (session) {
                return (
                    <TestTakingScreen
                        mode={activeStudySession ? 'study' : 'test'}
                        session={session}
                        onUpdateAnswer={handleUpdateAnswer}
                        onChangeQuestion={handleChangeQuestion}
                        onToggleBookmark={handleToggleBookmark}
                        onSubmitTest={handleSubmitTest}
                        onSubmitOfflineTest={handleSubmitTest}
                        onEndSession={handleEndStudySession}
                        onPauseSession={handlePauseSession}
                        onCancelSession={() => {
                            handleCancelActiveSession();
                            backToSet('test');
                        }}
                        isSubmittingTest={isSubmittingTest}
                    />
                );
            }
        }
        if (setPath.activity === 'cards' && setPath.deckId && !setPath.cardSession) {
            const deck = selectedDeck?.id === setPath.deckId
                ? selectedDeck
                : decks.find((row) => row.id === setPath.deckId);
            if (deck) {
                return (
                    <DeckDetailScreen
                        deck={deck}
                        flashcards={flashcards}
                        onBack={() => backToSet('cards')}
                        onStartReview={(next) => {
                            handleStartReview(next);
                            backToSet('cards', { deckId: next.id, cardSession: 'review' });
                        }}
                        onStartCram={(next) => {
                            handleStartCram(next);
                            backToSet('cards', { deckId: next.id, cardSession: 'cram' });
                        }}
                        onStartMatch={(next) => {
                            handleStartMatch(next);
                            backToSet('play', { playSession: 'match' });
                        }}
                        onStartLearn={(next) => {
                            handleStartLearn(next);
                            backToSet('cards', { deckId: next.id, cardSession: 'learn' });
                        }}
                        onOpenCreateFlashcard={handleOpenCreateFlashcardModal}
                        onOpenEditFlashcard={handleOpenEditFlashcardModal}
                        onDeleteFlashcard={handleDeleteFlashcard}
                        onOpenEditDeck={handleOpenEditDeckModal}
                        onMoveDeckToCourse={handleMoveDeckToCourse}
                        onDeleteDeck={handleDeleteDeck}
                        onGenerateFlashcards={handleGenerateFlashcards}
                        isGenerating={isGeneratingFlashcards}
                        onResetStatistics={handleResetDeckStatistics}
                        onExportDeck={handleExportDeck}
                        onLoadMoreCards={handleLoadMoreFlashcards}
                        onEnhanceFlashcard={handleAIEnhanceFlashcard}
                    />
                );
            }
        }
    }
    if (!workspaceCourseId && !workspaceSetId) {
        return (
        <StudyHubScreen
            decks={decks}
            onOpenLibrary={() => navigateTo(AppMode.LIBRARY)}
            activeTestSession={activeTestSession}
            activeStudySession={activeStudySession}
            onResumeSession={() => handleResumeSession(activeTestSession ? AppMode.TEST_ACTIVE : AppMode.STUDY_ACTIVE)}
            pausedSessions={pausedSessions}
            onResumePausedSession={handleResumePausedSession}
            onAbandonPausedSession={handleAbandonPausedSession}
            onOpenStudySet={(studySetId) => navigateTo(AppMode.STUDY_SET_WORKSPACE, { studySetId })}
        />
        );
    }
    return (
        <CourseWorkspace
            courseId={workspaceCourseId}
            studySetId={workspaceSetId}
            routePath={setPath}
            theme={theme}
            companionContext={companionContext}
            onCompanionAction={handleCompanionAction}
            onSelectDeck={(deck) => {
                setSelectedDeck(deck);
                if (workspaceSetId) {
                    navigateTo(AppMode.STUDY_SET_WORKSPACE, {
                        studySetId: workspaceSetId,
                        workspaceActivity: 'cards',
                        deckId: deck.id,
                    });
                    return;
                }
                handleSelectDeck(deck);
            }}
            onStartMatch={(deck) => {
                handleStartMatch(deck);
                if (workspaceSetId) {
                    navigateTo(AppMode.STUDY_SET_WORKSPACE, {
                        studySetId: workspaceSetId,
                        workspaceActivity: 'play',
                        playSession: 'match',
                    });
                }
            }}
            onStartCram={(deck, timer, cardIds) => {
                handleStartCram(deck, timer, cardIds);
                if (workspaceSetId) {
                    navigateTo(AppMode.STUDY_SET_WORKSPACE, {
                        studySetId: workspaceSetId,
                        workspaceActivity: 'cards',
                        deckId: deck.id,
                        cardSession: 'cram',
                    });
                }
            }}
            onOpenNote={(noteId) => {
                if (workspaceSetId) {
                    navigateTo(AppMode.STUDY_SET_WORKSPACE, {
                        studySetId: workspaceSetId,
                        workspaceActivity: 'notes',
                        noteId,
                    });
                    return;
                }
                void noteHandlers.openNote(noteId);
            }}
            onNewTest={handleStartNewTest}
            onOpenTest={(testId) => {
                if (workspaceSetId) {
                    navigateTo(AppMode.STUDY_SET_WORKSPACE, {
                        studySetId: workspaceSetId,
                        workspaceActivity: 'test',
                        testId,
                    });
                    return;
                }
                navigateToPath(buildTestDetailPath(testId));
            }}
            onOpenLibrary={() => navigateTo(AppMode.LIBRARY)}
        />
    );
};

const renderShop: ScreenEntry = (ctx) => {
    const {
        myListingsRefreshKey, marketplaceBrowseIntent, shopRoute, navigateToPath, leaveShopSubState,
        setMarketplaceListingCategory, navigateTo, setSelectedMarketplaceListingId,
        setSelectedMarketplaceListingInitialQuantity, setAppMode, setStudyProductSource,
        setSellerProfileReturnMode, setSelectedSellerId
    } = ctx;
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
        // The marketplace screens navigate by NAME, not by AppMode —
        // the same string contract mobile uses, so one screen can be
        // shared. Each `onNavigate` below is a translation table from
        // those names to modes plus the selection the target needs
        // (listing id, order id, seller id, …). An unrecognised name
        // falls through and does nothing.
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
        } else if (screen === 'MarketplaceCheckout') {
            setAppMode(AppMode.MARKETPLACE_CHECKOUT);
        } else if (screen === 'MarketplaceYou') {
            setAppMode(AppMode.MARKETPLACE_YOU);
        } else if (screen === 'MarketplaceAddresses') {
            setAppMode(AppMode.MARKETPLACE_ADDRESSES);
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
};

export const SCREEN_REGISTRY: Record<AppMode, ScreenEntry> = {
    [AppMode.CREATE_GROUP]: (ctx) => {
        const {
            currentUser, users, handleCreateGroup, createGroupPreset, setCreateGroupPreset,
            handleSelectChat, navigateTo, showToast, openCommunityChannel, handleEnterCreatedGroup,
            createGroupReturnMode
        } = ctx;
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
                            announceStudyGroupToBoard(preset, currentUser, group.name, sendGroupMessage);
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
    },
    [AppMode.CHAT]: (ctx) => {
        const { selectedChatIsBoard, selectedChatCommunityId, myCommunities, renderChatWindow, navigateTo } = ctx;
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
    },
    [AppMode.TEST_ACTIVE]: (ctx) => {
        const {
            activeTestSession, handleUpdateAnswer, handleChangeQuestion, handleToggleBookmark,
            handleSubmitTest, handlePauseSession, handleCancelActiveSession, isSubmittingTest
        } = ctx;
        if (!activeTestSession) return null;
        return <TestTakingScreen mode="test" session={activeTestSession}
            onUpdateAnswer={handleUpdateAnswer} onChangeQuestion={handleChangeQuestion}
            onToggleBookmark={handleToggleBookmark} onSubmitTest={handleSubmitTest}
            onSubmitOfflineTest={handleSubmitTest} onPauseSession={handlePauseSession}
            onCancelSession={handleCancelActiveSession} isSubmittingTest={isSubmittingTest} />;
    },
    [AppMode.STUDY_ACTIVE]: (ctx) => {
        const {
            activeStudySession, getUserSettings, handleUpdateAnswer, handleChangeQuestion,
            handleToggleBookmark, handleEndStudySession, handlePauseSession, handleCancelActiveSession
        } = ctx;
        if (!activeStudySession) return null;
        return <TestTakingScreen mode="study" session={activeStudySession}
            showExplanationsImmediately={getUserSettings().study.showExplanationsImmediately}
            onUpdateAnswer={handleUpdateAnswer} onChangeQuestion={handleChangeQuestion}
            onToggleBookmark={handleToggleBookmark} onEndSession={handleEndStudySession}
            onPauseSession={handlePauseSession} onCancelSession={handleCancelActiveSession} />;
    },
    [AppMode.GAME_ACTIVE]: (ctx) => {
        const { activeGameSession, handleGameAnswer, handlePauseGame, setEndGameConfirmOpen } = ctx;
        if (!activeGameSession) return null;
        return <GameScreen
            session={activeGameSession}
            onUpdateAnswer={handleGameAnswer}
            onPauseSession={handlePauseGame}
            onRequestEndSession={() => setEndGameConfirmOpen(true)}
        />;
    },
    [AppMode.GAME_RESULTS]: (ctx) => {
        const { activeGameSession, currentUser, handleRematch, setActiveGameSession, setAppMode } = ctx;
        if (!activeGameSession || (!activeGameSession.isComplete && !activeGameSession.awaitingOpponent)) return null;
        return <GameResultScreen session={activeGameSession} currentUser={currentUser} onRematch={handleRematch}
            onExit={() => { setActiveGameSession(null); setAppMode(AppMode.CHAT); }} />;
    },
    [AppMode.TEST_REVIEW]: (ctx) => {
        const {
            activeTestResult, testResults, groups, setActiveTestResult, setAppMode, noteHandlers,
            handleRetakeTestFromResult, handlePracticeFailedQuestions, handleAIExplainAnswer
        } = ctx;
        if (!activeTestResult) return null;
        {
            const sourceNoteId = activeTestResult.session?.config?.sourceNoteId || null;
            const sourceNoteTitle = activeTestResult.session?.config?.sourceNoteTitle;
            return <TestReviewScreen results={activeTestResult} allTestResults={testResults} groups={groups}
                onExit={() => { setActiveTestResult(null); setAppMode(AppMode.CHAT); }}
                onNavigateToDashboard={() => { setActiveTestResult(null); setAppMode(AppMode.DASHBOARD); }}
                onBackToNote={
                  sourceNoteId
                    ? () => {
                        setActiveTestResult(null);
                        void noteHandlers.openNote(sourceNoteId);
                      }
                    : undefined
                }
                backToNoteLabel={sourceNoteTitle ? `Back to ${sourceNoteTitle}` : undefined}
                onRetakeTest={(session) => { void handleRetakeTestFromResult(session, activeTestResult?.id); }}
                onPracticeFailedQuestions={handlePracticeFailedQuestions}
                onExplainAnswer={handleAIExplainAnswer} />;
        }
    },
    [AppMode.DASHBOARD]: (ctx) => {
        const {
            theme, testResults, groups, currentUser, studyActivityDays, navigateTo,
            handleOpenCreateDeckModal, setCreateGroupReturnMode, openStudyDestination, decks,
            handleSelectDeck, noteHandlers, openModal, handleRecordLecture, navigateToPath,
            toggleCompanion, budget, transactions, appMode, isCompanionOpen, messages,
            setShowImportAndStudy, handleFlashcardStudy, serverStreak, dueCardsCount, homeReviewPlan,
            handleOpenQuickTest, activeTestSession, activeStudySession, handleResumeSession,
            pausedSessions, handleResumePausedSession, handleAbandonPausedSession
        } = ctx;
        return <DashboardScreen theme={theme} testResults={testResults} groups={groups} currentUser={currentUser}
            studyActivityDays={studyActivityDays}
            onNavigateToChat={() => navigateTo(AppMode.CHAT)}
            onNavigateToFlashcards={() => navigateTo(AppMode.LIBRARY, { libraryTab: 'flashcards' })}
            onOpenCreateDeck={handleOpenCreateDeckModal}
            onNavigateToMarketplace={() => navigateTo(AppMode.MARKETPLACE)}
            onNavigateToCreateGroup={() => {
                setCreateGroupReturnMode(AppMode.CHAT);
                navigateTo(AppMode.CREATE_GROUP);
            }}
            onNavigateToBudget={() => navigateTo(AppMode.BUDGET_TRACKER)}
            onNavigateToStudyHub={() => { void openStudyDestination(); }}
            onOpenCourseWorkspace={(courseId) => navigateTo(AppMode.COURSE_WORKSPACE, { courseId })}
            onOpenStudySet={(studySetId) => navigateTo(AppMode.STUDY_SET_WORKSPACE, { studySetId })}
            onNavigateToTests={() => navigateTo(AppMode.TESTS_HOME)}
            onOpenDeckById={(deckId) => {
                const deck = decks.find((d) => d.id === deckId);
                if (deck) handleSelectDeck(deck);
                else navigateTo(AppMode.DECK_DETAIL, { deckId });
            }}
            onOpenNoteById={(noteId) => { void noteHandlers.openNote(noteId); }}
            onOpenAcademicSettings={() => {
                openModal('settings');
                useUIStore.getState().setSettingsTab('academic');
            }}
            onRecordLecture={() => handleRecordLecture()}
            onNavigatePath={(path) => navigateToPath(path)}
            onNavigateToLibrary={() => navigateTo(AppMode.LIBRARY)}
            onNavigateToOffline={() => navigateTo(AppMode.OFFLINE_MODE)}
            onToggleCompanion={toggleCompanion}
            deckCount={decks.length}
            hasBudgetSet={!!(budget?.monthlyLimit && budget.monthlyLimit > 0) || transactions.length > 0}
            // KNOWN ISSUE (tracked, found during M7): this and the two
            // `hasExploredMarketplace` / `hasTriedOffline` props below are
            // always FALSE. They are only evaluated while the dashboard is on
            // screen, i.e. while `appMode` is DASHBOARD, so the onboarding
            // checklist can never tick "opened the library", "explored the
            // shop" or "tried offline". The switch hid it (TypeScript reported
            // the comparisons as having no overlap, but App.tsx is not in any
            // tsc project — see the note in apps/web/vite.config.ts). Left
            // exactly as it behaved; fixing it needs a visited-mode record,
            // which is a behaviour change.
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
            serverStreak={serverStreak}
            dueCardsCount={dueCardsCount}
            reviewPlanTotalDue={homeReviewPlan.totalDue}
            onOpenQuickTest={handleOpenQuickTest}
            activeTestSession={activeTestSession}
            activeStudySession={activeStudySession}
            onResumeSession={() => handleResumeSession(activeTestSession ? AppMode.TEST_ACTIVE : AppMode.STUDY_ACTIVE)}
            pausedSessions={pausedSessions}
            onResumePausedSession={handleResumePausedSession}
            onAbandonPausedSession={handleAbandonPausedSession}
        />;
    },
    [AppMode.LIBRARY]: (ctx) => {
        const {
            libraryTab, handleLibraryTabChange, dueCardsCount, notes, decks, renderNotesScreen,
            renderFlashcardsScreen, noteHandlers, handleSelectDeck, navigateTo, setStudyProductSource,
            setAppMode
        } = ctx;
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
                onOpenStudy={() => {
                    useStudySetStore.getState().openPicker();
                    navigateTo(AppMode.STUDY_HUB);
                }}
            />
        );
    },
    [AppMode.STUDY_HUB]: (ctx) => {
        const {
            decks, navigateTo, activeTestSession, activeStudySession, handleResumeSession,
            pausedSessions, handleResumePausedSession, handleAbandonPausedSession
        } = ctx;
        return (
            <StudyHubScreen
                decks={decks}
                onOpenLibrary={() => navigateTo(AppMode.LIBRARY)}
                activeTestSession={activeTestSession}
                activeStudySession={activeStudySession}
                onResumeSession={() => handleResumeSession(activeTestSession ? AppMode.TEST_ACTIVE : AppMode.STUDY_ACTIVE)}
                pausedSessions={pausedSessions}
                onResumePausedSession={handleResumePausedSession}
                onAbandonPausedSession={handleAbandonPausedSession}
                onOpenStudySet={(studySetId) => navigateTo(AppMode.STUDY_SET_WORKSPACE, { studySetId })}
            />
        );
    },
    [AppMode.STUDY_SET_WORKSPACE]: renderStudyRoom,
    [AppMode.COURSE_WORKSPACE]: renderStudyRoom,
    [AppMode.TESTS_HOME]: (ctx) => {
        const {
            testResults, pausedSessions, handleResumePausedSession, handleAbandonPausedSession,
            offlineBundles, handleStartOfflineSession, handleStartNewTest, setActiveTestResult,
            setAppMode, handleRetakeTestFromResult
        } = ctx;
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
    },
    [AppMode.AI_TOOLS]: (ctx) => {
        const { theme, noteHandlers, handleStudyDeck, handleFlashcardStudy, navigateTo, showToast } = ctx;
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
    },
    [AppMode.NOTES]: (ctx) => {
        const { renderNotesScreen } = ctx;
        return renderNotesScreen(false);
    },
    [AppMode.NOTE_EDITOR]: (ctx) => {
        const {
            selectedNote, theme, comments, groups, currentUser, notesSaving, navigateTo, noteHandlers,
            setStudyProductSource, setAppMode, showToast, setSelectedDeck, getQuizForNote, studyGoal,
            dailyQuizProgress, setStudyGoal, answerDailyQuestion, completeDailyQuiz
        } = ctx;
        if (!selectedNote) return null;
        // `key={selectedNote.id}` deliberately remounts the editor when
        // the open note changes: its editor state, autosave timer and
        // quiz panel are all per-note and must not be carried across.
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
                // Deleting a note that is mid-recording asks a different
                // question and discards the recording first; the ordinary
                // path just confirms. Either way the pending autosave is
                // cancelled and the selection cleared BEFORE the delete
                // request, so a queued save cannot resurrect the note.
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
                        const existing = getQuizForNote(selectedNote.id);
                        const session = await noteHandlers.handleStartNoteQuiz(
                            editorState,
                            jobHooks,
                            { replace: Boolean(existing?.completed) }
                        );
                        if (session?.questions?.length) {
                            showToast(`Quiz ready — ${session.questions.length} questions beside your note`, 'success');
                        }
                        return session;
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
                        const session = await noteHandlers.handleStartNoteQuiz(
                            {
                                title: selectedNote.title,
                                body: selectedNote.body,
                            },
                            undefined,
                            { replace: true }
                        );
                        if (session?.questions?.length) {
                            showToast(`New quiz ready — ${session.questions.length} questions beside your note`, 'success');
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
    },
    [AppMode.FLASHCARDS]: (ctx) => {
        const { renderFlashcardsScreen } = ctx;
        return renderFlashcardsScreen(false);
    },
    [AppMode.DECK_DETAIL]: (ctx) => {
        const {
            selectedDeck, flashcards, setAppMode, setSelectedDeck, handleStartReview, handleStartCram,
            handleStartMatch, handleStartLearn, handleOpenCreateFlashcardModal,
            handleOpenEditFlashcardModal, handleDeleteFlashcard, handleOpenEditDeckModal,
            handleMoveDeckToCourse, handleDeleteDeck, handleGenerateFlashcards, isGeneratingFlashcards,
            handleResetDeckStatistics, handleExportDeck, handleLoadMoreFlashcards,
            handleAIEnhanceFlashcard
        } = ctx;
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
    },
    [AppMode.FLASHCARD_REVIEW]: (ctx) => {
        const { activeReviewSession, handleUpdateSrsData, setAppMode, setActiveReviewSession } = ctx;
        if (!activeReviewSession) return null;
        return <FlashcardReviewScreen session={activeReviewSession} onUpdateSrs={handleUpdateSrsData}
            onEndSession={() => { setAppMode(AppMode.DECK_DETAIL); setActiveReviewSession(null); }} />;
    },
    [AppMode.FLASHCARD_CRAM]: (ctx) => {
        const { activeCramSession, handleCramAnswer, handleEndCramSession, handleCramIncorrect } = ctx;
        if (!activeCramSession) return null;
        return <CramSessionScreen session={activeCramSession} onAnswer={handleCramAnswer}
            onEndSession={handleEndCramSession} onCramIncorrect={handleCramIncorrect} />;
    },
    [AppMode.FLASHCARD_MATCH]: (ctx) => {
        const { selectedDeck, flashcards, handleEndStudyMode, theme } = ctx;
        if (!selectedDeck) return null;
        return <MatchStudyScreen
            cards={flashcards.filter(fc => fc.deckId === selectedDeck.id)}
            deckName={selectedDeck.name}
            onExit={handleEndStudyMode}
            theme={theme}
        />;
    },
    [AppMode.FLASHCARD_LEARN]: (ctx) => {
        const { selectedDeck, flashcards, handleEndStudyMode, theme } = ctx;
        if (!selectedDeck) return null;
        return <LearnStudyScreen
            cards={flashcards.filter(fc => fc.deckId === selectedDeck.id)}
            deckName={selectedDeck.name}
            onExit={handleEndStudyMode}
            theme={theme}
        />;
    },
    [AppMode.OFFLINE_MODE]: (ctx) => {
        const {
            offlineBundles, decks, offlineDeckIds, pendingSyncResults, pendingFlashcardReviews,
            handleStartOfflineSession, handleDeleteBundle, handleSyncResults, handleSyncFlashcardReviews,
            handleImportBundle, handleRenameBundle, isOnline
        } = ctx;
        return <OfflineModeScreen offlineBundles={offlineBundles}
            offlineDecks={decks.filter(d => offlineDeckIds.includes(d.id))}
            pendingSyncResultsCount={pendingSyncResults.length}
            pendingFlashcardReviewsCount={pendingFlashcardReviews.length}
            onStartOfflineSession={handleStartOfflineSession} onDeleteBundle={handleDeleteBundle}
            onSyncPendingResults={handleSyncResults} onSyncFlashcardReviews={handleSyncFlashcardReviews}
            onImportBundle={handleImportBundle}
            onRenameBundle={handleRenameBundle} isOnline={isOnline} />;
    },
    [AppMode.BUDGET_TRACKER]: (ctx) => {
        const {
            currentUser, transactions, budget, setAddTransactionType, openModal, handleDeleteTransaction,
            toggleSidebar
        } = ctx;
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
    },
    [AppMode.CREATE_MARKETPLACE_LISTING]: renderShop,
    [AppMode.MARKETPLACE]: renderShop,
    [AppMode.MARKETPLACE_LISTING_DETAIL]: (ctx) => {
        const {
            selectedMarketplaceListingId, selectedMarketplaceListingInitialQuantity,
            setSelectedMarketplaceListingInitialQuantity, setAppMode, handleInitiateDm,
            setSellerProfileReturnMode, setSelectedSellerId, setSelectedMarketplaceOrderId,
            setSelectedMarketplaceListingId, setMarketplaceBrowseIntent, setEditingMarketplaceListing,
            openModal
        } = ctx;
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
    },
    [AppMode.MY_LISTINGS]: (ctx) => {
        const {
            setMarketplaceListingCategory, openModal, setEditingMarketplaceListing,
            setSelectedMarketplaceListingId, setSelectedMarketplaceListingInitialQuantity, setAppMode,
            setSelectedMarketplaceOrderId, setSellerProfileReturnMode, setSelectedSellerId,
            myListingsRefreshKey
        } = ctx;
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
    },
    [AppMode.MARKETPLACE_PURCHASES]: (ctx) => {
        const { setAppMode, setSelectedMarketplaceListingId, setSelectedMarketplaceListingInitialQuantity } = ctx;
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
    },
    [AppMode.CAMPUS_PAGE]: (ctx) => {
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
    },
    [AppMode.INVITE_FRIENDS]: (ctx) => {
        const { setAppMode } = ctx;
        return <InviteFriendsScreen onBack={() => setAppMode(AppMode.DASHBOARD)} />;
    },
    [AppMode.COMMUNITY_DETAIL]: (ctx) => {
        const {
            communityRoute, communityChannelId, navigateTo, selectedChat, renderChatWindow,
            activeCommunity, activeCommunityDetail, handleCommunityNavigate
        } = ctx;
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
    },
    [AppMode.DISCOVER]: (ctx) => {
        const {
            discoverSection, standaloneRoute, setAppMode, navigateTo, setSelectedSellerId,
            setSellerProfileReturnMode, openDiscoverGroup, setStudyRoomJoin, setSelectedStudyRoomId,
            setCreateLabOpen, openModal, setCreateGroupReturnMode
        } = ctx;
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
    },
    [AppMode.CREATOR_PROFILE]: (ctx) => {
        const {
            selectedSellerId, currentUser, setAppMode, sellerProfileReturnMode,
            setSelectedMarketplaceListingId, setSelectedMarketplaceListingInitialQuantity,
            handleInitiateDm
        } = ctx;
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
                } else if (screen === 'DirectMessages' && params?.userId) {
                    handleInitiateDm(String(params.userId));
                }
            }} />;
    },
    [AppMode.STUDY_PRODUCT_DRAFTS]: (ctx) => {
        const {
            studyProductSource, setStudyProductSource, setAppMode, setSelectedMarketplaceListingId,
            setSelectedMarketplaceListingInitialQuantity
        } = ctx;
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
    },
    [AppMode.SEMESTER_PRODUCTS]: (ctx) => {
        const { setAppMode, setStudyProductSource } = ctx;
        return (
            <SemesterProductsScreen
                onBack={() => setAppMode(AppMode.LIBRARY)}
                onNavigateToDrafts={() => {
                    setStudyProductSource(null);
                    setAppMode(AppMode.STUDY_PRODUCT_DRAFTS);
                }}
            />
        );
    },
    [AppMode.STUDY_ROOM]: (ctx) => {
        const {
            selectedStudyRoomId, studyRoomJoin, activeCommunity, navigateTo, setDiscoverSection,
            setCreateLabOpen, setSelectedStudyRoomId, activeCommunityDetail
        } = ctx;
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
    },
    [AppMode.MARKETPLACE_FAVORITES]: (ctx) => {
        const {
            setAppMode, setSelectedMarketplaceListingId, setSelectedMarketplaceListingInitialQuantity,
            setMarketplaceListingCategory, openModal, navigateTo
        } = ctx;
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
    },
    [AppMode.MARKETPLACE_ORDERS]: (ctx) => {
        const {
            setAppMode, setSelectedMarketplaceOrderId, setSelectedMarketplaceListingId,
            setSelectedMarketplaceListingInitialQuantity
        } = ctx;
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
    },
    [AppMode.MARKETPLACE_CART]: (ctx) => {
        const {
            setAppMode, setSelectedMarketplaceOrderId, setSelectedMarketplaceListingId,
            setSelectedMarketplaceListingInitialQuantity
        } = ctx;
        return <MarketplaceCartScreen
            onBack={() => setAppMode(AppMode.MARKETPLACE)}
            onNavigate={(screen, params) => {
                if (screen === 'Marketplace') {
                    setAppMode(AppMode.MARKETPLACE);
                } else if (screen === 'MarketplaceCheckout') {
                    setAppMode(AppMode.MARKETPLACE_CHECKOUT);
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
    },
    [AppMode.MARKETPLACE_CHECKOUT]: (ctx) => {
        const { setAppMode, setSelectedMarketplaceOrderId } = ctx;
        return <MarketplaceCheckoutScreen
            onBack={() => setAppMode(AppMode.MARKETPLACE_CART)}
            onNavigate={(screen, params) => {
                if (screen === 'MarketplaceOrders') {
                    setAppMode(AppMode.MARKETPLACE_ORDERS);
                } else if (screen === 'MarketplaceAddresses') {
                    setAppMode(AppMode.MARKETPLACE_ADDRESSES);
                } else if (screen === 'MarketplaceOrderDetail' && params?.orderId) {
                    setSelectedMarketplaceOrderId(String(params.orderId));
                    setAppMode(AppMode.MARKETPLACE_ORDER_DETAIL);
                }
            }}
        />;
    },
    [AppMode.MARKETPLACE_YOU]: (ctx) => {
        const { setAppMode } = ctx;
        return <ShopAccountScreen
            onBack={() => setAppMode(AppMode.MARKETPLACE)}
            onNavigate={(screen) => {
                if (screen === 'MarketplaceCart') setAppMode(AppMode.MARKETPLACE_CART);
                else if (screen === 'MarketplaceOrders') setAppMode(AppMode.MARKETPLACE_ORDERS);
                else if (screen === 'MarketplaceAddresses') setAppMode(AppMode.MARKETPLACE_ADDRESSES);
                else if (screen === 'MarketplaceFavorites') setAppMode(AppMode.MARKETPLACE_FAVORITES);
                else if (screen === 'MarketplacePurchases') setAppMode(AppMode.MARKETPLACE_PURCHASES);
                else if (screen === 'MarketplaceInquiries') setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                else if (screen === 'MyListings') setAppMode(AppMode.MY_LISTINGS);
            }}
        />;
    },
    [AppMode.MARKETPLACE_ADDRESSES]: (ctx) => {
        const { setAppMode } = ctx;
        return <MarketplaceAddressesScreen onBack={() => setAppMode(AppMode.MARKETPLACE_YOU)} />;
    },
    [AppMode.MARKETPLACE_ORDER_DETAIL]: (ctx) => {
        const {
            selectedMarketplaceOrderId, setAppMode, setMyListingsRefreshKey,
            setSelectedMarketplaceListingId
        } = ctx;
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
    },
    [AppMode.SELLER_CUSTOMERS]: (ctx) => {
        const { setAppMode, handleInitiateDm } = ctx;
        return <SellerCustomersScreen
            onBack={() => setAppMode(AppMode.MY_LISTINGS)}
            onNavigate={(screen, params) => {
                if (screen === 'DirectMessages' && params?.userId) handleInitiateDm(params.userId);
            }}
        />;
    },
    [AppMode.MARKETPLACE_INQUIRIES]: (ctx) => {
        const {
            handleInitiateDm, setSelectedMarketplaceListingId, setAppMode, setSelectedMarketplaceOrderId,
            currentUser
        } = ctx;
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
    },
    [AppMode.SELLER_PROFILE]: (ctx) => {
        const {
            selectedSellerId, setSelectedSellerId, sellerProfileReturnMode, selectedMarketplaceListingId,
            setAppMode, setSelectedMarketplaceListingId, handleInitiateDm, setSelectedMarketplaceOrderId
        } = ctx;
        if (!selectedSellerId) return null;
        // Back honours `sellerProfileReturnMode`, stamped by whichever
        // screen opened this one — except when that origin was a listing
        // whose id has since been cleared, which would bounce straight
        // back out through the redirect effect.
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
    },
    [AppMode.MARKETPLACE_JOBS]: (ctx) => {
        const { handleJobsNavigate } = ctx;
        return (
            <JobsBoardScreen onNavigate={handleJobsNavigate} />
        );
    },
    [AppMode.MARKETPLACE_JOB_DETAIL]: (ctx) => {
        const { selectedJobId, handleJobsNavigate, handleSelectChat, navigateTo } = ctx;
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
    },
    [AppMode.JOB_COMPANY]: (ctx) => {
        const { selectedCompanyId, handleJobsNavigate } = ctx;
        if (!selectedCompanyId) return null;
        return (
            <JobCompanyScreen
                companyId={selectedCompanyId}
                onNavigate={handleJobsNavigate}
            />
        );
    },
    [AppMode.CREATE_MARKETPLACE_JOB]: (ctx) => {
        const { selectedJobId, handleJobsNavigate } = ctx;
        return (
            <CreateJobScreen
                jobId={selectedJobId}
                onNavigate={handleJobsNavigate}
            />
        );
    },
    [AppMode.MY_JOB_POSTINGS]: (ctx) => {
        const { handleJobsNavigate } = ctx;
        return (
            <MyJobPostingsScreen onNavigate={handleJobsNavigate} />
        );
    },
    [AppMode.MY_JOB_APPLICATIONS]: (ctx) => {
        const { handleJobsNavigate, handleSelectChat, navigateTo } = ctx;
        return (
            <MyJobApplicationsScreen
                onNavigate={handleJobsNavigate}
                onOpenDm={(threadId) => {
                    handleSelectChat({ id: threadId, chatType: 'dm' } as any);
                    navigateTo(AppMode.CHAT, { threadId });
                }}
            />
        );
    },
    [AppMode.JOB_EMPLOYER]: (ctx) => {
        const { handleJobsNavigate } = ctx;
        return (
            <JobEmployerScreen onNavigate={handleJobsNavigate} />
        );
    },
    [AppMode.JOB_EMPLOYER_PIPELINE]: (ctx) => {
        const { selectedJobId, handleJobsNavigate, handleSelectChat, navigateTo } = ctx;
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
    },
    [AppMode.ADMIN]: (ctx) => {
        const { isPlatformAdmin, setAppMode } = ctx;
        if (!isPlatformAdmin) return null;
        return <AdminScreen onBackToDashboard={() => setAppMode(AppMode.DASHBOARD)} />;
    },
};
