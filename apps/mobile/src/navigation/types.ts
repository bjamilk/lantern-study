export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  Onboarding: undefined;
  Settings: undefined;
  EditProfile: undefined;
  BlockedUsers: undefined;
  Offline: undefined;
  LegalDocument: { document: "privacy" | "terms" | "cookies" };
};

export type AuthStackParamList = {
  Login: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
  VerifyEmail: { email: string };
  ResetPassword: undefined;
  LegalDocument: { document: "privacy" | "terms" | "cookies" };
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
  TestsList: undefined;
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
  OrderDetail: {
    orderId: string;
    paymentReturn?: boolean;
    /** Paystack callback query: payment=return */
    payment?: string;
    reference?: string;
    trxref?: string;
  };
  SellerCustomers: undefined;
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
  BudgetHome: undefined;
  AddExpense: undefined;
  AddIncome: undefined;
  SetBudget: undefined;
  SavingsGoals: undefined;
  Wallet: undefined;
  ExpenseSplit: undefined;
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
