export enum FlashcardType {
    BASIC = 'BASIC',
    CLOZE = 'CLOZE',
    IMAGE_OCCLUSION = 'IMAGE_OCCLUSION',
}

export interface SrsData {
    interval: number; // in days
    easeFactor: number;
    repetitions: number;
    nextReviewDate: string; // ISO Date string
    failedAttempts?: number; // Count of "again" ratings
    isLeech?: boolean; // True if card is difficult (high failed attempts)
}

export interface Flashcard {
    id: string;
    deckId: string;
    type: FlashcardType;
    front?: string; // for Basic / Image prompt
    back?: string; // for Basic
    clozeText?: string; // for Cloze, e.g., "The capital of France is {{c1::Paris}}."
    imageUrl?: string; // for Image Occlusion cards
    occlusionData?: {
      type: 'rectangles' | 'circles' | 'freeform' | 'blur';
      rectangles?: { x: number; y: number; width: number; height: number }[];
      circles?: { x: number; y: number; radius: number }[];
      freeform?: { points: { x: number; y: number }[] };
      blur?: { x: number; y: number; width: number; height: number; radius: number; opacity: number }[];
    };
    srsData?: SrsData;
    tags?: string[];
    createdAt: string; // ISO Date string
}

export interface FlashcardSession {
    deck: Deck;
    cardQueue: Flashcard[];
    // Optional timed session settings
    timerSeconds?: number;
    endTime?: string; // ISO Date string
}

export interface Deck {
    id: string;
    name: string;
    description?: string;
    createdAt: string; // ISO Date string
    userId?: string; // owner
    createdBy?: string;
    approvedBy?: string;
    isShared?: boolean;
}

export interface FlashcardComment {
    id: string;
    flashcardId: string;
    userId: string;
    comment: string;
    createdAt: string;
    resolved?: boolean;
}

export interface StudySessionParticipant {
    userId: string;
    joinedAt: string;
    name?: string;
    avatarUrl?: string;
}

export interface StudySession {
    id: string;
    deckId: string;
    createdBy?: string;
    startedAt: string;
    endsAt?: string;
    isActive: boolean;
    metadata?: Record<string, any>;
    participants?: StudySessionParticipant[];
}

export interface DeckCollaborator {
    userId: string;
    role: 'viewer' | 'editor' | 'owner';
    addedAt: string;
    profile?: {
      id: string;
      name: string;
      avatarUrl?: string;
    };
}

export type BadgeId = 'GROUP_FOUNDER' | 'QUESTION_ASKER' | 'RISING_STAR' | 'TEST_TAKER' | 'HIGH_SCORER' | 'PERFECTIONIST' | 'DUELIST' | 'MARKETPLACE_SELLER' | 'TRUSTED_SELLER' | 'OFFER_MAKER';

export interface Badge {
  id: BadgeId; // e.g., 'TEST_TAKER'
  level: number;
  name: string; // e.g., 'Test Taker II'
  description: string;
  icon: string; // Emoji or icon name
  dateAwarded: string; // ISO Date string
}

export interface UserStats {
  testsCompleted: number;
  questionsCreated: number;
  groupsCreated: number;
  highScoreTests: number; // count of tests >= 80%
  perfectScoreTests: number; // count of tests with 100%
  gamesWon: number;
  listingsCreated: number;
  listingsSold: number;
  fiveStarReviews: number; // count of 5-star reviews received as seller
  offersMade: number; // count of marketplace offers submitted
}

export interface NotificationSettings {
  dailyReminder: boolean;
  groupActivity: boolean;
  marketplaceUpdates: boolean;
  badgeUnlocks: boolean;
  srsReminders: boolean;
  lastReminderTimestamp?: number;
  theme?: 'light' | 'dark';
}


export interface TestPreset {
    id: string;
    name: string;
    config: Omit<TestConfig, 'questionIds' | 'groupId'>;
}

export interface User {
  id: string;
  name: string;
  username?: string; // Unique username (lowercase, alphanumeric + underscore, 3-20 chars)
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  email?: string;
  password?: string; // For mock auth only
  phoneNumber?: string;
  points: number;
  badges: Badge[];
  stats: UserStats;
  settings?: NotificationSettings;
  testPresets?: TestPreset[];
  decks?: Deck[];
  flashcards?: Flashcard[];
}

export interface GroupPermissions {
  canSendMessages: boolean;
  canAddMembers: boolean;
  canEditSettings: boolean;
  canApproveMembers: boolean;
}

export interface Group {
  id: string;
  name: string;
  avatarUrl?: string;
  members: User[];
  description?: string;
  lastMessage?: string; // For display in sidebar
  lastMessageTime?: string; // For display in sidebar
  unreadCount?: number;
  memberEmails?: string[]; // For invited members not yet registered
  adminIds: string[]; 
  moderatorIds?: string[];
  parentId?: string; // ID of the parent group, if this is a sub-group
  isArchived?: boolean;
  inviteId?: string;
  pendingMembers?: User[];
  permissions?: GroupPermissions; // Permissions for non-admin members
  invitedPhoneNumbers?: string[]; // For invited members not yet registered
}

export enum MessageType {
  TEXT = 'TEXT',
  QUESTION = 'QUESTION',
}

export enum QuestionType {
  OPEN_ENDED = 'OPEN_ENDED',
  MULTIPLE_CHOICE_SINGLE = 'MULTIPLE_CHOICE_SINGLE',
  TRUE_FALSE = 'TRUE_FALSE',
  MULTIPLE_CHOICE_MULTIPLE = 'MULTIPLE_CHOICE_MULTIPLE',
  FILL_IN_THE_BLANK = 'FILL_IN_THE_BLANK',
  MATCHING = 'MATCHING',
  DIAGRAM_LABELING = 'DIAGRAM_LABELING',
}

export interface QuestionOption {
  id: string;
  text: string;
}

export interface MatchingItem {
  id: string;
  text: string;
}

export interface DiagramLabel {
  id: string;
  text: string;
  x: number; // as percentage
  y: number; // as percentage
}

export enum QuestionStatus {
    PENDING = 'PENDING',
    VERIFIED = 'VERIFIED',
    REJECTED = 'REJECTED'
}

export interface Message {
  id: string;
  groupId: string;
  sender: User;
  timestamp: Date;
  type: MessageType;
  text?: string;
  // Question related fields
  questionStem?: string;
  explanation?: string;
  questionType?: QuestionType;
  options?: QuestionOption[]; 
  correctAnswerIds?: string[]; 
  imageUrl?: string; // Can be a URL or a Base64 data URI for offline
  tags?: string[];
  questionStatus?: QuestionStatus; // For questions
  // Voting fields
  upvotes: number;
  downvotes: number;
  // --- Fields for community curation ---
  /** An array of user IDs who have flagged this question as a duplicate/similar. */
  flaggedAsSimilarUserIds?: string[];
  /** Whether the question has been archived by the community and should be hidden. */
  isArchived?: boolean;
  // Fields for new question types
  acceptableAnswers?: string[]; 
  matchingPromptItems?: MatchingItem[]; 
  matchingAnswerItems?: MatchingItem[]; 
  correctMatches?: { promptItemId: string; answerItemId: string }[]; 
  diagramLabels?: DiagramLabel[];
}

// ChatItem union type for sidebar/app navigation
export type ChatItem = (Group & { chatType: 'group' }) | (DMThread & { chatType: 'dm' });

// New types for Test/Study Mode
export enum AppMode {
  CHAT = 'CHAT',
  TEST_ACTIVE = 'TEST_ACTIVE',
  STUDY_ACTIVE = 'STUDY_ACTIVE',
  TEST_REVIEW = 'TEST_REVIEW',
  DASHBOARD = 'DASHBOARD',
  OFFLINE_MODE = 'OFFLINE_MODE',
  GAME_ACTIVE = 'GAME_ACTIVE',
  GAME_RESULTS = 'GAME_RESULTS',
  FLASHCARDS = 'FLASHCARDS',
  FLASHCARD_REVIEW = 'FLASHCARD_REVIEW',
  DECK_DETAIL = 'DECK_DETAIL',
  FLASHCARD_CRAM = 'FLASHCARD_CRAM',
  CREATE_GROUP = 'CREATE_GROUP',
  BUDGET_TRACKER = 'BUDGET_TRACKER',
  MARKETPLACE = 'MARKETPLACE',
  MARKETPLACE_LISTING_DETAIL = 'MARKETPLACE_LISTING_DETAIL',
  CREATE_MARKETPLACE_LISTING = 'CREATE_MARKETPLACE_LISTING',
  MY_LISTINGS = 'MY_LISTINGS',
  MARKETPLACE_INQUIRIES = 'MARKETPLACE_INQUIRIES',
  SELLER_PROFILE = 'SELLER_PROFILE',
}

export interface TestQuestion extends Message {
  questionNumber: number; 
}

export interface TestConfig {
  groupId: string; 
  numberOfQuestions: number;
  questionIds: string[]; // Stores original IDs for reference, even if questions are embedded in offline bundle
  timerDuration?: number; 
  allowedQuestionTypes: QuestionType[];
  selectedTags?: string[];
  focusOnNew?: boolean;
}

export type UserAnswerRecord = {
  questionId: string;
  selectedOptionIds?: string[];
  fillText?: string;
  matchingAnswers?: { promptItemId: string; answerItemId: string }[];
  diagramAnswers?: { labelId: string; selectedLabelId: string }[];
  isCorrect?: boolean;
  timeSpentSeconds?: number;
  isBookmarked?: boolean;
};

export interface TestSessionData {
  config: TestConfig;
  questions: TestQuestion[];
  userAnswers: Record<string, UserAnswerRecord>;
  currentQuestionIndex: number;
  startTime: Date;
  endTime?: Date;
  remainingTime?: number; // in seconds
  isOffline?: boolean;
}

export interface GameSession {
    id: string;
    user: User;
    opponent: User;
    questions: TestQuestion[];
    userAnswers: Record<string, UserAnswerRecord>;
    opponentAnswers: Record<string, UserAnswerRecord>; // For simulation
    userScore: number;
    opponentScore: number;
    userTime: number; // in seconds
    opponentTime: number; // in seconds
    isComplete: boolean;
    winnerId?: string;
    userStreak?: number;
    opponentStreak?: number;
    userStreakMax?: number;
    opponentStreakMax?: number;
    userCorrectAnswers?: number;
    opponentCorrectAnswers?: number;
}

export interface StudySessionData extends TestSessionData {
  // No endTime needed for study mode unless explicitly set
  // isOffline flag inherited
}

export interface TestResult {
  id: string; // Unique ID for each result, used for pending sync
  session: TestSessionData; // TestSessionData now includes isOffline
  score: number;
  totalQuestions: number;
  correctAnswersCount: number;
}// Spaced Repetition Types
export interface UserQuestionStat {
  correctAttempts: number;
  incorrectAttempts: number;

  lastAttempted: string; // ISO string date
}

export interface UserQuestionStats {
  [questionId: string]: UserQuestionStat;
}


// Types for Offline Functionality
export interface OfflineQuestion extends Message {
  // Inherits all Message properties. imageUrl here could be a Base64 string.
  // We don't need to redefine, just ensure imageUrl can hold Base64.
}

export interface OfflineSessionBundle {
  bundleId: string;
  config: TestConfig; // The config used to generate this bundle
  questions: OfflineQuestion[]; // The actual question data, with images potentially as Base64
  downloadedAt: Date;
  groupName: string; // Store group name for display
}

// Direct Messaging Types
export interface DMThread {
  id: string; // Composite key of user IDs e.g., 'user1-user2' sorted
  participantIds: [string, string];
  participants: { [userId: string]: { name: string, avatarUrl?: string } };
  lastMessage?: string;
  lastMessageTimestamp?: Date;
  unreadCount?: number;
  isArchived?: boolean;
}

export interface DirectMessage {
  id: string;
  threadId: string;
  senderId: string;
  text: string;
  timestamp: Date;
}


// --- Notifications ---
export interface AppNotification {
  id: string;
  message: string;
  date: string; // ISO string
  read: boolean;
  link?: string; // Optional link to navigate to
}

// --- Budgeting ---
export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
  INVESTMENT = 'INVESTMENT',
}

// Student-specific expense categories
export const STUDENT_EXPENSE_CATEGORIES = [
  { id: 'food_feeding', label: 'Food & Feeding', icon: '🍔' },
  { id: 'accommodation', label: 'Accommodation / Hostel', icon: '🏠' },
  { id: 'transport', label: 'Transport', icon: '🚌' },
  { id: 'data_airtime', label: 'Data & Airtime', icon: '📱' },
  { id: 'books_materials', label: 'Books & Materials', icon: '📚' },
  { id: 'printing_stationery', label: 'Printing & Stationery', icon: '🖨️' },
  { id: 'clothing_fashion', label: 'Clothing & Fashion', icon: '👕' },
  { id: 'tuition_fees', label: 'Tuition & School Fees', icon: '🎓' },
  { id: 'bills_utilities', label: 'Bills & Utilities', icon: '💡' },
  { id: 'laundry', label: 'Laundry & Cleaning', icon: '🧹' },
  { id: 'social_entertainment', label: 'Social & Entertainment', icon: '🎉' },
  { id: 'health_pharmacy', label: 'Health & Pharmacy', icon: '💊' },
  { id: 'marketplace_purchase', label: 'Marketplace Purchase', icon: '🛒' },
  { id: 'other', label: 'Other', icon: '📦' },
] as const;

// Student-specific income categories
export const STUDENT_INCOME_CATEGORIES = [
  { id: 'allowance', label: 'Allowance (Parents/Guardian)', icon: '👨‍👩‍👧' },
  { id: 'part_time', label: 'Part-time Job / Side Hustle', icon: '💼' },
  { id: 'freelance', label: 'Freelance / Gig Work', icon: '💰' },
  { id: 'scholarship', label: 'Scholarship / Bursary', icon: '📝' },
  { id: 'marketplace_sale', label: 'Marketplace Sale', icon: '🏪' },
  { id: 'gift', label: 'Gift', icon: '🎁' },
  { id: 'study_rewards', label: 'Study Rewards', icon: '🏆' },
  { id: 'other', label: 'Other', icon: '📦' },
] as const;

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  category: string;
  description: string;
  date: string; // ISO Date string
  linkedListingId?: string; // For marketplace auto-logged transactions
  splitGroupId?: string; // For expense splitting
}

export interface Budget {
  monthlyLimit: number;
  monthYear: string; // Format: "YYYY-MM"
  userId?: string;
  categoryBudgets?: Record<string, number>; // Per-category budget allocation
}

export interface SavingsGoal {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  icon: string;
  deadline?: string; // ISO Date
  createdAt: string;
  completedAt?: string;
}

export interface ExpenseSplit {
  id: string;
  creatorId: string;
  title: string;
  totalAmount: number;
  category: string;
  participants: ExpenseSplitParticipant[];
  status: 'active' | 'settled';
  createdAt: string;
}

export interface ExpenseSplitParticipant {
  userId: string;
  userName: string;
  amount: number;
  paid: boolean;
}

export interface FinancialTip {
  id: string;
  title: string;
  content: string;
  category: 'saving' | 'budgeting' | 'investing' | 'campus';
  icon: string;
}

// --- Marketplace Types ---

export interface MarketplaceListing {
  id: string;
  user_id: string;
  seller_id?: string; // alias for user_id
  seller?: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  profiles?: {
    id: string;
    name: string;
    avatar_url?: string;
  };
  category: string;
  title: string;
  description?: string;
  price?: number;
  location?: string;
  images?: string[];
  status: 'active' | 'sold' | 'inactive';
  categorySpecificFields?: any;
  category_specific_fields?: any;
  views_count?: number;
  favorites_count?: number;
  inquiries_count?: number;
  created_at: string;
  updated_at: string;
  reviews?: MarketplaceReview[];
}

export interface MarketplaceReview {
  id: string;
  listing_id: string;
  reviewer_id: string;
  reviewer?: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  rating: number;
  comment?: string;
  created_at: string;
}

export interface MarketplaceReport {
  id: string;
  listing_id: string;
  reporter_id: string;
  reason: string;
  details?: string;
  status: 'pending' | 'resolved' | 'dismissed';
  created_at: string;
}

export interface MarketplaceTransaction {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  status: 'pending' | 'released' | 'refunded' | 'disputed';
  created_at: string;
}

export interface MarketplaceFavorite {
  id: string;
  user_id: string;
  listing_id: string;
  listing?: MarketplaceListing;
  created_at: string;
}

export interface MarketplaceInquiry {
  id: string;
  listing_id: string;
  dm_thread_id: string;
  buyer_id: string;
  seller_id: string;
  status: 'open' | 'negotiating' | 'closed' | 'purchased';
  initial_message: string;
  created_at: string;
  updated_at: string;
  listing?: MarketplaceListing;
  buyer?: {
    id: string;
    name: string;
    avatar_url?: string;
  };
  seller?: {
    id: string;
    name: string;
    avatar_url?: string;
  };
}

export interface SellerStats {
  totalListings: number;
  activeListings: number;
  soldListings: number;
  totalViews: number;
  totalInquiries: number;
  totalFavorites: number;
}

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'countered' | 'expired' | 'withdrawn';

export interface MarketplaceOffer {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  status: OfferStatus;
  counter_amount?: number;
  message?: string;
  parent_offer_id?: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  listing?: MarketplaceListing;
  buyer?: { id: string; name: string; avatar_url?: string };
  seller?: { id: string; name: string; avatar_url?: string };
}

export interface SavedSearch {
  id: string;
  user_id: string;
  name: string;
  filters: {
    category?: string;
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    location?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  };
  notify: boolean;
  last_checked_at: string;
  created_at: string;
  newMatchCount?: number; // client-side: number of new matches since last check
}

export interface SellerProfile {
  user: {
    id: string;
    name: string;
    avatar_url?: string;
    created_at: string;
  };
  stats: SellerStats & {
    avgRating: number;
    totalReviews: number;
  };
  badges: Badge[];
  recentListings: MarketplaceListing[];
  recentReviews: (MarketplaceReview & { listing_title?: string })[];
}