export type RootStackParamList = {
  // Auth hosts a nested stack; deep links target e.g. { screen: 'ResetPassword' }.
  Auth:
    | import("@react-navigation/native").NavigatorScreenParams<AuthStackParamList>
    | undefined;
  Main: undefined;
  Onboarding: undefined;
  Settings: undefined;
  EditProfile: undefined;
  /** Academic identity + "My courses" management (Settings → Academic). */
  AcademicSettings: undefined;
  /** Join a lecturer’s class by hall code — no LMS required. */
  JoinClass: { code?: string } | undefined;
  /** Me → AI uses: the allowance, every action's price, the doors at zero. */
  UsageLimits: undefined;
  InviteFriends: undefined;
  BlockedUsers: undefined;
  /** Library tree → Offline filtered to a course (`'null'` = unfiled bundles). */
  Offline: { courseId?: string | null; courseLabel?: string } | undefined;
  /** Any shared legal document id (privacy, terms, cookies, prohibited, seller-terms). */
  LegalDocument: { document: import("@lantern/shared/legal").LegalDocumentId };
};

export type AuthStackParamList = {
  Login: undefined;
  // Phase 4 Q: `ref` carries a referral code in from an invite deep link.
  SignUp: { ref?: string } | undefined;
  ForgotPassword: undefined;
  VerifyEmail: { email: string };
  ResetPassword: undefined;
  LegalDocument: { document: import("@lantern/shared/legal").LegalDocumentId };
};

export type HomeStackParamList = {
  Dashboard: undefined;
  Leaderboard: undefined;
  TestAnalysis: {
    test?: import("../types/dashboardStats").RecentTest;
    sessionId?: string;
    attemptId?: string;
  };
};

export type StudyStackParamList = {
  StudyHub: undefined;
  /**
   * One enrolled course as a room — notes, decks, tests and lectures together.
   */
  CourseRoom: { courseId?: string; studySetId?: string; courseLabel?: string };
  /**
   * Notes studio for one course — enhance, turn into, ask, walk through.
   * Distinct from NoteEditor; the room stays a dashboard.
   */
  NotesStudio: { courseId?: string; courseLabel?: string; noteId: string; studySetId?: string };
  /**
   * Adaptive quiz for one course — confirm, confidence 1–3, then explanation.
   * Distinct from TestTaking (submit-all).
   */
  AdaptiveQuiz: {
    courseId?: string;
    courseLabel?: string;
    noteId?: string;
    studySetId?: string;
    seedItems?: import('@lantern/shared/learning').AdaptiveQuizItem[];
  };
  /**
   * Lecture studio for one course — my notes, live transcript, ask.
   * Distinct from NoteEditor; the room stays a dashboard.
   */
  LectureStudio: { courseId?: string; courseLabel?: string; noteId?: string; studySetId?: string };
  /**
   * Lesson studio for one course — board, plan, voice, chat.
   * Distinct from companion overlay; Explore skips, Mastery sequences.
   */
  LessonStudio: { courseId?: string; courseLabel?: string; noteId?: string; studySetId?: string };
  /**
   * Recap studio for one course — generated listen-through with transcript and ask.
   * Distinct from Narration, which reads the document page.
   */
  RecapStudio: { courseId?: string; courseLabel?: string; noteId?: string; studySetId?: string };
  /**
   * Study calendar for one course — month grid from exam date + outline.
   * Distinct from Library's outline editor; Edit outline still opens that sheet.
   */
  StudyCalendar: { courseId?: string; courseLabel?: string; studySetId?: string };
  /**
   * Essay studio for one course — practice feedback on a draft, with or without a rubric.
   * Not an official grade. Distinct from generating exam essay questions.
   */
  EssayStudio: { courseId?: string; courseLabel?: string; noteId?: string; studySetId?: string };
  /**
   * Play hub for one course — Match plus speed games from this course's deck.
   * Group duels stay in Chat.
   */
  PlayStudio: { courseId?: string; courseLabel?: string; studySetId?: string };
  /**
   * One set's own settings — name, description, visibility, mode, folder, and
   * deleting it. Web has had these in a modal since the set room shipped.
   */
  StudySetSettings: { studySetId: string };
  /**
   * Add materials to one set: files, YouTube, pasted text, an Anki export,
   * with the set's own recent uploads underneath.
   */
  StudySetUpload: { studySetId: string; courseId?: string; courseLabel?: string };
  /**
   * What is filed in ONE set. Distinct from `Library`, which is every artefact
   * the student owns — the room's Cards and Test doors used to open that.
   */
  StudySetLibrary: {
    studySetId: string;
    courseId?: string;
    courseLabel?: string;
    kind?: 'cards' | 'tests' | 'lectures' | 'notes';
  };
  /**
   * `manageOutlineCourseId` opens the outline editor on arrival — the deep
   * link behind the readiness card's "Add your topics", which has to land on
   * an editable topic list rather than near one.
   */
  Library:
    | {
        tab?: "notes" | "flashcards";
        manageOutlineCourseId?: string;
        manageOutlineCourseLabel?: string;
      }
    | undefined;
  FlashcardsList: undefined;
  DeckDetail: { deckId: string; deckName?: string };
  /**
   * `queueDeckIds` is the cross-deck due queue this session belongs to, in
   * order (this deck included). Home sends it so the session can run all N
   * cards its button counted instead of stopping after the first deck.
   */
  FlashcardReview: { deckId: string; deckName?: string; queueDeckIds?: string[] };
  CramSession: { deckId: string; deckName?: string; timedMinutes?: number; cardIds?: string[] };
  MatchStudy: { deckId: string; deckName?: string };
  LearnStudy: { deckId: string; deckName?: string };
  NotesList: undefined;
  /**
   * `startRecording` is the Record door's handover: the door has already
   * asked, created the note and named it, and the editor starts the recorder
   * on arrival so the note that lands has a lecture in it.
   */
  NoteEditor: { noteId: string; startRecording?: boolean };
  NoteShareAccept: { token: string };
  /**
   * The page-by-page walk-through of one document attached to a note.
   *
   * On the STUDY stack and pushed from the note, not presented as a modal:
   * it is a place a student reads in, so it keeps the global bar and carries
   * its own contextual row (Plan · Ask · Quiz · Done). `pageIndex` is where to
   * open — a resume, or the plan panel's own row — and is optional because the
   * first page is the right answer when nobody has said otherwise.
   */
  Walkthrough: { noteId: string; attachmentId: string; pageIndex?: number };
  /**
   * "Read it to me" — a document read aloud by the phone.
   *
   * On the STUDY stack beside the walk-through, and for the same reason: it is
   * a place a student stays in, so it keeps the global bar. `pageIndex` is the
   * hand-over from the walk-through — the page you were on is the page the
   * reading starts at.
   *
   * It carries NO contextual row. The three things worth a row here — play,
   * page, speed — are all inside the player, in reach of the thumb, and two of
   * them change state continuously; a bottom row whose Play item is out of sync
   * with the button six inches above it is worse than no row at all.
   */
  Narration: { noteId: string; attachmentId: string; pageIndex?: number };
  /**
   * "+ New test" — the three sources a test can come from (a deck, a note, or
   * the group chat). It lives on the STUDY stack because a test is Study's
   * business: the button used to switch the global tab to Chat, which is the
   * defect this route replaces.
   */
  TestBuilder:
    | {
        /**
         * The note the student was reading when they asked for a test — the
         * contextual row's Test item on `NoteEditor` (spec v3 §7.2) carries
         * it. The builder opens on its note picker with that note first; it
         * never starts a generation on arrival, because a screen that spends
         * a credit before it is read is not a builder.
         */
        noteId?: string;
      }
    | undefined;
  /** Library tree → History filtered to a course (`'null'` = unfiled sessions). */
  TestsList:
    | { tab?: "tests" | "history"; courseId?: string | null; courseLabel?: string }
    | undefined;
  TestTaking: {
    testId: string;
    testName: string;
    mode?: "test" | "study";
    isOffline?: boolean;
    offlineTestId?: string;
    groupName?: string;
    groupId?: string;
    /**
     * Where this session was launched from, when that was not the Study tab
     * (today: a group chat thread). Exit / Done / hardware BACK reset the
     * Study stack and go back there instead of landing on the Study hub.
     */
    returnTo?: import("../screens/tests/testSessionExit").ReturnToTarget;
  };
  /** `returnTo` is threaded from TestTaking on submit, so a retake keeps it. */
  TestResults: {
    attemptId: string;
    returnTo?: import("../screens/tests/testSessionExit").ReturnToTarget;
  };
  TestAnalysis: {
    test?: import("../types/dashboardStats").RecentTest;
    sessionId?: string;
    attemptId?: string;
  };
};

export type ChatStackParamList = {
  GroupsList: undefined;
  /** `communityId/communityName/communitySlug` lock the new group to a community as a channel (spec §4.6). */
  CreateGroup:
    | {
        parentId?: string;
        parentName?: string;
        communityId?: string;
        communityName?: string;
        communitySlug?: string;
        /** Defaults to 'board' when communityId is set; ignored otherwise. */
        communitySurface?: 'board' | 'study_group';
        /** Prefilled name from "Start a study group about this". */
        seedName?: string;
        /** The board that spawned it — it gets a plain TEXT pointer back. */
        announceInGroupId?: string;
      }
    | undefined;
  /** `communitySlug/communityName` only drive the `in <Community> ›` link when a board or study group is opened from the plain chat list. */
  GroupChat: {
    groupId: string;
    groupName?: string;
    openAddMembers?: boolean;
    communitySlug?: string;
    communityName?: string;
  };
  DirectMessage: {
    threadId: string;
    recipientId: string;
    recipientName?: string;
  };
  GameScreen: { session?: Record<string, unknown> };
  GameResult: {
    session: Record<string, unknown>;
    currentUser: Record<string, unknown>;
  };
  ChallengesInbox: undefined;
};

export type MarketStackParamList = {
  MarketplaceHome: undefined;
  /** Shop by department; omitting nodeId opens the department list. */
  ShopBrowse: { nodeId?: string } | undefined;
  /** "Browse by course" index: courses that have at least one active listing. */
  CourseBrowse: undefined;
  /**
   * One course's banks and packs. `courseLabel`/`institutionName` are the
   * index row's own values, shown while the page loads so the header is never
   * blank; the fetched course always wins once it arrives.
   */
  CourseListings: {
    courseId: string;
    courseLabel?: string;
    institutionName?: string | null;
  };
  /** The Amazon-style "You" hub: orders, saved, cart, and everything a seller runs. */
  ShopAccount: undefined;
  ListingDetail: { listingId: string; quantity?: number };
  MyListings: undefined;
  /** Which side of the conversation to show; defaults to seller (buyer questions). */
  Inquiries: { tab?: 'seller' | 'buyer' } | undefined;
  CreateListing: undefined;
  EditListing: { listingId: string };
  MakeOffer: {
    listingId: string;
    listingTitle?: string;
    listingPrice?: number;
  };
  SellerProfile: { sellerId: string; sellerName?: string };
  /** Received (seller) or made (buyer); defaults to seller. */
  Offers: { tab?: 'seller' | 'buyer' } | undefined;
  Favorites: undefined;
  /**
   * Which side of the order the viewer is on; defaults to buyer. `buy_again`
   * is the Amazon shelf: completed buyer orders only, each row leading with
   * "Buy again". All optional so every bare `navigate('Orders')` still compiles.
   */
  Orders: { role?: 'buyer' | 'seller'; view?: 'buy_again' } | undefined;
  Cart: undefined;
  Checkout: undefined;
  Addresses: undefined;
  Purchases: undefined;
  StudyProductDrafts:
    | { source?: { noteIds?: string[]; folderId?: string | null; courseId?: string | null; title?: string } }
    | undefined;
  CreatorProfile: { userId: string };
  // Phase 3 L / decision D12 — Discover is the hub; the marketplace is a tab
  // inside it, which is why these live on the Market stack.
  Discover:
    | {
        section?: 'communities' | 'groups' | 'people' | 'rooms' | 'marketplace';
        /** Changes on every drawer tap so the same section re-applies even if the screen sits on another tab. */
        at?: number;
      }
    | undefined;
  CommunityDetail: { slug: string };
  /**
   * Start a community. On the CAMPUS stack with every other community screen
   * (founder rule §0a), so Back returns to the Communities segment.
   * `code` prefills the join sheet when a `discover/join/<code>` deep link
   * could not resolve the code to a community on its own.
   */
  CreateCommunity: { code?: string } | undefined;
  // Founder rule (spec §0a): a community's channels, rooms and roster live on
  // THIS stack, never on the Chat tab, so back always returns to the community.
  CommunityMembers: { slug: string; communityId?: string; name?: string };
  /**
   * Roles, mutes and invite links for one community (Wave 8). On the CAMPUS
   * stack beside the roster for the same reason: back returns to the
   * community, and nothing about a community is ever reached by nesting.
   */
  CommunityManage: { slug: string; communityId?: string; name?: string };
  /**
   * One community room. The route name is unchanged so deep links and every
   * existing navigation param keep working: the screen routes the community's
   * lounge to the live chat and everything else to the BOARD (founder
   * decision 1, 2026-09-02).
   */
  CommunityChannel: {
    groupId: string;
    groupName?: string;
    /**
     * In-app pushes carry all three; a deep link carries only the slug (the
     * screen resolves the rest from the community store).
     */
    communitySlug?: string;
    communityName?: string;
    communityId?: string;
    /** Set by the community page so the router need not wait on the detail. */
    isLounge?: boolean;
  };
  /** One board post and its comments. */
  CommunityPost: {
    groupId: string;
    rootId: string;
    communitySlug?: string;
    communityName?: string;
    /** Fallback title for the share sheet on a post with no title of its own. */
    boardName?: string;
  };
  /**
   * Bookmarked posts across EVERY board (§7.5). Takes no params: the list is
   * account-level, not per board, which is the whole reason the server-side
   * bookmark replaced the two device-local saves that could not read each
   * other.
   */
  SavedPosts: undefined;
  /** Create a board or a study group from inside a community (same component as the Chat stack's CreateGroup). */
  CreateGroup:
    | {
        parentId?: string;
        parentName?: string;
        communityId?: string;
        communityName?: string;
        communitySlug?: string;
        /** Defaults to 'board' when communityId is set; ignored otherwise. */
        communitySurface?: 'board' | 'study_group';
        /** Prefilled name from "Start a study group about this". */
        seedName?: string;
        /** The board that spawned it — it gets a plain TEXT pointer back. */
        announceInGroupId?: string;
      }
    | undefined;
  Feed: undefined;
  Mastery: { courseId?: string } | undefined;
  SemesterProducts: undefined;
  StudyRoom:
    | {
        roomId?: string;
        courseId?: string;
        topic?: string;
        communityId?: string;
        communityName?: string;
      }
    | undefined;
  OrderDetail: {
    orderId: string;
    paymentReturn?: boolean;
    /** Paystack callback query: payment=return */
    payment?: string;
    reference?: string;
    trxref?: string;
  };
  SellerCustomers: undefined;
  /** Payout bank setup plus the earnings ledger; the only place status/payoutAt render. */
  SellerPayout: undefined;
};

/**
 * Jobs owns its own stack so Shop and Jobs keep independent history — the
 * point of giving each a bottom-tab destination is that switching between
 * them returns you where you were, which a shared stack cannot do.
 */
export type JobsStackParamList = {
  JobsHome: undefined;
  JobDetail: { jobId: string };
  /** `jobId` switches the form into edit mode for an existing posting. */
  CreateJob: { jobId?: string } | undefined;
  MyJobPostings: undefined;
  MyJobApplications: undefined;
  JobEmployer: undefined;
  JobApplicants: { jobId: string };
  JobCompany: { companyId: string };
};

export type BudgetStackParamList = {
  BudgetHome: { tab?: 'overview' | 'transactions' | 'goals' | 'insights' | 'wallet' } | undefined;
  AddExpense: undefined;
  AddIncome: undefined;
  SetBudget: undefined;
  SavingsGoals: undefined;
  Wallet: undefined;
  ExpenseSplit: undefined;
  Recurring: undefined;
  SetCategoryBudget: undefined;
  FinancialToolkit: undefined;
  AddInvestment: undefined;
};

/**
 * Campus — one destination with three segments (Communities · Shop · Jobs) —
 * owns every screen the retired Market and Jobs stacks held, so the Campus tab
 * stays lit all the way down into a listing, a job, a board or a post.
 *
 * `MarketplaceHome` and `JobsHome` are still listed and still registered: they
 * became SEGMENTS rather than screens, but seven screens across the app still
 * call `navigate('MarketplaceHome')` / `navigate('JobsHome')`, so the names
 * survive as one-frame redirects onto the right segment.
 */
export type CampusStackParamList = {
  /** `at` changes per request so the same segment re-applies on a repeat tap. */
  Campus:
    | {
        segment?: import("../screens/campus/campusSegments").CampusSegment;
        at?: number;
        /**
         * A `discover/join/<code>` deep link whose code did not resolve to a
         * community on its own: the Communities segment opens its Join sheet
         * with this in the box rather than dropping the link.
         */
        joinCode?: string;
      }
    | undefined;
} & MarketStackParamList &
  JobsStackParamList;

/**
 * Profile — identity, academic details, Budget, Downloads, the two modes,
 * Settings and Log out. Progress is a peer screen on this stack. Budget lives
 * here rather than in a tab of its own so Back returns to Profile and the
 * Profile tab stays lit while a student is in it.
 */
export type MeStackParamList = {
  Me: undefined;
  MeProgress: undefined;
} & BudgetStackParamList;

/** What a nested `navigate('<Tab>', …)` hands a tab screen. */
type NestedNavigateParams = {
  screen?: string;
  params?: Record<string, unknown>;
  initial?: boolean;
};

export type MainTabParamList = {
  // The five destinations, in bar order. Home is the launch tab.
  HomeTab: undefined;
  StudyTab: undefined;
  ChatTab: undefined;
  CampusTab:
    | import("@react-navigation/native").NavigatorScreenParams<CampusStackParamList>
    | undefined;
  MeTab:
    | import("@react-navigation/native").NavigatorScreenParams<MeStackParamList>
    | undefined;
  /**
   * Notifications follows the reader around from the top bar; it is not one of
   * the five places, so it lights no bottom tab.
   */
  NotificationsTab: undefined;
  /**
   * RETIRED, kept as compatibility shims (navigation/legacyTabs.ts). Around
   * fifteen screens this wave does not own still name these routes, and a
   * `navigate` to a route that does not exist is silently dropped in release
   * builds. Each is a redirect screen onto Campus or Me.
   */
  MarketTab: NestedNavigateParams | undefined;
  JobsTab: NestedNavigateParams | undefined;
  BudgetTab: NestedNavigateParams | undefined;
};

/**
 * Routes that own the whole window: a study session in a fullScreenModal, or a
 * detail screen that draws its own header with a back arrow and its real
 * title. The shared chrome stands down for these — and ONLY for these.
 *
 * This is a property of the ROUTE, and it is the only thing that ever takes a
 * bar away. Scrolling does not; a keyboard opening does not; focusing a search
 * box does not; a screen borrowing the top row does not.
 */
/**
 * The immersive list itself, as an array, so a pure module can read it —
 * navigation/contextualBars.ts subtracts these routes from its registry, and
 * its tests assert that no session route ever carries a contextual row.
 */
export const IMMERSIVE_ROUTE_NAMES = [
  "FlashcardReview",
  "CramSession",
  "MatchStudy",
  "LearnStudy",
  "TestTaking",
  "TestResults",
  "TestAnalysis",
  "GameScreen",
  "GameResult",
  "ListingDetail",
  "CreateGroup",
  "GroupChat",
  "DirectMessage",
  // A community room — the lounge chat or a board — on the Market stack.
  "CommunityChannel",
  "CommunityPost",
] as const;

const IMMERSIVE_SCREENS = new Set<string>(IMMERSIVE_ROUTE_NAMES);

export function shouldHideTabBar(routeName: string | undefined): boolean {
  if (!routeName) return false;
  return IMMERSIVE_SCREENS.has(routeName);
}

/**
 * Every route name that can be the focused route inside a tab's stack.
 *
 * The union, not one stack's keys: chrome that keys off "where am I" —
 * navigation/contextualBars.ts is the first — has to name routes from any of
 * them, and a typo in a route name is otherwise invisible until a navigate is
 * silently dropped in a release build.
 */
export type RouteName =
  | keyof HomeStackParamList
  | keyof StudyStackParamList
  | keyof ChatStackParamList
  | keyof CampusStackParamList
  | keyof MeStackParamList
  | keyof MainTabParamList;

/** The Study stack's own routes — the only stack with a contextual row today. */
export type StudyRouteName = keyof StudyStackParamList;
