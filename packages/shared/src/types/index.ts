// ===========================================
// Lantern Study - Shared Types (canonical)
// ===========================================

export enum FlashcardType {
  BASIC = 'BASIC',
  CLOZE = 'CLOZE',
  IMAGE_OCCLUSION = 'IMAGE_OCCLUSION',
}

export interface OcclusionData {
  type: 'rectangles' | 'circles' | 'freeform' | 'blur';
  rectangles?: { x: number; y: number; width: number; height: number }[];
  circles?: { x: number; y: number; radius: number }[];
  freeform?: { points: { x: number; y: number }[] };
  /** Multiple freeform masks (preferred). Legacy cards may only have `freeform`. */
  freeforms?: { points: { x: number; y: number }[] }[];
  blur?: { x: number; y: number; width: number; height: number; radius: number; opacity: number }[];
}

export interface SrsData {
  interval: number;
  easeFactor: number;
  repetitions: number;
  nextReviewDate: string;
  failedAttempts?: number;
  isLeech?: boolean;
  /** FSRS scheduler fields (optional — SM-2 cards omit these) */
  scheduler?: 'sm2' | 'fsrs';
  difficulty?: number;
  stability?: number;
}

export interface Flashcard {
  id: string;
  deckId: string;
  type: FlashcardType;
  front?: string;
  back?: string;
  clozeText?: string;
  imageUrl?: string;
  occlusionData?: OcclusionData;
  srsData?: SrsData;
  tags?: string[];
  /** Optimistic concurrency token from API (CAS). */
  version?: number;
  createdAt: string;
}

export interface Deck {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  userId?: string;
  createdBy?: string;
  approvedBy?: string;
  isShared?: boolean;
}

export interface FlashcardSession {
  deck: Deck;
  cardQueue: Flashcard[];
  timerSeconds?: number;
  endTime?: string;
}

export interface FlashcardComment {
  id: string;
  flashcardId: string;
  userId: string;
  comment: string;
  createdAt: string;
  resolved?: boolean;
}

export interface DeckCollaborator {
  userId: string;
  role: 'viewer' | 'editor' | 'owner';
  addedAt: string;
  profile?: { id: string; name: string; avatarUrl?: string };
}

export type BadgeId =
  | 'GROUP_FOUNDER'
  | 'QUESTION_ASKER'
  | 'RISING_STAR'
  | 'TEST_TAKER'
  | 'HIGH_SCORER'
  | 'PERFECTIONIST'
  | 'DUELIST'
  | 'MARKETPLACE_SELLER'
  | 'TRUSTED_SELLER'
  | 'OFFER_MAKER';

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
  /**
   * Highest upvote count on any single question the user has authored — the
   * metric behind RISING_STAR. Optional because profiles saved before this
   * existed have no value for it; the server recomputes it from `messages`.
   */
  questionUpvotesMax?: number;
  listingsCreated: number;
  listingsSold: number;
  fiveStarReviews: number;
  offersMade: number;
}

export type { UserSettings, NotificationSettings } from '../settings/userSettings';
import type { UserSettings } from '../settings/userSettings';

export interface TestPreset {
  id: string;
  name: string;
  config: Omit<TestConfig, 'questionIds' | 'groupId'>;
}

export interface User {
  id: string;
  name: string;
  username?: string;
  isAdmin?: boolean;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  email?: string;
  password?: string;
  phoneNumber?: string;
  points: number;
  badges: Badge[];
  stats: UserStats;
  settings?: UserSettings;
  settingsVersion?: number;
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
  REJECTED = 'REJECTED',
}

/** Compact preview of a message being replied to. */
export interface MessageReplyPreview {
  id: string;
  senderId?: string;
  senderName?: string;
  type?: MessageType | string;
  text?: string;
  questionStem?: string;
  isRemoved?: boolean;
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
  editedAt?: string;
  removedAt?: string;
  isRemoved?: boolean;
  acceptableAnswers?: string[];
  matchingPromptItems?: MatchingItem[];
  matchingAnswerItems?: MatchingItem[];
  correctMatches?: { promptItemId: string; answerItemId: string }[];
  diagramLabels?: DiagramLabel[];
  replyToMessageId?: string;
  mentionedUserIds?: string[];
  replyTo?: MessageReplyPreview | null;
  /** Root message id for nested reply threads (null if not part of a thread). */
  threadRootId?: string;
  /** Number of replies in this thread (on root or any member). */
  replyCount?: number;
  /** Sender-facing receipt for own messages. */
  receiptStatus?: 'sent' | 'read';
  seenByCount?: number;
  seenByTotal?: number;
  /** Optimistic reconcile key from messages.client_message_id. */
  clientMessageId?: string;
}

export type ChatItem = (Group & { chatType: 'group' }) | (DMThread & { chatType: 'dm' });

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
  FLASHCARD_MATCH = 'FLASHCARD_MATCH',
  FLASHCARD_LEARN = 'FLASHCARD_LEARN',
  CREATE_GROUP = 'CREATE_GROUP',
  BUDGET_TRACKER = 'BUDGET_TRACKER',
  MARKETPLACE = 'MARKETPLACE',
  MARKETPLACE_LISTING_DETAIL = 'MARKETPLACE_LISTING_DETAIL',
  CREATE_MARKETPLACE_LISTING = 'CREATE_MARKETPLACE_LISTING',
  MY_LISTINGS = 'MY_LISTINGS',
  MARKETPLACE_FAVORITES = 'MARKETPLACE_FAVORITES',
  MARKETPLACE_INQUIRIES = 'MARKETPLACE_INQUIRIES',
  MARKETPLACE_ORDERS = 'MARKETPLACE_ORDERS',
  MARKETPLACE_CART = 'MARKETPLACE_CART',
  MARKETPLACE_ORDER_DETAIL = 'MARKETPLACE_ORDER_DETAIL',
  SELLER_CUSTOMERS = 'SELLER_CUSTOMERS',
  SELLER_PROFILE = 'SELLER_PROFILE',
  MARKETPLACE_JOBS = 'MARKETPLACE_JOBS',
  MARKETPLACE_JOB_DETAIL = 'MARKETPLACE_JOB_DETAIL',
  CREATE_MARKETPLACE_JOB = 'CREATE_MARKETPLACE_JOB',
  MY_JOB_POSTINGS = 'MY_JOB_POSTINGS',
  MY_JOB_APPLICATIONS = 'MY_JOB_APPLICATIONS',
  JOB_EMPLOYER = 'JOB_EMPLOYER',
  JOB_EMPLOYER_PIPELINE = 'JOB_EMPLOYER_PIPELINE',
  JOB_COMPANY = 'JOB_COMPANY',
  ADMIN = 'ADMIN',
  NOTES = 'NOTES',
  NOTE_EDITOR = 'NOTE_EDITOR',
  LIBRARY = 'LIBRARY',
  STUDY_HUB = 'STUDY_HUB',
  AI_TOOLS = 'AI_TOOLS',
}

export type StudyNoteSourceType = 'typed' | 'youtube' | 'pdf' | 'audio' | 'import' | 'presentation' | 'photos';
export type StudyGoalMode = 'casual' | 'retention' | 'exam_prep';

export interface NoteFolder {
  id: string;
  userId: string;
  groupId?: string;
  parentId?: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export type NoteAccessRole = 'owner' | 'editor' | 'viewer' | 'group_member';
export type NoteShareGrantRole = 'viewer' | 'editor';

export interface NoteOwnerPresentation {
  id: string;
  name?: string;
  username?: string;
  avatarUrl?: string;
}

export interface StudyNote {
  id: string;
  userId: string;
  folderId?: string;
  groupId?: string;
  title: string;
  body: string;
  summary?: string;
  sourceType: StudyNoteSourceType;
  youtubeUrl?: string;
  youtubeVideoId?: string;
  isShared?: boolean;
  /** @deprecated Dormant legacy field — do not use for secure share links. */
  shareToken?: string;
  /** Source note when created via Make a copy. */
  copiedFromNoteId?: string;
  /** Optimistic concurrency token from API (CAS). */
  version?: number;
  /** Caller's access on this note (list/detail). */
  accessRole?: NoteAccessRole;
  /** Present for shared (non-owned) notes. */
  owner?: NoteOwnerPresentation;
  /** Soft-hidden from the default Notes list. */
  isArchived?: boolean;
  /** Pinned notes sort above others in the active list. */
  isPinned?: boolean;
  pinnedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteAttachment {
  id: string;
  noteId: string;
  type: 'pdf' | 'audio' | 'image' | 'youtube' | 'presentation';
  fileUrl?: string;
  fileName?: string;
  extractedText?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface NoteComment {
  id: string;
  noteId: string;
  userId: string;
  comment: string;
  createdAt: string;
  resolved: boolean;
  user?: NoteOwnerPresentation;
}

export interface NoteCollaborator {
  noteId: string;
  userId: string;
  role: 'viewer' | 'editor' | 'owner';
  addedAt: string;
  user?: NoteOwnerPresentation;
}

export interface NoteShareLink {
  id: string;
  noteId: string;
  role: NoteShareGrantRole;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
  lastRedeemedAt?: string;
  isActive?: boolean;
  /** Plaintext token — only returned once at create time. */
  token?: string;
  url?: string;
}

export interface NoteSharePreview {
  shareLinkId: string;
  noteId: string;
  title: string;
  role: NoteShareGrantRole;
  owner: NoteOwnerPresentation;
  alreadyHasAccess: boolean;
  currentAccessRole?: NoteAccessRole;
  isOwner: boolean;
}

export interface DailyQuizQuestion {
  id: string;
  text: string;
  type: 'multiple_choice' | 'true_false' | 'short_answer';
  options?: string[];
  correctAnswer: string;
  explanation: string;
  topic: string;
}

export interface DailyQuizSession {
  date: string;
  noteId?: string;
  /** Display title of the source note — shown on dashboard so users know context. */
  sourceNoteTitle?: string;
  questions: DailyQuizQuestion[];
  answers: Record<string, string>;
  completed: boolean;
}

export interface TestQuestion extends Message {
  questionNumber: number;
}

export interface TestConfig {
  groupId: string;
  groupName?: string;
  numberOfQuestions: number;
  questionIds: string[];
  timerDuration?: number;
  allowedQuestionTypes: QuestionType[];
  selectedTags?: string[];
  focusOnNew?: boolean;
  /**
   * Offline bundle this session was started from, when applicable.
   * "qbank-<listingId>" identifies a marketplace question bank, which is how a
   * completed session is attributed to that bank's leaderboard.
   */
  bundleId?: string;
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

export type TestSessionStatus = 'in_progress' | 'paused' | 'completed' | 'abandoned';
export type TestSessionKind = 'test' | 'study';

export interface TestSessionData {
  id?: string;
  config: TestConfig;
  questions: TestQuestion[];
  userAnswers: Record<string, UserAnswerRecord>;
  currentQuestionIndex: number;
  startTime: Date;
  endTime?: Date;
  remainingTime?: number;
  isOffline?: boolean;
  sessionKind?: TestSessionKind;
  status?: TestSessionStatus;
  title?: string;
  updatedAt?: string;
  pausedAt?: string;
}

/** Lean row for Saved sessions list (paused / in-progress drafts). */
export interface PausedSessionSummary {
  id: string;
  sessionKind: TestSessionKind;
  status: 'in_progress' | 'paused';
  title: string;
  answeredCount: number;
  totalQuestions: number;
  currentQuestionIndex: number;
  remainingTimeSeconds?: number | null;
  startTime: string;
  updatedAt: string;
  pausedAt?: string | null;
  groupId?: string;
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
  userStreak?: number;
  opponentStreak?: number;
  userStreakMax?: number;
  opponentStreakMax?: number;
  userCorrectAnswers?: number;
  opponentCorrectAnswers?: number;
  /** Server-backed challenge id; absent for solo practice */
  challengeId?: string;
  /** True when playing alone (no opponent, no win recorded) */
  isSoloPractice?: boolean;
  /** True after user submitted but waiting for opponent */
  awaitingOpponent?: boolean;
}

export type ChallengeStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'completed'
  | 'cancelled';

export interface ChallengeConfig {
  numberOfQuestions: number;
  allowedQuestionTypes?: string[];
  selectedTags?: string[];
}

export interface ChallengeParticipant {
  userId: string;
  score: number;
  totalTime: number;
  correctCount: number;
  maxStreak: number;
  answers: Record<string, UserAnswerRecord>;
  finishedAt?: string;
  name?: string;
  avatarUrl?: string;
}

export interface GroupChallenge {
  id: string;
  groupId: string;
  challengerId: string;
  opponentId: string;
  status: ChallengeStatus;
  config: ChallengeConfig;
  questionIds: string[];
  questions?: TestQuestion[];
  winnerId?: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  challenger?: Pick<User, 'id' | 'name' | 'avatarUrl'>;
  opponent?: Pick<User, 'id' | 'name' | 'avatarUrl'>;
  participants?: ChallengeParticipant[];
  myParticipant?: ChallengeParticipant;
  opponentParticipant?: ChallengeParticipant;
  gamification?: {
    points: number;
    badges: Badge[];
    stats: UserStats;
    awardedBadges?: Badge[];
  };
}

export interface StudySessionData extends TestSessionData {}

export interface TestResult {
  id: string;
  session: TestSessionData;
  score: number;
  totalQuestions: number;
  correctAnswersCount: number;
}

export interface UserQuestionStat {
  correctAttempts: number;
  incorrectAttempts: number;
  lastAttempted: string;
  stem?: string | null;
  groupName?: string | null;
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
  displayName?: string;
}

export type DmThreadStatus = 'open' | 'pending' | 'declined';

export interface DMThread {
  id: string;
  participantIds: [string, string] | string[];
  participants: { [userId: string]: { name: string; avatarUrl?: string } };
  lastMessage?: string;
  lastMessageTimestamp?: Date | string;
  unreadCount?: number;
  isArchived?: boolean;
  /**
   * ISO timestamp when the current user deleted this chat ("delete for me").
   * Messages at or before this time must stay hidden even after the thread resurfaces.
   */
  historyClearedAt?: string | null;
  /**
   * Local-only: thread was opened/created on the client before the server row exists.
   * Cleared when a threads fetch returns this id.
   */
  clientPending?: boolean;
  /** open = two-way; pending = message request; declined = rejected request */
  status?: DmThreadStatus;
  /** User who initiated a pending/declined message request */
  requestedBy?: string | null;
}

export interface DirectMessage {
  /** Local-only outbox state; never sent to or returned by the server. */
  deliveryState?: 'pending' | 'failed';
  id: string;
  threadId: string;
  senderId: string;
  /** Profile photo from API/realtime — used for the other person's bubbles. */
  senderAvatar?: string | null;
  senderName?: string | null;
  text: string;
  timestamp: Date | string;
  editedAt?: string;
  removedAt?: string;
  isRemoved?: boolean;
  replyToMessageId?: string;
  replyTo?: MessageReplyPreview | null;
  threadRootId?: string;
  replyCount?: number;
  receiptStatus?: 'sent' | 'read';
  /** Optimistic reconcile key from dm_messages.client_message_id (REL-03). */
  clientMessageId?: string;
}

export interface AppNotification {
  id: string;
  message: string;
  date: string;
  read: boolean;
  link?: string;
  type?: string;
  data?: Record<string, unknown>;
}

export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
  INVESTMENT = 'INVESTMENT',
}

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
  date: string;
  linkedListingId?: string;
  splitGroupId?: string;
}

export interface Budget {
  monthlyLimit: number;
  monthYear: string;
  userId?: string;
  /** Planned expenses per category. Legacy name; see BudgetPlan.plannedExpenses. */
  categoryBudgets?: Record<string, number>;
  /**
   * Planned income per category. Without this the budget is only a spending
   * cap — it is what makes "income − (expenses + savings)" answerable.
   */
  plannedIncome?: Record<string, number>;
  /** Planned savings allocation for the month. */
  plannedSavings?: number;
}

export interface SavingsGoal {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  icon: string;
  deadline?: string;
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

export interface MarketplaceListing {
  id: string;
  user_id: string;
  seller_id?: string;
  seller?: { id: string; name: string; avatarUrl?: string };
  profiles?: { id: string; name: string; avatar_url?: string };
  category: string;
  title: string;
  description?: string;
  price?: number;
  sale_price?: number;
  sale_ends_at?: string;
  promo_label?: string;
  effective_price?: number;
  is_on_sale?: boolean;
  location?: string;
  campus_id?: string | null;
  country_code?: string;
  currency?: string;
  campus?: {
    id: string;
    name: string;
    city: string;
    state: string;
    slug?: string;
    geopolitical_zone?: string | null;
  };
  images?: string[];
  status: 'active' | 'sold' | 'inactive' | 'reserved' | 'suspended_by_admin' | 'removed_by_admin';
  categorySpecificFields?: Record<string, unknown>;
  category_specific_fields?: Record<string, unknown>;
  views_count?: number;
  favorites_count?: number;
  inquiries_count?: number;
  is_boosted?: boolean;
  search_score?: number;
  quantity?: number | null;
  /** 'question_bank' is a digital listing delivered into offline_bundles. */
  listing_kind?: 'single' | 'bundle' | 'question_bank';
  bundle_items?: Array<{ listing_id?: string; title: string; price?: number }>;
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
    username?: string;
    avatarUrl?: string;
    avatar_url?: string;
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

export type MarketplaceOrderStatus =
  | 'pending_payment'
  | 'awaiting_payment'
  | 'paid'
  | 'ready_for_pickup'
  | 'buyer_confirmed'
  | 'completed'
  | 'cancelled'
  | 'disputed';

export type MarketplaceOrderSource = 'buy_now' | 'offer_accept' | 'manual';

export interface MarketplaceOrder {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  /** Units purchased; offers stay 1. */
  quantity?: number;
  offer_id?: string;
  inquiry_id?: string;
  transaction_id?: string;
  /** Paystack marketplace payment row when checkout is enabled. */
  payment_id?: string | null;
  coupon_id?: string;
  discount_amount?: number;
  payment_proof_url?: string;
  payment_proof_submitted_at?: string;
  source: MarketplaceOrderSource;
  status: MarketplaceOrderStatus;
  fulfillment_mode: 'campus_meetup' | 'hall_dropoff';
  meeting_location?: string;
  seller_note?: string;
  seller_confirmed_at?: string;
  buyer_confirmed_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  listing?: MarketplaceListing;
  buyer?: { id: string; name: string; avatar_url?: string };
  seller?: { id: string; name: string; avatar_url?: string };
  transaction?: MarketplaceTransaction;
}

export interface MarketplaceCartItem {
  id: string;
  buyer_id: string;
  listing_id: string;
  quantity: number;
  created_at: string;
  updated_at: string;
  listing?: MarketplaceListing | null;
}

export interface SellerAnalytics {
  totalRevenue: number;
  revenue30d: number;
  avgSalePrice: number;
  avgTimeToSellDays: number;
  /** All-time completed sales / all-time listing views. Prefer conversionRate30d when available. */
  conversionRate: number;
  /** Period-aligned conversion from product_events (null until event pipeline has data). */
  conversionRate30d?: number | null;
  offerAcceptRate: number;
  pendingOrders: number;
  openInquiries: number;
  discountsGiven: number;
  completedSalesCount: number;
  topListings: Array<{
    id: string;
    title: string;
    views: number;
    inquiries: number;
    offers: number;
    sold: boolean;
    revenue: number;
  }>;
  salesByWeek: Array<{ weekStart: string; revenue: number; count: number }>;
  salesBySource?: Array<{ source: string; count: number; revenue: number }>;
  inquiryToSaleRate?: number;
  staleListings?: Array<{ id: string; title: string; daysListed: number; views: number }>;
  highViewsLowEngagement?: Array<{
    id: string;
    title: string;
    views: number;
    inquiries: number;
    offers: number;
  }>;
  favoriteHighlights?: Array<{ id: string; title: string; favoritesCount: number }>;
  /** Daily listing_view counts over last 30 days (from product_events). */
  viewsByDay?: Array<{ date: string; views: number; uniqueViewers: number }>;
  /** Period funnel: impressions → views → inquiries → offers → sales (30d). */
  funnel30d?: {
    impressions: number;
    views: number;
    inquiries: number;
    offers: number;
    sales: number;
  };
}

export interface SellerBuyerContact {
  buyerId: string;
  name: string;
  avatar_url?: string;
  lastInteractionAt: string;
  completedPurchases: number;
  totalSpent: number;
  openInquiry: boolean;
  openOrder: boolean;
  segments?: string[];
}

export type SellerCustomerSegment =
  | 'repeat_buyer'
  | 'top_spender'
  | 'open_order'
  | 'open_inquiry'
  | 'lead'
  | 'customer';

export interface MarketplaceCoupon {
  id: string;
  seller_id: string;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  listing_id?: string | null;
  max_uses?: number | null;
  uses_count: number;
  starts_at?: string | null;
  ends_at?: string | null;
  active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface CouponValidationResult {
  code: string;
  baseAmount: number;
  discountAmount: number;
  finalAmount: number;
}

export interface MarketplaceSellerPreferences {
  seller_id: string;
  hall_dropoff_enabled: boolean;
  hall_dropoff_min_amount?: number | null;
  onboarding_completed_at?: string | null;
  boost_credits?: number;
  require_payment_confirmation?: boolean;
  favorite_alert_threshold?: number;
  shop_name?: string | null;
  shop_bio?: string | null;
  cover_image_url?: string | null;
  shop_updated_at?: string | null;
  updated_at: string;
}

export interface SellerShop {
  shopName: string;
  bio: string | null;
  coverImageUrl: string | null;
}

export interface MarketplaceShopCard {
  sellerId: string;
  shopName: string;
  bio: string | null;
  coverImageUrl: string | null;
  avatarUrl: string | null;
  activeListingCount: number;
  avgRating: number;
  totalReviews: number;
  campusId: string | null;
  campusLabel: string | null;
  lastListingAt: string | null;
}

export interface SellerOnboardingStatus {
  needsOnboarding: boolean;
  boostCredits: number;
  listingCount: number;
  tips: string[];
}

export interface MarketplacePickupNudge {
  enabled: boolean;
  minAmount: number;
  buyerSpentWithSeller: number;
  remainingAmount: number;
  message: string | null;
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
  buyer?: { id: string; name: string; avatar_url?: string };
  seller?: { id: string; name: string; avatar_url?: string };
}

export interface SellerStats {
  totalListings: number;
  activeListings: number;
  soldListings: number;
  completedOrders: number;
  totalViews: number;
  totalInquiries: number;
  totalFavorites: number;
  totalRevenue?: number;
  revenue30d?: number;
  conversionRate?: number;
  pendingOrders?: number;
  isVerified?: boolean;
}

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'countered' | 'expired' | 'withdrawn';

export interface MarketplaceOffer {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  status: OfferStatus;
  /** Whose proposal this row is; the other party may accept/decline/counter. */
  proposed_by?: 'buyer' | 'seller';
  counter_amount?: number;
  message?: string;
  parent_offer_id?: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  listing?: MarketplaceListing;
  buyer?: { id: string; name: string; avatar_url?: string };
  seller?: { id: string; name: string; avatar_url?: string };
  /**
   * The order created when this offer was accepted, party-scoped by the API
   * (present only for a buyer/seller of that order), or null. Optional because
   * older/cached responses predate the field. Note the camelCase `paymentId`:
   * it matches the API's OfferOrderSummary and is deliberately NOT the
   * snake_case `payment_id` used on a full MarketplaceOrder — reading the
   * wrong casing here silently hides the buyer's Pay-now affordance, so this
   * shared shape exists to make that misread a compile error.
   */
  order?: { id: string; status: string; paymentId: string | null } | null;
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
  newMatchCount?: number;
}

export interface SellerProfile {
  user: { id: string; name: string; avatar_url?: string; created_at?: string };
  shop?: SellerShop;
  /** Owner scope gets full SellerStats; public scope only the fields below. */
  stats: Partial<SellerStats> & {
    avgRating: number;
    totalReviews: number;
    isVerified?: boolean;
  };
  /** Seller reputation chips (trusted/top seller) — not gamification Badges. */
  badges: Array<{ id: string; label: string; icon?: string }>;
  recentListings: MarketplaceListing[];
  recentReviews: (MarketplaceReview & { listing_title?: string })[];
}

export type CompanionActionType =
  | 'navigate_to_flashcards'
  | 'open_test_config'
  | 'open_create_flashcard'
  | 'navigate_to_dashboard'
  | 'navigate_to_chat'
  | 'auto_generate_flashcards'
  | 'navigate_to_notes'
  | 'open_note_learn';

export interface CompanionAction {
  type: CompanionActionType;
  label: string;
  payload?: Record<string, string>;
}

export interface CompanionMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: CompanionAction[];
  /** User rating for assistant replies; null/undefined = none. */
  feedback?: 'up' | 'down' | null;
  created_at: string;
}

/** One companion chat thread (general or note-linked). */
export interface CompanionConversation {
  id: string;
  title: string;
  preview: string;
  noteContextId: string | null;
  noteTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanionUserContext {
  userName?: string;
  groups?: string[];
  weakTopics?: string[];
  dueCardsCount?: number;
  recentTestSummary?: string;
  budgetSummary?: string;
  currentScreen?: string;
  activeSessionSummary?: string;
  noteContext?: string;
  noteTitle?: string;
  noteId?: string;
  studyGoal?: StudyGoalMode;
  /** Active companion thread; omit / null + newConversation to start fresh. */
  conversationId?: string;
  /** When true, create a new thread instead of continuing the latest for this note scope. */
  newConversation?: boolean;
}

export interface UserPreferences {
  theme: 'light' | 'dark';
  lowDataMode: boolean;
  studyGoal?: StudyGoalMode;
}

export interface AIUsageInfo {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

export type ActivityType =
  | 'test'
  | 'flashcard'
  | 'flashcard_new'
  | 'study_question'
  | 'game'
  | 'daily_quiz';

export interface StudyActivityDay {
  date: string;
  count: number;
  breakdown?: Partial<Record<ActivityType, number>>;
}
