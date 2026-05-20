// ===========================================
// Lantern Study - Shared Types
// ===========================================
// This file is shared between web and mobile apps

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
    front?: string; // for Basic
    back?: string; // for Basic
    clozeText?: string; // for Cloze, e.g., "The capital of France is {{c1::Paris}}."
    imageUrl?: string;
    occlusionData?: any;
    srsData?: SrsData;
    tags?: string[];
    createdAt: string; // ISO Date string
}

export interface Deck {
    id: string;
    name: string;
    description?: string;
    createdAt: string; // ISO Date string
}

export type BadgeId = 'GROUP_FOUNDER' | 'QUESTION_ASKER' | 'RISING_STAR' | 'TEST_TAKER' | 'HIGH_SCORER' | 'PERFECTIONIST' | 'DUELIST';

export interface Badge {
  id: BadgeId;
  level: number;
  name: string;
  description: string;
  icon: string;
  dateAwarded: string;
}

export interface UserStats {
  testsCompleted: number;
  questionsCreated: number;
  groupsCreated: number;
  highScoreTests: number;
  perfectScoreTests: number;
  gamesWon: number;
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
  password?: string;
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
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount?: number;
  memberEmails?: string[];
  adminIds: string[]; 
  moderatorIds?: string[];
  parentId?: string;
  isArchived?: boolean;
  inviteId?: string;
  pendingMembers?: User[];
  permissions?: GroupPermissions;
  invitedPhoneNumbers?: string[];
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
  x: number;
  y: number;
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
  questionStem?: string;
  explanation?: string;
  questionType?: QuestionType;
  options?: QuestionOption[]; 
  correctAnswerIds?: string[]; 
  imageUrl?: string;
  tags?: string[];
  questionStatus?: QuestionStatus;
  upvotes: number;
  downvotes: number;
  flaggedAsSimilarUserIds?: string[];
  isArchived?: boolean;
  acceptableAnswers?: string[]; 
  matchingPromptItems?: MatchingItem[]; 
  matchingAnswerItems?: MatchingItem[]; 
  correctMatches?: { promptItemId: string; answerItemId: string }[]; 
  diagramLabels?: DiagramLabel[];
}

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
}

export interface TestQuestion extends Message {
  questionNumber: number; 
}

export interface TestConfig {
  groupId: string; 
  numberOfQuestions: number;
  questionIds: string[];
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
  remainingTime?: number;
  isOffline?: boolean;
}

export interface GameSession {
    id: string;
    user: User;
    opponent: User;
    questions: TestQuestion[];
    userAnswers: Record<string, UserAnswerRecord>;
    opponentAnswers: Record<string, UserAnswerRecord>;
    userScore: number;
    opponentScore: number;
    userTime: number;
    opponentTime: number;
    isComplete: boolean;
    winnerId?: string;
}

export interface StudySessionData extends TestSessionData {}

export interface TestResult {
  session: TestSessionData;
  score: number; 
  totalQuestions: number;
  correctAnswersCount: number;
}

export interface UserQuestionStat {
  correctAttempts: number;
  incorrectAttempts: number;
  lastAttempted: string;
}

export interface UserQuestionStats {
  [questionId: string]: UserQuestionStat;
}

export interface OfflineQuestion extends Message {}

export interface OfflineSessionBundle {
  bundleId: string;
  config: TestConfig;
  questions: OfflineQuestion[];
  downloadedAt: Date;
  groupName: string;
}

export interface DMThread {
  id: string;
  participantIds: [string, string];
  participants: { [userId: string]: { name: string, avatarUrl?: string } };
  lastMessage?: string;
  lastMessageTimestamp?: Date;
  unreadCount?: number;
}

export interface DirectMessage {
  id: string;
  threadId: string;
  senderId: string;
  text: string;
  timestamp: Date;
}

export interface AppNotification {
  id: string;
  message: string;
  date: string;
  read: boolean;
  link?: string;
}

export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  category: string;
  description: string;
  date: string;
}

export interface Budget {
  userId: string;
  month: string;
  targetAmount: number;
}

export interface MarketplaceListing {
  id: string;
  user_id: string;
  seller_id?: string;
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
  status: 'pending' | 'completed' | 'cancelled' | 'disputed';
  escrow_status: 'held' | 'released' | 'refunded';
  created_at: string;
  completed_at?: string;
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
