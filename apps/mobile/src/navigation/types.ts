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
  Library: { tab?: "notes" | "flashcards" } | undefined;
  FlashcardsList: undefined;
  DeckDetail: { deckId: string; deckName?: string };
  FlashcardReview: { deckId: string; deckName?: string };
  CramSession: { deckId: string; deckName?: string; timedMinutes?: number };
  MatchStudy: { deckId: string; deckName?: string };
  LearnStudy: { deckId: string; deckName?: string };
  NotesList: undefined;
  NoteEditor: { noteId: string };
  NoteShareAccept: { token: string };
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
  };
  TestResults: { attemptId: string };
  TestAnalysis: {
    test?: import("../types/dashboardStats").RecentTest;
    sessionId?: string;
    attemptId?: string;
  };
};

export type ChatStackParamList = {
  GroupsList: undefined;
  CreateGroup: { parentId?: string; parentName?: string } | undefined;
  GroupChat: { groupId: string; groupName?: string; openAddMembers?: boolean };
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
  ListingDetail: { listingId: string; quantity?: number };
  MyListings: undefined;
  Inquiries: undefined;
  CreateListing: undefined;
  EditListing: { listingId: string };
  MakeOffer: {
    listingId: string;
    listingTitle?: string;
    listingPrice?: number;
  };
  SellerProfile: { sellerId: string; sellerName?: string };
  Offers: undefined;
  Favorites: undefined;
  Orders: undefined;
  Cart: undefined;
  Purchases: undefined;
  StudyProductDrafts:
    | { source?: { noteIds?: string[]; folderId?: string | null; courseId?: string | null; title?: string } }
    | undefined;
  CreatorProfile: { userId: string };
  // Phase 3 L / decision D12 — Discover is the hub; the marketplace is a tab
  // inside it, which is why these live on the Market stack.
  Discover: { section?: 'communities' | 'groups' | 'people' | 'marketplace' } | undefined;
  CommunityDetail: { slug: string };
  Feed: undefined;
  Mastery: { courseId?: string } | undefined;
  SemesterProducts: undefined;
  StudyRoom: { roomId?: string; courseId?: string; topic?: string } | undefined;
  OrderDetail: {
    orderId: string;
    paymentReturn?: boolean;
    /** Paystack callback query: payment=return */
    payment?: string;
    reference?: string;
    trxref?: string;
  };
  SellerCustomers: undefined;
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

export type MainTabParamList = {
  HomeTab: undefined;
  StudyTab: undefined;
  ChatTab: undefined;
  NotificationsTab: undefined;
  BudgetTab: undefined;
  MarketTab: undefined;
  JobsTab: undefined;
  /** Offline mode as a base tab; the root-stack `Offline` modal remains for
      course-filtered links from the Library tree. */
  OfflineTab: undefined;
};

const IMMERSIVE_SCREENS = new Set([
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
]);

export function shouldHideTabBar(routeName: string | undefined): boolean {
  if (!routeName) return false;
  return IMMERSIVE_SCREENS.has(routeName);
}
