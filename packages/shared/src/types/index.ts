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
  /**
   * AI/author-declared difficulty (flashcards.authored_difficulty). Distinct
   * from srsData.difficulty, which is FSRS scheduler state.
   */
  authoredDifficulty?: 'easy' | 'medium' | 'hard' | null;
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
  /** Course this deck belongs to (academic archive). */
  courseId?: string | null;
  /** Topic within `courseId`. Never set without a course, never from another course. */
  topicId?: string | null;
  /**
   * Distinct OTHER people who have studied this deck (Phase 3 · M).
   * Maintained by record_deck_study; the owner's own study is excluded.
   */
  studyCount?: number;
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
  // ---- Academic identity (profiles.institution_id & friends) ----
  /** marketplace_campuses.id of the student's institution (never an "Other" sentinel). */
  institutionId?: string | null;
  /** Resolved summary of `institutionId`, present on GET /users/me and /users/:id. */
  institution?: InstitutionSummary | null;
  faculty?: string | null;
  programme?: string | null;
  /** 100..900 */
  studyLevel?: number | null;
  /** Owner/admin only in the public projection. */
  entryYear?: number | null;
  /** Owner/admin only in the public projection. */
  expectedGraduationYear?: number | null;
  /** Creator bio, ≤ 280 chars (Phase 2 · J). */
  bio?: string | null;
  /** Verified v1: 0 none, 1 confirmed email, 2 + active payout profile. Server-owned. */
  verificationLevel?: number | null;
}

/** Institution as surfaced on a user: a promoted marketplace_campuses row. */
export interface InstitutionSummary {
  id: string;
  name: string;
  slug: string;
}

/** One shared row per (institution, normalised code). */
export interface Course {
  id: string;
  institutionId: string | null;
  /** Normalised, e.g. "BIO 201". */
  code: string;
  title: string;
  faculty?: string | null;
  level?: number | null;
  semester?: 1 | 2 | null;
  /** Curated by Lantern/admins (sorts first in search). */
  isCanonical: boolean;
}

/** A student's enrolment in a course for one academic year (the archive spine). */
export interface UserCourse {
  course: Course;
  /** "2026/2027" */
  academicYear: string;
  semester?: 1 | 2 | null;
  status: 'active' | 'archived';
  /** "YYYY-MM-DD" */
  examDate?: string | null;
}

/**
 * The ordered, human-curated syllabus outline inside one course (course_topics).
 * NOT a `Concept`: concepts are a cross-course many-to-many graph of what an
 * artefact is *about*; a topic is where it sits in *this* course's running
 * order. An artefact can carry both. Shared course data — anyone enrolled reads
 * the outline and may extend it, exactly like `Course` itself.
 */
export interface CourseTopic {
  id: string;
  courseId: string;
  title: string;
  /** Sparse (10, 20, 30…) so a topic can be slotted between two others. */
  position: number;
}

/**
 * A normalised topic in the knowledge network (concepts table). One row per
 * (course, slug); slug comes from @lantern/shared/learning normalizeConceptSlug.
 */
export interface Concept {
  id: string;
  slug: string;
  name: string;
  parentId?: string | null;
  courseId?: string | null;
  source: 'ai' | 'user' | 'import' | 'backfill';
  createdBy?: string | null;
  createdAt?: string;
}

/** concept ↔ artefact edge (concept_links). target_id is text: question ids are messages.id. */
export interface ConceptLink {
  conceptId: string;
  targetType: 'flashcard' | 'question' | 'note' | 'deck';
  targetId: string;
  confidence: number;
  source: 'ai' | 'user' | 'import' | 'backfill';
  createdBy?: string | null;
  createdAt?: string;
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
  /** Course this group studies (academic archive). */
  courseId?: string | null;
  /** Phase 3 L — discovery. Private by default; only an admin can widen it. */
  visibility?: 'private' | 'community' | 'public';
  communityId?: string | null;
  tags?: string[];
  memberCount?: number;
  questionCount?: number;
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
  // Phase 3 L (decision D12): Discover is the hub — communities, groups,
  // people, trending — with the marketplace nested as one of its tabs.
  DISCOVER = 'DISCOVER',
  // Phase 4 Q — invite friends / referrals
  INVITE_FRIENDS = 'INVITE_FRIENDS',
  // Phase 4 R — public campus/programme SEO page
  CAMPUS_PAGE = 'CAMPUS_PAGE',
  COMMUNITY_DETAIL = 'COMMUNITY_DETAIL',
  MARKETPLACE = 'MARKETPLACE',
  MARKETPLACE_LISTING_DETAIL = 'MARKETPLACE_LISTING_DETAIL',
  CREATE_MARKETPLACE_LISTING = 'CREATE_MARKETPLACE_LISTING',
  MY_LISTINGS = 'MY_LISTINGS',
  MARKETPLACE_PURCHASES = 'MARKETPLACE_PURCHASES',
  STUDY_PRODUCT_DRAFTS = 'STUDY_PRODUCT_DRAFTS',
  CREATOR_PROFILE = 'CREATOR_PROFILE',
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
  /** A folder can *be* a course (academic archive). */
  courseId?: string | null;
  // No topicId: a folder is not a filed artefact. Notes, decks and test
  // sessions carry the topic; note_folders.topic_id has no writer or reader.
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
  /** Course this note belongs to (academic archive). */
  courseId?: string | null;
  /** Topic within `courseId`. Never set without a course, never from another course. */
  topicId?: string | null;
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
  /**
   * Capped, concatenated attachment text (extracted PDF/slide/OCR/transcript
   * text) supplied by the notes-list endpoint so imported notes — whose `body`
   * is empty — are findable by their content in the client-side search filter.
   * Not persisted; present only on list payloads.
   */
  searchText?: string;
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
   * Exam-style lock: once a question is answered and the user moves on, it is
   * locked and cannot be returned to. Skipped (unanswered) questions stay open.
   * Only meaningful for test sessions (mode === 'test'), never study.
   */
  lockAnsweredQuestions?: boolean;
  /**
   * Offline bundle this session was started from, when applicable.
   * "qbank-<listingId>" identifies a marketplace question bank, which is how a
   * completed session is attributed to that bank's leaderboard.
   */
  bundleId?: string;
  /** Course this session is attributed to (mirrors test_sessions.course_id). */
  courseId?: string | null;
  /**
   * Topic within `courseId` (mirrors test_sessions.topic_id). Lives here rather
   * than on TestSessionData because that is where `courseId` lives — the server
   * reads the session's course off the config-like payload, and the topic must
   * travel the same path or it is dropped on save.
   */
  topicId?: string | null;
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
  /**
   * Ids of questions locked from further navigation, when config.lockAnsweredQuestions
   * is on. A question is added on leaving it once answered. Persisted with the session
   * so the lock survives pause/resume and reloads (can't be dodged by refreshing).
   */
  lockedQuestionIds?: string[];
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
  /** Course this bundle belongs to (also written into config.courseId). */
  courseId?: string | null;
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

// `color` is the stable per-category swatch used by every chart/bar on both web
// and mobile, so a category is the same colour everywhere (no index-based drift).
export const STUDENT_EXPENSE_CATEGORIES = [
  { id: 'food_feeding', label: 'Food & Feeding', icon: '🍔', color: '#f59e0b' },
  { id: 'accommodation', label: 'Accommodation / Hostel', icon: '🏠', color: '#8b5cf6' },
  { id: 'transport', label: 'Transport', icon: '🚌', color: '#0ea5e9' },
  { id: 'data_airtime', label: 'Data & Airtime', icon: '📱', color: '#06b6d4' },
  { id: 'books_materials', label: 'Books & Materials', icon: '📚', color: '#6366f1' },
  { id: 'printing_stationery', label: 'Printing & Stationery', icon: '🖨️', color: '#64748b' },
  { id: 'clothing_fashion', label: 'Clothing & Fashion', icon: '👕', color: '#ec4899' },
  { id: 'tuition_fees', label: 'Tuition & School Fees', icon: '🎓', color: '#4f46e5' },
  { id: 'bills_utilities', label: 'Bills & Utilities', icon: '💡', color: '#eab308' },
  { id: 'laundry', label: 'Laundry & Cleaning', icon: '🧹', color: '#14b8a6' },
  { id: 'social_entertainment', label: 'Social & Entertainment', icon: '🎉', color: '#f43f5e' },
  { id: 'health_pharmacy', label: 'Health & Pharmacy', icon: '💊', color: '#ef4444' },
  { id: 'marketplace_purchase', label: 'Marketplace Purchase', icon: '🛒', color: '#10b981' },
  { id: 'other', label: 'Other', icon: '📦', color: '#94a3b8' },
] as const;

export const STUDENT_INCOME_CATEGORIES = [
  { id: 'allowance', label: 'Allowance (Parents/Guardian)', icon: '👨‍👩‍👧', color: '#10b981' },
  { id: 'part_time', label: 'Part-time Job / Side Hustle', icon: '💼', color: '#0ea5e9' },
  { id: 'freelance', label: 'Freelance / Gig Work', icon: '💰', color: '#f59e0b' },
  { id: 'scholarship', label: 'Scholarship / Bursary', icon: '📝', color: '#8b5cf6' },
  { id: 'marketplace_sale', label: 'Marketplace Sale', icon: '🏪', color: '#14b8a6' },
  { id: 'gift', label: 'Gift', icon: '🎁', color: '#ec4899' },
  { id: 'study_rewards', label: 'Study Rewards', icon: '🏆', color: '#eab308' },
  { id: 'other', label: 'Other', icon: '📦', color: '#94a3b8' },
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
  status: 'active' | 'sold' | 'inactive' | 'reserved' | 'archived' | 'suspended_by_admin' | 'removed_by_admin';
  categorySpecificFields?: Record<string, unknown>;
  category_specific_fields?: Record<string, unknown>;
  views_count?: number;
  favorites_count?: number;
  inquiries_count?: number;
  is_boosted?: boolean;
  search_score?: number;
  quantity?: number | null;
  /**
   * Digital listing kinds deliver into the buyer's own data instead of a
   * physical handoff: 'question_bank' → offline_bundles; 'study_pack' →
   * offline_bundles + a deck + a note.
   */
  listing_kind?: 'single' | 'bundle' | 'question_bank' | 'study_pack';
  bundle_items?: Array<{ listing_id?: string; title: string; price?: number }>;
  /** Course this listing is for (academic archive). */
  courseId?: string | null;
  /** Raw DB alias of `courseId` (listing rows are served snake_case). */
  course_id?: string | null;
  /** Topic within `courseId`. Never set without a course, never from another course. */
  topicId?: string | null;
  /** Raw DB alias of `topicId` (listing rows are served snake_case). */
  topic_id?: string | null;
  // ── Rights / takedown / appeal state (Phase 1 · E). The API returns these
  // only to the listing owner and platform admins; other viewers never see them.
  rights_status?: ListingRightsStatus;
  rightsStatus?: ListingRightsStatus;
  rights_attested_at?: string | null;
  rights_attestation_version?: string | null;
  /** Soft content-filter hits recorded at create/edit time. */
  moderation_flags?: ModerationFlag[];
  takedown_reason?: string | null;
  takedownReason?: string | null;
  takedown_at?: string | null;
  appeal_status?: ListingAppealStatus;
  appealStatus?: ListingAppealStatus;
  appeal_note?: string | null;
  appealed_at?: string | null;
  appeal_decided_at?: string | null;
  created_at: string;
  updated_at: string;
  reviews?: MarketplaceReview[];
}

// ─── Moderation (Phase 1 · E) ──────────────────────────────────────────────
// String unions mirror the CHECK constraints in
// supabase/migrations/20260822140000_rights_and_moderation.sql; the
// vocabulary helpers live in ../moderation.

export type ListingRightsStatus = 'unattested' | 'attested' | 'under_review' | 'takedown' | 'cleared';

export type ListingAppealStatus = 'none' | 'requested' | 'upheld' | 'reversed';

export interface ModerationFlag {
  /** RegExp source of the content-filter pattern that matched. */
  pattern: string;
  reason: ContentReportReason;
  /** ISO timestamp of the write that tripped the filter. */
  at: string;
  /** Which field(s) matched, e.g. 'title+description'. */
  field?: string;
}

export type ContentReportTargetType =
  | 'listing'
  | 'question_bank'
  | 'note'
  | 'deck'
  | 'user'
  | 'group'
  | 'message'
  | 'dm_message'
  | 'job_posting';

export type ContentReportReason =
  | 'scam'
  | 'spam'
  | 'inappropriate'
  | 'copyright'
  | 'leaked_exam'
  | 'plagiarism'
  | 'harassment'
  | 'prohibited_item'
  | 'wrong_category'
  | 'discriminatory'
  | 'other';

export type ContentReportStatus = 'pending' | 'under_review' | 'resolved' | 'dismissed';

/** What the admin queue shows about the reported thing (resolved server-side per target type). */
export interface ContentReportTargetSummary {
  type: ContentReportTargetType;
  id: string;
  /** Listing/job title, note title, deck name, group name, username, or a message snippet. */
  title?: string | null;
  /** Listing/job status, or 'removed' for soft-deleted notes/decks, 'archived' for groups. */
  status?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  /** False when the target row no longer exists. */
  exists: boolean;
}

export interface ContentReport {
  id: string;
  reporter_id: string;
  target_type: ContentReportTargetType;
  target_id: string;
  reason: ContentReportReason;
  details?: string | null;
  status: ContentReportStatus;
  admin_note?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  /** 'marketplace_reports' | 'job_reports' for rows backfilled from the old tables. */
  legacy_source?: string | null;
  legacy_id?: string | null;
  created_at: string;
  reporter?: { id: string; name?: string | null; username?: string | null } | null;
  target?: ContentReportTargetSummary;
  /** Legacy alias kept for the existing admin console: populated when target_type is 'listing'. */
  listing?: { id: string; title: string; status: string; user_id?: string } | null;
  listing_id?: string | null;
}

export interface ModerationStrike {
  id: string;
  user_id: string;
  report_id?: string | null;
  severity: 1 | 2 | 3;
  reason: string;
  created_by?: string | null;
  created_at: string;
  expires_at: string;
}

/** GET /users/me/moderation */
export interface ModerationState {
  activeStrikes: number;
  suspendedUntil: string | null;
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

// ========== LIBRARY ARCHIVE (Phase 1 · B — docs/phase1-library-archive-contract.md §1) ==========

export interface LibraryCourseCounts {
  notes: number;
  decks: number;
  tests: number;
  /** Every offline bundle filed under the course — purchased packs included. */
  bundles: number;
  /** Subset of `bundles`: offline_bundles whose bundle_id starts with `qbank-`. */
  purchasedPacks: number;
}

/** The third level of the archive: year → course → topic (Phase 1 · A). */
export interface LibraryTopicNode {
  topic: CourseTopic;
  counts: LibraryCourseCounts;
}

export interface LibraryCourseNode {
  course: Course;
  /** Archived enrolments are included with `status: 'archived'` (group under "Past semesters"). */
  enrolment: UserCourse;
  counts: LibraryCourseCounts;
  /**
   * Ordered by topic position. Omitted entirely — not empty — while the
   * course_topics migration is unapplied, so a client must treat "no topics"
   * and "topics not available yet" as the same thing: show the flat course.
   */
  topics?: LibraryTopicNode[];
  /** Artefacts filed under the course but under no topic. Omitted with `topics`. */
  untopiced?: LibraryCourseCounts;
}

export interface LibraryYear {
  /** "2026/2027" — newest first. */
  academicYear: string;
  /** Active enrolments first, then by course code. */
  courses: LibraryCourseNode[];
}

/** GET /library/overview */
export interface LibraryOverview {
  years: LibraryYear[];
  /** Items whose course_id is null. */
  unfiled: { notes: number; decks: number; tests: number; bundles: number };
}

/** `types=` values accepted by GET /library/search. */
export type LibrarySearchType = 'notes' | 'decks' | 'flashcards' | 'bundles';

export type LibrarySearchResultType = 'note' | 'deck' | 'flashcard' | 'bundle';

export type LibrarySearchMatchField =
  | 'title'
  | 'summary'
  | 'body'
  | 'attachment'
  | 'name'
  | 'description'
  | 'front'
  | 'back'
  | 'displayName'
  | 'groupName';

/** One row of GET /library/search — ranked (title prefix > contains > secondary text), then by recency. */
export interface LibrarySearchResult {
  type: LibrarySearchResultType;
  /** notes/decks/flashcards: row id; bundles: the client-facing bundleId. */
  id: string;
  title: string;
  snippet: string;
  courseId: string | null;
  /** Topic within `courseId`. Absent while the course_topics migration is unapplied. */
  topicId?: string | null;
  /** Flashcards only — results stay grouped under their deck. */
  deckId?: string;
  /** Flashcards only — the deck's name for group headers. */
  deckTitle?: string;
  /** Which field matched, when known. */
  matchedIn?: LibrarySearchMatchField;
  updatedAt: string;
}
