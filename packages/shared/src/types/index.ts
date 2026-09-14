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
  /** Personal study set this deck belongs to. Optional; independent of course. */
  studySetId?: string | null;
  /** Topic within `courseId`. Never set without a course, never from another course. */
  topicId?: string | null;
  /**
   * Distinct OTHER people who have studied this deck (Phase 3 · M).
   * Maintained by record_deck_study; the owner's own study is excluded.
   */
  studyCount?: number;
  /**
   * Cover image storage reference ("bucket/path"), NOT a URL. Signed URLs live
   * 24h, so the path is what is persisted; clients re-sign on read through
   * POST /storage/signed-urls (variant 'thumb' for grids).
   */
  coverPath?: string | null;
  /** Resolved signed URL for `coverPath`. Never persisted; present only on responses that sign. */
  coverUrl?: string | null;
  /** Resolved signed URL for the sibling thumbnail. Never persisted. */
  coverThumbUrl?: string | null;
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
  | 'OFFER_MAKER'
  | 'CAMPUS_AMBASSADOR';

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
  /**
   * 1 when profiles.is_ambassador is set, else 0. Drives CAMPUS_AMBASSADOR.
   * Never a self-serve counter — the admin flag is the source of truth.
   */
  campusAmbassador?: number;
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
  /** Semester the student is currently in: 1 = first, 2 = second. */
  currentSemester?: 1 | 2 | null;
  /** Owner/admin only in the public projection. */
  entryYear?: number | null;
  /** Owner/admin only in the public projection. */
  expectedGraduationYear?: number | null;
  /** Creator bio, ≤ 280 chars (Phase 2 · J). */
  bio?: string | null;
  /** Verified v1: 0 none, 1 confirmed email, 2 + active payout profile. Server-owned. */
  verificationLevel?: number | null;
  /** Privacy-safe last heartbeat. Omitted when the peer hides online status. */
  lastSeenAt?: string | null;
  /** Privacy-safe online / offline / hidden from last_seen_at. */
  onlineStatus?: 'online' | 'offline' | 'hidden';
}

/** Institution as surfaced on a user: a promoted marketplace_campuses row. */
export interface InstitutionSummary {
  id: string;
  name: string;
  slug: string;
  /** university | polytechnic | college | primary | secondary */
  kind?: string;
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
 * A personal study set — the primary container on the Study tab.
 * A course is an optional tag, not a requirement to exist.
 */
export interface StudySet {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  courseId?: string | null;
  folderId?: string | null;
  coverPath?: string | null;
  /**
   * The tile pastel its owner picked, or null/absent to derive one from the id
   * (`setTileArt` in study/setPresentation). A cover picture still wins over
   * both: cover > this > hash.
   *
   * Typed as the open `string` rather than `SetTileHue` because it arrives off
   * a database row; `setTileArt` ignores a value outside the six.
   */
  tileHue?: string | null;
  /** The tile glyph its owner picked. Null/absent derives one. */
  tileGlyph?: string | null;
  visibility?: 'private' | 'public';
  mode?: 'cram' | 'standard' | 'comprehensive';
  /** "YYYY-MM-DD" — the set's own exam date, independent of any enrolment. */
  examDate?: string | null;
  /**
   * The server could not persist `examDate` because the `exam_date` column is
   * not applied on this database yet. Everything else in the patch did land.
   */
  examDateUnsupported?: boolean;
  lastStudiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudySetFolder {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
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

/** Lecturer-owned instance of a catalogue course (docs/phase-teach-portal-contract.md). */
export type ClassRole = 'instructor' | 'ta' | 'student';
export type ClassMemberStatus = 'active' | 'removed';
export type ClassMaterialKind = 'syllabus' | 'lecture' | 'reading' | 'slide';
export type ClassAssignmentKind = 'test' | 'deck' | 'notes' | 'open';
export type ClassAssignmentProgressStatus = 'assigned' | 'completed';
export type InstitutionStaffRole = 'instructor' | 'department_admin' | 'institution_admin';

export interface ClassSection {
  id: string;
  course: Course;
  /** Set when the class covers one syllabus topic rather than the whole course. */
  topic: CourseTopic | null;
  institutionId: string | null;
  title: string;
  academicYear: string;
  semester: 1 | 2 | null;
  archivedAt: string | null;
  createdAt: string;
  memberCount: number;
  role: ClassRole;
  /** Present for instructors and TAs only — never sent to students. */
  joinCode?: string;
}

export interface ClassJoinPreview {
  title: string;
  course: Course;
  topic: CourseTopic | null;
  instructorName: string;
  memberCount: number;
  academicYear: string;
  semester: 1 | 2 | null;
}

export interface ClassMember {
  userId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  role: ClassRole;
  status: ClassMemberStatus;
  joinedAt: string;
}

export interface ClassMaterial {
  id: string;
  classId: string;
  noteId: string | null;
  kind: ClassMaterialKind;
  title: string;
  body?: string;
  publishedAt: string | null;
  createdAt: string;
}

export interface ClassGeneratedQuizQuestion {
  text: string;
  type: string;
  options?: string[];
  correctAnswer?: string;
  explanation?: string;
  difficulty?: string;
  topic?: string;
}

export interface ClassGeneratedCard {
  front: string;
  back: string;
  mnemonic?: string;
}

export interface ClassGenerateResult {
  kind: 'quiz' | 'flashcards' | 'outline';
  questions?: ClassGeneratedQuizQuestion[];
  cards?: ClassGeneratedCard[];
  outline?: string[];
}

export interface ClassAssignmentProgress {
  assignmentId: string;
  userId: string;
  status: ClassAssignmentProgressStatus;
  score: number | null;
  completedAt: string | null;
}

export interface ClassAssignment {
  id: string;
  classId: string;
  title: string;
  kind: ClassAssignmentKind;
  dueAt: string | null;
  noteId: string | null;
  deckId: string | null;
  payload: {
    questions?: ClassGeneratedQuizQuestion[];
    cards?: ClassGeneratedCard[];
    outline?: string[];
  };
  createdAt: string;
  progress?: ClassAssignmentProgress | null;
  completionCount?: number;
}

export interface ClassAnalyticsStudent {
  userId: string;
  name: string;
  username: string | null;
  completedAssignments: number;
  lastActivityAt: string | null;
  atRisk: boolean;
}

export interface ClassAnalytics {
  memberCount: number;
  publishedMaterialCount: number;
  assignmentCount: number;
  students: ClassAnalyticsStudent[];
  atRiskDays: number;
}

export interface InstitutionStaff {
  institutionId: string;
  institutionName?: string;
  userId: string;
  name?: string;
  username?: string | null;
  role: InstitutionStaffRole;
  status: 'active' | 'revoked';
  createdAt: string;
}

export interface InstitutionClassAnalytics {
  institutionId: string;
  classCount: number;
  memberCount: number;
  publishedMaterialCount: number;
  assignmentCount: number;
}

export interface LmsConnectorStatus {
  available: false;
  connectors: [];
  message: string;
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
  /**
   * Which surface a community group renders as. NULL/undefined = legacy =
   * 'board'; only 'study_group' opts out. Irrelevant without a communityId.
   * Never decide the surface from the screen that mounted the group — use
   * `isCommunityBoard` from `@lantern/shared/network`.
   */
  communitySurface?: 'board' | 'study_group' | null;
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
  /** Emoji reaction counts, e.g. { "👍": 3 }. Server-owned (trigger-maintained). */
  reactions?: Record<string, number>;
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
  /**
   * Distinct upvotes from members OTHER than the author — the only count that
   * can grant VERIFIED (see utils/questionVerification). Server-owned and
   * undefined on API builds that predate it, so clients must degrade rather
   * than treat it as 0.
   */
  peerUpvotes?: number;
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
  /** Board post title (messages.subject), ≤120 chars. Undefined pre-migration. */
  subject?: string | null;
  /** Server-side board pin — one per board, enforced by a unique partial index. */
  pinnedAt?: string | null;
  /** Who pinned it (profiles.id). */
  pinnedBy?: string | null;
  /**
   * What a board post IS (`messages.post_kind`): discussion | question |
   * announcement | event. Undefined pre-20260908120000 and on legacy rows —
   * both read as 'discussion' through `normalizeBoardPostKind`.
   */
  postKind?: string | null;
  /** Why a moderator removed this post. Shown with the tombstone. */
  removedReason?: string | null;
  /** The accepted answer on a `question` post (a comment's message id). */
  answeredMessageId?: string | null;
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
  SEMESTER_PRODUCTS = 'SEMESTER_PRODUCTS',
  STUDY_ROOM = 'STUDY_ROOM',
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
  MARKETPLACE_CHECKOUT = 'MARKETPLACE_CHECKOUT',
  MARKETPLACE_YOU = 'MARKETPLACE_YOU',
  MARKETPLACE_ADDRESSES = 'MARKETPLACE_ADDRESSES',
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
  /** One enrolled course as a room: `/study/courses/:courseId`. */
  COURSE_WORKSPACE = 'COURSE_WORKSPACE',
  /** One personal study set as a room: `/study/sets/:studySetId`. */
  STUDY_SET_WORKSPACE = 'STUDY_SET_WORKSPACE',
  /** Wave 1 door: the list of tests (`/tests`), above `/tests/active` and `/tests/review`. */
  TESTS_HOME = 'TESTS_HOME',
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
  /** Personal study set this note belongs to. Optional; independent of course. */
  studySetId?: string | null;
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
  /**
   * Cover image storage reference ("bucket/path"), NOT a URL — same contract as
   * `Deck.coverPath`: persist the path, re-sign for display.
   */
  coverPath?: string | null;
  /** Resolved signed URL for `coverPath`. Never persisted. */
  coverUrl?: string | null;
  /** Resolved signed URL for the sibling thumbnail. Never persisted. */
  coverThumbUrl?: string | null;
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

/**
 * One page of an uploaded document (`note_attachment_pages`).
 *
 * `pageIndex` is 0-based. `text` is that page's text alone — the whole-document
 * blob stays on `NoteAttachment.extractedText` and is unchanged by this.
 *
 * `imageUrl` is a short-lived signed URL minted by the API on read; it is never
 * stored, so never cache it past the response that carried it. It is absent
 * when no page image has been rendered, which is the normal case for a text
 * PDF — a client that needs a picture must render the page itself.
 */
export interface NoteAttachmentPage {
  attachmentId: string;
  pageIndex: number;
  text: string;
  charCount: number;
  imageUrl?: string;
  createdAt?: string;
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

/**
 * How a test is meant to be sat.
 *
 * 'practice' reveals each answer as you go (and, per spec §9 #5, asks how sure
 * you were first); 'exam' hides everything until the end and may run a clock.
 * The builder writes this into the saved test's config, which is the only place
 * a launch — hours later, from a link or a notification — can read it back.
 */
export type TestAttemptKind = 'practice' | 'exam';

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
  /**
   * Study set this session belongs to (mirrors test_sessions.study_set_id).
   *
   * It lives on the config for the same reason `courseId` does: the config is
   * what every create path already sends, so a set stamped here reaches the
   * column whichever door the session came through. Without it, all 77 of a
   * live account's sessions carried no set, and every set room's Test tab was
   * permanently empty — the list is filtered on exactly this.
   */
  studySetId?: string | null;
  /**
   * Provenance of a personal test, written once at creation. Read it through
   * `TestSessionProvenance` (the server resolves and returns that) rather than
   * off the config, so the reading code does not have to know these key names.
   */
  sourceNoteId?: string | null;
  sourceNoteTitle?: string | null;
  sourceDeckId?: string | null;
  sourceDeckTitle?: string | null;
  /** The job that generated the questions, when one did. */
  sourceJobId?: string | null;
  /** 'note' | 'deck' | 'group' | 'personal' — which source above is the real one. */
  source?: string;
  /**
   * What the student chose in the builder. Absent on every test written before
   * the builder existed, and those read as an exam — the older, stricter of the
   * two, so a missing field can never accidentally reveal answers early.
   */
  attemptKind?: TestAttemptKind;
  /**
   * The taking mode `attemptKind` implies: 'study' for practice, 'test' for an
   * exam. Stored alongside rather than derived at every read so a client that
   * only knows about session kinds does not have to learn the builder's words.
   */
  mode?: TestSessionKind;
  /**
   * Which Study door filed this personal test. Quiz and Test used to read the
   * same `/tests` rows; new writes stamp `quiz` or `test` so the two lists
   * stop duplicating. Absent on older rows — `studyTestDoor` infers.
   */
  studyDoor?: 'quiz' | 'test';
  /** Generic sitting preset from the Test door — not a licensed exam skin. */
  sittingPreset?: 'timed' | 'calculator_off' | 'passage';
  /** False when the sitting is "no calculator". Absent means unrestricted. */
  calculatorAllowed?: boolean;
  /** True when stems should quote a passage from the material. */
  passageStem?: boolean;
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
  /**
   * How sure the student was when they committed this answer (spec §9 #5:
   * asked on PRACTICE attempts only; timed exam attempts stay plain).
   * Absent means "never asked", which is NOT the same as unsure — review and
   * analysis must keep the three states apart.
   */
  confidence?: AnswerConfidence;
};

/** Self-report captured before the reveal on a practice attempt. */
export type AnswerConfidence = 'sure' | 'unsure';

export const ANSWER_CONFIDENCE_VALUES: readonly AnswerConfidence[] = ['sure', 'unsure'];

/**
 * Where a test session came from, resolved server-side so no client has to
 * dig through `config`. Every field is a string or null — never absent — so a
 * client can render "From <title>" without an undefined check.
 */
export interface TestSessionProvenance {
  /** Note the questions were generated from, when applicable. */
  noteId: string | null;
  /** Deck the questions were drawn from, when applicable. */
  deckId: string | null;
  /** Study group whose question bank the test was built from, when applicable. */
  groupId: string | null;
  /** Display title of whichever source is set (note title, deck name, group name). */
  title: string | null;
}

/**
 * Outcome of one attempt, split three ways. `unanswered` is never folded into
 * `incorrect`: a question the student never reached is not a question they got
 * wrong, and the results screen must not accuse them of one for the other.
 */
export interface TestAttemptTally {
  total: number;
  answered: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  /**
   * The same split again, keyed by what the student said BEFORE the reveal.
   * `unspecified` covers exam attempts and every answer recorded before
   * confidence existed — it is not a third confidence level.
   */
  byConfidence: Record<
    AnswerConfidence | 'unspecified',
    { correct: number; incorrect: number; answered: number }
  >;
}

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
  /** Emoji reaction counts, e.g. { "👍": 3 }. Server-owned (trigger-maintained). */
  reactions?: Record<string, number>;
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
  /** Compact browse cards flatten condition out of category_specific_fields. */
  condition?: string | null;
  /** Compact browse cards flatten taxonomyNodeId out of category_specific_fields. */
  taxonomyNodeId?: string | null;
  views_count?: number;
  favorites_count?: number;
  inquiries_count?: number;
  /**
   * Trigger-maintained review aggregate (20260828160000 migration). Absent /
   * null until the migration is applied — clients must hide rating UI when
   * `rating_count` is not a positive number.
   */
  rating_avg?: number | null;
  rating_count?: number | null;
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
  | 'job_posting'
  /** A post or comment on a community board (`messages` with a board group). */
  | 'community_post'
  /** A member of a community, reported to that community's moderators. */
  | 'community_member';

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
  /**
   * Reviewer completed a purchase of this listing (order / digital
   * entitlement / seller-confirmed inquiry). Computed at read time by the API;
   * absent when the lookup was skipped or failed.
   */
  verifiedPurchase?: boolean;
  /**
   * "Helpful" reaction count. Absent (not 0) while the review-votes migration
   * has not been applied — clients hide the control entirely then.
   */
  helpfulCount?: number;
  /** Whether the current viewer marked this review helpful (authed reads only). */
  viewerMarkedHelpful?: boolean;
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
  | 'shipped'
  | 'buyer_confirmed'
  | 'completed'
  | 'cancelled'
  | 'disputed';

export type MarketplaceFulfillmentMode =
  | 'campus_meetup'
  | 'hall_dropoff'
  | 'shipping'
  | 'digital';

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
  checkout_id?: string | null;
  shipping_amount?: number;
  shipping_address?: Record<string, unknown> | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  shipped_at?: string | null;
  seller_payout_kobo?: number | null;
  fulfillment_mode: MarketplaceFulfillmentMode;
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
  shipping_enabled?: boolean;
  shipping_fee_naira?: number | null;
  shipping_free_over_naira?: number | null;
  ships_from_campus_id?: string | null;
  ships_from_city?: string | null;
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

export interface MarketplaceSellerFulfillment {
  sellerId: string;
  campusMeetup: true;
  hallDropoffEnabled: boolean;
  hallDropoffMinAmount: number | null;
  shippingEnabled: boolean;
  shippingFeeNaira: number;
  shippingFreeOverNaira: number | null;
  shipsFromCampusId: string | null;
  shipsFromCity: string | null;
}

export interface MarketplaceAddress {
  id: string;
  user_id: string;
  label?: string | null;
  recipient_name: string;
  phone: string;
  campus_id?: string | null;
  city: string;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  hall?: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export type MarketplaceCheckoutStatus =
  | 'draft'
  | 'awaiting_payment'
  | 'paid'
  | 'failed'
  | 'cancelled';

export interface MarketplaceCheckout {
  id: string;
  buyer_id: string;
  status: MarketplaceCheckoutStatus;
  item_amount_kobo: number;
  shipping_amount_kobo: number;
  total_charged_kobo: number;
  payment_id?: string | null;
  shipping_address?: Record<string, unknown> | null;
  authorizationUrl?: string | null;
  orders?: MarketplaceOrder[];
  created_at: string;
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

/**
 * Where an assistant reply was read from, for the source chips under it.
 *
 * `excerpts` are 1-based chunk positions inside that one note, in reading
 * order. There are no page numbers in this pipeline, so a chip reads
 * "<note title> · Excerpt 3" and never claims a page.
 */
export interface CompanionCitation {
  noteId: string;
  noteTitle: string;
  excerpts: number[];
}

export interface CompanionMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: CompanionAction[];
  /** Source chips for this reply. Live-session only — not persisted server-side. */
  citations?: CompanionCitation | null;
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

/**
 * How the companion teaches a turn. Not a personality gallery: each mode
 * changes what the assistant is ALLOWED to do, so the difference shows up in
 * every reply instead of being a change of tone.
 *
 * Mirrors the server's own union in `aiService.ts` — the server is still the
 * authority (it re-validates every value), this is what the clients may send.
 */
export type CompanionMode = 'explain' | 'quiz_me' | 'socratic' | 'guided';

/**
 * Where a Guided lesson has got to, carried by the client on every turn.
 *
 * The companion stores no per-thread lesson state of its own, so this is the
 * only thing that tells turn 5 what turn 1 was teaching. It rides in
 * `CompanionUserContext.guided` and is treated as untrusted metadata by the
 * server — see the field's comment there.
 */
export interface GuidedSession {
  /** The lesson's subject, as the picker row named it. Never the unit. */
  topic: string;
  /** The note the topic was built from, re-attached on every turn. */
  sourceNoteId?: string | null;
  /** That note's title, for the prompt's "from <source>" clause. */
  sourceTitle?: string | null;
  /** 1-based step the student is on. Only the lesson advances it. */
  step: number;
  /**
   * The check question the last reply ended on — what the student's next
   * message is an answer TO. Without it the model re-reads the whole thread
   * and picks whichever question it likes, which is how a correct answer got
   * marked as the start of step 1 again.
   */
  lastCheck?: string | null;
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
  /**
   * Walk-through page scope. With `noteId`, the server grounds the reply in
   * that ONE page of the attachment (or in nothing, when the page is blank)
   * instead of the whole note. Sent once, with the question asked from the
   * page — never persisted with the active note.
   */
  attachmentId?: string;
  /** 0-based page of `attachmentId`. */
  pageIndex?: number;
  /**
   * One-shot highlight from the notes studio. Quoted in the user message;
   * sent with this Ask so the rail can show the span was the question.
   */
  selectedSpan?: string;
  /**
   * One-shot stem from the adaptive quiz. Quoted in the user message so the
   * rail is asking about this question, not the whole note.
   */
  questionStem?: string;
  /**
   * One-shot excerpt from the lecture studio — what was just said. Quoted in
   * the user message so Ask does not need the recorder to stop.
   */
  recentTranscript?: string;
  /** When set, companion grounding may include that class's published materials. */
  classId?: string;
  /** Course the student is in — generated decks should file here. */
  courseId?: string;
  studyGoal?: StudyGoalMode;
  /**
   * How the companion should teach THIS turn.
   *
   * The one context field the client legitimately owns — it is a UI choice,
   * not a claim about the student's data — so the server still runs it through
   * its allowlist and falls back to `explain` on anything unknown. Nothing is
   * persisted: a mode rides with the send and is re-sent on the next one.
   */
  mode?: CompanionMode;
  /**
   * The lesson this Guided thread is in the middle of.
   *
   * Guided used to send nothing but `mode: 'guided'` after the seed turn, so
   * every reply past the first had no topic, no source and no step in front of
   * it. The model fell back to the only goal it could still see — the words in
   * the seed, "Imported Notes" — and taught the student how to find their
   * notes, from step 1, on a turn they had just answered correctly.
   *
   * Like `mode`, this is client-declared metadata: a claim about where the
   * conversation got to, not about the student's data. The server sanitizes it
   * (allowlisted shape, length caps, step clamped) and drops anything
   * malformed rather than pasting it into the prompt.
   */
  guided?: GuidedSession;
  /** Active companion thread; omit / null + newConversation to start fresh. */
  conversationId?: string;
  /** When true, create a new thread instead of continuing the latest for this note scope. */
  newConversation?: boolean;
  /**
   * Photos attached to this turn, as returned by `uploadCompanionImage`.
   *
   * The server believes the `attachmentId` and nothing else — it reads each
   * transcript back out of its own table for rows the student owns. The text
   * and word count travel here only so the composer chip can say
   * "Image · 240 words" without a second round trip.
   */
  imageAttachments?: CompanionImageAttachment[];
}

/**
 * One photo the companion has already read.
 *
 * There is no vision model in the chat path, so "the companion can see my
 * photo" is really "the photo was transcribed once, at upload, and the
 * transcript grounds the answer" — which is why `wordCount` is part of the
 * contract: zero words means the picture gave the companion nothing, and the
 * student needs to be told that rather than left wondering.
 */
export interface CompanionImageAttachment {
  attachmentId: string;
  /** Signed URL for the stored (normalized) image — a thumbnail source. */
  url: string;
  fileName: string;
  extractedText: string;
  wordCount: number;
  /** AI uses actually spent reading it. */
  creditsCharged?: number;
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

// ===========================================
// Exam formats (AI question generation)
// ===========================================

/**
 * The Nigerian exam papers a generated question can be written to imitate.
 *
 * This is a TAG, not a table: it rides inside the existing question JSON
 * (`question.examFormat`), so nothing about it needs a migration. Values are
 * snake_case and must stay stable — old generated questions already carry them.
 */
export type ExamFormat = 'jamb' | 'waec_theory' | 'post_utme' | 'departmental';

export const EXAM_FORMATS: readonly ExamFormat[] = [
  'jamb',
  'waec_theory',
  'post_utme',
  'departmental',
];

/** Student-facing labels. Web and mobile must show the same words. */
export const EXAM_FORMAT_LABELS: Record<ExamFormat, string> = {
  jamb: 'JAMB',
  waec_theory: 'WAEC theory',
  post_utme: 'Post-UTME',
  departmental: 'Departmental past paper',
};

/** One-line description of what each preset changes about the questions. */
export const EXAM_FORMAT_DESCRIPTIONS: Record<ExamFormat, string> = {
  jamb: 'Four-option objectives, one line each, no calculators assumed.',
  waec_theory: 'Structured theory questions in (a)/(b) parts, with marks.',
  post_utme: 'Fast screening objectives — short stems, tight distractors.',
  departmental: 'Course-style past-paper questions in your lecturer’s wording.',
};

export function isExamFormat(value: unknown): value is ExamFormat {
  return typeof value === 'string' && (EXAM_FORMATS as readonly string[]).includes(value);
}
