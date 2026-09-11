import { createClient } from "@supabase/supabase-js";
import {
  DatabaseConfig,
  User,
  Group,
  Message,
  TestResult,
  Notification,
} from "../types";
import { cacheService } from "./cache";
import { scrubEmailFromDisplayName } from "@lantern/shared/utils/displayNames";
import { logger } from "../utils/logger";
import { buildFlashcardUpdateData } from "../utils/flashcardUpdate";
import {
  buildMarketplaceBudgetTxIds,
  buildManualSaleBudgetTxId,
  buildMarketplacePurchaseDescription,
  buildMarketplaceSaleDescription,
  MARKETPLACE_BUDGET_CATEGORIES,
  MARKETPLACE_BUDGET_TYPES,
} from "@lantern/shared/utils/server";
import {
  checkAndAwardBadges,
  coerceRawUserAnswers,
  initialUserStats,
  resolveQuestionStatusAfterVote,
  sanitizeAnswerConfidences,
  tallyTestAttempt,
} from "@lantern/shared/utils/testHelpers";
import {
  BADGE_DEFINITIONS,
  createBadge,
} from "@lantern/shared/utils/gamification";
import {
  canVerifyQuestion,
  countPeerUpvotes,
} from "@lantern/shared/utils/questionVerification";
import { QuestionStatus } from "@lantern/shared/types";
import { mapUserStatsFromApi } from "@lantern/shared/utils/apiMappers";
import { computeStudyStreak } from "@lantern/shared/utils/activity";
import { calculateFsrsData } from "@lantern/shared/utils/fsrs";
import {
  getSrsMaxInterval,
  normalizeUserSettings,
} from "@lantern/shared/settings";
import {
  BOARD_BOOKMARK_IMPORT_MAX,
  BOARD_FAVORITE_EMOJI,
  BOARD_BOOKMARKS_PAGE_SIZE,
  BOARD_BOOKMARKS_PAGE_SIZE_MAX,
  BOARD_COMMENT_NOTIFY_MAX,
  BOARD_POST_SUBJECT_MAX,
  BOARD_QUOTE_SNIPPET_MAX,
  BOARD_REPOST_CLIENT_ID_PREFIX,
  BOARD_REPOST_PER_BOARD_HOURLY_MAX,
  BOARD_REPOST_QUOTE_MAX,
  BOARD_REPOST_SELF_COOLDOWN_MS,
  boardPostDeepLinkPath,
  boardQuoteSnippet,
  boardRepostClientId,
  boardRepostOriginalId,
  BOARD_POST_KIND_DEFAULT,
  COMMUNITY_MODERATION_COPY,
  canPinOnBoard,
  canPostBoardKind,
  isBoardImageUrlAllowed,
  isBoardRepostRow,
  isCommunityBoard,
  isCommunityMemberMuted,
  normalizeBoardPostKind,
  resolveCommunityRole,
  resolveGroupDiscovery,
  type BoardBookmarkEntry,
  type BoardPostKind,
  type BoardQuotedPost,
  type CommunityRole,
} from "@lantern/shared/network";
import {
  groupColumns,
  hasCommunityMemberMute,
  hasGroupCommunitySurface,
  hasMessageBoardColumns,
  hasMessagePostKind,
  isMissingColumnError,
  markCommunityMemberMuteMissing,
  markGroupCommunitySurfaceMissing,
  markMessageBoardColumnsMissing,
  markMessagePostKindMissing,
  markMessageReactionsColumnMissing,
  messageColumns,
  reactionColumns,
} from "./schemaCapabilities";
import {
  MARKETPLACE_DEFAULT_COUNTRY,
  MARKETPLACE_DEFAULT_CURRENCY,
  MARKETPLACE_MODERATED_LISTING_STATUSES,
  isMarketplaceListingEditable,
  isMarketplaceListingStatus,
  sellerListingTransitionError,
  isKnownTaxonomyNodeId,
  rankRelatedListings,
} from "@lantern/shared/marketplace";
import { PublicError } from "../utils/safeError";
import {
  cardToFlashcardRow,
  DeckWithCardsError,
  isMissingRpcError,
  type NormalizedDeckCard,
} from "./deckWithCards";
// Value import (const array) — marketplaceOrders only type-imports supabase, so
// this introduces no runtime import cycle.
import { OPEN_ORDER_STATUSES } from "./marketplaceOrders";
// Shared `?courseId=` filter (none / unfiled / course) for the artefact lists;
// academicCourses only type-imports supabase, so no runtime cycle either.
import {
  applyCourseFilter,
  courseFilterKey,
  isMissingStudySetColumn,
  isMissingTopicColumn,
  type CourseFilter,
} from "./academicCourses";
// Topic write-through (Phase 1 · A): anything that can be filed under a course
// can be filed under one of its topics, validated against the course the row
// ends up with. courseTopics only type-imports supabase, so no cycle either.
import { getCourseTopicsService } from "./courseTopics";
// Owner/admin-only moderation columns never ride along on embedded listings.
import { stripListingModerationFields } from "./moderation";
import {
  isPrivateStorageBucket,
  parseStorageObjectUrl,
  storageThumbPath,
} from "@lantern/shared/utils/storageUrl";
import {
  resolveThreadRootId,
  computeDmReceiptStatus,
  computeGroupReceipt,
  parseChatAudioUrl,
  parseChatImageUrl,
} from "@lantern/shared/utils/chatMedia";
import { normalizeReactions } from "@lantern/shared/chat";
import {
  clearDmHistoryClearedAtForUser,
  effectiveDmUnreadFloor,
  filterMessagesAfterDmHistoryCutoff,
  readDmHistoryClearedAt,
  withDmHistoryClearedAt,
} from "@lantern/shared/utils/dmHistoryCutoff";

function extractMentionUsernames(text?: string | null): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(/@([a-zA-Z0-9_]{2,32})\b/g)) {
    const username = match[1];
    if (username) found.add(username.toLowerCase());
  }
  return [...found];
}
import {
  assertImageMagicBytes,
  clampSignedUrlTtl,
  detectImageMime,
  STORAGE_SIGNED_URL_MAX_TTL,
} from "../utils/fileValidation";
import { VersionConflictError } from "../utils/versionConflict";
// Append-only learning log (Phase 1 · C). Value import of a leaf module
// (learningEvents only type-imports this file), so no runtime import cycle.
import {
  buildCardReviewedEvent,
  lookupDeckCourseId,
  lookupDeckOwnerAndCourse,
  recordLearningEvent,
  recordTestSessionAnswers,
} from "./learningEvents";
import type { LearningSurface } from "@lantern/shared/learning";
import { buildNoteStoragePath } from "./noteFiles";
import { mapNoteCommentRow, NOTE_COMMENT_SELECT } from "./noteCommentMapping";
import {
  IMMUTABLE_IMAGE_CACHE_CONTROL,
  processImageForUpload,
} from "./imageProcessing";

type UserStats = typeof initialUserStats;

type GamificationSyncResult = {
  points: number;
  badges: User["badges"];
  stats: UserStats;
  awardedBadges: User["badges"];
};

type ProfileSenderRow = {
  id?: string;
  name?: string;
  username?: string;
  avatar_url?: string;
};

export type ChatMessageMutationStatus =
  | "ok"
  | "invalid_content"
  | "invalid_kind"
  | "not_found"
  | "forbidden"
  | "not_editable"
  | "not_removable"
  | "removed"
  | "expired";

export type ChatMessageMutationResult = {
  status: ChatMessageMutationStatus;
  message?: Record<string, unknown>;
};

/**
 * Why a pin did or did not happen. The route maps each to its own code so the
 * client can say the true thing: 503 the migration is not applied yet, 400 the
 * group is not a board, 403 the caller may not pin, 404 no such message or no
 * access to it.
 */
export type MessagePinResult =
  | { status: "ok"; message: Record<string, unknown> }
  | { status: "unavailable" }
  | { status: "not_found" }
  | { status: "not_board" }
  | { status: "not_pinnable" }
  | { status: "forbidden" };

/**
 * Why a repost did or did not happen (§6.3). Every rule is enforced HERE and
 * not in the client, so calling the endpoint directly with curl is refused
 * exactly like tapping a control the UI has hidden.
 */
export type BoardRepostResult =
  | { status: "ok"; message: Record<string, unknown> }
  | { status: "not_found" }
  | { status: "not_board" }
  | { status: "not_same_board" }
  | { status: "not_a_post" }
  | { status: "repost_of_repost" }
  | { status: "own_too_soon" }
  | { status: "removed" }
  | { status: "already" }
  | { status: "too_many" }
  | { status: "quote_too_long" };

/** Undoing a repost. `groupId` lets the route invalidate the right board page. */
export type BoardRepostUndoResult =
  | { status: "ok"; groupId: string; repostId: string }
  | { status: "not_found" };

/**
 * A bookmark write. `unavailable` is the pre-migration answer — the API is
 * deployed before the founder hand-applies 20260904120000, and every board
 * screen has to keep working through that window.
 */
export type MessageBookmarkResult =
  | { status: "ok"; bookmarked: boolean }
  | { status: "unavailable" }
  | { status: "not_found" }
  | { status: "not_a_board_post" };

/** One page of "Saved posts". `serverBacked: false` means the table is absent. */
export type BoardBookmarkPage = {
  entries: BoardBookmarkEntry[];
  nextCursor: string | null;
  serverBacked: boolean;
};

function mapProfileSender(
  profile: ProfileSenderRow | null | undefined,
  senderId: string,
) {
  return {
    id: profile?.id || senderId,
    // Never an address: a profiles row created from an email sign-up can hold
    // the address itself, and this is the one serialiser every board, DM and
    // group message sender passes through.
    name: scrubEmailFromDisplayName(profile?.name) || "Unknown",
    username: profile?.username || undefined,
    avatarUrl: profile?.avatar_url,
    points: 0,
    badges: [],
    stats: {},
  };
}

function resolveNestedProfile(profiles: unknown): ProfileSenderRow | null {
  if (Array.isArray(profiles)) return (profiles[0] as ProfileSenderRow) ?? null;
  return (profiles as ProfileSenderRow) ?? null;
}

/** Map a profiles table row (snake_case) to the API User shape (with snake_case aliases). */
function mapProfileRowToUser(
  row: Record<string, unknown> | null | undefined,
): User | null {
  if (!row || typeof row !== "object") return null;
  const avatarUrl = (row.avatar_url as string | undefined) || undefined;
  const mapped = {
    id: String(row.id),
    name: String(row.name || ""),
    username: (row.username as string | undefined) || undefined,
    firstName: (row.first_name as string | undefined) || undefined,
    lastName: (row.last_name as string | undefined) || undefined,
    email: (row.email as string | undefined) || undefined,
    phoneNumber: (row.phone as string | undefined) || undefined,
    avatarUrl,
    points: typeof row.points === "number" ? row.points : 0,
    badges: Array.isArray(row.badges) ? row.badges : [],
    stats: row.stats ?? {},
    settings: row.settings ?? {},
    settingsVersion:
      typeof row.settings_version === "number"
        ? row.settings_version
        : Number(row.settings_version) || 1,
    testPresets: Array.isArray(row.test_presets) ? row.test_presets : [],
    test_presets: Array.isArray(row.test_presets) ? row.test_presets : [],
    // Aliases for clients that still read snake_case from GET /users/:id
    avatar_url: avatarUrl,
    phone: (row.phone as string | undefined) || undefined,
    first_name: (row.first_name as string | undefined) || undefined,
    last_name: (row.last_name as string | undefined) || undefined,
    // Academic identity (20260822130000). Absent columns (migration not yet
    // applied) read as null so clients always see the keys.
    institutionId: (row.institution_id as string | null | undefined) ?? null,
    faculty: (row.faculty as string | null | undefined) ?? null,
    programme: (row.programme as string | null | undefined) ?? null,
    studyLevel: toNullableInt(row.study_level),
    // 20260830090000. Absent column (migration unapplied) reads as null.
    currentSemester: toNullableInt(row.current_semester),
    entryYear: toNullableInt(row.entry_year),
    expectedGraduationYear: toNullableInt(row.expected_graduation_year),
    // Creator identity (20260823123000). Read back so "Edit bio" can prefill
    // and the profile can render it; verification_level drives the Verified badge.
    bio: (row.bio as string | null | undefined) ?? null,
    verificationLevel: toNullableInt(row.verification_level) ?? 0,
  };
  return mapped as User;
}

function toNullableInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildProfileUpsertRow(
  profile: Partial<User> & {
    first_name?: string;
    last_name?: string;
    username?: string;
    phone?: string;
    avatar_url?: string;
  },
  options?: { allowGamificationFields?: boolean },
): Record<string, unknown> {
  const allowGamification = options?.allowGamificationFields === true;
  const row: Record<string, unknown> = {
    id: profile.id,
    name: profile.name,
    avatar_url: profile.avatarUrl ?? profile.avatar_url,
    phone: profile.phoneNumber ?? profile.phone,
    points: allowGamification ? (profile.points ?? 0) : 0,
    stats: allowGamification ? (profile.stats ?? {}) : {},
    badges: allowGamification ? (profile.badges ?? []) : [],
    settings: profile.settings ?? {},
    username: profile.username ?? undefined,
    first_name: profile.firstName ?? profile.first_name ?? undefined,
    last_name: profile.lastName ?? profile.last_name ?? undefined,
  };
  if (profile.email) {
    row.email = profile.email;
  }
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  );
}

/**
 * Course reference carried on test/bundle payloads: top-level `courseId` wins,
 * else `config.courseId`. Anything that is not a UUID is ignored (null).
 */
const COURSE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function resolveCourseIdFromConfigLike(
  payload: { courseId?: unknown; config?: { courseId?: unknown } | null } | null | undefined,
): string | null {
  const candidate = payload?.courseId ?? payload?.config?.courseId ?? null;
  return typeof candidate === "string" && COURSE_UUID_RE.test(candidate)
    ? candidate
    : null;
}

/**
 * Topic reference on the same payloads. Returned RAW, unlike the course above:
 * a topic id we cannot use must 400 in resolveForArtefact, not quietly vanish
 * into an artefact the student thinks they filed.
 */
function resolveTopicIdFromConfigLike(
  payload: { topicId?: unknown; config?: { topicId?: unknown } | null } | null | undefined,
): unknown {
  if (payload?.topicId !== undefined) return payload.topicId;
  return payload?.config?.topicId;
}

/**
 * `topicId` rides on an artefact only once the column exists: absent means
 * "topics are not available yet", null means "no topic". Same rule as
 * LibrarySearchResult.topicId, so a client has one thing to branch on.
 */
function topicIdOf(row: any): { topicId?: string | null } {
  return row && typeof row === "object" && "topic_id" in row
    ? { topicId: row.topic_id ?? null }
    : {};
}

/** A topic filter only narrows a query when it names one; none/invalid do not. */
const topicFilterApplies = (filter: CourseFilter | undefined): boolean =>
  filter?.kind === "course" || filter?.kind === "unfiled";

/**
 * Run a write, retrying it without `topic_id` when that column is not there
 * yet (20260826120000 unapplied). Nothing can hold a topic before the
 * migration — resolveForArtefact rejects every id — so the only value that can
 * reach here is a clear, and clearing a column that does not exist is a no-op.
 * A missing topic must never fail the note/deck/test/listing it rode in on.
 */
async function writeWithTopicFallback(
  run: (payload: Record<string, any>) => PromiseLike<any>,
  payload: Record<string, any>,
): Promise<any> {
  const result = await run(payload);
  if (result?.error && "study_set_id" in payload && isMissingStudySetColumn(result.error)) {
    logger.warn(
      "study_set_id missing — write retried without it (apply 20260911120000_study_sets.sql)",
    );
    const { study_set_id: _droppedSet, ...withoutSet } = payload;
    return writeWithTopicFallback(run, withoutSet);
  }
  if (!result?.error || !("topic_id" in payload) || !isMissingTopicColumn(result.error)) {
    return result;
  }
  logger.warn(
    "topic_id missing — write retried without it (apply 20260826120000_course_topics.sql)",
  );
  const { topic_id: _dropped, ...rest } = payload;
  return run(rest);
}

// ============ MARKETPLACE LISTING WRITE SANITIZERS (mass-assignment guard) ============
// Known listing kinds, mirroring the DB CHECK constraint on
// marketplace_listings.listing_kind (migrations 20260818120000 +
// 20260823120000, which adds 'study_pack').
const KNOWN_LISTING_KINDS = ["single", "bundle", "question_bank", "study_pack"];
const MAX_LISTING_IMAGES = 24;

function marketplaceWriteError(message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = 400;
  return err;
}

/**
 * category_specific_fields is a free-form JSON blob written verbatim from the
 * client. Boost/promotion state (boosted_until, boost_level, …) lives inside it
 * but is server-owned — set only by boostMarketplaceListing after a paid boost
 * credit is consumed, and read as `is_boosted` by the search RPC. Strip any
 * boost-prefixed key a client supplies so nobody can self-mint a free,
 * indefinite boost.
 */
function stripServerOwnedListingFields(
  raw: unknown,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (/^boost/i.test(key)) continue; // boosted_until, boost_level, boost_*
    out[key] = value;
  }
  return out;
}

/** Server-owned boost/promotion keys carried on an existing listing. */
function pickServerOwnedListingFields(
  raw: unknown,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (/^boost/i.test(key)) out[key] = value;
  }
  return out;
}

function sanitizeListingImages(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw marketplaceWriteError("images must be an array of image URLs");
  }
  if (raw.length > MAX_LISTING_IMAGES) {
    throw marketplaceWriteError(
      `A listing can have at most ${MAX_LISTING_IMAGES} images`,
    );
  }
  for (const img of raw) {
    if (typeof img !== "string") {
      throw marketplaceWriteError("Each image must be a string URL");
    }
  }
  return raw as string[];
}

function assertValidListingKind(kind: unknown): void {
  if (kind === undefined || kind === null) return;
  if (typeof kind !== "string" || !KNOWN_LISTING_KINDS.includes(kind)) {
    throw marketplaceWriteError("Invalid listing kind");
  }
}

function assertValidBundleItems(items: unknown): void {
  if (items === undefined || items === null) return;
  if (!Array.isArray(items)) {
    throw marketplaceWriteError("bundle_items must be an array");
  }
}

function assertValidListingQuantity(quantity: unknown): void {
  if (quantity === undefined || quantity === null) return; // null = single/unlimited
  const n = Number(quantity);
  if (!Number.isInteger(n) || n < 0) {
    throw marketplaceWriteError("Quantity must be a whole number of 0 or more");
  }
}

/**
 * 4xx error whose message is written for the seller and safe to return
 * verbatim in production (see clientErrorMessage / the global error handler,
 * which both honour statusCode on operational errors).
 */
function listingStateError(message: string, statusCode: 400 | 403): Error {
  return Object.assign(new PublicError(message), { statusCode });
}

/**
 * Guard for seller-initiated listing edits: moderated listings are read-only,
 * and any requested status change must be a transition the shared lifecycle
 * table (packages/shared/src/marketplace/lifecycle.ts) allows a seller to make.
 * Module-level (not a method) so tests can drive the prototype with a stub.
 */
async function assertSellerListingUpdateAllowed(
  service: { getMarketplaceListingById(id: string): Promise<any> },
  listingId: string,
  nextStatus: unknown,
): Promise<void> {
  const current = await service.getMarketplaceListingById(listingId);
  const currentStatus = current?.status;
  // Unknown row or legacy status: fall through to the update, which returns
  // null / fails exactly as it did before this guard existed.
  if (!isMarketplaceListingStatus(currentStatus)) return;
  if (!isMarketplaceListingEditable(currentStatus)) {
    throw listingStateError(
      currentStatus === "removed_by_admin"
        ? "This listing was removed by Lantern moderation and can no longer be edited."
        : "This listing is suspended by Lantern moderation and cannot be edited until it is restored.",
      403,
    );
  }
  if (nextStatus === undefined || nextStatus === null) return;
  if (!isMarketplaceListingStatus(nextStatus)) {
    throw listingStateError("Unknown listing status", 400);
  }
  const refusal = sellerListingTransitionError(currentStatus, nextStatus);
  if (refusal) throw listingStateError(refusal, 403);
}

/**
 * A source-note title as clients may print it: a non-empty trimmed string, or
 * null. Anything else (undefined, "", a number a bad write left in config)
 * becomes null so no client ever interpolates it into "From undefined".
 */
export function normalizeSourceNoteTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

/**
 * Where a session came from, resolved once here so no client has to know the
 * config key names. Every field is a string or null — never absent — so
 * "From <title>" renders or does not, and never prints "From undefined".
 *
 * Precedence is note → deck → group: a quiz generated from a note that also
 * carries a groupId is a note quiz, because that is the source a student
 * recognises.
 */
export function buildTestProvenance(session: any): {
  noteId: string | null;
  deckId: string | null;
  groupId: string | null;
  title: string | null;
} {
  const config = (session?.config && typeof session.config === "object" ? session.config : {}) as any;
  const noteId = typeof config.sourceNoteId === "string" && config.sourceNoteId ? config.sourceNoteId : null;
  const deckId = typeof config.sourceDeckId === "string" && config.sourceDeckId ? config.sourceDeckId : null;
  const groupId = typeof config.groupId === "string" && config.groupId ? config.groupId : null;
  const title = noteId
    ? normalizeSourceNoteTitle(config.sourceNoteTitle)
    : deckId
      ? normalizeSourceNoteTitle(config.sourceDeckTitle)
      : groupId
        ? normalizeSourceNoteTitle(config.groupName)
        : null;
  return { noteId, deckId, groupId, title };
}

/**
 * Correct / incorrect / unanswered for one stored session row, plus the same
 * split by reported confidence. Never throws and never returns undefined: a
 * session with no questions tallies to all zeroes, which a client can render.
 *
 * Unanswered is its own number on purpose — see `tallyTestAttempt`.
 */
export function buildAttemptTally(session: any) {
  const questions = Array.isArray(session?.questions) ? session.questions : [];
  return tallyTestAttempt(
    questions,
    coerceRawUserAnswers(session?.user_answers ?? session?.userAnswers, questions) as Record<
      string,
      unknown
    >,
  );
}

/**
 * One row of GET /api/v1/tests, as every client reads it.
 *
 * Pure and exported because this shape is a contract, not an implementation
 * detail: mobile's "Available Tests" list reads the FLAT fields and web reads
 * the nested `session`, and a personal test that satisfies only one of them
 * is invisible on the other side.
 */
export function mapTestListRow(session: any, lean: boolean): any {
  const result = Array.isArray(session.test_results)
    ? session.test_results[0]
    : session.test_results;
  const questions = Array.isArray(session.questions)
    ? session.questions
    : [];
  const answers = coerceRawUserAnswers(session.user_answers, questions);
  const answeredCount = Object.keys(answers).length;
  const sessionStatus = session.status ||
    (session.end_time ? "completed" : "in_progress");

  // Fold per-answer timings into a sum and a count. Lean responses drop
  // user_answers, so without these the dashboards cannot compute
  // "Avg / question" or total study time and render a dash. Answers with
  // no recorded time are excluded from both, so the client can divide
  // them directly. Kept as sum+count rather than a pre-divided average so
  // the client can weight correctly when it aggregates across tests.
  let timeSpentSeconds = 0;
  let questionsWithTime = 0;
  for (const answer of Object.values(answers) as any[]) {
    const spent = answer?.timeSpentSeconds ?? answer?.time_spent_seconds;
    if (typeof spent === "number" && Number.isFinite(spent)) {
      timeSpentSeconds += spent;
      questionsWithTime++;
    }
  }

  if (
    lean &&
    (sessionStatus === "paused" || sessionStatus === "in_progress")
  ) {
    return {
      id: session.id,
      sessionKind: session.session_kind || "test",
      status: sessionStatus,
      title:
        session.title ||
        session.config?.groupName ||
        (session.session_kind === "study" ? "Study session" : "Test"),
      answeredCount,
      totalQuestions: questions.length,
      currentQuestionIndex: session.current_question_index || 0,
      remainingTimeSeconds: session.remaining_time_seconds ?? null,
      startTime: session.start_time || new Date().toISOString(),
      updatedAt: session.updated_at || session.start_time || new Date().toISOString(),
      pausedAt: session.paused_at ?? null,
      groupId: session.config?.groupId ?? null,
      sourceNoteId: session.config?.sourceNoteId ?? null,
      sourceNoteTitle: normalizeSourceNoteTitle(session.config?.sourceNoteTitle),
      provenance: buildTestProvenance(session),
    };
  }

  // A launchable test: unfinished and carrying questions — exactly what the
  // mobile "Available Tests" tab lists.
  const launchable = !session.end_time && questions.length > 0;

  return {
    id: session.id,
    // --- Flat mirror: the "Available Tests" contract ---------------------
    //
    // The nested `session` below is what web reads. Mobile reads the FLAT row
    // — `t.questions`, `t.config`, `t.end_time` — so every personal test was
    // filtered out before it was ever drawn: its questions sat one level in,
    // `questions.length` was 0, and a quiz saved from a note appeared nowhere
    // while "No Tests Available" stayed on screen. Same data, one more shape.
    //
    // `questions` is mirrored ONLY for a launchable session; a page of
    // completed history would otherwise carry every question twice.
    config: session.config || {},
    questions: lean || !launchable ? [] : questions,
    title:
      session.title ||
      session.config?.name ||
      session.config?.title ||
      null,
    status: sessionStatus,
    /** What a client may DO with it, independent of the db status. */
    availability: launchable
      ? sessionStatus === "paused"
        ? "paused"
        : "available"
      : session.end_time
        ? "completed"
        : "empty",
    session_kind: session.session_kind || "test",
    sessionKind: session.session_kind || "test",
    questionCount: questions.length || session.config?.numberOfQuestions || 0,
    /** Provenance for a quiz generated from a note (config.sourceNoteId). */
    sourceNoteId: session.config?.sourceNoteId ?? null,
    /**
     * The note's own title, persisted into config at creation and backfilled
     * on read when absent. The list prints "From <title>" under a note quiz,
     * so a missing field rendered the literal "From undefined" on device
     * (build 159). Always a string or null — never absent, never undefined.
     */
    sourceNoteTitle: normalizeSourceNoteTitle(session.config?.sourceNoteTitle),
    sourceDeckId: session.config?.sourceDeckId ?? null,
    sourceDeckTitle: normalizeSourceNoteTitle(session.config?.sourceDeckTitle),
    sourceJobId: session.config?.sourceJobId ?? null,
    /** @see buildTestProvenance — one object instead of four config lookups. */
    provenance: buildTestProvenance(session),
    start_time: session.start_time ?? null,
    end_time: session.end_time ?? null,
    // test_sessions has no `created_at` column: `start_time` (DEFAULT NOW()
    // on insert) is the row's creation date and what the list sorts by. Named
    // `created_at` because that is the field shipped clients read.
    created_at: session.start_time ?? session.updated_at ?? null,
    updated_at: session.updated_at ?? null,
    // ---------------------------------------------------------------
    session: {
      id: session.id,
      config: session.config || {},
      questions: lean ? [] : questions,
      userAnswers: lean ? {} : answers,
      currentQuestionIndex: session.current_question_index || 0,
      startTime: session.start_time
        ? new Date(session.start_time)
        : new Date(),
      endTime: session.end_time
        ? new Date(session.end_time)
        : undefined,
      isOffline: session.is_offline || false,
      sessionKind: session.session_kind || "test",
      status: sessionStatus,
      title: session.title || undefined,
      updatedAt: session.updated_at || undefined,
      pausedAt: session.paused_at || undefined,
      remainingTime: session.remaining_time_seconds ?? undefined,
    },
    score: result?.score || 0,
    totalQuestions:
      result?.total_questions ||
      questions.length ||
      0,
    correctAnswersCount: result?.correct_answers_count || 0,
    timeSpentSeconds,
    questionsWithTime,
  };
}

/**
 * A live community mute (20260908120000) blocks EVERY write into that
 * community — a board post, a board comment, a repost, the lounge and every
 * text channel — because all of them arrive at `sendMessage` /
 * `createBoardRepost` with a `communityId` from `resolveBoardContext`.
 * Reading is never blocked. Zero queries while the migration is unapplied,
 * one membership read after it.
 *
 * A module-level function, not a method: the board test harnesses call the
 * prototype on a bare object, and a check that a harness can forget to stub
 * is a check that is silently missing in the test.
 *
 * Throws a 403 with the same copy both clients show on a disabled composer,
 * so a stale client that still lets a muted member type gets the same
 * sentence the fresh one shows up front.
 */
async function assertNotMutedInCommunity(
  db: unknown,
  userId: string,
  communityId: string | null,
): Promise<void> {
  if (!communityId) return;
  if (!(await hasCommunityMemberMute(db))) return;
  const { data, error } = await (db as any)
    .from("community_members")
    .select("muted_until")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .is("opted_out_at", null)
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error)) {
      markCommunityMemberMuteMissing();
      return;
    }
    throw error;
  }
  const mutedUntil = (data as { muted_until?: string | null } | null)?.muted_until ?? null;
  if (isCommunityMemberMuted(mutedUntil)) {
    throw Object.assign(new Error(COMMUNITY_MODERATION_COPY.mutedTitle), {
      statusCode: 403,
    });
  }
}

export class SupabaseService {
  private supabase;
  private supabaseUrl: string;
  private static readonly DEFAULT_GROUP_PAGE_SIZE = 20;
  private static readonly MAX_GROUP_PAGE_SIZE = 50;
  private static readonly DEFAULT_DECK_PAGE_SIZE = 20;
  private static readonly MAX_DECK_PAGE_SIZE = 50;
  private static readonly DEFAULT_FLASHCARD_PAGE_SIZE = 50;
  private static readonly MAX_FLASHCARD_PAGE_SIZE = 100;
  private static readonly DEFAULT_MESSAGE_PAGE_SIZE = 50;
  private static readonly MAX_MESSAGE_PAGE_SIZE = 100;

  private getResponseProfile(profile?: string): "compact" | "full" {
    return profile === "compact" ? "compact" : "full";
  }

  /** Rewrite legacy localhost:54321 storage URLs to the configured Supabase URL. */
  private normalizeStorageUrl(url: string): string {
    if (!url) return url;
    const base = this.supabaseUrl.replace(/\/$/, "");
    return url.replace(/https?:\/\/(localhost|127\.0\.0\.1):54321/gi, base);
  }

  resolveStorageReference(
    bucket?: string,
    path?: string,
    url?: string,
  ): { bucket: string; path: string } | null {
    if (bucket && path) return { bucket, path };
    if (!url) return null;
    const parsed = parseStorageObjectUrl(this.normalizeStorageUrl(url));
    return parsed;
  }

  async createSignedStorageUrl(
    bucket: string,
    path: string,
    expiresInSeconds = 60 * 60 * 24,
  ): Promise<string> {
    if (!isPrivateStorageBucket(bucket)) {
      throw new Error(
        "Signing is only allowed for known private storage buckets",
      );
    }
    if (
      !path ||
      path.includes("..") ||
      path.startsWith("/") ||
      path.includes("\\")
    ) {
      throw new Error("Invalid storage path");
    }
    const ttl = clampSignedUrlTtl(expiresInSeconds);
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(path, ttl);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message || "Failed to create signed URL");
    }
    return this.normalizeStorageUrl(data.signedUrl);
  }

  /**
   * Sign a storage object for display. When variant is `thumb`, prefer the
   * sibling `<path>.thumb.webp` and fall back to the original if missing.
   * ACL checks must always use the original path.
   */
  async createSignedStorageUrlWithVariant(
    bucket: string,
    path: string,
    expiresInSeconds = 60 * 60 * 24,
    variant: "thumb" | "original" = "original",
  ): Promise<string> {
    if (variant !== "thumb") {
      return this.createSignedStorageUrl(bucket, path, expiresInSeconds);
    }
    const ttl = clampSignedUrlTtl(expiresInSeconds);
    const thumbPath = storageThumbPath(path);
    try {
      const { data, error } = await this.supabase.storage
        .from(bucket)
        .createSignedUrls([thumbPath, path], ttl);
      if (!error && data) {
        const thumbResult = data[0];
        const originalResult = data[1];
        const signedUrl =
          (thumbResult && !thumbResult.error && thumbResult.signedUrl) ||
          (originalResult && !originalResult.error && originalResult.signedUrl) ||
          null;
        if (signedUrl) return this.normalizeStorageUrl(signedUrl);
      }
    } catch {
      // Fall through to original-only sign.
    }
    return this.createSignedStorageUrl(bucket, path, expiresInSeconds);
  }

  /**
   * Batch sign display URLs. When variant is `thumb`, prefers sibling thumbs
   * with original fallback (same pattern as marketplace compact cards).
   */
  async signStorageDisplayUrls(
    refs: Array<{ bucket: string; path: string; index: number }>,
    options?: {
      expiresInSeconds?: number;
      variant?: "thumb" | "original";
    },
  ): Promise<Map<number, string>> {
    const ttl = clampSignedUrlTtl(options?.expiresInSeconds);
    const variant = options?.variant || "original";
    const signedByIndex = new Map<number, string>();
    const byBucket = new Map<string, Array<{ index: number; path: string }>>();
    for (const ref of refs) {
      if (!ref.bucket || !ref.path || !isPrivateStorageBucket(ref.bucket)) continue;
      const group = byBucket.get(ref.bucket) || [];
      group.push({ index: ref.index, path: ref.path });
      byBucket.set(ref.bucket, group);
    }

    for (const [bucket, items] of byBucket) {
      try {
        const paths =
          variant === "thumb"
            ? items.flatMap((item) => [storageThumbPath(item.path), item.path])
            : items.map((item) => item.path);
        const { data, error } = await this.supabase.storage
          .from(bucket)
          .createSignedUrls(paths, ttl);
        if (error || !data) continue;
        if (variant === "thumb") {
          items.forEach((item, i) => {
            const thumbResult = data[i * 2];
            const originalResult = data[i * 2 + 1];
            const signedUrl =
              (thumbResult && !thumbResult.error && thumbResult.signedUrl) ||
              (originalResult &&
                !originalResult.error &&
                originalResult.signedUrl) ||
              null;
            if (signedUrl) {
              signedByIndex.set(item.index, this.normalizeStorageUrl(signedUrl));
            }
          });
        } else {
          items.forEach((item, i) => {
            const result = data[i];
            if (result && !result.error && result.signedUrl) {
              signedByIndex.set(
                item.index,
                this.normalizeStorageUrl(result.signedUrl),
              );
            }
          });
        }
      } catch {
        // Bucket publicly readable or transient error; callers fall back to unsigned URLs.
      }
    }
    return signedByIndex;
  }

  async signStorageDisplayUrl(
    url: string,
    expiresInSeconds = 60 * 60 * 24,
    variant: "thumb" | "original" = "original",
  ): Promise<string> {
    if (!url || url.startsWith("data:")) return url;
    const parsed = parseStorageObjectUrl(this.normalizeStorageUrl(url));
    // Unknown / non-private buckets: never mint service-role signed URLs for them.
    if (!parsed || !isPrivateStorageBucket(parsed.bucket)) {
      return this.normalizeStorageUrl(url);
    }
    return this.createSignedStorageUrlWithVariant(
      parsed.bucket,
      parsed.path,
      expiresInSeconds,
      variant,
    );
  }

  async canAccessStorageObject(
    userId: string | null,
    bucket: string,
    path: string,
  ): Promise<boolean> {
    // SEC-05: deny-by-default — never grant access to unknown / non-allowlisted buckets.
    if (!isPrivateStorageBucket(bucket)) return false;
    if (
      !path ||
      path.includes("..") ||
      path.startsWith("/") ||
      path.includes("\\")
    ) {
      return false;
    }

    const parts = path.split("/").filter(Boolean);
    const ownerId = parts[0];
    if (!ownerId) return false;
    if (userId && ownerId === userId) return true;

    if (bucket === "marketplace-images") {
      if (parts[1] === "listings" && parts[2]) {
        const listingId = parts[2];
        const { data } = await this.supabase
          .from("marketplace_listings")
          .select("id, status, user_id")
          .eq("id", listingId)
          .maybeSingle();
        if (data?.status === "active") return true;
        if (userId && data?.user_id === userId) return true;
      }
      return false;
    }

    if (bucket === "flashcard-images") {
      if (!userId) return false;
      return this.canAccessFlashcardImage(userId, path);
    }

    if (bucket === "question-images") {
      if (!userId) return false;
      return this.canAccessQuestionImage(userId, path);
    }

    if (bucket === "note-files") {
      // Chat attachments: {ownerId}/chat/{groupId}/... or {ownerId}/chat/dm/{threadId}/...
      if (userId && parts[1] === "chat" && parts[2]) {
        if (parts[2] === "dm" && parts[3]) {
          return this.isDmThreadParticipant(parts[3], userId);
        }
        return this.isGroupMember(parts[2], userId);
      }
      return false;
    }

    if (bucket === "profile-avatars") {
      if (!userId) return false;
      // Public/friends visibility, or conversation peers (DM / shared group) for chat bubbles.
      if (await this.isProfileVisibleToViewer(userId, ownerId)) return true;
      return this.canViewPeerChatAvatar(userId, ownerId);
    }

    if (bucket === "job-resumes") {
      // Owner-only here (handled above). Employers reach an applicant's resume
      // through the jobs-board application endpoint, which authorizes against
      // the posting rather than the storage path.
      return false;
    }

    if (bucket === "group-avatars") {
      if (!userId) return false;
      // Paths are {groupId}/avatar-...
      const groupId = parts[0];
      if (!groupId) return false;
      return this.isGroupMember(groupId, userId);
    }

    return false;
  }

  private escapeIlikePattern(value: string): string {
    return value.replace(/[%_\\]/g, "\\$&");
  }

  /** True when stored image_url refers to exactly this storage object (not a substring plant). */
  private storageUrlMatchesObject(
    imageUrl: string | null | undefined,
    bucket: string,
    path: string,
  ): boolean {
    if (!imageUrl) return false;
    if (imageUrl === path || imageUrl === `${bucket}/${path}`) return true;
    const parsed = parseStorageObjectUrl(imageUrl);
    return !!parsed && parsed.bucket === bucket && parsed.path === path;
  }

  /**
   * True when the user may read a flashcard image.
   * Requires an exact object reference on a deck the user can read, and that the
   * storage path owner is authorized to edit that deck (blocks confused-deputy URL planting).
   */
  private async canAccessFlashcardImage(
    userId: string,
    path: string,
  ): Promise<boolean> {
    const pathOwner = path.split("/")[0];
    if (!pathOwner) return false;

    const escapedPath = this.escapeIlikePattern(path);
    const { data: cards, error } = await this.supabase
      .from("flashcards")
      .select("deck_id, image_url")
      .not("image_url", "is", null)
      .ilike("image_url", `%${escapedPath}%`)
      .limit(50);

    if (error) throw error;
    if (!cards?.length) return false;

    const deckIds = [
      ...new Set(
        cards
          .filter((c) =>
            this.storageUrlMatchesObject(c.image_url, "flashcard-images", path),
          )
          .map((c) => c.deck_id)
          .filter(Boolean),
      ),
    ];

    for (const deckId of deckIds) {
      const canRead = await this.verifyDeckAccess(userId, deckId, "read");
      if (!canRead) continue;
      // Path owner must be an editor/owner of the referencing deck — not merely mentioned in image_url.
      if (await this.verifyDeckAccess(pathOwner, deckId, "edit")) return true;
    }
    return false;
  }

  /**
   * True when the image is on a group message the user can see, and the uploader
   * (path owner) is also a member of that group (blocks URL planting).
   */
  private async canAccessQuestionImage(
    userId: string,
    path: string,
  ): Promise<boolean> {
    const pathOwner = path.split("/")[0];
    if (!pathOwner) return false;

    const escapedPath = this.escapeIlikePattern(path);
    const { data: rows, error } = await this.supabase
      .from("messages")
      .select("group_id, image_url")
      .not("image_url", "is", null)
      .ilike("image_url", `%${escapedPath}%`)
      .limit(50);

    if (error) throw error;
    if (!rows?.length) return false;

    const groupIds = [
      ...new Set(
        rows
          .filter((r) =>
            this.storageUrlMatchesObject(r.image_url, "question-images", path),
          )
          .map((r) => r.group_id)
          .filter(Boolean),
      ),
    ];

    for (const groupId of groupIds) {
      if (!(await this.isGroupMember(groupId, userId))) continue;
      if (await this.isGroupMember(groupId, pathOwner)) return true;
    }
    return false;
  }

  private async normalizeListingRecordAsync(listing: any): Promise<any> {
    const base = this.normalizeListingRecord(listing);
    if (!base || !Array.isArray(base.images)) return base;
    return {
      ...base,
      images: await Promise.all(
        base.images.map((imageUrl: string) =>
          this.signStorageDisplayUrl(imageUrl),
        ),
      ),
    };
  }

  private normalizeListingRecord(listing: any): any {
    if (!listing) return listing;
    const salePrice =
      listing.sale_price != null ? Number(listing.sale_price) : null;
    const onSale =
      salePrice != null &&
      !!listing.sale_ends_at &&
      new Date(listing.sale_ends_at) > new Date();
    const base = !Array.isArray(listing.images)
      ? listing
      : {
          ...listing,
          images: listing.images.map((url: string) =>
            this.normalizeStorageUrl(url),
          ),
        };
    return {
      ...base,
      effective_price: onSale ? salePrice : Number(listing.price) || 0,
      is_on_sale: onSale,
    };
  }

  private normalizeInquiryRecord(inquiry: any): any {
    if (!inquiry) return inquiry;
    return {
      ...inquiry,
      listing: inquiry.listing
        ? this.normalizeListingRecord(inquiry.listing)
        : inquiry.listing,
    };
  }

  private normalizeFavoriteRecord(favorite: any): any {
    if (!favorite) return favorite;
    return {
      ...favorite,
      listing: favorite.listing
        ? this.normalizeListingRecord(favorite.listing)
        : favorite.listing,
    };
  }

  private normalizeOfferRecord(offer: any): any {
    if (!offer) return offer;
    return {
      ...offer,
      listing: offer.listing
        ? this.normalizeListingRecord(offer.listing)
        : offer.listing,
    };
  }

  private normalizeMessageRecord(
    msg: any,
  ): Partial<Message> & { type: "TEXT" | "QUESTION" } {
    const removedAt = msg.removed_at || msg.removedAt || null;
    const isRemoved = !!removedAt;
    const presentationRecord = isRemoved
      ? { ...msg, text: null, question_data: null, image_url: null }
      : msg;
    const parsed = this.parseMessageContent(presentationRecord);
    const imageUrl = presentationRecord.image_url || parsed.imageUrl;
    const type = (parsed.type || msg.type || "TEXT") as "TEXT" | "QUESTION";
    return {
      ...parsed,
      type,
      ...(imageUrl ? { imageUrl: this.normalizeStorageUrl(imageUrl) } : {}),
      editedAt: msg.edited_at || msg.editedAt || undefined,
      removedAt: removedAt || undefined,
      isRemoved,
      // Denormalised emoji counts (20260830120000). Every listing query now
      // SELECTs `reactions`; before it did not, so a freshly loaded board or
      // chat read {} and the counts only appeared after a realtime UPDATE or
      // the viewer's own tap. `normalizeReactions` also absorbs the
      // pre-migration case, where the column is simply absent.
      reactions: normalizeReactions(msg.reactions),
      // Required by the shipped optimistic-send path so a client can match its
      // own pending row to the persisted one instead of rendering it twice.
      clientMessageId: msg.client_message_id ?? msg.clientMessageId ?? undefined,
      // Board columns (20260903120000). Absent — not null — pre-migration, and
      // a removed post shows its tombstone, never its title.
      subject: isRemoved ? null : (msg.subject ?? undefined),
      pinnedAt: msg.pinned_at ?? msg.pinnedAt ?? undefined,
      pinnedBy: msg.pinned_by ?? msg.pinnedBy ?? undefined,
      // Board post kinds (20260908120000). Absent — not null — pre-migration;
      // `normalizeBoardPostKind` reads both as 'discussion'. The removal
      // reason SURVIVES a removal on purpose: it is the tombstone's whole
      // point, unlike the title and body, which are stripped.
      postKind: msg.post_kind ?? msg.postKind ?? undefined,
      removedReason: msg.removed_reason ?? msg.removedReason ?? undefined,
      answeredMessageId:
        msg.answered_message_id ?? msg.answeredMessageId ?? undefined,
      replyToMessageId:
        msg.reply_to_message_id || msg.replyToMessageId || undefined,
      mentionedUserIds:
        msg.mentioned_user_ids || msg.mentionedUserIds || undefined,
      replyTo: msg.replyTo || undefined,
      threadRootId: msg.thread_root_id || msg.threadRootId || undefined,
      replyCount:
        typeof msg.replyCount === "number" ? msg.replyCount : undefined,
      // Board repost hydration (§6.4), attached by attachBoardRepostContext
      // before this maps the row. Absent on chat pages, which never run it.
      repostOf: msg.repostOf ?? undefined,
      repostCount:
        typeof msg.repostCount === "number" ? msg.repostCount : undefined,
      // Peer-upvote progress, attached by attachPeerUpvotes before this maps the
      // row. Absent — not 0 — on paths that do not compute it, so a client can
      // tell "no peers yet" from "this build does not report it".
      peerUpvotes:
        typeof msg.peerUpvotes === "number" ? msg.peerUpvotes : undefined,
      receiptStatus: msg.receiptStatus || undefined,
      seenByCount:
        typeof msg.seenByCount === "number" ? msg.seenByCount : undefined,
      seenByTotal:
        typeof msg.seenByTotal === "number" ? msg.seenByTotal : undefined,
    };
  }

  constructor(config: DatabaseConfig) {
    this.supabaseUrl = config.url;
    this.supabase = createClient(config.url, config.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  // Get the raw Supabase client for direct operations (RPC calls, etc.)
  getClient() {
    return this.supabase;
  }

  // User/Profile Functions
  async fetchUserProfile(userId: string): Promise<User | null> {
    const cacheKey = `user:${userId}:profile`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single();

        if (error) throw error;
        return data;
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  async updateUserProfile(
    userId: string,
    updates: Partial<User>,
  ): Promise<User> {
    const { data, error } = await this.supabase
      .from("profiles")
      .update({
        name: updates.name,
        avatar_url: updates.avatarUrl,
        phone: updates.phoneNumber,
        points: updates.points,
        stats: updates.stats,
        badges: updates.badges,
        settings: updates.settings,
        username: updates.username,
        first_name: updates.firstName,
        last_name: updates.lastName,
      })
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;

    // Invalidate cache
    await cacheService.invalidateUserCache(userId);

    return data;
  }

  async updateExpoPushToken(userId: string, token: string): Promise<void> {
    const { error } = await this.supabase
      .from("profiles")
      .update({ expo_push_token: token })
      .eq("id", userId);

    if (error) throw error;
    await cacheService.invalidateUserCache(userId);
  }

  async clearExpoPushToken(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from("profiles")
      .update({ expo_push_token: null })
      .eq("id", userId);

    if (error) throw error;
    await cacheService.invalidateUserCache(userId);
  }

  private async sendExpoPushForNotification(
    userId: string,
    notification: {
      message: string;
      type?: string;
      link?: string;
      data?: Record<string, unknown>;
    },
  ): Promise<void> {
    const pushTypes = new Set([
      "challenge_invite",
      "challenge_accepted",
      "challenge_result",
      "challenge_opponent_finished",
      "marketplace_inquiry",
      "marketplace_purchase",
      "marketplace_order_update",
      "marketplace_review_prompt",
      "saved_search_match",
      "job_alert",
      "job_application",
      "job_application_status",
      "job_interview",
      "job_interview_response",
      "job_offer",
      "job_offer_response",
      "job_interview_reminder",
      "job_offer_reminder",
      "group_invite",
      "group_message",
      "badge_unlock",
      "test_result",
      "srs_reminder",
      "dm_message",
      // Jobs-board alert family: saved-search matches and pipeline reminders.
      // Settings policy still applies per user (pushEnabled + marketplaceUpdates).
      "job_alert",
      "job_interview_reminder",
      "job_offer_reminder",
    ]);
    if (notification.type && !pushTypes.has(notification.type)) return;

    try {
      const { data: profile, error } = await this.supabase
        .from("profiles")
        .select("expo_push_token, settings")
        .eq("id", userId)
        .single();

      if (error || !profile?.expo_push_token) return;

      const { shouldSendExpoPush } =
        await import("../utils/userSettingsPolicy");
      if (!shouldSendExpoPush(profile.settings, notification.type)) return;

      const token = profile.expo_push_token as string;
      if (!token.startsWith("ExponentPushToken")) return;

      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: token,
          title: "Lantern Study",
          body: notification.message,
          data: {
            type: notification.type,
            link: notification.link,
            ...(notification.data || {}),
          },
          sound: "default",
        }),
      });
    } catch (err) {
      logger.warn("Expo push notification failed", { userId, err });
    }
  }

  async createUserProfile(
    profile: Partial<User> & {
      first_name?: string;
      last_name?: string;
      username?: string;
      phone?: string;
      avatar_url?: string;
    },
  ): Promise<User> {
    const row = buildProfileUpsertRow(profile);
    const { data, error } = await this.supabase
      .from("profiles")
      .upsert(row, { onConflict: "id" })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // New User Methods for API Routes
  async getUsers(
    options: { page?: number; limit?: number; search?: string } = {},
  ): Promise<User[]> {
    const { page = 1, limit = 20, search } = options;
    const offset = (page - 1) * limit;

    let query = this.supabase
      .from("profiles")
      .select("*")
      .range(offset, offset + limit - 1);

    if (search) {
      // Search by name, email, or username
      const escaped = search.replace(/%/g, "\\%").replace(/_/g, "\\_");
      const pattern = `%${escaped}%`;
      query = query.or(
        `name.ilike.${pattern},email.ilike.${pattern},username.ilike.${pattern}`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    return data || [];
  }

  async getUserById(userId: string): Promise<User | null> {
    const cacheKey = `user:${userId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null; // Not found
          throw error;
        }

        return mapProfileRowToUser(data as Record<string, unknown>);
      },
      { ttl: 600 },
    ); // Cache for 10 minutes
  }

  async isProfileVisibleToViewer(
    viewerId: string,
    targetId: string,
  ): Promise<boolean> {
    if (viewerId === targetId) return true;
    const { data, error } = await this.supabase.rpc(
      "profile_visible_to_viewer",
      {
        viewer_id: viewerId,
        target_id: targetId,
      },
    );
    if (error) throw error;
    return data === true;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    return mapProfileRowToUser(data as Record<string, unknown>);
  }

  /**
   * Resolve a UUID, @username, email, or display name to a profile id.
   * SEC-06: resolution failures use one generic message (no email/ID existence leak).
   */
  async resolveCollaboratorUserId(identifier: string): Promise<string> {
    const trimmed = identifier.trim();
    const notFound = () => {
      const err = new Error(
        "Unable to add that collaborator. Check the @username and try again.",
      ) as Error & { code?: string };
      err.code = "collaborator_not_found";
      throw err;
    };

    if (!trimmed) {
      const err = new Error(
        "Enter a @username to add a collaborator.",
      ) as Error & { code?: string };
      err.code = "collaborator_invalid";
      throw err;
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(trimmed)) {
      const user = await this.getUserById(trimmed);
      if (!user) notFound();
      return user!.id;
    }

    // Email lookups must not reveal whether the address is registered (SEC-06).
    if (trimmed.includes("@") && trimmed.includes(".")) {
      const user = await this.getUserByEmail(trimmed);
      if (!user) notFound();
      return user!.id;
    }

    const username = trimmed.replace(/^@/, "").toLowerCase();
    const { data: byUsername, error: usernameError } = await this.supabase
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (usernameError) throw usernameError;
    if (byUsername?.id) return byUsername.id;

    const matches = await this.getUsers({ search: trimmed, limit: 5 });
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
      const err = new Error(
        "Multiple users match that name. Use an exact @username instead.",
      ) as Error & { code?: string };
      err.code = "collaborator_ambiguous";
      throw err;
    }

    notFound();
    return ""; // unreachable
  }

  async createUser(
    userData: Partial<User> & {
      first_name?: string;
      last_name?: string;
      username?: string;
      phone?: string;
      avatar_url?: string;
    },
  ): Promise<User> {
    const row = buildProfileUpsertRow(userData);
    const { data, error } = await this.supabase
      .from("profiles")
      .upsert(row, { onConflict: "id" })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  private async invalidateProfilePresentationCaches(
    userId: string,
  ): Promise<void> {
    const { data: memberships, error } = await this.supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", userId)
      .eq("pending", false);

    if (error) {
      logger.warn(
        "Could not resolve profile group caches; invalidating globally",
        {
          userId,
          error,
        },
      );
      await Promise.all([
        cacheService.deletePattern("group:members:*"),
        cacheService.deletePattern("messages:group:*"),
        cacheService.deletePattern("group:*:messages"),
      ]);
      return;
    }

    const groupIds = [
      ...new Set(
        (memberships || [])
          .map(
            (membership: { group_id?: string | null }) => membership.group_id,
          )
          .filter((groupId): groupId is string => Boolean(groupId)),
      ),
    ];
    await Promise.all(
      groupIds.map((groupId) => cacheService.invalidateGroupCache(groupId)),
    );
  }

  async updateUser(
    userId: string,
    updates: Partial<User> & {
      avatar_url?: string;
      phone?: string;
      first_name?: string;
      last_name?: string;
      test_presets?: any[];
    },
    options: { expectedSettingsVersion?: number } = {},
  ): Promise<User | null> {
    // Build update object, handling both camelCase and snake_case keys
    const updateData: any = {};

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.avatarUrl !== undefined)
      updateData.avatar_url = updates.avatarUrl;
    if (updates.avatar_url !== undefined)
      updateData.avatar_url = updates.avatar_url;
    if (updates.phoneNumber !== undefined)
      updateData.phone = updates.phoneNumber;
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.username !== undefined) updateData.username = updates.username;
    if (updates.firstName !== undefined)
      updateData.first_name = updates.firstName;
    if (updates.first_name !== undefined)
      updateData.first_name = updates.first_name;
    if (updates.lastName !== undefined) updateData.last_name = updates.lastName;
    if (updates.last_name !== undefined)
      updateData.last_name = updates.last_name;
    if (updates.points !== undefined) updateData.points = updates.points;
    if (updates.stats !== undefined) updateData.stats = updates.stats;
    if (updates.badges !== undefined) updateData.badges = updates.badges;
    // Creator bio (Phase 2 · J); normalized + length-checked in routes/users.ts.
    if ((updates as { bio?: string | null }).bio !== undefined)
      updateData.bio = (updates as { bio?: string | null }).bio ?? null;
    // Academic identity columns (validated + institution-checked in routes/users.ts).
    if (updates.institutionId !== undefined)
      updateData.institution_id = updates.institutionId || null;
    if (updates.faculty !== undefined) updateData.faculty = updates.faculty || null;
    if (updates.programme !== undefined)
      updateData.programme = updates.programme || null;
    if (updates.studyLevel !== undefined)
      updateData.study_level = updates.studyLevel ?? null;
    if (updates.currentSemester !== undefined)
      updateData.current_semester = updates.currentSemester ?? null;
    if (updates.entryYear !== undefined)
      updateData.entry_year = updates.entryYear ?? null;
    if (updates.expectedGraduationYear !== undefined)
      updateData.expected_graduation_year = updates.expectedGraduationYear ?? null;
    if (updates.settings !== undefined) {
      // Never nest test_presets into the settings JSONB blob.
      const settingsPayload =
        updates.settings &&
        typeof updates.settings === "object" &&
        !Array.isArray(updates.settings)
          ? { ...(updates.settings as Record<string, unknown>) }
          : updates.settings;
      if (
        settingsPayload &&
        typeof settingsPayload === "object" &&
        !Array.isArray(settingsPayload)
      ) {
        delete (settingsPayload as { test_presets?: unknown }).test_presets;
      }
      updateData.settings = settingsPayload;
    }
    // Dedicated column — do not merge into settings JSONB (would wipe other categories).
    if (updates.test_presets !== undefined) {
      updateData.test_presets = Array.isArray(updates.test_presets)
        ? updates.test_presets
        : [];
    }

    let expectedSettingsVersion = options.expectedSettingsVersion;
    if (updateData.settings !== undefined && expectedSettingsVersion == null) {
      const { data: current, error: currentError } = await this.supabase
        .from("profiles")
        .select("settings_version")
        .eq("id", userId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) return null;
      expectedSettingsVersion = Number(current.settings_version) || 1;
    }

    let query = this.supabase
      .from("profiles")
      .update(updateData)
      .eq("id", userId);
    if (updateData.settings !== undefined && expectedSettingsVersion != null) {
      query = query.eq("settings_version", expectedSettingsVersion);
    }

    const { data, error } = await query.select().maybeSingle();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    if (!data) {
      if (updateData.settings !== undefined) {
        const current = await this.getUserById(userId);
        throw new VersionConflictError(
          "Settings were updated on another device. Refresh and try again.",
          current,
        );
      }
      return null;
    }

    // Invalidate cache (exact user key + pattern)
    await cacheService.invalidateUserCache(userId);
    if (
      Object.prototype.hasOwnProperty.call(updateData, "avatar_url") ||
      Object.prototype.hasOwnProperty.call(updateData, "name") ||
      Object.prototype.hasOwnProperty.call(updateData, "username")
    ) {
      // Group member lists and message responses embed profile presentation fields.
      await this.invalidateProfilePresentationCaches(userId);
    }

    return mapProfileRowToUser(data as Record<string, unknown>);
  }

  async deleteUser(userId: string): Promise<boolean> {
    const { deleteUserAccountFully } = await import("./userDataLifecycle");
    return deleteUserAccountFully(this, userId);
  }

  async exportUserData(userId: string): Promise<Record<string, unknown>> {
    const { exportUserDataArchive } = await import("./userDataLifecycle");
    const { wrapSignedExport } = await import("./accountExportSign");
    const archive = await exportUserDataArchive(this, userId);
    let sourceEmail: string | null = null;
    try {
      const { data: authUser } =
        await this.supabase.auth.admin.getUserById(userId);
      sourceEmail = authUser?.user?.email ?? null;
    } catch {
      sourceEmail = null;
    }
    return wrapSignedExport({
      sourceUserId: userId,
      sourceEmail,
      data: archive,
    }) as unknown as Record<string, unknown>;
  }

  /** @deprecated use deleteUser — kept for internal reference */
  async deleteUserProfileOnly(userId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from("profiles")
      .delete()
      .eq("id", userId);

    if (error) throw error;

    // Invalidate cache
    await cacheService.invalidateUserCache(userId);

    return true;
  }

  async getUserStats(userId: string): Promise<any> {
    const cacheKey = `user:stats:${userId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        // Get user profile for basic stats
        const user = await this.getUserById(userId);
        if (!user) return null;

        // Get additional stats from related tables
        const { data: groupCount, error: groupError } = await this.supabase
          .from("group_members")
          .select("group_id", { count: "exact" })
          .eq("user_id", userId);

        const { data: messageCount, error: messageError } = await this.supabase
          .from("messages")
          .select("id", { count: "exact" })
          .eq("sender_id", userId);

        const { data: testResults, error: testError } = await this.supabase
          .from("test_sessions")
          .select("score")
          .eq("user_id", userId);

        if (groupError || messageError || testError) {
          throw groupError || messageError || testError;
        }

        const avgScore =
          testResults && testResults.length > 0
            ? testResults.reduce(
                (sum, result) => sum + (result.score || 0),
                0,
              ) / testResults.length
            : 0;

        return {
          userId,
          points: user.points || 0,
          groupsCount: groupCount?.length || 0,
          messagesCount: messageCount?.length || 0,
          testsTaken: testResults?.length || 0,
          averageScore: Math.round(avgScore * 100) / 100,
          badges: user.badges || [],
          stats: user.stats || {},
        };
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  async getUserGroups(
    userId: string,
    options: { page?: number; limit?: number } = {},
  ): Promise<Group[]> {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `user:groups:${userId}:${page}:${limit}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("group_members")
          .select(
            `
          groups (
            id,
            name,
            avatar_url,
            description,
            last_message,
            last_message_time,
            admin_ids,
            permissions,
            parent_id,
            is_archived,
            invite_id,
            course_id,
            created_at
          )
        `,
          )
          .eq("user_id", userId)
          .range(offset, offset + limit - 1);

        if (error) throw error;
        return data?.map((item: any) => item.groups).filter(Boolean) || [];
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  // Group Methods for API Routes
  async getGroups(
    options: {
      page?: number;
      limit?: number;
      search?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      userId?: string;
      responseProfile?: "compact" | "full";
    } = {},
  ): Promise<Group[]> {
    const {
      page = 1,
      limit = SupabaseService.DEFAULT_GROUP_PAGE_SIZE,
      search,
      sortBy = "created_at",
      sortOrder = "desc",
      userId,
      responseProfile = "full",
    } = options;
    const profile = this.getResponseProfile(responseProfile);
    const safeLimit = Math.min(
      SupabaseService.MAX_GROUP_PAGE_SIZE,
      Math.max(1, limit),
    );
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * safeLimit;

    const cacheKey = `groups:list:${safePage}:${safeLimit}:${search || ""}:${sortBy}:${sortOrder}:${userId || ""}:profile:${profile}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        // community_surface rides along on BOTH profiles: the chat list
        // filters boards out of Chat with it (spec §4.5), and the compact
        // profile is exactly what that list fetches.
        const baseClause =
          profile === "compact"
            ? "id, name, avatar_url, last_message_time, is_archived, community_id"
            : "id, name, description, avatar_url, last_message, last_message_time, admin_ids, permissions, parent_id, is_archived, invite_id, course_id, visibility, community_id, created_at";

        let memberGroupIds: string[] | null = null;
        if (userId) {
          // Only return groups where the user is an active (non-pending) member
          const { data: memberGroups, error: memberError } = await this.supabase
            .from("group_members")
            .select("group_id")
            .eq("user_id", userId)
            .eq("pending", false);

          if (memberError) throw memberError;

          memberGroupIds = memberGroups?.map((mg) => mg.group_id) || [];
          if (memberGroupIds.length === 0) return [];
        }

        const runList = async (selectClause: string) => {
          let query = (this.supabase as any)
            .from("groups")
            .select(selectClause)
            .range(offset, offset + safeLimit - 1);
          if (search) query = query.ilike("name", `%${search}%`);
          if (memberGroupIds) query = query.in("id", memberGroupIds);
          return query.order(sortBy, { ascending: sortOrder === "asc" });
        };

        // The group list is the hottest read in the app: a stale capability
        // probe must degrade it, never 500 it.
        let { data, error } = await runList(
          await groupColumns(this.supabase, baseClause),
        );
        if (error && isMissingColumnError(error)) {
          markGroupCommunitySurfaceMissing();
          ({ data, error } = await runList(baseClause));
        }
        if (error) throw error;

        const groupIds = (data || []).map((item: any) => item.id);
        const memberCounts: Record<string, number> = {};

        if (groupIds.length > 0) {
          const { data: memberRows, error: memberCountError } =
            await this.supabase
              .from("group_members")
              .select("group_id")
              .in("group_id", groupIds);

          if (!memberCountError && memberRows) {
            memberRows.forEach((row: { group_id: string }) => {
              memberCounts[row.group_id] =
                (memberCounts[row.group_id] || 0) + 1;
            });
          }
        }

        // Transform snake_case to camelCase
        return (data || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          avatarUrl: item.avatar_url,
          lastMessage: item.last_message,
          lastMessageTime: item.last_message_time,
          adminIds: item.admin_ids || [],
          permissions: item.permissions || {},
          parentId: item.parent_id,
          isArchived: item.is_archived,
          inviteId: item.invite_id,
          courseId: item.course_id ?? null,
          visibility: item.visibility || "private",
          communityId: item.community_id ?? null,
          communitySurface: item.community_surface ?? null,
          createdAt: item.created_at,
          memberCount: memberCounts[item.id] || 0,
        })) as Group[];
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  /**
   * Every column a group row carries on the wire. `community_surface` is
   * appended only once 20260903120000 is applied — pre-migration the column
   * does not exist and NULL (= board) is the right answer anyway.
   */
  private static readonly GROUP_COLUMNS_BASE =
    "id, name, description, avatar_url, last_message, last_message_time, admin_ids, permissions, parent_id, is_archived, invite_id, course_id, visibility, community_id, created_at";

  async getGroupById(groupId: string, userId?: string): Promise<Group | null> {
    const base = SupabaseService.GROUP_COLUMNS_BASE;
    if (!userId) {
      const readOne = (columns: string) =>
        (this.supabase as any)
          .from("groups")
          .select(columns)
          .eq("id", groupId)
          .maybeSingle();
      let { data, error } = await readOne(await groupColumns(this.supabase, base));
      if (error && isMissingColumnError(error)) {
        markGroupCommunitySurfaceMissing();
        ({ data, error } = await readOne(base));
      }
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        name: data.name,
        description: data.description,
        avatarUrl: data.avatar_url,
        lastMessage: data.last_message,
        lastMessageTime: data.last_message_time,
        adminIds: data.admin_ids || [],
        permissions: data.permissions || {},
        parentId: data.parent_id,
        isArchived: data.is_archived,
        inviteId: data.invite_id,
        courseId: data.course_id ?? null,
        visibility: (data as { visibility?: string }).visibility || "private",
        communityId: (data as { community_id?: string | null }).community_id ?? null,
        communitySurface:
          (data as { community_surface?: "board" | "study_group" | null })
            .community_surface ?? null,
        createdAt: data.created_at,
      } as Group;
    }

    const cacheKey = `group:${groupId}:user:${userId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const readOne = (columns: string) =>
          (this.supabase as any)
            .from("groups")
            .select(columns)
            .eq("id", groupId)
            .single();
        let { data, error } = await readOne(await groupColumns(this.supabase, base));
        if (error && isMissingColumnError(error)) {
          markGroupCommunitySurfaceMissing();
          ({ data, error } = await readOne(base));
        }

        if (error) {
          if (error.code === "PGRST116") return null; // Not found
          throw error;
        }

        // Check if user has active (non-pending) membership
        if (userId) {
          const { data: membership, error: memberError } = await this.supabase
            .from("group_members")
            .select("user_id, pending")
            .eq("group_id", groupId)
            .eq("user_id", userId)
            .single();

          if (memberError && memberError.code !== "PGRST116") throw memberError;
          if (!membership || membership.pending === true) return null;
        }

        // Transform snake_case to camelCase
        return {
          id: data.id,
          name: data.name,
          description: data.description,
          avatarUrl: data.avatar_url,
          lastMessage: data.last_message,
          lastMessageTime: data.last_message_time,
          adminIds: data.admin_ids || [],
          permissions: data.permissions || {},
          parentId: data.parent_id,
          isArchived: data.is_archived,
          inviteId: data.invite_id,
          courseId: data.course_id ?? null,
          visibility: (data as { visibility?: string }).visibility || "private",
          communityId: (data as { community_id?: string | null }).community_id ?? null,
          communitySurface:
            (data as { community_surface?: "board" | "study_group" | null })
              .community_surface ?? null,
          createdAt: data.created_at,
        } as Group;
      },
      { ttl: 600 },
    ); // Cache for 10 minutes
  }

  async createGroup(
    groupData: Partial<Group>,
    userId: string,
    memberIds: string[] = [],
  ): Promise<Group> {
    const discovery = resolveGroupDiscovery({
      visibility: groupData.visibility,
      communityId: groupData.communityId,
    });
    /**
     * Which surface this group renders as inside its community. Only
     * meaningful with a community_id, and only written once the column
     * exists — pre-migration NULL means board, which is the default anyway,
     * and 'study_group' is refused at the route with a 503 (spec §3.1).
     */
    const surface: "board" | "study_group" | null = discovery.communityId
      ? groupData.communitySurface === "study_group"
        ? "study_group"
        : "board"
      : null;
    const baseInsert: Record<string, unknown> = {
      name: groupData.name,
      description: groupData.description,
      avatar_url: groupData.avatarUrl,
      admin_ids: [userId],
      permissions: groupData.permissions || {},
      invite_id: groupData.inviteId,
      parent_id: groupData.parentId,
      course_id: groupData.courseId || null,
      visibility: discovery.visibility,
      community_id: discovery.communityId,
      is_archived: false,
    };
    const insertGroup = (row: Record<string, unknown>) =>
      (this.supabase as any).from("groups").insert(row).select().single();
    const withSurface =
      surface && (await hasGroupCommunitySurface(this.supabase))
        ? { ...baseInsert, community_surface: surface }
        : baseInsert;
    let { data, error } = await insertGroup(withSurface);
    if (error && withSurface !== baseInsert && isMissingColumnError(error)) {
      markGroupCommunitySurfaceMissing();
      ({ data, error } = await insertGroup(baseInsert));
    }

    if (error) throw error;

    // If this is a subgroup, add all parent group members to the subgroup
    const allMemberIds = [userId, ...memberIds];

    if (groupData.parentId) {
      // Fetch parent group members
      const { data: parentMembers, error: parentError } = await this.supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupData.parentId);

      if (!parentError && parentMembers) {
        const parentMemberIds = parentMembers.map((m) => m.user_id);
        // Add parent members that aren't already in the list
        for (const parentMemberId of parentMemberIds) {
          if (!allMemberIds.includes(parentMemberId)) {
            allMemberIds.push(parentMemberId);
          }
        }
      }
    }

    // Creator + inherited parent members join immediately; explicitly invited users stay pending until they accept.
    const explicitInviteSet = new Set(memberIds.filter((id) => id !== userId));
    const membersToInsert = allMemberIds.map((id) => ({
      group_id: data.id,
      user_id: id,
      pending: explicitInviteSet.has(id),
    }));

    const { error: memberError } = await this.supabase
      .from("group_members")
      .insert(membersToInsert);

    if (memberError) throw memberError;

    // Invalidate caches
    await cacheService.invalidateUserCache(userId);
    for (const memberId of memberIds) {
      await cacheService.invalidateUserCache(memberId);
    }
    await cacheService.deletePattern("groups:list:*");

    await this.incrementUserStatsAndAwardBadges(userId, {
      groupsCreated: 1,
    }).catch((err) => {
      logger.warn("Failed to increment groupsCreated gamification", {
        userId,
        err,
      });
    });

    // Transform snake_case to camelCase
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      avatarUrl: data.avatar_url,
      lastMessage: data.last_message,
      lastMessageTime: data.last_message_time,
      adminIds: data.admin_ids || [],
      permissions: data.permissions || {},
      parentId: data.parent_id,
      isArchived: data.is_archived,
      inviteId: data.invite_id,
      courseId: data.course_id ?? null,
      visibility: discovery.visibility,
      communityId: discovery.communityId,
      communitySurface: data.community_surface ?? surface,
      createdAt: data.created_at,
      pendingInviteUserIds: Array.from(explicitInviteSet),
    } as Group & { pendingInviteUserIds?: string[] };
  }

  async updateGroup(
    groupId: string,
    updates: Partial<Group>,
  ): Promise<Group | null> {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.description !== undefined) dbUpdates.description = updates.description;
    if (updates.avatarUrl !== undefined) dbUpdates.avatar_url = updates.avatarUrl;
    if (updates.permissions !== undefined) dbUpdates.permissions = updates.permissions;
    if (updates.inviteId !== undefined) dbUpdates.invite_id = updates.inviteId;
    if (updates.parentId !== undefined) dbUpdates.parent_id = updates.parentId;
    if (updates.isArchived !== undefined) dbUpdates.is_archived = updates.isArchived;
    if (updates.adminIds !== undefined) dbUpdates.admin_ids = updates.adminIds;
    if (updates.courseId !== undefined) dbUpdates.course_id = updates.courseId || null;
    // Phase 3 L discovery fields. A group is private by default; making it
    // discoverable is an explicit, admin-only act.
    if (updates.visibility !== undefined || updates.communityId !== undefined) {
      const discovery = resolveGroupDiscovery({
        visibility: updates.visibility ?? "private",
        communityId: updates.communityId,
      });
      dbUpdates.visibility = discovery.visibility;
      dbUpdates.community_id = discovery.communityId;
    }
    if (updates.tags !== undefined) dbUpdates.tags = Array.isArray(updates.tags) ? updates.tags : [];

    if (Object.keys(dbUpdates).length === 0) {
      return this.getGroupById(groupId);
    }

    const { data, error } = await this.supabase
      .from("groups")
      .update(dbUpdates)
      .eq("id", groupId)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    // Invalidate caches. The board context is keyed outside `group:<id>:*` on
    // purpose (every send would otherwise blow it), so clear it explicitly —
    // moving a group between communities changes its surface.
    await cacheService.invalidateGroupCache(groupId);
    await cacheService.delete(`board:context:${groupId}`);
    await cacheService.deletePattern("groups:list:*");

    // Transform snake_case to camelCase
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      avatarUrl: data.avatar_url,
      lastMessage: data.last_message,
      lastMessageTime: data.last_message_time,
      adminIds: data.admin_ids || [],
      permissions: data.permissions || {},
      parentId: data.parent_id,
      isArchived: data.is_archived,
      inviteId: data.invite_id,
      courseId: data.course_id ?? null,
      visibility: (data as { visibility?: string }).visibility || "private",
      communityId: (data as { community_id?: string | null }).community_id ?? null,
      communitySurface:
        (data as { community_surface?: "board" | "study_group" | null })
          .community_surface ?? null,
      createdAt: data.created_at,
    } as Group;
  }

  async getGroupByInviteId(inviteId: string): Promise<Group | null> {
    const { data, error } = await this.supabase
      .from("groups")
      .select("*")
      .eq("invite_id", inviteId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    return {
      id: data.id,
      name: data.name,
      description: data.description,
      avatarUrl: data.avatar_url,
      lastMessage: data.last_message,
      lastMessageTime: data.last_message_time,
      adminIds: data.admin_ids || [],
      permissions: data.permissions || {},
      parentId: data.parent_id,
      isArchived: data.is_archived,
      inviteId: data.invite_id,
      courseId: data.course_id ?? null,
      createdAt: data.created_at,
    } as Group;
  }

  /**
   * Invite a user into a group. By default creates a pending membership that the
   * invitee must accept. Pass `pending: false` only for invitee-initiated joins
   * (e.g. invite-link Accept) or the group creator.
   */
  async addGroupMember(
    groupId: string,
    userId: string,
    options: { pending?: boolean } = {},
  ): Promise<Group | null> {
    const pending = options.pending !== false;

    const { error: memberError } = await this.supabase
      .from("group_members")
      .insert({
        group_id: groupId,
        user_id: userId,
        pending,
      });

    if (memberError) {
      if (memberError.code === "23505") {
        // Already a row — invite again leaves pending as-is; self-join accepts a pending invite.
        if (!pending) {
          const accepted = await this.acceptGroupInvite(groupId, userId);
          if (accepted) return await this.getGroupById(groupId, userId);
          return await this.getGroupById(groupId, userId);
        }
        return null;
      }
      throw memberError;
    }

    await cacheService.invalidateGroupCache(groupId);
    await cacheService.invalidateUserCache(userId);
    await cacheService.deletePattern("groups:list:*");

    return pending ? null : await this.getGroupById(groupId, userId);
  }

  /** Bulk invite members as pending (invitee must accept). */
  async addGroupMembersBatch(
    groupId: string,
    userIds: string[],
  ): Promise<{
    invited: string[];
    alreadyMembers: string[];
    alreadyPending: string[];
  }> {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if (!uniqueIds.length) {
      return { invited: [], alreadyMembers: [], alreadyPending: [] };
    }

    const { data: existing, error: checkError } = await this.supabase
      .from("group_members")
      .select("user_id, pending")
      .eq("group_id", groupId)
      .in("user_id", uniqueIds);

    if (checkError) throw checkError;

    const alreadyMembers: string[] = [];
    const alreadyPending: string[] = [];
    const existingSet = new Set<string>();
    for (const row of existing || []) {
      existingSet.add(row.user_id);
      if (row.pending === true) alreadyPending.push(row.user_id);
      else alreadyMembers.push(row.user_id);
    }
    const toInvite = uniqueIds.filter((id) => !existingSet.has(id));

    if (toInvite.length) {
      const { error: insertError } = await this.supabase
        .from("group_members")
        .upsert(
          toInvite.map((user_id) => ({
            group_id: groupId,
            user_id,
            pending: true,
          })),
          { onConflict: "group_id,user_id", ignoreDuplicates: true },
        );
      if (insertError) throw insertError;

      await cacheService.invalidateGroupCache(groupId);
      await cacheService.invalidateGlobalCache("groups:list:*");
      for (const memberId of toInvite) {
        await cacheService.invalidateUserCache(memberId);
      }
    }

    return { invited: toInvite, alreadyMembers, alreadyPending };
  }

  async acceptGroupInvite(groupId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("group_members")
      .update({ pending: false, joined_at: new Date().toISOString() })
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .eq("pending", true)
      .select("user_id");

    if (error) throw error;
    if (!data?.length) return false;

    await cacheService.invalidateGroupCache(groupId);
    await cacheService.invalidateUserCache(userId);
    await cacheService.deletePattern("groups:list:*");
    return true;
  }

  async declineGroupInvite(groupId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .eq("pending", true)
      .select("user_id");

    if (error) throw error;
    if (!data?.length) return false;

    await cacheService.invalidateGroupCache(groupId);
    await cacheService.invalidateUserCache(userId);
    await cacheService.deletePattern("groups:list:*");
    return true;
  }

  async getPendingGroupInvitesForUser(userId: string): Promise<
    Array<{
      groupId: string;
      groupName: string;
      avatarUrl?: string;
      invitedAt?: string;
    }>
  > {
    const { data, error } = await this.supabase
      .from("group_members")
      .select("group_id, joined_at, groups(id, name, avatar_url)")
      .eq("user_id", userId)
      .eq("pending", true);

    if (error) throw error;

    return (data || []).map((row: any) => ({
      groupId: row.group_id,
      groupName: row.groups?.name || "Group",
      avatarUrl: row.groups?.avatar_url,
      invitedAt: row.joined_at,
    }));
  }

  async isGroupMember(groupId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("group_members")
      .select("user_id, pending")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") throw error;
    return !!data && data.pending !== true;
  }

  async isDmThreadParticipant(
    threadId: string,
    userId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("dm_threads")
      .select("participant_ids")
      .eq("id", threadId)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    const ids = Array.isArray(data?.participant_ids)
      ? data!.participant_ids
      : [];
    return ids.includes(userId);
  }

  /**
   * A DM message the viewer is allowed to act on: the message must exist and
   * the viewer must be a participant in its thread. Mirrors
   * getAuthorizedGroupMessage so reaction routes can 404 uniformly.
   */
  async getAuthorizedDmMessage(
    messageId: string,
    userId: string,
  ): Promise<{ id: string; threadId: string } | null> {
    const { data, error } = await this.supabase
      .from("dm_messages")
      .select("id, thread_id")
      .eq("id", messageId)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    if (!data) return null;
    const threadId = String((data as any).thread_id);
    const allowed = await this.isDmThreadParticipant(threadId, userId);
    return allowed ? { id: String((data as any).id), threadId } : null;
  }

  /**
   * True when viewer may see peer's profile avatar in chat (DM partner or shared active group),
   * even if the peer's profile visibility is private.
   */
  async canViewPeerChatAvatar(
    viewerId: string,
    peerId: string,
  ): Promise<boolean> {
    if (!viewerId || !peerId || viewerId === peerId) return viewerId === peerId;
    const threadId = [viewerId, peerId].sort().join("-");
    const { data: dm, error: dmError } = await this.supabase
      .from("dm_threads")
      .select("id")
      .eq("id", threadId)
      .maybeSingle();
    if (dmError && dmError.code !== "PGRST116") throw dmError;
    if (dm) return true;

    const { data: shared, error: sharedError } = await this.supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", viewerId)
      .eq("pending", false);
    if (sharedError) throw sharedError;
    const groupIds = (shared || []).map(
      (row: { group_id: string }) => row.group_id,
    );
    if (groupIds.length === 0) return false;

    const { data: peerMembership, error: peerError } = await this.supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", peerId)
      .eq("pending", false)
      .in("group_id", groupIds)
      .limit(1)
      .maybeSingle();
    if (peerError && peerError.code !== "PGRST116") throw peerError;
    return !!peerMembership;
  }

  /**
   * Authorize mutation of a group message. Returns the message row when the user
   * is an active (non-pending) member of its group; otherwise null (treat as not
   * found to avoid IDOR leaks).
   */
  async getAuthorizedGroupMessage(
    messageId: string,
    userId: string,
  ): Promise<{
    id: string;
    group_id: string;
    sender_id: string;
    type: string;
  } | null> {
    const { data, error } = await this.supabase
      .from("messages")
      .select("id, group_id, sender_id, type")
      .eq("id", messageId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") throw error;
    if (!data?.group_id) return null;

    const { data: membership, error: memberError } = await this.supabase
      .from("group_members")
      .select("user_id, pending")
      .eq("group_id", data.group_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (memberError && memberError.code !== "PGRST116") throw memberError;
    if (!membership || membership.pending === true) return null;

    return data;
  }

  async isGroupAdmin(groupId: string, userId: string): Promise<boolean> {
    const group = await this.getGroupById(groupId);
    if (!group) return false;
    return (
      (group.adminIds || []).includes(userId) ||
      !!(group.permissions && group.permissions[userId]?.admin)
    );
  }

  /** Whether an authenticated user may deliver a notification to another user. */
  async canNotifyUser(
    requestingUserId: string,
    targetUserId: string,
    link?: string,
  ): Promise<boolean> {
    if (!link) return false;

    const groupMatch = link.match(/^\/chat\/([0-9a-f-]{36})$/i);
    if (groupMatch) {
      const groupId = groupMatch[1];
      const group = await this.getGroupById(groupId);
      if (!group) return false;

      const isAdmin =
        (group.adminIds || []).includes(requestingUserId) ||
        !!(group.permissions && group.permissions[requestingUserId]?.admin);

      const requesterIsMember = await this.isGroupMember(
        groupId,
        requestingUserId,
      );
      if (!requesterIsMember && !isAdmin) return false;

      if (isAdmin) return true;

      return this.isGroupMember(groupId, targetUserId);
    }

    if (link === "/dashboard" || link.startsWith("/dashboard")) {
      const { data, error } = await this.supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", targetUserId);

      if (error) throw error;
      for (const row of data || []) {
        const group = await this.getGroupById(row.group_id);
        if ((group?.adminIds || []).includes(requestingUserId)) return true;
      }
      return false;
    }

    return false;
  }

  async removeGroupMember(
    groupId: string,
    userId: string,
  ): Promise<Group | null> {
    const group = await this.getGroupById(groupId);

    const { error } = await this.supabase
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", userId);

    if (error) throw error;

    // Keep admin_ids in sync when an admin leaves or is removed.
    if (group?.adminIds?.includes(userId)) {
      const nextAdminIds = group.adminIds.filter((id) => id !== userId);
      const { error: adminError } = await this.supabase
        .from("groups")
        .update({ admin_ids: nextAdminIds })
        .eq("id", groupId);
      if (adminError) throw adminError;
    }

    // Invalidate caches
    await cacheService.invalidateGroupCache(groupId);
    await cacheService.invalidateUserCache(userId);
    await cacheService.deletePattern("groups:list:*");

    return await this.getGroupById(groupId);
  }

  async deleteGroup(groupId: string): Promise<void> {
    // Cascade removes members/messages. Intentionally do NOT purge test_sessions:
    // group id lives in config JSONB with no FK, and product keeps orphan history
    // for the user's Recent Tests (Group performance simply drops missing groups).
    const { error } = await this.supabase
      .from("groups")
      .delete()
      .eq("id", groupId);

    if (error) {
      logger.error(`Error deleting group ${groupId}:`, error);
      throw error;
    }

    logger.info(
      `Group ${groupId} deleted. Members/messages cascaded; test history retained.`,
    );

    // Invalidate relevant caches
    await cacheService.invalidateGroupCache(groupId);
    await cacheService.deletePattern("groups:list:*");
  }

  async getGroupMembers(
    groupId: string,
    options: { page?: number; limit?: number; requestingUserId?: string } = {},
  ): Promise<User[]> {
    const { page = 1, limit = 50, requestingUserId } = options;
    const offset = (page - 1) * limit;

    // SEC-04: partition by viewer; payload stays public-only (phone/settings attached after).
    const cacheKey = `group:members:${groupId}:${page}:${limit}:${requestingUserId || "anon"}`;

    const publicMembers = await cacheService.cached(
      cacheKey,
      async () => {
        const { data: memberData, error: memberError } = await this.supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId)
          .eq("pending", false)
          .range(offset, offset + limit - 1);

        if (memberError) {
          logger.error("Error fetching group members:", memberError);
          throw memberError;
        }

        if (!memberData || memberData.length === 0) {
          return [];
        }

        const userIds = memberData.map((m) => m.user_id);
        const { data: profileData, error: profileError } = await this.supabase
          .from("profiles")
          .select("id, name, username, avatar_url, points, stats, badges")
          .in("id", userIds);

        if (profileError) {
          logger.error("Error fetching member profiles:", profileError);
          throw profileError;
        }

        return (profileData || []).map((profile: any) => ({
          id: profile.id,
          name: profile.name,
          username: profile.username,
          avatarUrl: profile.avatar_url,
          points: profile.points || 0,
          stats: profile.stats || {},
          badges: profile.badges || [],
        }));
      },
      { ttl: 300 },
    );

    if (!requestingUserId) return publicMembers as User[];

    const selfInPage = publicMembers.some(
      (m: any) => m.id === requestingUserId,
    );
    if (!selfInPage) return publicMembers as User[];

    const { data: selfProfile, error: selfError } = await this.supabase
      .from("profiles")
      .select("phone, settings")
      .eq("id", requestingUserId)
      .maybeSingle();

    if (selfError) {
      logger.error("Error fetching self member profile:", selfError);
      throw selfError;
    }

    return (publicMembers as User[]).map((member: any) => {
      if (member.id !== requestingUserId) return member;
      return {
        ...member,
        phoneNumber: selfProfile?.phone,
        settings: selfProfile?.settings,
      };
    });
  }

  async getGroupStats(groupId: string): Promise<any> {
    const cacheKey = `group:stats:${groupId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        // Get member count
        const { count: memberCount, error: memberError } = await this.supabase
          .from("group_members")
          .select("user_id", { count: "exact", head: true })
          .eq("group_id", groupId);

        // Get message count
        const { count: messageCount, error: messageError } = await this.supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("group_id", groupId);

        // Get recent activity
        const { data: recentMessages, error: recentError } = await this.supabase
          .from("messages")
          .select("timestamp")
          .eq("group_id", groupId)
          .is("removed_at", null)
          .eq("is_archived", false)
          .order("timestamp", { ascending: false })
          .limit(10);

        if (memberError || messageError || recentError) {
          throw memberError || messageError || recentError;
        }

        const lastActivity =
          recentMessages && recentMessages.length > 0
            ? new Date(recentMessages[0].timestamp)
            : null;

        return {
          groupId,
          memberCount: memberCount || 0,
          messageCount: messageCount || 0,
          lastActivity,
          isActive:
            lastActivity &&
            Date.now() - lastActivity.getTime() < 7 * 24 * 60 * 60 * 1000, // Active if activity in last 7 days
        };
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  // Message Methods for API Routes
  async getGroupMessages(
    groupId: string,
    options: {
      page?: number;
      limit?: number;
      before?: string;
      after?: string;
      responseProfile?: "compact" | "full";
      viewerUserId?: string;
      /** Board pages are roots only: comments live behind "N comments". */
      rootsOnly?: boolean;
    } = {},
  ): Promise<Message[]> {
    const {
      page = 1,
      limit = SupabaseService.DEFAULT_MESSAGE_PAGE_SIZE,
      before,
      after,
      responseProfile = "full",
      viewerUserId,
      rootsOnly = false,
    } = options;
    const profile = this.getResponseProfile(responseProfile);
    const safeLimit = Math.min(
      SupabaseService.MAX_MESSAGE_PAGE_SIZE,
      Math.max(1, limit),
    );
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * safeLimit;

    // The roots-only page is a DIFFERENT result set for the same page number,
    // so it needs its own key or a board and a chat would poison each other.
    const cacheKey = `messages:group:${groupId}:${safePage}:${safeLimit}:${before || ""}:${after || ""}:profile:${profile}:roots:${rootsOnly ? "1" : "0"}`;

    logger.debug("getGroupMessages: Fetching messages", {
      groupId,
      page: safePage,
      limit: safeLimit,
      cacheKey,
    });

    const messages = await cacheService.cached(
      cacheKey,
      async () => {
        logger.debug("getGroupMessages: Cache miss, querying database");
        const baseSelectClause =
          profile === "compact"
            ? `
          id,
          group_id,
          sender_id,
          type,
          text,
          timestamp,
          edited_at,
          removed_at,
          upvotes,
          downvotes,
          is_archived,
          image_url,
          client_message_id,
          reply_to_message_id,
          mentioned_user_ids,
          thread_root_id,
          profiles!sender_id (
            id,
            name,
            username,
            avatar_url
          )
        `
            : `
          id,
          group_id,
          sender_id,
          type,
          text,
          question_data,
          flagged_as_similar_user_ids,
          timestamp,
          edited_at,
          removed_at,
          upvotes,
          downvotes,
          is_archived,
          image_url,
          client_message_id,
          reply_to_message_id,
          mentioned_user_ids,
          thread_root_id,
          profiles!sender_id (
            id,
            name,
            username,
            avatar_url
          )
        `;

        // Supabase's generated select type becomes intractable for the two
        // profile-dependent projection strings above. The response is normalized
        // immediately below, so keep this dynamic query explicitly untyped.
        const runPage = (selectClause: string) => {
          let query = (this.supabase as any)
            .from("messages")
            .select(selectClause)
            .eq("group_id", groupId);

          // A board post is a root; a comment is the same row with
          // thread_root_id set and belongs behind "N comments".
          if (rootsOnly) {
            query = query.is("thread_root_id", null);
          }
          if (before) {
            query = query.lt("timestamp", before);
          }
          if (after) {
            query = query.gt("timestamp", after);
          }

          return query
            .order("timestamp", { ascending: false })
            .range(offset, offset + safeLimit - 1);
        };

        // Two optional column sets from two different migrations, so two
        // retries and never more: drop `reactions` first (20260830120000),
        // then the board columns (20260903120000).
        let { data, error } = await runPage(
          await reactionColumns(
            this.supabase,
            await messageColumns(this.supabase, baseSelectClause),
          ),
        );
        if (error && isMissingColumnError(error)) {
          markMessageReactionsColumnMissing();
          ({ data, error } = await runPage(
            await messageColumns(this.supabase, baseSelectClause),
          ));
        }
        if (error && isMissingColumnError(error)) {
          // Pre-migration: no titles and no pins, but the board still loads.
          markMessageBoardColumnsMissing();
          ({ data, error } = await runPage(baseSelectClause));
        }

        if (error) {
          logger.error("getGroupMessages: Database error", { error });
          throw error;
        }

        logger.info("getGroupMessages: Retrieved messages from DB", {
          groupId,
          count: (data || []).length,
          questionCount: (data || []).filter((m: any) => m.type === "QUESTION")
            .length,
        });

        const withReplies = await this.attachReplyPreviewsBatch(
          data || [],
          "messages",
        );
        const withCounts = await this.attachThreadReplyCounts(
          withReplies,
          "messages",
          "group_id",
          groupId,
        );
        // Board only. `repostOf` and `repostCount` are the same for every
        // member, so they belong INSIDE the 120s page cache; `repostedByMe`
        // and `bookmarked` are viewer-specific and are attached after it.
        const withReposts = rootsOnly
          ? await this.attachBoardRepostContext(withCounts, groupId)
          : withCounts;
        // Verification progress ("1 of 2 peer votes") is the same for every
        // member, so it belongs inside the 120s page cache alongside the repost
        // context. Both response profiles get it: `compact` drops
        // `question_data`, but the count is computed, not selected.
        const withPeerUpvotes = await this.attachPeerUpvotes(withReposts);

        return withPeerUpvotes.reverse().map((msg: any) => ({
          id: msg.id,
          groupId: msg.group_id,
          sender: mapProfileSender(
            resolveNestedProfile(msg.profiles),
            msg.sender_id,
          ),
          senderId: msg.sender_id,
          timestamp: msg.timestamp
            ? new Date(msg.timestamp).toISOString()
            : new Date().toISOString(),
          flaggedAsSimilarUserIds: msg.flagged_as_similar_user_ids || [],
          upvotes: msg.upvotes || 0,
          downvotes: msg.downvotes || 0,
          isArchived: msg.is_archived || false,
          ...this.normalizeMessageRecord(msg),
        }));
      },
      { ttl: 120 },
    ); // Cache for 2 minutes

    if (viewerUserId) {
      const withReceipts = await this.enrichGroupMessageReceipts(
        messages,
        groupId,
        viewerUserId,
      );
      return rootsOnly
        ? this.enrichBoardViewerState(withReceipts, viewerUserId)
        : withReceipts;
    }
    return messages;
  }

  async getMessageById(
    messageId: string,
    userId?: string,
  ): Promise<Message | null> {
    const rawCacheKey = `message:raw:${messageId}`;

    const data = await cacheService.cached(
      rawCacheKey,
      async () => {
        const { data: row, error } = await this.supabase
          .from("messages")
          .select(
            `
          id,
          group_id,
          sender_id,
          type,
          text,
          question_data,
          flagged_as_similar_user_ids,
          timestamp,
          edited_at,
          removed_at,
          upvotes,
          downvotes,
          profiles!sender_id (
            id,
            name,
            username,
            avatar_url
          )
        `,
          )
          .eq("id", messageId)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null;
          throw error;
        }
        return row;
      },
      { ttl: 600 },
    );

    if (!data) return null;

    if (userId) {
      const { data: membership, error: memberError } = await this.supabase
        .from("group_members")
        .select("user_id, pending")
        .eq("group_id", data.group_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (memberError && memberError.code !== "PGRST116") throw memberError;
      if (!membership || membership.pending === true) return null;
    }

    // Outside the raw-row cache on purpose: votes move faster than its 600s TTL.
    const [row] = await this.attachPeerUpvotes([data]);

    return {
      id: row.id,
      groupId: row.group_id,
      sender: mapProfileSender(
        resolveNestedProfile((row as any).profiles),
        row.sender_id,
      ),
      senderId: row.sender_id,
      timestamp: row.timestamp
        ? new Date(row.timestamp).toISOString()
        : new Date().toISOString(),
      flaggedAsSimilarUserIds: row.flagged_as_similar_user_ids || [],
      upvotes: row.upvotes || 0,
      downvotes: row.downvotes || 0,
      ...this.normalizeMessageRecord(row),
    };
  }

  private mapChatMutationRow(
    kind: "group" | "dm",
    row: Record<string, any>,
  ): Record<string, unknown> {
    const removedAt = row.removed_at || null;
    return {
      id: row.id,
      ...(kind === "group"
        ? { groupId: row.group_id, type: row.type || "TEXT" }
        : { threadId: row.thread_id, type: "TEXT" }),
      senderId: row.sender_id,
      timestamp: row.timestamp,
      editedAt: row.edited_at || undefined,
      removedAt: removedAt || undefined,
      isRemoved: !!removedAt,
      ...(!removedAt ? { text: row.text } : {}),
    };
  }

  private async refreshChatPreview(
    kind: "group" | "dm",
    row: Record<string, any>,
  ): Promise<void> {
    if (kind === "group") {
      const groupId = row.group_id as string;
      const { data: latest, error: latestError } = await this.supabase
        .from("messages")
        .select("text, type, question_data, timestamp")
        .eq("group_id", groupId)
        .is("removed_at", null)
        .eq("is_archived", false)
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError) throw latestError;
      const questionData =
        latest?.question_data && typeof latest.question_data === "object"
          ? latest.question_data
          : {};
      const preview =
        String(latest?.type || "").toUpperCase() === "QUESTION"
          ? `New question: ${String(questionData.questionStem || "").substring(0, 50)}`
          : latest?.text || null;

      const previewCutoff = latest?.timestamp || row.timestamp;
      let updateQuery = this.supabase
        .from("groups")
        .update({
          last_message: preview,
          last_message_time: latest?.timestamp || null,
        })
        .eq("id", groupId);
      if (previewCutoff) {
        updateQuery = updateQuery.or(
          `last_message_time.is.null,last_message_time.lte.${previewCutoff}`,
        );
      }
      const { error: updateError } = await updateQuery;
      if (updateError) throw updateError;
      return;
    }

    const threadId = row.thread_id as string;
    const { data: latest, error: latestError } = await this.supabase
      .from("dm_messages")
      .select("text, timestamp")
      .eq("thread_id", threadId)
      .is("removed_at", null)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) throw latestError;
    const previewCutoff = latest?.timestamp || row.timestamp;
    let updateQuery = this.supabase
      .from("dm_threads")
      .update({
        last_message: latest?.text || null,
        last_message_time: latest?.timestamp || null,
      })
      .eq("id", threadId);
    if (previewCutoff) {
      updateQuery = updateQuery.or(
        `last_message_time.is.null,last_message_time.lte.${previewCutoff}`,
      );
    }
    const { error: updateError } = await updateQuery;
    if (updateError) throw updateError;
  }

  private async invalidateChatMessageMutation(
    kind: "group" | "dm",
    row: Record<string, any>,
  ): Promise<void> {
    await cacheService.delete(`message:raw:${row.id}`);
    await cacheService.deletePattern(`message:*:${row.id}`);

    if (kind === "group") {
      await cacheService.invalidateGroupCache(row.group_id);
      await cacheService.deletePattern(`messages:group:${row.group_id}:*`);
      await cacheService.delete(`group:stats:${row.group_id}`);
      return;
    }

    await cacheService.deletePattern("messages:direct:*");
  }

  private async refreshChatMessageNotifications(
    kind: "group" | "dm",
    messageId: string,
    action: "edited" | "removed",
    preview?: string,
  ): Promise<void> {
    const { data: notifications, error } = await this.supabase
      .from("notifications")
      .select("id, data")
      .contains("data", { messageId });
    if (error) throw error;
    if (!notifications?.length) return;

    await Promise.all(
      notifications.map(async (notification) => {
        const notificationData =
          notification.data && typeof notification.data === "object"
            ? notification.data
            : {};
        const { error: updateError } = await this.supabase
          .from("notifications")
          .update({
            message:
              kind === "group"
                ? `A message in a group was ${action}`
                : `A direct message was ${action}`,
            data: {
              ...notificationData,
              preview:
                action === "removed"
                  ? "Message removed"
                  : String(preview || "").slice(0, 80),
              edited: action === "edited",
              removed: action === "removed",
            },
          })
          .eq("id", notification.id);
        if (updateError) throw updateError;
      }),
    );
    await cacheService.deletePattern("notifications:*");
  }

  async editChatMessage(
    kind: "group" | "dm",
    messageId: string,
    actorId: string,
    content: string,
  ): Promise<ChatMessageMutationResult> {
    const { data, error } = await this.supabase.rpc("edit_chat_message", {
      p_message_kind: kind,
      p_message_id: messageId,
      p_actor_id: actorId,
      p_new_text: content,
    });
    if (error) throw error;

    const result = (data || {
      status: "not_found",
    }) as ChatMessageMutationResult & {
      message?: Record<string, any>;
    };
    if (result.status !== "ok" || !result.message) return result;

    await this.invalidateChatMessageMutation(kind, result.message);
    try {
      await this.refreshChatPreview(kind, result.message);
    } catch (previewError) {
      logger.warn("Failed to refresh chat preview after message edit", {
        kind,
        messageId,
        previewError,
      });
    }
    try {
      await this.refreshChatMessageNotifications(
        kind,
        String(result.message.id),
        "edited",
        content,
      );
    } catch (notificationError) {
      logger.warn("Failed to refresh notifications after message edit", {
        kind,
        messageId,
        notificationError,
      });
    }
    return {
      status: "ok",
      message: this.mapChatMutationRow(kind, result.message),
    };
  }

  async removeChatMessage(
    kind: "group" | "dm",
    messageId: string,
    actorId: string,
  ): Promise<ChatMessageMutationResult> {
    const { data, error } = await this.supabase.rpc("remove_chat_message", {
      p_message_kind: kind,
      p_message_id: messageId,
      p_actor_id: actorId,
    });
    if (error) throw error;

    const result = (data || {
      status: "not_found",
    }) as ChatMessageMutationResult & {
      message?: Record<string, any>;
    };
    if (result.status !== "ok" || !result.message) return result;

    // `remove_chat_message` predates `messages.pinned_at`, so a removed post
    // keeps its pin and the board's PINNED strip becomes a permanent, blank
    // tombstone. Clear it here, at the source, which frees the
    // one-pin-per-board index slot too.
    if (kind === "group") {
      await this.clearPinOnRemovedMessage(result.message);
    }

    await this.invalidateChatMessageMutation(kind, result.message);
    try {
      await this.refreshChatPreview(kind, result.message);
    } catch (previewError) {
      logger.warn("Failed to refresh chat preview after message removal", {
        kind,
        messageId,
        previewError,
      });
    }
    try {
      await this.refreshChatMessageNotifications(
        kind,
        String(result.message.id),
        "removed",
      );
    } catch (notificationError) {
      logger.warn("Failed to scrub notifications after message removal", {
        kind,
        messageId,
        notificationError,
      });
    }

    return {
      status: "ok",
      message: this.mapChatMutationRow(kind, result.message),
    };
  }

  /**
   * Drop the server pin from a just-removed group message. Best-effort: a
   * pre-migration database has no `pinned_at`, and a failure here must not
   * turn a successful deletion into an error.
   */
  private async clearPinOnRemovedMessage(
    message: Record<string, any>,
  ): Promise<void> {
    if (!message?.id || !message.pinned_at) return;
    try {
      const { error } = await (this.supabase as any)
        .from("messages")
        .update({ pinned_at: null, pinned_by: null })
        .eq("id", message.id);
      if (error && !isMissingColumnError(error)) throw error;
      message.pinned_at = null;
      message.pinned_by = null;
    } catch (pinError) {
      logger.warn("Failed to clear the pin on a removed message", {
        messageId: message.id,
        pinError,
      });
    }
  }

  /**
   * After votes change, recompute PENDING/VERIFIED/REJECTED from group vote counts
   * and persist into question_data so every member sees the same testable status.
   * (Clients previously called PUT /status, which only author/admin could write.)
   */
  private async syncQuestionStatusAfterVote(messageId: string): Promise<{
    upvotes: number;
    downvotes: number;
    groupId: string | null;
    questionStatus?: string;
  }> {
    const { data: msg, error } = await this.supabase
      .from("messages")
      .select("group_id, sender_id, upvotes, downvotes, type, question_data")
      .eq("id", messageId)
      .single();

    if (error) throw error;
    if (!msg) {
      return { upvotes: 0, downvotes: 0, groupId: null };
    }

    const questionData =
      msg.question_data && typeof msg.question_data === "object"
        ? msg.question_data
        : {};
    let questionStatus =
      typeof questionData.questionStatus === "string"
        ? questionData.questionStatus
        : undefined;

    const isQuestion =
      String(msg.type || "").toUpperCase() === "QUESTION" ||
      !!(questionData.questionStem || questionData.questionType);

    if (isQuestion && msg.group_id) {
      const { count, error: countError } = await this.supabase
        .from("group_members")
        .select("*", { count: "exact", head: true })
        .eq("group_id", msg.group_id);
      if (countError) {
        logger.warn("syncQuestionStatusAfterVote: member count failed", {
          messageId,
          groupId: msg.group_id,
          error: countError,
        });
      }
      const memberCount = count ?? 0;
      let resolved = resolveQuestionStatusAfterVote({
        upvotes: msg.upvotes ?? 0,
        downvotes: msg.downvotes ?? 0,
        memberCount,
      });
      // VERIFIED is evidence, not a tally (same rule as PUT /:id/status). The
      // denormalised `upvotes` includes the author's OWN vote and the 20% share
      // threshold is 1 in any group of five or fewer, so without this clause an
      // author could auto-verify their own question by upvoting it — a back
      // door around the peer-vote gate. Distinct non-author upvotes must reach
      // VERIFY_PEER_UPVOTES; otherwise the question stays PENDING. REJECTED is
      // untouched: pulling a bad question needs no quorum.
      if (resolved === QuestionStatus.VERIFIED) {
        const peerUpvotes = await this.countPeerUpvotesForMessage(
          messageId,
          msg.sender_id ?? null,
        );
        if (!canVerifyQuestion(peerUpvotes)) resolved = QuestionStatus.PENDING;
      }
      if (resolved !== questionStatus) {
        const { error: updateError } = await this.supabase
          .from("messages")
          .update({
            question_data: {
              ...questionData,
              questionStatus: resolved,
            },
          })
          .eq("id", messageId);
        if (updateError) {
          logger.error(
            "syncQuestionStatusAfterVote: failed to persist status",
            {
              messageId,
              resolved,
              error: updateError,
            },
          );
        } else {
          questionStatus = resolved;
        }
      }
    }

    await cacheService.delete(`message:${messageId}`);
    if (msg.group_id) {
      await cacheService.invalidateGroupCache(msg.group_id);
      await cacheService.deletePattern(`messages:group:${msg.group_id}:*`);
    }

    return {
      upvotes: msg.upvotes ?? 0,
      downvotes: msg.downvotes ?? 0,
      groupId: msg.group_id ?? null,
      questionStatus,
    };
  }

  async voteQuestion(
    messageId: string,
    userId: string,
    voteType: "up" | "down",
  ): Promise<any> {
    const { data: existingVote, error: checkError } = await this.supabase
      .from("question_votes")
      .select("vote_type")
      .eq("message_id", messageId)
      .eq("user_id", userId)
      .maybeSingle();

    if (checkError) throw checkError;

    if (existingVote?.vote_type === voteType) {
      const synced = await this.syncQuestionStatusAfterVote(messageId);
      return {
        success: true,
        voteType,
        upvotes: synced.upvotes,
        downvotes: synced.downvotes,
        questionStatus: synced.questionStatus,
      };
    }

    const { error } = await this.supabase.from("question_votes").upsert(
      {
        message_id: messageId,
        user_id: userId,
        vote_type: voteType,
      },
      { onConflict: "message_id,user_id" },
    );

    if (error) throw error;

    const synced = await this.syncQuestionStatusAfterVote(messageId);
    return {
      success: true,
      voteType,
      upvotes: synced.upvotes,
      downvotes: synced.downvotes,
      questionStatus: synced.questionStatus,
    };
  }

  async removeVote(messageId: string, userId: string): Promise<any> {
    const { error } = await this.supabase
      .from("question_votes")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", userId);

    if (error) throw error;

    const synced = await this.syncQuestionStatusAfterVote(messageId);
    return {
      success: true,
      upvotes: synced.upvotes,
      downvotes: synced.downvotes,
      questionStatus: synced.questionStatus,
    };
  }

  /**
   * Emoji reactions (20260830120000). One table serves group messages and DMs;
   * the DB trigger recounts the denormalised `reactions` JSONB on the parent,
   * whose UPDATE then rides the realtime channels both clients already have.
   *
   * Authorization is the caller's job (getAuthorizedGroupMessage /
   * getAuthorizedDmMessage) — this layer only writes.
   */
  private reactionsMissingTable(error: any): boolean {
    return (
      error?.code === "42P01" ||
      error?.code === "PGRST205" ||
      error?.code === "42703"
    );
  }

  async addMessageReaction(
    messageId: string,
    userId: string,
    emoji: string,
    scope: "group" | "dm" = "group",
  ): Promise<{ reactions: Record<string, number> }> {
    const column = scope === "dm" ? "dm_message_id" : "group_message_id";
    const { error } = await this.supabase
      .from("message_reactions")
      .upsert(
        { [column]: messageId, user_id: userId, emoji },
        { onConflict: `${column},user_id,emoji`, ignoreDuplicates: true },
      );
    if (error) {
      if (this.reactionsMissingTable(error)) {
        const err: any = new Error("Reactions are not available yet");
        err.statusCode = 503;
        throw err;
      }
      throw error;
    }
    return this.readMessageReactions(messageId, scope);
  }

  async removeMessageReaction(
    messageId: string,
    userId: string,
    emoji: string,
    scope: "group" | "dm" = "group",
  ): Promise<{ reactions: Record<string, number> }> {
    const column = scope === "dm" ? "dm_message_id" : "group_message_id";
    const { error } = await this.supabase
      .from("message_reactions")
      .delete()
      .eq(column, messageId)
      .eq("user_id", userId)
      .eq("emoji", emoji);
    if (error) {
      if (this.reactionsMissingTable(error)) {
        const err: any = new Error("Reactions are not available yet");
        err.statusCode = 503;
        throw err;
      }
      throw error;
    }
    return this.readMessageReactions(messageId, scope);
  }

  /** Authoritative counts straight after a write (the trigger has already run). */
  async readMessageReactions(
    messageId: string,
    scope: "group" | "dm" = "group",
  ): Promise<{ reactions: Record<string, number> }> {
    const table = scope === "dm" ? "dm_messages" : "messages";
    const { data, error } = await this.supabase
      .from(table)
      .select("reactions")
      .eq("id", messageId)
      .maybeSingle();
    if (error) {
      if (this.reactionsMissingTable(error)) return { reactions: {} };
      throw error;
    }
    const raw = (data as any)?.reactions;
    return { reactions: raw && typeof raw === "object" ? raw : {} };
  }

  /** How many DISTINCT emoji a message already carries (API-side cap). */
  async countDistinctReactionEmoji(
    messageId: string,
    scope: "group" | "dm" = "group",
  ): Promise<number> {
    const { reactions } = await this.readMessageReactions(messageId, scope);
    return Object.keys(reactions).length;
  }

  /** The viewer's own reactions across a group: { messageId: ["👍", "🔥"] }. */
  async getUserReactionsForGroup(
    groupId: string,
    userId: string,
  ): Promise<Record<string, string[]>> {
    const { data: messages, error: msgError } = await this.supabase
      .from("messages")
      .select("id")
      .eq("group_id", groupId);
    if (msgError) throw msgError;
    if (!messages || messages.length === 0) return {};

    const { data, error } = await this.supabase
      .from("message_reactions")
      .select("group_message_id, emoji")
      .eq("user_id", userId)
      .in(
        "group_message_id",
        messages.map((m: any) => m.id),
      );
    if (error) {
      if (this.reactionsMissingTable(error)) return {};
      throw error;
    }
    const out: Record<string, string[]> = {};
    for (const row of data || []) {
      const id = String((row as any).group_message_id);
      (out[id] ||= []).push(String((row as any).emoji));
    }
    return out;
  }

  /** The viewer's own reactions across a DM thread. */
  async getUserReactionsForThread(
    threadId: string,
    userId: string,
  ): Promise<Record<string, string[]>> {
    const { data: messages, error: msgError } = await this.supabase
      .from("dm_messages")
      .select("id")
      .eq("thread_id", threadId);
    if (msgError) throw msgError;
    if (!messages || messages.length === 0) return {};

    const { data, error } = await this.supabase
      .from("message_reactions")
      .select("dm_message_id, emoji")
      .eq("user_id", userId)
      .in(
        "dm_message_id",
        messages.map((m: any) => m.id),
      );
    if (error) {
      if (this.reactionsMissingTable(error)) return {};
      throw error;
    }
    const out: Record<string, string[]> = {};
    for (const row of data || []) {
      const id = String((row as any).dm_message_id);
      (out[id] ||= []).push(String((row as any).emoji));
    }
    return out;
  }

  /**
   * Distinct UPvotes on a question from members other than its author — the only
   * count that may grant VERIFIED. `question_votes` is keyed on
   * (message_id, user_id), so one row is one voter; `countPeerUpvotes` drops the
   * author's own row. A read failure returns 0, which refuses the verify rather
   * than granting one on missing evidence.
   */
  async countPeerUpvotesForMessage(
    messageId: string,
    authorId: string | null | undefined,
  ): Promise<number> {
    const { data, error } = await this.supabase
      .from("question_votes")
      .select("user_id, vote_type")
      .eq("message_id", messageId)
      .eq("vote_type", "up");

    if (error) {
      logger.warn("countPeerUpvotesForMessage failed", { messageId, error });
      return 0;
    }
    return countPeerUpvotes(data || [], authorId);
  }

  /**
   * Peer-upvote counts for a page of messages, in one query.
   *
   * This rides INSIDE the page cache because the number is the same for every
   * viewer, and casting a vote already invalidates `messages:group:*`. It runs
   * for both response profiles: the compact profile drops `question_data`, and
   * leaving the count out of it would repeat the hole that once hid reaction
   * counts from a freshly loaded chat.
   */
  private async attachPeerUpvotes(messages: any[]): Promise<any[]> {
    const questionIds = messages
      .filter((m) => String(m?.type || "").toUpperCase() === "QUESTION" && m?.id)
      .map((m) => m.id as string);
    if (!questionIds.length) return messages;

    const { data, error } = await this.supabase
      .from("question_votes")
      .select("message_id, user_id, vote_type")
      .eq("vote_type", "up")
      .in("message_id", questionIds);

    if (error) {
      // No count is honest; a zero would read as "nobody has upvoted this".
      logger.warn("attachPeerUpvotes failed", { error });
      return messages;
    }

    const byMessage = new Map<string, any[]>();
    for (const row of (data || []) as any[]) {
      const id = row?.message_id;
      if (!id) continue;
      const bucket = byMessage.get(id);
      if (bucket) bucket.push(row);
      else byMessage.set(id, [row]);
    }

    const questionIdSet = new Set(questionIds);
    return messages.map((m) =>
      questionIdSet.has(m?.id)
        ? {
            ...m,
            peerUpvotes: countPeerUpvotes(
              byMessage.get(m.id) || [],
              m.sender_id ?? m.senderId ?? null,
            ),
          }
        : m,
    );
  }

  async getUserVotesForGroup(
    groupId: string,
    userId: string,
  ): Promise<Record<string, "up" | "down">> {
    // Get all message IDs in the group
    const { data: messages, error: msgError } = await this.supabase
      .from("messages")
      .select("id")
      .eq("group_id", groupId);

    if (msgError) throw msgError;
    if (!messages || messages.length === 0) return {};

    const messageIds = messages.map((m) => m.id);

    // Get user's votes for those messages
    const { data: votes, error: votesError } = await this.supabase
      .from("question_votes")
      .select("message_id, vote_type")
      .eq("user_id", userId)
      .in("message_id", messageIds);

    if (votesError) throw votesError;

    // Convert to a map
    const voteMap: Record<string, "up" | "down"> = {};
    for (const vote of votes || []) {
      voteMap[vote.message_id] = vote.vote_type;
    }

    return voteMap;
  }

  async updateQuestionStatus(
    messageId: string,
    questionStatus: string,
  ): Promise<any> {
    // First get the current message to get the question_data
    const { data: currentMessage, error: fetchError } = await this.supabase
      .from("messages")
      .select("question_data, group_id")
      .eq("id", messageId)
      .single();

    if (fetchError) throw fetchError;
    if (!currentMessage) throw new Error("Message not found");

    // Update the questionStatus in the question_data JSONB
    const updatedQuestionData = {
      ...currentMessage.question_data,
      questionStatus,
    };

    const { data, error } = await this.supabase
      .from("messages")
      .update({ question_data: updatedQuestionData })
      .eq("id", messageId)
      .select()
      .single();

    if (error) throw error;

    // Invalidate caches (list GET uses messages:group:* keys)
    await cacheService.delete(`message:${messageId}`);
    await cacheService.delete(`group:${currentMessage.group_id}:messages`);
    if (currentMessage.group_id) {
      await cacheService.invalidateGroupCache(currentMessage.group_id);
      await cacheService.deletePattern(
        `messages:group:${currentMessage.group_id}:*`,
      );
    }

    return data;
  }

  async updateMessageFlagged(
    messageId: string,
    flaggedUserIds: string[],
  ): Promise<Message | null> {
    const { data, error } = await this.supabase
      .from("messages")
      .update({
        flagged_as_similar_user_ids: flaggedUserIds,
      })
      .eq("id", messageId)
      .select(
        `
        id,
        group_id,
        sender_id,
        type,
        text,
        question_data,
        flagged_as_similar_user_ids,
        timestamp,
        edited_at,
        removed_at,
        profiles!sender_id (
          id,
          name,
          username,
          avatar_url
        )
      `,
      )
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    // Invalidate caches
    await cacheService.invalidateGroupCache(data.group_id);
    await cacheService.delete(`message:${messageId}`);
    await cacheService.deletePattern(`messages:group:${data.group_id}:*`);

    return {
      id: data.id,
      groupId: data.group_id,
      sender: mapProfileSender(
        resolveNestedProfile(data.profiles),
        data.sender_id,
      ),
      senderId: data.sender_id,
      timestamp: data.timestamp
        ? new Date(data.timestamp).toISOString()
        : new Date().toISOString(),
      flaggedAsSimilarUserIds: data.flagged_as_similar_user_ids || [],
      upvotes: 0,
      downvotes: 0,
      type: data.type || "TEXT",
      text: data.text,
    };
  }

  async createDeck(
    deckData: {
      name: string;
      description?: string;
      isShared?: boolean;
      courseId?: string | null;
      studySetId?: string | null;
      topicId?: string | null;
    },
    userId: string,
  ): Promise<any> {
    const topicId = await this.resolveArtefactTopic({
      topicId: deckData.topicId,
      courseId: deckData.courseId,
    });
    const { data, error } = await writeWithTopicFallback(
      (row) => this.supabase.from("decks").insert(row).select().single(),
      {
        name: deckData.name,
        description: deckData.description || "",
        user_id: userId,
        is_shared: deckData.isShared ?? false,
        course_id: deckData.courseId || null,
        ...(deckData.studySetId !== undefined ? { study_set_id: deckData.studySetId || null } : {}),
        ...(topicId !== undefined ? { topic_id: topicId } : {}),
      },
    );

    if (error) {
      logger.error("Error creating deck:", { error, deckData, userId });
      throw new Error(error.message || "Failed to create deck");
    }

    // Cache the new deck
    await cacheService.set(`deck:${data.id}`, data, 1800); // 30 minutes

    return data;
  }

  /**
   * Create a deck AND its cards as one unit.
   *
   * Preferred path is the `create_deck_with_cards` RPC (one transaction). That
   * migration is hand-applied, so while it is missing this compensates: insert
   * the deck, insert the cards, and DELETE the deck if any card fails. Either
   * way a caller that sees an error can be sure no empty deck was left behind —
   * which is the whole point (an interrupted generate used to strand a
   * "0 cards" deck that no client-side rollback could reach).
   */
  async createDeckWithCards(
    deckData: {
      name: string;
      description?: string;
      isShared?: boolean;
      courseId?: string | null;
      studySetId?: string | null;
      topicId?: string | null;
    },
    cards: NormalizedDeckCard[],
    userId: string,
  ): Promise<{ deck: any; flashcards: any[]; atomic: boolean }> {
    // Resolved before anything is written: a topic that belongs to another
    // course is a PublicError (400), not a half-written deck.
    const topicId = await this.resolveArtefactTopic({
      topicId: deckData.topicId,
      courseId: deckData.courseId,
    });

    const rpcResult = await this.tryCreateDeckWithCardsRpc(deckData, topicId, cards, userId);
    if (rpcResult) {
      if (deckData.studySetId) {
        await this.updateDeck(rpcResult.deckId, { studySetId: deckData.studySetId }, userId);
      }
      await this.invalidateDeckCaches(userId, rpcResult.deckId);
      const deck = await this.getDeckRow(rpcResult.deckId);
      const flashcards = await this.getDeckCardRows(rpcResult.deckId);
      return { deck, flashcards, atomic: true };
    }

    // ---- Compensating path (RPC not present on this database) ----
    const { data: deck, error: deckError } = await writeWithTopicFallback(
      (row) => this.supabase.from("decks").insert(row).select().single(),
      {
        name: deckData.name,
        description: deckData.description || "",
        user_id: userId,
        is_shared: deckData.isShared ?? false,
        course_id: deckData.courseId || null,
        ...(deckData.studySetId !== undefined ? { study_set_id: deckData.studySetId || null } : {}),
        ...(topicId !== undefined ? { topic_id: topicId } : {}),
      },
    );

    if (deckError || !deck) {
      logger.error("Error creating deck (with-cards)", { error: deckError, userId });
      throw new DeckWithCardsError(
        "DECK_WRITE_FAILED",
        deckError?.message || "Failed to create deck",
        true,
      );
    }

    const { data: inserted, error: cardsError } = await this.supabase
      .from("flashcards")
      .insert(cards.map((card) => cardToFlashcardRow(card, deck.id)))
      .select();

    // A partial insert is the same failure as none: PostgREST inserts the array
    // in one statement, so any error means zero rows landed.
    if (cardsError || !inserted || inserted.length !== cards.length) {
      const rolledBack = await this.deleteDeckRowBestEffort(deck.id);
      logger.error("Cards failed after deck insert — deck removed", {
        error: cardsError,
        deckId: deck.id,
        rolledBack,
        expected: cards.length,
        inserted: inserted?.length ?? 0,
      });
      await this.invalidateDeckCaches(userId, deck.id);
      throw new DeckWithCardsError(
        "CARD_WRITE_FAILED",
        cardsError?.message || "Failed to save the deck's cards",
        rolledBack,
      );
    }

    await this.invalidateDeckCaches(userId, deck.id);
    return { deck, flashcards: inserted, atomic: false };
  }

  /**
   * Add generated cards to a deck the student already has.
   *
   * The generate flow opened from inside a deck promises the cards land in
   * THAT deck; creating a second one named after it left a duplicate in the
   * library and the original still empty. No deck row is written here, so a
   * single PostgREST insert (one statement, all rows or none) is the whole
   * transaction — nothing to compensate.
   *
   * Returns null when the caller may not edit the deck, which the route
   * answers as 404 rather than leaking whether the deck exists.
   */
  async addCardsToExistingDeck(
    deckId: string,
    cards: NormalizedDeckCard[],
    userId: string,
  ): Promise<{ deck: any; flashcards: any[]; atomic: boolean } | null> {
    const canEdit = await this.verifyDeckAccess(userId, deckId, "edit");
    if (!canEdit) return null;

    // The FULL row, not fetchDeckRecord's projection: the client merges what
    // comes back over its local copy, and a row missing `topic_id` would file
    // the student's deck under no topic until the next refetch.
    const { data: deck, error: deckError } = await this.supabase
      .from("decks")
      .select("*")
      .eq("id", deckId)
      .maybeSingle();
    if (deckError) throw deckError;
    if (!deck) return null;

    const { data: inserted, error: cardsError } = await this.supabase
      .from("flashcards")
      .insert(cards.map((card) => cardToFlashcardRow(card, deckId)))
      .select();

    if (cardsError || !inserted || inserted.length !== cards.length) {
      logger.error("Cards failed for existing deck", {
        error: cardsError,
        deckId,
        expected: cards.length,
        inserted: inserted?.length ?? 0,
      });
      // One statement: an error means zero rows landed, so the deck is
      // exactly as the student left it.
      throw new DeckWithCardsError(
        "CARD_WRITE_FAILED",
        cardsError?.message || "Failed to save the deck's cards",
        true,
      );
    }

    await this.invalidateDeckCaches(userId, deckId);
    return { deck, flashcards: inserted, atomic: true };
  }

  /** Returns null when this database has no `create_deck_with_cards` yet. */
  private async tryCreateDeckWithCardsRpc(
    deckData: {
      name: string;
      description?: string;
      isShared?: boolean;
      courseId?: string | null;
    },
    topicId: string | null | undefined,
    cards: NormalizedDeckCard[],
    userId: string,
  ): Promise<{ deckId: string } | null> {
    const { data, error } = await this.supabase.rpc("create_deck_with_cards", {
      p_owner: userId,
      p_deck: {
        name: deckData.name,
        description: deckData.description || "",
        is_shared: deckData.isShared ?? false,
        course_id: deckData.courseId || null,
        ...(topicId ? { topic_id: topicId } : {}),
      },
      p_cards: cards.map((card) => ({
        type: card.type,
        front: card.front,
        back: card.back,
        clozeText: card.clozeText,
        imageUrl: card.imageUrl,
        occlusionData: card.occlusionData,
        tags: card.tags,
      })),
    });

    if (error) {
      if (isMissingRpcError(error)) return null;
      logger.error("create_deck_with_cards RPC failed", { error, userId });
      // The function is transactional: an error means nothing was written.
      throw new DeckWithCardsError(
        "CARD_WRITE_FAILED",
        error.message || "Failed to create deck",
        true,
      );
    }

    const deckId =
      (data as any)?.deckId || (data as any)?.deck_id || (Array.isArray(data) ? data[0]?.deckId : null);
    if (!deckId) {
      throw new DeckWithCardsError("CARD_WRITE_FAILED", "Failed to create deck", true);
    }
    return { deckId: String(deckId) };
  }

  private async getDeckRow(deckId: string): Promise<any> {
    const { data } = await this.supabase
      .from("decks")
      .select("*")
      .eq("id", deckId)
      .maybeSingle();
    return data || { id: deckId };
  }

  private async getDeckCardRows(deckId: string): Promise<any[]> {
    const { data } = await this.supabase
      .from("flashcards")
      .select("*")
      .eq("deck_id", deckId);
    return data || [];
  }

  /** Best effort: report whether the orphan deck row is actually gone. */
  private async deleteDeckRowBestEffort(deckId: string): Promise<boolean> {
    try {
      const { error } = await this.supabase.from("decks").delete().eq("id", deckId);
      return !error;
    } catch (err) {
      logger.error("Failed to remove partial deck", { deckId, err });
      return false;
    }
  }

  private async invalidateDeckCaches(userId: string, deckId?: string): Promise<void> {
    if (deckId) {
      await cacheService.delete(`deck:${deckId}`);
      await cacheService.deletePattern(`deck:${deckId}:user:*`);
    }
    await cacheService.delete(`decks:user:${userId}`);
    await cacheService.deletePattern(`decks:user:${userId}*`);
    await cacheService.deletePattern(`decks:${userId}*`);
    await cacheService.deletePattern("flashcards:*");
  }

  async getDecks(
    userId: string,
    includeShared: boolean = false,
    options: {
      page?: number;
      limit?: number;
      responseProfile?: "compact" | "full";
      /** Academic archive filter (decks.course_id): unfiled → IS NULL, course → eq. */
      courseFilter?: CourseFilter;
      /** Same, one level down (decks.topic_id): unfiled → no topic in that course. */
      topicFilter?: CourseFilter;
    } = {},
  ): Promise<any[]> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(
      SupabaseService.MAX_DECK_PAGE_SIZE,
      Math.max(1, options.limit || SupabaseService.DEFAULT_DECK_PAGE_SIZE),
    );
    const profile = this.getResponseProfile(options.responseProfile);
    const offset = (page - 1) * limit;
    // v2: includeShared means owned + collaborator decks — never every globally shared deck.
    const cacheKey = `decks:user:${userId}:scope:${includeShared ? "owned_collab" : "owned"}:p${page}:l${limit}:profile:${profile}:course:${courseFilterKey(options.courseFilter)}:topic:${courseFilterKey(options.topicFilter)}:v2`;
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached !== null) return cached;

    const selectClause =
      profile === "compact"
        ? "id, name, user_id, is_shared, course_id, created_at, study_count"
        // study_count (Phase 3 M) is selected so "studied by N" can render;
        // without it the counter is written but never readable by a client.
        : "id, name, description, user_id, is_shared, course_id, created_at, study_count";

    let accessibleIds: string[] | null = null;
    if (includeShared) {
      // Owned decks + decks where the user is an explicit collaborator.
      // Do NOT list every is_shared=true deck in the product (that leaked other users' libraries).
      accessibleIds = await this.getAccessibleDeckIds(userId);
      if (accessibleIds.length === 0) {
        await cacheService.set(cacheKey, [], 1800);
        return [];
      }
    }

    // topic_id is projected (and filtered) only while it exists — naming a
    // column the migration has not added yet 42703s the whole deck list.
    const runQuery = (withTopic: boolean) => {
      let query = this.supabase
        .from("decks")
        .select(withTopic ? `${selectClause}, topic_id` : selectClause)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      query = applyCourseFilter(query, "course_id", options.courseFilter);
      if (withTopic) {
        query = applyCourseFilter(query, "topic_id", options.topicFilter);
      }
      return accessibleIds
        ? query.in("id", accessibleIds)
        : query.eq("user_id", userId);
    };

    let { data, error }: { data: any; error: any } = await runQuery(true);
    if (error && isMissingTopicColumn(error)) {
      // No deck can carry a topic before the migration: a named topic matches
      // nothing, and "no topic" matches every deck.
      if (options.topicFilter?.kind === "course") {
        await cacheService.set(cacheKey, [], 1800);
        return [];
      }
      ({ data, error } = await runQuery(false));
    }

    if (error) throw error;

    const decks = (
      (data || []) as unknown as Array<{ id: string; [key: string]: unknown }>
    ).filter((d) => d && typeof d.id === "string" && d.id);
    const deckIds = decks.map((d) => d.id);
    const cardCountByDeck: Record<string, number> = {};

    if (deckIds.length > 0) {
      const { data: cardRows, error: countError } = await this.supabase
        .from("flashcards")
        .select("deck_id")
        .in("deck_id", deckIds);

      if (!countError && cardRows) {
        for (const row of cardRows) {
          const deckId = row.deck_id as string;
          cardCountByDeck[deckId] = (cardCountByDeck[deckId] || 0) + 1;
        }
      }
    }

    const decksWithCounts = decks.map((d) => ({
      ...d,
      card_count: cardCountByDeck[d.id] || 0,
    }));

    await cacheService.set(cacheKey, decksWithCounts, 1800); // 30 minutes
    return decksWithCounts;
  }

  async getSharedDecks(): Promise<any[]> {
    const cacheKey = `decks:shared`;
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from("decks")
      .select("*")
      .eq("is_shared", true)
      .order("created_at", { ascending: false });

    if (error) throw error;

    await cacheService.set(cacheKey, data, 1800); // 30 minutes
    return data;
  }

  async getDeckCollaborators(deckId: string, userId: string): Promise<any[]> {
    const hasAccess = await this.verifyDeckAccess(userId, deckId, "read");
    if (!hasAccess) return [];

    const cacheKey = `deck_collaborators:${deckId}`;
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from("deck_collaborators")
      .select(
        "user_id, role, added_at, profiles!deck_collaborators_user_id_fkey(id, name, avatar_url)",
      )
      .eq("deck_id", deckId);

    if (error) throw error;

    await cacheService.set(cacheKey, data, 300);
    return data;
  }

  async addDeckCollaborator(
    deckId: string,
    userId: string,
    role: string = "editor",
    requesterId?: string,
  ): Promise<any> {
    const actorId = requesterId || userId;
    const canManage = await this.verifyDeckAccess(actorId, deckId, "owner");
    if (!canManage) throw new Error("Access denied");

    const { data, error } = await this.supabase
      .from("deck_collaborators")
      .insert({ deck_id: deckId, user_id: userId, role })
      .select()
      .single();

    if (error) throw error;

    await cacheService.delete(`deck_collaborators:${deckId}`);
    return data;
  }

  async removeDeckCollaborator(
    deckId: string,
    userId: string,
    requesterId?: string,
  ): Promise<boolean> {
    const actorId = requesterId || userId;
    const isOwner = await this.verifyDeckAccess(actorId, deckId, "owner");
    if (!isOwner && actorId !== userId) throw new Error("Access denied");

    const { error } = await this.supabase
      .from("deck_collaborators")
      .delete()
      .eq("deck_id", deckId)
      .eq("user_id", userId);

    if (error) throw error;

    await cacheService.delete(`deck_collaborators:${deckId}`);
    return true;
  }

  async getDeck(deckId: string): Promise<any | null> {
    const cacheKey = `deck:${deckId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from("decks")
      .select("id, name, description, user_id, is_shared, created_at")
      .eq("id", deckId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    await cacheService.set(cacheKey, data, 1800); // 30 minutes
    return data;
  }

  async updateDeck(
    deckId: string,
    updates: {
      name?: string;
      description?: string;
      isPublic?: boolean;
      isShared?: boolean;
      courseId?: string | null;
      studySetId?: string | null;
      topicId?: string | null;
    },
    userId: string,
  ): Promise<any | null> {
    const canEdit = await this.verifyDeckAccess(userId, deckId, "edit");
    if (!canEdit) return null;

    // Validated against the course the deck ENDS UP with; moving or unfiling
    // the deck takes its topic with it.
    const topicId = await this.resolveArtefactTopicPatch("decks", deckId, updates);

    const { data, error } = await writeWithTopicFallback(
      (payload) =>
        this.supabase
          .from("decks")
          .update(payload)
          .eq("id", deckId)
          .select()
          .single(),
      {
        name: updates.name,
        description: updates.description,
        is_public: updates.isPublic,
        is_shared: updates.isShared,
        // undefined = untouched (dropped by JSON), null = cleared
        course_id: updates.courseId === undefined ? undefined : updates.courseId || null,
        study_set_id: updates.studySetId === undefined ? undefined : updates.studySetId || null,
        ...(topicId !== undefined ? { topic_id: topicId } : {}),
      },
    );

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    // Update cache
    await cacheService.set(`deck:${deckId}`, data, 1800);
    await cacheService.deletePattern(`deck:${deckId}:user:*`);

    return data;
  }

  async deleteDeck(deckId: string, userId: string): Promise<boolean> {
    const isOwner = await this.verifyDeckAccess(userId, deckId, "owner");
    if (!isOwner) return false;

    const { error } = await this.supabase
      .from("decks")
      .delete()
      .eq("id", deckId);

    if (error) throw error;

    // Clear cache
    await cacheService.delete(`deck:${deckId}`);
    await cacheService.deletePattern(`deck:${deckId}:user:*`);
    await cacheService.deletePattern(`decks:user:*`);

    return true;
  }

  async exportDeck(deckId: string, userId: string): Promise<any | null> {
    const deck = await this.getDeckForUser(deckId, userId);
    if (!deck) return null;

    const { data: flashcards, error } = await this.supabase
      .from("flashcards")
      .select("*")
      .eq("deck_id", deckId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return {
      deck,
      flashcards: flashcards || [],
    };
  }

  async importDeck(importData: any, userId: string): Promise<any> {
    // Always create exactly one new deck owned by the authenticated user.
    // Never honor foreign user_id / deck id / is_shared from the payload.
    const deckName =
      typeof importData?.deck?.name === "string" && importData.deck.name.trim()
        ? importData.deck.name.trim().slice(0, 200)
        : "Imported Deck";
    const deckDescription =
      typeof importData?.deck?.description === "string"
        ? importData.deck.description.slice(0, 2000)
        : "";

    const { data: newDeck, error: deckError } = await this.supabase
      .from("decks")
      .insert({
        name: deckName,
        description: deckDescription,
        user_id: userId,
        is_shared: false,
      })
      .select()
      .single();

    if (deckError) {
      logger.error("Error creating deck during import:", deckError);
      throw deckError;
    }

    // Import flashcards (removed user_id as it doesn't exist in flashcards schema)
    if (importData.flashcards && importData.flashcards.length > 0) {
      const flashcardsToInsert = importData.flashcards.map((card: any) => {
        const cardType = card.type || "BASIC";
        const insertData: any = {
          deck_id: newDeck.id,
          type: cardType,
        };

        if (cardType === "CLOZE") {
          insertData.cloze_text = card.clozeText || card.cloze_text;
        } else if (cardType === "IMAGE_OCCLUSION") {
          insertData.front = card.front;
          insertData.back = card.back;
          const occlusionData = card.occlusion_data || card.occlusionData;
          if (occlusionData) {
            insertData.occlusion_data = occlusionData;
          }
        } else {
          insertData.front = card.front;
          insertData.back = card.back;
        }

        const imageUrl = card.image_url || card.imageUrl;
        if (imageUrl) {
          insertData.image_url = imageUrl;
        }

        if (card.tags && card.tags.length > 0) {
          insertData.tags = card.tags;
        }

        return insertData;
      });

      const { error: cardsError } = await this.supabase
        .from("flashcards")
        .insert(flashcardsToInsert);

      if (cardsError) {
        logger.error("Error importing flashcards:", cardsError);
        throw cardsError;
      }
    }

    // Invalidate user's deck cache so the new deck shows up
    await cacheService.delete(`decks:user:${userId}`);
    await cacheService.deletePattern(`decks:user:${userId}*`);
    await cacheService.deletePattern(`decks:${userId}*`);

    // Invalidate flashcard caches so newly imported cards show up
    await cacheService.deletePattern("flashcards:*");

    // Cache the new deck
    await cacheService.set(`deck:${newDeck.id}`, newDeck, 1800);

    // fetch back the inserted cards so callers can update state immediately
    let insertedFlashcards: any[] = [];
    if (importData.flashcards && importData.flashcards.length > 0) {
      const { data: cards } = await this.supabase
        .from("flashcards")
        .select("*")
        .eq("deck_id", newDeck.id);
      insertedFlashcards = cards || [];
    }

    return { deck: newDeck, flashcards: insertedFlashcards };
  }

  /**
   * Replace all cards in an existing deck in place, keeping the deck row (and
   * its id) stable. Used when a study pack the buyer owns publishes a new
   * version: the buyer's delivered deck is refreshed without creating a
   * duplicate deck. The deck's owner is NOT re-checked here — callers pass a
   * deck id they materialised for that buyer (delivered_refs.deckId), never a
   * client-supplied id.
   */
  async replaceDeckCards(
    deckId: string,
    cards: Array<{
      front?: string;
      back?: string;
      type?: string;
      clozeText?: string;
      cloze_text?: string;
      occlusion_data?: unknown;
      occlusionData?: unknown;
      image_url?: string;
      imageUrl?: string;
      tags?: unknown;
    }>,
  ): Promise<void> {
    const { error: deleteError } = await this.supabase
      .from("flashcards")
      .delete()
      .eq("deck_id", deckId);
    if (deleteError) {
      logger.error("Error clearing deck cards for replacement:", deleteError);
      throw deleteError;
    }

    if (cards && cards.length > 0) {
      const rows = cards.map((card) => {
        const cardType = card.type || "BASIC";
        const insertData: any = { deck_id: deckId, type: cardType };
        if (cardType === "CLOZE") {
          insertData.cloze_text = card.clozeText || card.cloze_text;
        } else if (cardType === "IMAGE_OCCLUSION") {
          insertData.front = card.front;
          insertData.back = card.back;
          const occlusionData = card.occlusion_data || card.occlusionData;
          if (occlusionData) insertData.occlusion_data = occlusionData;
        } else {
          insertData.front = card.front;
          insertData.back = card.back;
        }
        const imageUrl = card.image_url || card.imageUrl;
        if (imageUrl) insertData.image_url = imageUrl;
        if (Array.isArray(card.tags) && card.tags.length > 0) {
          insertData.tags = card.tags;
        }
        return insertData;
      });
      const { error: insertError } = await this.supabase
        .from("flashcards")
        .insert(rows);
      if (insertError) {
        logger.error("Error inserting replacement deck cards:", insertError);
        throw insertError;
      }
    }

    await cacheService.deletePattern("flashcards:*");
    await cacheService.delete(`deck:${deckId}`);
    // The per-user deck list bakes in a computed card_count, so it must be
    // rebuilt after the card set changes (same broad pattern importDeck uses).
    await cacheService.deletePattern(`decks:user:*`);
  }

  async createFlashcard(flashcardData: {
    deckId: string;
    type?: string;
    front?: string;
    back?: string;
    clozeText?: string;
    imageUrl?: string;
    occlusionData?: any;
    tags?: string[];
    userId?: string;
  }): Promise<any> {
    const cardType = flashcardData.type || "BASIC";

    if (!flashcardData.userId) {
      throw new Error("Authentication required");
    }
    const canEdit = await this.verifyDeckAccess(
      flashcardData.userId,
      flashcardData.deckId,
      "edit",
    );
    if (!canEdit) {
      throw new Error("Deck not found or access denied");
    }

    const insertData: any = {
      deck_id: flashcardData.deckId,
      type: cardType,
    };

    if (cardType === "CLOZE") {
      // CLOZE cards must have cloze_text and front/back must be NULL per DB constraint
      insertData.cloze_text = flashcardData.clozeText;
      // front and back are left as NULL for CLOZE cards
    } else {
      // For BASIC and IMAGE_OCCLUSION, allow an optional image URL.
      insertData.front = flashcardData.front;
      insertData.back =
        cardType === "IMAGE_OCCLUSION" ? null : flashcardData.back;
      insertData.image_url = flashcardData.imageUrl;
    }

    if (cardType === "IMAGE_OCCLUSION") {
      insertData.occlusion_data = flashcardData.occlusionData;
    }

    if (flashcardData.tags && flashcardData.tags.length > 0) {
      insertData.tags = flashcardData.tags;
    }

    const { data, error } = await this.supabase
      .from("flashcards")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      logger.error("Error creating flashcard:", { error, flashcardData });
      throw new Error(error.message || "Failed to create flashcard");
    }

    // Invalidate deck cache
    await cacheService.deletePattern(`flashcards:*`);

    return data;
  }

  /** Best-effort sibling thumb upload; failures never fail the parent upload. */
  private async uploadSiblingThumb(
    bucket: string,
    filePath: string,
    thumb: Buffer | null,
  ): Promise<void> {
    if (!thumb) return;
    try {
      const { error: thumbError } = await this.supabase.storage
        .from(bucket)
        .upload(storageThumbPath(filePath), thumb, {
          contentType: "image/webp",
          cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
          upsert: true,
        });
      if (thumbError) {
        logger.warn("Thumbnail upload failed", {
          bucket,
          filePath,
          error: thumbError.message,
        });
      }
    } catch (thumbErr: any) {
      logger.warn("Thumbnail generation/upload failed", {
        bucket,
        filePath,
        error: thumbErr?.message,
      });
    }
  }

  async uploadFlashcardImage(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    folder?: string;
  }): Promise<{ url: string; path: string }> {
    const bucket = "flashcard-images";
    const timestamp = Date.now();
    const ownerPrefix = `${params.userId.replace(/[^a-zA-Z0-9_-]/g, "")}/`;
    const folderSegment = params.folder
      ? `${params.folder.replace(/\.\./g, "").replace(/^\/+|\/+$/g, "")}/`
      : "";

    const buffer = Buffer.from(params.base64Data, "base64");
    assertImageMagicBytes(buffer, params.contentType);
    const { normalized, thumb } = await processImageForUpload(
      buffer,
      "flashcard",
      { detectedMime: detectImageMime(buffer) || params.contentType },
    );
    const baseName =
      params.fileName
        .replace(/\.[^/.]+$/, "")
        .replace(/[^a-zA-Z0-9_.-]/g, "_") || "flashcard";
    const filePath = `${ownerPrefix}${folderSegment}${timestamp}-${baseName}.${normalized.ext}`;

    const attemptUpload = async () => {
      return this.supabase.storage.from(bucket).upload(filePath, normalized.buffer, {
        contentType: normalized.contentType,
        cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
        upsert: false,
      });
    };

    let uploadResult = await attemptUpload();

    // If bucket doesn't exist, create it and retry once.
    if (
      uploadResult.error &&
      typeof uploadResult.error.message === "string" &&
      uploadResult.error.message.toLowerCase().includes("bucket") &&
      uploadResult.error.message.toLowerCase().includes("not found")
    ) {
      await this.supabase.storage.createBucket(bucket, { public: false });
      uploadResult = await attemptUpload();
    }

    const { error } = uploadResult;
    if (error) {
      logger.error("Error uploading flashcard image:", { error, filePath });
      throw new Error(error.message);
    }

    await this.uploadSiblingThumb(bucket, filePath, thumb);
    const signedUrl = await this.createSignedStorageUrl(bucket, filePath);

    return {
      url: signedUrl,
      path: filePath,
    };
  }

  /** SEC-07: marketplace images — magic-byte validated server upload. */
  async uploadMarketplaceImage(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    listingId?: string;
  }): Promise<{ url: string; path: string; storageUrl: string }> {
    const bucket = "marketplace-images";
    const timestamp = Date.now();
    const buffer = Buffer.from(params.base64Data, "base64");
    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error("Image exceeds 10 MB limit");
    }
    // Prefer magic bytes — clients often send the wrong MIME after compression / camera export.
    const detected = detectImageMime(buffer);
    if (!detected) {
      throw new Error(
        "File content is not a supported image (JPEG, PNG, GIF, or WebP). HEIC/HEIF photos must be converted first.",
      );
    }
    const { normalized, thumb } = await processImageForUpload(
      buffer,
      "marketplace",
      { detectedMime: detected },
    );
    const baseName =
      params.fileName
        .replace(/\.[^/.]+$/, "")
        .replace(/[^a-zA-Z0-9_.-]/g, "_") || "photo";
    const safeName = `${baseName}.${normalized.ext}`;
    const ownerPrefix = `${params.userId.replace(/[^a-zA-Z0-9_-]/g, "")}/`;
    const listingSegment = params.listingId
      ? `listings/${params.listingId.replace(/[^a-zA-Z0-9_-]/g, "")}/`
      : "temp/";
    const filePath = `${ownerPrefix}${listingSegment}${timestamp}-${safeName}`;

    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(filePath, normalized.buffer, {
        contentType: normalized.contentType,
        cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
        upsert: false,
      });
    if (error) {
      logger.error("Error uploading marketplace image:", { error, filePath });
      throw new Error(error.message);
    }

    // Grid thumbnail at a deterministic sibling path (<path>.thumb.webp).
    await this.uploadSiblingThumb(bucket, filePath, thumb);

    const base = process.env.SUPABASE_URL?.replace(/\/$/, "") || "";
    const storageUrl = `${base}/storage/v1/object/${bucket}/${filePath}`;

    return {
      url: await this.createSignedStorageUrl(bucket, filePath),
      path: filePath,
      storageUrl,
    };
  }

  /** SEC-07: chat images stored under note-files/{userId}/chat/{groupId}/... */
  async uploadChatImage(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    groupId?: string;
  }): Promise<{ url: string; path: string }> {
    const bucket = "note-files";
    const timestamp = Date.now();
    const ownerPrefix = `${params.userId.replace(/[^a-zA-Z0-9_-]/g, "")}/`;
    const chatId = (params.groupId || "general").replace(/[^a-zA-Z0-9_-]/g, "");
    if (params.groupId) {
      const member = await this.isGroupMember(params.groupId, params.userId);
      if (!member) throw new Error("Not a member of this group");
    }
    const buffer = Buffer.from(params.base64Data, "base64");
    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error("Image exceeds 10 MB limit");
    }
    assertImageMagicBytes(buffer, params.contentType);
    const { normalized, thumb } = await processImageForUpload(buffer, "chat", {
      detectedMime: detectImageMime(buffer) || params.contentType,
    });
    const baseName =
      params.fileName
        .replace(/\.[^/.]+$/, "")
        .replace(/[^a-zA-Z0-9_.-]/g, "_") || "chat";
    const filePath = `${ownerPrefix}chat/${chatId}/${timestamp}-${baseName}.${normalized.ext}`;

    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(filePath, normalized.buffer, {
        contentType: normalized.contentType,
        cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
        upsert: false,
      });
    if (error) {
      logger.error("Error uploading chat image:", { error, filePath });
      throw new Error(error.message);
    }

    await this.uploadSiblingThumb(bucket, filePath, thumb);

    return {
      // `clampSignedUrlTtl` caps every signed URL at STORAGE_SIGNED_URL_MAX_TTL
      // (24h), so asking for a week only ever produced a 24h URL that then
      // rotted inside `messages.text`. Ask for what we actually get, and let
      // clients re-sign on read (POST /api/v1/storage/signed-url[s]).
      url: await this.createSignedStorageUrl(
        bucket,
        filePath,
        STORAGE_SIGNED_URL_MAX_TTL,
      ),
      path: filePath,
    };
  }

  /** Chat voice notes under note-files/{userId}/chat/{groupId|dm/threadId}/... */
  async uploadChatAudio(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    groupId?: string;
    threadId?: string;
  }): Promise<{ url: string; path: string }> {
    const bucket = "note-files";
    const timestamp = Date.now();
    const safeName = params.fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const ownerPrefix = `${params.userId.replace(/[^a-zA-Z0-9_-]/g, "")}/`;
    const allowed = [
      "audio/webm",
      "audio/mp4",
      "audio/m4a",
      "audio/mpeg",
      "audio/ogg",
      "audio/wav",
      "audio/x-m4a",
    ];
    const contentType =
      params.contentType === "audio/x-m4a" ? "audio/mp4" : params.contentType;
    if (
      !allowed.includes(params.contentType) &&
      !allowed.includes(contentType)
    ) {
      throw new Error(
        "Unsupported audio type. Use webm, mp4/m4a, ogg, or wav.",
      );
    }
    let chatSegment: string;
    if (params.groupId) {
      const member = await this.isGroupMember(params.groupId, params.userId);
      if (!member) throw new Error("Not a member of this group");
      chatSegment = params.groupId.replace(/[^a-zA-Z0-9_-]/g, "");
    } else if (params.threadId) {
      const participant = await this.isDmThreadParticipant(
        params.threadId,
        params.userId,
      );
      if (!participant)
        throw new Error("Not a participant of this conversation");
      chatSegment = `dm/${params.threadId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    } else {
      chatSegment = "general";
    }
    const filePath = `${ownerPrefix}chat/${chatSegment}/${timestamp}-${safeName}`;
    const buffer = Buffer.from(params.base64Data, "base64");
    if (buffer.length > 8 * 1024 * 1024) {
      throw new Error("Audio exceeds 8 MB limit");
    }
    if (buffer.length < 256) {
      throw new Error("Audio recording is empty or too short");
    }

    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(filePath, buffer, {
        contentType,
        cacheControl: "3600",
        upsert: false,
      });
    if (error) {
      logger.error("Error uploading chat audio:", { error, filePath });
      throw new Error(error.message);
    }

    return {
      // `clampSignedUrlTtl` caps every signed URL at STORAGE_SIGNED_URL_MAX_TTL
      // (24h), so asking for a week only ever produced a 24h URL that then
      // rotted inside `messages.text`. Ask for what we actually get, and let
      // clients re-sign on read (POST /api/v1/storage/signed-url[s]).
      url: await this.createSignedStorageUrl(
        bucket,
        filePath,
        STORAGE_SIGNED_URL_MAX_TTL,
      ),
      path: filePath,
    };
  }

  /** SEC-07: question/message images — magic-byte validated server upload. */
  async uploadQuestionImage(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
  }): Promise<{ url: string; path: string }> {
    const bucket = "question-images";
    const timestamp = Date.now();
    const ownerPrefix = `${params.userId.replace(/[^a-zA-Z0-9_-]/g, "")}/`;
    const buffer = Buffer.from(params.base64Data, "base64");
    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error("Image exceeds 10 MB limit");
    }
    assertImageMagicBytes(buffer, params.contentType);
    const { normalized, thumb } = await processImageForUpload(
      buffer,
      "question",
      { detectedMime: detectImageMime(buffer) || params.contentType },
    );
    const baseName =
      params.fileName
        .replace(/\.[^/.]+$/, "")
        .replace(/[^a-zA-Z0-9_.-]/g, "_") || "question";
    const filePath = `${ownerPrefix}questions/${timestamp}-${baseName}.${normalized.ext}`;

    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(filePath, normalized.buffer, {
        contentType: normalized.contentType,
        cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
        upsert: false,
      });
    if (error) {
      logger.error("Error uploading question image:", { error, filePath });
      throw new Error(error.message);
    }

    await this.uploadSiblingThumb(bucket, filePath, thumb);

    return {
      url: await this.createSignedStorageUrl(bucket, filePath),
      path: filePath,
    };
  }

  async uploadProfileAvatar(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
  }): Promise<{ url: string; path: string; avatarUrl: string }> {
    const bucket = "profile-avatars";
    const safeUserId = params.userId.replace(/[^a-zA-Z0-9_-]/g, "");
    const buffer = Buffer.from(params.base64Data, "base64");
    // Prefer magic-byte detection — web clients compress to WebP but often send the original file MIME.
    const detected = detectImageMime(buffer);
    if (!detected) {
      throw new Error(
        "File content is not a supported image (JPEG, PNG, GIF, or WebP).",
      );
    }
    const { normalized } = await processImageForUpload(buffer, "avatar", {
      detectedMime: detected,
    });
    // Versioned path so clients and CDNs do not keep serving a stale avatar after replace.
    const version = Date.now();
    const filePath = `${safeUserId}/avatar-${version}.${normalized.ext}`;

    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(filePath, normalized.buffer, {
        contentType: normalized.contentType,
        cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
        upsert: true,
      });

    if (error) {
      logger.error("Error uploading profile avatar:", { error, filePath });
      throw new Error(error.message);
    }

    // Best-effort cleanup of older avatar objects for this user.
    try {
      const { data: existing } = await this.supabase.storage
        .from(bucket)
        .list(safeUserId, { limit: 50 });
      const stale = (existing || [])
        .map((obj) => obj.name)
        .filter(
          (name) =>
            name.startsWith("avatar") &&
            name !== `avatar-${version}.${normalized.ext}`,
        )
        .map((name) => `${safeUserId}/${name}`);
      if (stale.length > 0) {
        await this.supabase.storage.from(bucket).remove(stale);
      }
    } catch (cleanupError) {
      logger.warn("Failed to clean up old profile avatars", {
        cleanupError,
        userId: safeUserId,
      });
    }

    const signedUrl = await this.createSignedStorageUrl(bucket, filePath);
    const base = process.env.SUPABASE_URL?.replace(/\/$/, "") || "";
    const avatarUrl = `${base}/storage/v1/object/${bucket}/${filePath}`;

    return { url: signedUrl, path: filePath, avatarUrl };
  }

  async uploadGroupAvatar(params: {
    groupId: string;
    fileName: string;
    base64Data: string;
    contentType: string;
  }): Promise<{ url: string; path: string; avatarUrl: string }> {
    const bucket = "group-avatars";
    const safeGroupId = params.groupId.replace(/[^a-zA-Z0-9_-]/g, "");
    const buffer = Buffer.from(params.base64Data, "base64");
    const detected = detectImageMime(buffer);
    if (!detected) {
      throw new Error(
        "File content is not a supported image (JPEG, PNG, GIF, or WebP).",
      );
    }
    const { normalized } = await processImageForUpload(buffer, "avatar", {
      detectedMime: detected,
    });
    const version = Date.now();
    const filePath = `${safeGroupId}/avatar-${version}.${normalized.ext}`;

    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(filePath, normalized.buffer, {
        contentType: normalized.contentType,
        cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
        upsert: true,
      });

    if (error) {
      logger.error("Error uploading group avatar:", { error, filePath });
      throw new Error(error.message);
    }

    try {
      const { data: existing } = await this.supabase.storage
        .from(bucket)
        .list(safeGroupId, { limit: 50 });
      const stale = (existing || [])
        .map((obj) => obj.name)
        .filter(
          (name) =>
            name.startsWith("avatar") &&
            name !== `avatar-${version}.${normalized.ext}`,
        )
        .map((name) => `${safeGroupId}/${name}`);
      if (stale.length > 0) {
        await this.supabase.storage.from(bucket).remove(stale);
      }
    } catch (cleanupError) {
      logger.warn("Failed to clean up old group avatars", {
        cleanupError,
        groupId: safeGroupId,
      });
    }

    const signedUrl = await this.createSignedStorageUrl(bucket, filePath);
    const base = process.env.SUPABASE_URL?.replace(/\/$/, "") || "";
    const avatarUrl = `${base}/storage/v1/object/${bucket}/${filePath}`;

    return { url: signedUrl, path: filePath, avatarUrl };
  }

  // Offline bundle persistence
  async getOfflineBundles(
    userId: string,
    options: {
      /** Academic archive filter (offline_bundles.course_id): unfiled → IS NULL, course → eq. */
      courseFilter?: CourseFilter;
    } = {},
  ): Promise<any[]> {
    let query = this.supabase
      .from("offline_bundles")
      .select("*")
      .eq("user_id", userId)
      .order("downloaded_at", { ascending: false });
    query = applyCourseFilter(query, "course_id", options.courseFilter);

    const { data, error } = await query;

    if (error) {
      logger.error("Error fetching offline bundles:", { error, userId });
      throw error;
    }

    return data || [];
  }

  async saveOfflineBundle(userId: string, bundle: any): Promise<void> {
    // Course lives in BOTH the column (filterable) and config.courseId (the
    // shape the offline runtime already round-trips).
    const courseId = resolveCourseIdFromConfigLike(bundle);
    const config = { ...(bundle.config || {}) };
    if (courseId) config.courseId = courseId;
    else if (bundle.courseId === null) delete config.courseId;
    const insert = {
      user_id: userId,
      bundle_id: bundle.bundleId,
      config,
      course_id: courseId,
      questions: bundle.questions || [],
      group_name: bundle.groupName || null,
      display_name: bundle.displayName ?? null,
      downloaded_at: bundle.downloadedAt || new Date().toISOString(),
    };

    const { data, error } = await this.supabase
      .from("offline_bundles")
      .upsert(insert, { onConflict: "user_id,bundle_id" });

    if (error) {
      logger.error("Error saving offline bundle:", {
        error,
        userId,
        bundleId: bundle.bundleId,
      });
      throw error;
    }

    return;
  }

  async deleteOfflineBundle(userId: string, bundleId: string): Promise<void> {
    const { error } = await this.supabase
      .from("offline_bundles")
      .delete()
      .eq("user_id", userId)
      .eq("bundle_id", bundleId);

    if (error) {
      logger.error("Error deleting offline bundle:", {
        error,
        userId,
        bundleId,
      });
      throw error;
    }

    return;
  }

  async getAccessibleDeckIds(userId: string): Promise<string[]> {
    const [
      { data: ownedDecks, error: ownedError },
      { data: collaboratorRows, error: collabError },
    ] = await Promise.all([
      this.supabase.from("decks").select("id").eq("user_id", userId),
      this.supabase
        .from("deck_collaborators")
        .select("deck_id")
        .eq("user_id", userId),
    ]);

    if (ownedError) throw ownedError;
    if (collabError) throw collabError;

    const ids = new Set<string>();
    for (const deck of ownedDecks || []) ids.add(deck.id);
    for (const row of collaboratorRows || []) {
      if (row.deck_id) ids.add(row.deck_id);
    }
    return Array.from(ids);
  }

  /** Internal fetch — no access check. */
  private async fetchDeckRecord(deckId: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from("decks")
      .select("id, name, description, user_id, is_shared, course_id, created_at")
      .eq("id", deckId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async verifyDeckAccess(
    userId: string,
    deckId: string,
    level: "read" | "edit" | "owner" = "read",
  ): Promise<boolean> {
    const deck = await this.fetchDeckRecord(deckId);
    if (!deck) return false;

    const isOwner = deck.user_id === userId;
    if (level === "owner") return isOwner;
    if (isOwner) return true;

    const { data: collab, error: collabError } = await this.supabase
      .from("deck_collaborators")
      .select("role")
      .eq("deck_id", deckId)
      .eq("user_id", userId)
      .maybeSingle();

    if (collabError) throw collabError;

    if (collab) {
      if (level === "read") return true;
      if (level === "edit")
        return collab.role === "editor" || collab.role === "owner";
    }

    if (level === "read" && deck.is_shared) return true;
    return false;
  }

  async getDeckForUser(deckId: string, userId: string): Promise<any | null> {
    const cacheKey = `deck:${deckId}:user:${userId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached !== null) return cached;

    const hasAccess = await this.verifyDeckAccess(userId, deckId, "read");
    if (!hasAccess) return null;

    const deck = await this.fetchDeckRecord(deckId);
    if (deck) await cacheService.set(cacheKey, deck, 1800);
    return deck;
  }

  async getFlashcardForUser(
    flashcardId: string,
    userId: string,
  ): Promise<any | null> {
    const cacheKey = `flashcard:${flashcardId}:user:${userId}`;
    const cached = await cacheService.get<any>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from("flashcards")
      .select("*")
      .eq("id", flashcardId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const hasAccess = await this.verifyDeckAccess(userId, data.deck_id, "read");
    if (!hasAccess) return null;

    await cacheService.set(cacheKey, data, 1800);
    return data;
  }

  async getFlashcards(
    userId: string,
    deckId?: string,
    options?: {
      page?: number;
      limit?: number;
      responseProfile?: "compact" | "full";
    },
  ): Promise<any[]> {
    const {
      page = 1,
      limit = SupabaseService.DEFAULT_FLASHCARD_PAGE_SIZE,
      responseProfile = "full",
    } = options || {};
    const profile = this.getResponseProfile(responseProfile);
    const safeLimit = Math.min(
      SupabaseService.MAX_FLASHCARD_PAGE_SIZE,
      Math.max(1, limit),
    );
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * safeLimit;

    const selectClause =
      profile === "compact"
        ? "id, deck_id, type, front, image_url, tags, created_at, version, updated_at"
        : "id, deck_id, type, front, back, cloze_text, image_url, occlusion_data, srs_data, tags, created_at, version, updated_at";

    const accessibleDeckIds = await this.getAccessibleDeckIds(userId);

    if (accessibleDeckIds.length === 0) {
      return [];
    }

    let query = this.supabase
      .from("flashcards")
      .select(selectClause)
      .in("deck_id", accessibleDeckIds)
      .order("created_at", { ascending: false });

    if (deckId) {
      if (!accessibleDeckIds.includes(deckId)) {
        return [];
      }
      query = query.eq("deck_id", deckId);
    }

    const { data, error } = await query.range(offset, offset + safeLimit - 1);

    if (error) throw error;

    return data || [];
  }

  async getFlashcard(flashcardId: string): Promise<any | null> {
    const cacheKey = `flashcard:${flashcardId}`;
    const cached = await cacheService.get<any>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from("flashcards")
      .select("*")
      .eq("id", flashcardId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    await cacheService.set(cacheKey, data, 1800); // 30 minutes
    return data;
  }

  async getFlashcardComments(flashcardId: string): Promise<any[]> {
    const cacheKey = `flashcard_comments:${flashcardId}`;
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from("flashcard_comments")
      .select("*")
      .eq("flashcard_id", flashcardId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    await cacheService.set(cacheKey, data, 300);
    return data;
  }

  async addFlashcardComment(
    flashcardId: string,
    userId: string,
    comment: string,
  ): Promise<any> {
    const { data, error } = await this.supabase
      .from("flashcard_comments")
      .insert({ flashcard_id: flashcardId, user_id: userId, comment })
      .select()
      .single();

    if (error) throw error;

    await cacheService.delete(`flashcard_comments:${flashcardId}`);
    return data;
  }

  async reviewFlashcard(
    flashcardId: string,
    userId: string,
    rating: "again" | "hard" | "good" | "easy",
    options: {
      expectedVersion?: number;
      /** 'web' | 'mobile' from x-lantern-surface; default 'api'. */
      surface?: LearningSurface;
      /** Offline replay: when the grade was actually given (ISO). */
      occurredAt?: string | null;
    } = {},
  ): Promise<any | null> {
    const existing = await this.getFlashcardForUser(flashcardId, userId);
    if (!existing) return null;

    const canEdit = await this.verifyDeckAccess(
      userId,
      existing.deck_id,
      "edit",
    );
    if (!canEdit) return null;

    const prefs = await this.getUserPreferences(userId);
    const settings = normalizeUserSettings(
      prefs?.preferences ?? prefs?.settings ?? {},
    );
    const newSrsData = calculateFsrsData(existing.srs_data, rating, {
      maxInterval: getSrsMaxInterval(settings.study),
    });

    const expectedVersion =
      options.expectedVersion != null &&
      Number.isFinite(Number(options.expectedVersion))
        ? Number(options.expectedVersion)
        : Number(existing.version) || 1;
    const updated = await this.updateFlashcard(
      flashcardId,
      { srsData: newSrsData },
      userId,
      { expectedVersion },
    );

    // learning_events: card_reviewed with the FSRS state before/after. Only
    // after the CAS write landed (a 409 throws above and emits nothing).
    // recordLearningEvent never throws — the review never fails on telemetry.
    if (updated) {
      // One round trip for BOTH the course id (telemetry, as before) and the
      // deck owner (needed by the two Phase 3 writes below) — same query count
      // this path had previously.
      const deckMeta = await lookupDeckOwnerAndCourse(this, existing.deck_id);

      await recordLearningEvent(
        this,
        buildCardReviewedEvent({
          userId,
          flashcardId,
          deckId: existing.deck_id,
          courseId: deckMeta.courseId,
          rating,
          srsBefore: existing.srs_data ?? null,
          srsAfter: updated.srs_data ?? newSrsData,
          surface: options.surface ?? "api",
          occurredAt: options.occurredAt ?? null,
        }),
      );

      // Keep the mastery graph's card-side numbers (due counts, maturity)
      // moving with reviews, not only test submissions. The service debounces
      // (30s), so a 60-card session costs a couple of refreshes, and
      // refresh() never throws — a stale graph must not fail a review.
      try {
        const { getTopicMasteryService } = await import("./topicMastery");
        getTopicMasteryService(this).refreshAsync(userId);
      } catch {
        /* mastery refresh is best-effort */
      }

      // Phase 3 M + O — "this person studied this deck", at most once per
      // window per (deck, user).
      //
      // This is the hottest path in the app: it fires on EVERY graded card, so
      // a realistic session is 20-100 calls of which exactly one is useful.
      // record_deck_study is idempotent (it counts distinct people, not
      // sessions), so an unguarded call would be correct but would burn a
      // round trip per card. The cache key is set only AFTER the work resolves,
      // so a transient failure retries on the next card instead of being
      // suppressed for the whole window.
      if (deckMeta.ownerId && deckMeta.ownerId !== userId) {
        const studyKey = `deck_study:${existing.deck_id}:${userId}`;
        void (async () => {
          try {
            if (await cacheService.get(studyKey)) return;
            // supabase-js RESOLVES on a PostgREST/Postgres error rather than
            // rejecting, so the result must be inspected. Without this the
            // catch below never fires, the key is stamped anyway, and the
            // "transient failures self-heal on the next card" promise in the
            // comment above is silently false for a full 6 hours.
            const { error: studyError } = await this.supabase.rpc("record_deck_study", {
              p_deck_id: existing.deck_id,
              p_user_id: userId,
            });
            if (studyError) throw studyError;
            const { getLearningConnectionsService } = await import("./learningConnections");
            await getLearningConnectionsService(this).record({
              // The deck's OWNER is the actor — their deck taught someone.
              // `userId` here is the STUDIER and is the beneficiary; passing it
              // as actorId would invert the metric.
              actorId: deckMeta.ownerId as string,
              beneficiaryId: userId,
              kind: "deck_collaborated",
              objectType: "deck",
              objectId: existing.deck_id,
              courseId: deckMeta.courseId,
            });
            await cacheService.set(studyKey, 1, 6 * 60 * 60);
          } catch {
            /* best-effort: a counter must never fail a review */
          }
        })();
      }
    }
    return updated;
  }

  async updateFlashcard(
    flashcardId: string,
    updates: {
      front?: string;
      back?: string;
      clozeText?: string;
      imageUrl?: string;
      occlusionData?: any;
      srsData?: any;
      tags?: string[];
    },
    userId?: string,
    options: { expectedVersion?: number } = {},
  ): Promise<any | null> {
    const existing = userId
      ? await this.getFlashcardForUser(flashcardId, userId)
      : await this.getFlashcard(flashcardId);
    if (!existing) return null;
    if (userId) {
      const canEdit = await this.verifyDeckAccess(
        userId,
        existing.deck_id,
        "edit",
      );
      if (!canEdit) return null;
    }

    // Build update object with only defined fields.
    // CLOZE rows require front/back NULL (check_flashcard_fields); clients often
    // send front:'' which must not be written as an empty string.
    const updateData: any = buildFlashcardUpdateData(existing.type, updates);

    // If no fields to update, just return the current flashcard
    if (Object.keys(updateData).length === 0) {
      return existing;
    }

    const expectedVersion =
      options.expectedVersion != null
        ? Number(options.expectedVersion)
        : Number(existing.version) || 1;

    const { data, error } = await this.supabase
      .from("flashcards")
      .update(updateData)
      .eq("id", flashcardId)
      .eq("version", expectedVersion)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === "PGRST116") return null;
      logger.error("Error updating flashcard:", {
        error,
        flashcardId,
        updates,
      });
      throw new Error(error.message || "Failed to update flashcard");
    }

    if (!data) {
      const current = userId
        ? await this.getFlashcardForUser(flashcardId, userId)
        : await this.getFlashcard(flashcardId);
      throw new VersionConflictError(
        "Flashcard was updated by another request. Retry the review.",
        current,
      );
    }

    // Update cache and invalidate deck cache
    await cacheService.set(`flashcard:${flashcardId}`, data, 1800);
    if (userId)
      await cacheService.delete(`flashcard:${flashcardId}:user:${userId}`);
    await cacheService.deletePattern(`flashcards:*`);

    return data;
  }

  async deleteFlashcard(
    flashcardId: string,
    userId?: string,
  ): Promise<boolean> {
    const flashcard = userId
      ? await this.getFlashcardForUser(flashcardId, userId)
      : await this.getFlashcard(flashcardId);
    if (!flashcard) return false;
    if (userId) {
      const canEdit = await this.verifyDeckAccess(
        userId,
        flashcard.deck_id,
        "edit",
      );
      if (!canEdit) return false;
    }

    const { error } = await this.supabase
      .from("flashcards")
      .delete()
      .eq("id", flashcardId);

    if (error) throw error;

    // Clear caches
    await cacheService.delete(`flashcard:${flashcardId}`);
    await cacheService.deletePattern(`flashcards:*`);

    return true;
  }

  /**
   * Attach question stems / group names from chat messages so dashboards can
   * render "Questions to review" even when lean test history omits questions.
   */
  private async attachQuestionStatStems(rows: any[]): Promise<any[]> {
    if (!rows.length) return rows;
    const questionIds = [
      ...new Set(
        rows
          .map((row) => row?.question_id || row?.questionId)
          .filter((id): id is string => typeof id === "string" && !!id),
      ),
    ];
    if (!questionIds.length) return rows;

    const { data: messages, error } = await this.supabase
      .from("messages")
      .select("id, group_id, text, question_data, groups:group_id(name)")
      .in("id", questionIds);

    if (error) {
      logger.warn("Failed to attach question stems for user stats", { error });
      return rows;
    }

    const byId = new Map<string, any>();
    (messages || []).forEach((msg: any) => {
      if (msg?.id) byId.set(msg.id, msg);
    });

    return rows.map((row) => {
      const questionId = row?.question_id || row?.questionId;
      const msg = questionId ? byId.get(questionId) : null;
      if (!msg) return row;
      const qd =
        msg.question_data && typeof msg.question_data === "object"
          ? msg.question_data
          : {};
      const stem =
        (typeof qd.questionStem === "string" && qd.questionStem) ||
        (typeof qd.question === "string" && qd.question) ||
        (typeof qd.text === "string" && qd.text) ||
        (typeof msg.text === "string" && msg.text) ||
        null;
      const groupProfile = Array.isArray(msg.groups)
        ? msg.groups[0]
        : msg.groups;
      const groupName =
        (typeof groupProfile?.name === "string" && groupProfile.name) || null;
      return {
        ...row,
        question_stem: stem,
        group_id: msg.group_id || row.group_id || null,
        group_name: groupName,
      };
    });
  }

  async getUserQuestionStats(userId: string): Promise<any[]> {
    const cacheKey = `user-stats:${userId}`;
    const cached = await cacheService.get<any[]>(cacheKey);
    let rows: any[];
    if (cached !== null && cached !== undefined) {
      rows = Array.isArray(cached) ? cached : [];
    } else {
      const { data, error } = await this.supabase
        .from("user_question_stats")
        .select("*")
        .eq("user_id", userId)
        .order("last_attempted", { ascending: false });

      if (error) throw error;

      rows = Array.isArray(data) ? data : [];
      await cacheService.set(cacheKey, rows, 1800); // 30 minutes
    }

    return this.attachQuestionStatStems(rows);
  }

  async updateUserQuestionStats(
    userId: string,
    questionId: string,
    stats: {
      correct_attempts?: number;
      incorrect_attempts?: number;
      last_attempted?: Date;
    },
  ): Promise<any> {
    // Check if stats exist
    const { data: existing, error: checkError } = await this.supabase
      .from("user_question_stats")
      .select("*")
      .eq("user_id", userId)
      .eq("question_id", questionId)
      .single();

    if (checkError && checkError.code !== "PGRST116") throw checkError;

    let result;
    if (existing) {
      // Update existing stats
      const { data, error } = await this.supabase
        .from("user_question_stats")
        .update({
          correct_attempts:
            stats.correct_attempts !== undefined
              ? stats.correct_attempts
              : existing.correct_attempts,
          incorrect_attempts:
            stats.incorrect_attempts !== undefined
              ? stats.incorrect_attempts
              : existing.incorrect_attempts,
          last_attempted: stats.last_attempted || existing.last_attempted,
        })
        .eq("user_id", userId)
        .eq("question_id", questionId)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      // Create new stats
      const { data, error } = await this.supabase
        .from("user_question_stats")
        .insert({
          user_id: userId,
          question_id: questionId,
          correct_attempts: stats.correct_attempts || 0,
          incorrect_attempts: stats.incorrect_attempts || 0,
          last_attempted: stats.last_attempted || new Date(),
        })
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    // Invalidate both cache key shapes used by summary + dedicated routes.
    await cacheService.delete(`user-stats:${userId}`);
    await cacheService.delete(`user:question-stats:${userId}`);

    return result;
  }

  async getUserQuestionStat(
    userId: string,
    questionId: string,
  ): Promise<any | null> {
    const cacheKey = `user-stat:${userId}:${questionId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached !== null) return cached as any;

    const { data, error } = await this.supabase
      .from("user_question_stats")
      .select("*")
      .eq("user_id", userId)
      .eq("question_id", questionId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    await cacheService.set(cacheKey, data, 1800); // 30 minutes
    return data;
  }

  async upsertUserQuestionStat(
    userId: string,
    questionId: string,
    stats: {
      correctAttempts?: number;
      incorrectAttempts?: number;
      lastAttempted?: Date;
    },
  ): Promise<any> {
    // Check if stats exist
    const { data: existing, error: checkError } = await this.supabase
      .from("user_question_stats")
      .select("*")
      .eq("user_id", userId)
      .eq("question_id", questionId)
      .single();

    if (checkError && checkError.code !== "PGRST116") throw checkError;

    let result;
    if (existing) {
      // Update existing stats
      const { data, error } = await this.supabase
        .from("user_question_stats")
        .update({
          correct_attempts:
            stats.correctAttempts !== undefined
              ? stats.correctAttempts
              : existing.correct_attempts,
          incorrect_attempts:
            stats.incorrectAttempts !== undefined
              ? stats.incorrectAttempts
              : existing.incorrect_attempts,
          last_attempted: stats.lastAttempted || existing.last_attempted,
        })
        .eq("user_id", userId)
        .eq("question_id", questionId)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      // Create new stats
      const { data, error } = await this.supabase
        .from("user_question_stats")
        .insert({
          user_id: userId,
          question_id: questionId,
          correct_attempts: stats.correctAttempts || 0,
          incorrect_attempts: stats.incorrectAttempts || 0,
          last_attempted: stats.lastAttempted || new Date(),
        })
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    // Invalidate both cache key shapes used by summary + dedicated routes.
    await cacheService.delete(`user-stats:${userId}`);
    await cacheService.delete(`user:question-stats:${userId}`);

    return result;
  }

  async resetDeckStatistics(deckId: string, userId: string): Promise<any> {
    const canEdit = await this.verifyDeckAccess(userId, deckId, "edit");
    if (!canEdit) throw new Error("Deck not found or access denied");

    // clear srs_data on all cards in deck so they appear new again
    const { error: cardError } = await this.supabase
      .from("flashcards")
      .update({ srs_data: {} })
      .eq("deck_id", deckId);

    if (cardError) throw cardError;

    // Reviews read the card (and its version) through the per-card caches
    // (`flashcard:{id}` and `flashcard:{id}:user:{userId}`). The bulk update
    // above just changed every card underneath those entries, so a review
    // graded after a reset would validate against a stale version and be
    // dropped. Purge each card's cache entries so the next read is fresh.
    const { data: deckCards, error: deckCardsError } = await this.supabase
      .from("flashcards")
      .select("id")
      .eq("deck_id", deckId);
    if (deckCardsError) throw deckCardsError;
    await Promise.all(
      ((deckCards || []) as Array<{ id: string }>).flatMap((card) => [
        cacheService.delete(`flashcard:${card.id}`),
        cacheService.deletePattern(`flashcard:${card.id}:user:*`),
      ]),
    );

    // also invalidate any related cache entries
    await cacheService.deletePattern(`flashcards:*`);
    await cacheService.delete(`deck:${deckId}`);

    return { success: true };
  }

  async getDirectMessages(
    userId: string,
    otherUserId: string,
    options: {
      page?: number;
      limit?: number;
    } = {},
  ): Promise<Message[]> {
    const { page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;

    // Create thread ID from sorted user IDs
    const sortedIds = [userId, otherUserId].sort();
    const threadId = sortedIds.join("-");

    try {
      const { data: threadMeta } = await this.supabase
        .from("dm_threads")
        .select("history_cleared_at")
        .eq("id", threadId)
        .maybeSingle();
      const historyClearedAt = readDmHistoryClearedAt(
        threadMeta?.history_cleared_at,
        userId,
      );

      const baseDmSelect = `
          id,
          thread_id,
          sender_id,
          text,
          timestamp,
          edited_at,
          removed_at,
          client_message_id,
          reply_to_message_id,
          thread_root_id,
          profiles:sender_id (
            id,
            name,
            avatar_url
          )
        `;
      // `dm_messages.reactions` lands in the same migration as
      // `messages.reactions` (20260830120000), so one capability answers for
      // both. Without it a DM read {} until a realtime UPDATE arrived.
      const runDmPage = (columns: string) => {
        let query = this.supabase
          .from("dm_messages")
          .select(columns)
          .eq("thread_id", threadId)
          .order("timestamp", { ascending: false })
          .range(offset, offset + limit - 1);

        // Delete-for-me: never return pre-cutoff history to the deleter.
        if (historyClearedAt) {
          query = query.gt("timestamp", historyClearedAt);
        }
        return query;
      };

      const dmSelect = await reactionColumns(this.supabase, baseDmSelect);
      let { data, error } = (await runDmPage(dmSelect)) as {
        data: any[] | null;
        error: any;
      };
      if (error && isMissingColumnError(error) && dmSelect !== baseDmSelect) {
        markMessageReactionsColumnMissing();
        ({ data, error } = (await runDmPage(baseDmSelect)) as {
          data: any[] | null;
          error: any;
        });
      }

      if (error) {
        logger.error("Error fetching DM messages from database", {
          error,
          threadId,
        });
        return [];
      }

      const withReplies = await this.attachReplyPreviewsBatch(
        data || [],
        "dm_messages",
      );
      const withCounts = await this.attachThreadReplyCounts(
        withReplies,
        "dm_messages",
        "thread_id",
        threadId,
      );

      const mapped = withCounts.reverse().map((msg: any) => ({
        id: msg.id,
        threadId: msg.thread_id,
        sender: mapProfileSender(
          resolveNestedProfile(msg.profiles),
          msg.sender_id,
        ),
        senderId: msg.sender_id,
        timestamp: new Date(msg.timestamp),
        type: "TEXT" as const,
        ...(!msg.removed_at ? { text: msg.text } : {}),
        editedAt: msg.edited_at || undefined,
        removedAt: msg.removed_at || undefined,
        isRemoved: !!msg.removed_at,
        upvotes: 0,
        downvotes: 0,
        flaggedAsSimilarUserIds: [],
        clientMessageId: msg.client_message_id || undefined,
        reactions: normalizeReactions(msg.reactions),
        replyToMessageId: msg.reply_to_message_id || undefined,
        replyTo: msg.replyTo || undefined,
        threadRootId: msg.thread_root_id || undefined,
        replyCount: typeof msg.replyCount === "number" ? msg.replyCount : 0,
      })) as Message[];

      return this.enrichDmMessageReceipts(
        mapped,
        threadId,
        userId,
        otherUserId,
      );
    } catch (error) {
      logger.error("Exception fetching DM messages", {
        error,
        userId,
        otherUserId,
      });
      return [];
    }
  }

  async sendDirectMessage(
    senderId: string,
    recipientId: string,
    content: string,
    options?: {
      bypassPrivacy?: boolean;
      clientMessageId?: string;
      replyToMessageId?: string;
    },
  ): Promise<Message> {
    let asMessageRequest = false;

    const { usersAreBlocked, resolveDirectMessageAccess } =
      await import("../utils/userSettingsPolicy");
    // Blocks always apply — even marketplace / bypassPrivacy paths.
    if (await usersAreBlocked(this.supabase, senderId, recipientId)) {
      throw new Error("You cannot message this user");
    }

    if (!options?.bypassPrivacy) {
      const { data: recipientProfile, error: recipientError } =
        await this.supabase
          .from("profiles")
          .select("settings")
          .eq("id", recipientId)
          .single();

      if (recipientError || !recipientProfile) {
        throw new Error("Recipient not found");
      }

      const access = await resolveDirectMessageAccess(
        this.supabase,
        senderId,
        recipientId,
        recipientProfile.settings,
      );
      if (access.mode === "deny") {
        throw new Error(access.reason || "Direct messages are not allowed");
      }
      asMessageRequest = access.mode === "request";
    }

    // Create thread ID from sorted user IDs
    const sortedIds = [senderId, recipientId].sort();
    const threadId = sortedIds.join("-");

    try {
      const { data: existingThread } = await this.supabase
        .from("dm_threads")
        .select("id, status, requested_by, archived_by, history_cleared_at")
        .eq("id", threadId)
        .maybeSingle();

      // Marketplace / bypass and recipient replies open the thread; cold outreach stays pending.
      let nextStatus: "open" | "pending" | "declined" = "open";
      let nextRequestedBy: string | null = null;
      if (options?.bypassPrivacy) {
        nextStatus = "open";
        nextRequestedBy = null;
      } else if (asMessageRequest) {
        nextStatus = "pending";
        nextRequestedBy =
          (typeof existingThread?.requested_by === "string" &&
            existingThread.requested_by) ||
          senderId;
      } else if (
        existingThread?.status === "pending" &&
        existingThread.requested_by !== senderId
      ) {
        // Recipient replied → accept.
        nextStatus = "open";
        nextRequestedBy = null;
      } else if (existingThread?.status === "open") {
        nextStatus = "open";
        nextRequestedBy = null;
      } else {
        nextStatus = "open";
        nextRequestedBy = null;
      }

      const { error: threadError } = await this.supabase
        .from("dm_threads")
        .upsert(
          {
            id: threadId,
            participant_ids: sortedIds,
            participants: {},
            last_message: content,
            last_message_time: new Date().toISOString(),
            status: nextStatus,
            requested_by: nextRequestedBy,
          },
          { onConflict: "id" },
        );

      if (threadError) {
        logger.error("Error creating/updating DM thread", {
          error: threadError,
        });
        throw new Error(`Failed to create DM thread: ${threadError.message}`);
      }

      // Insert the message
      const insertPayload: Record<string, unknown> = {
        thread_id: threadId,
        sender_id: senderId,
        text: content,
      };
      if (options?.clientMessageId) {
        insertPayload.client_message_id = options.clientMessageId;
      }
      if (options?.replyToMessageId) {
        insertPayload.reply_to_message_id = options.replyToMessageId;
        insertPayload.thread_root_id = await this.resolveThreadRootForReply(
          "dm_messages",
          options.replyToMessageId,
          { threadId },
        );
      }

      const dmSelect = `
          id,
          thread_id,
          sender_id,
          text,
          timestamp,
          edited_at,
          removed_at,
          client_message_id,
          reply_to_message_id,
          thread_root_id,
          profiles:sender_id (
            id,
            name,
            avatar_url
          )
        `;

      const { data, error } = await this.supabase
        .from("dm_messages")
        .insert(insertPayload)
        .select(dmSelect)
        .single();

      if (error) {
        if (error.code === "23505" && options?.clientMessageId) {
          const { data: existing } = await this.supabase
            .from("dm_messages")
            .select(dmSelect)
            .eq("thread_id", threadId)
            .eq("sender_id", senderId)
            .eq("client_message_id", options.clientMessageId)
            .maybeSingle();
          if (existing) {
            const withReply = await this.attachReplyPreview(
              existing,
              "dm_messages",
            );
            return {
              id: withReply.id,
              sender: mapProfileSender(
                resolveNestedProfile(withReply.profiles),
                withReply.sender_id,
              ),
              senderId: withReply.sender_id,
              recipientId,
              timestamp: new Date(withReply.timestamp),
              type: "TEXT" as const,
              ...(!withReply.removed_at ? { text: withReply.text } : {}),
              editedAt: withReply.edited_at || undefined,
              removedAt: withReply.removed_at || undefined,
              isRemoved: !!withReply.removed_at,
              upvotes: 0,
              downvotes: 0,
              flaggedAsSimilarUserIds: [],
              clientMessageId:
                withReply.client_message_id || options?.clientMessageId || undefined,
              replyToMessageId: withReply.reply_to_message_id || undefined,
              replyTo: withReply.replyTo || undefined,
              threadRootId: withReply.thread_root_id || undefined,
              replyCount: 0,
              receiptStatus: "sent" as const,
            } as unknown as Message;
          }
        }
        logger.error("Error inserting DM message", { error });
        throw new Error(`Failed to send DM: ${error.message}`);
      }

      // Un-archive for recipient, un-hide for inbox resurrection, and update
      // last message. Clearing hidden_by resurfaces the thread. Clear the *sender's*
      // history_cleared_at so their first message after delete-for-me is visible;
      // the recipient's cutoff is preserved.
      const archivedBy: string[] = Array.isArray(existingThread?.archived_by)
        ? existingThread.archived_by
        : [];
      const updatedArchivedBy = archivedBy.filter(
        (id: string) => id !== recipientId,
      );
      const nextHistoryClearedAt = clearDmHistoryClearedAtForUser(
        existingThread?.history_cleared_at,
        senderId,
      );

      await this.supabase
        .from("dm_threads")
        .update({
          last_message: content,
          last_message_time: new Date().toISOString(),
          archived_by: updatedArchivedBy,
          hidden_by: [],
          status: nextStatus,
          requested_by: nextRequestedBy,
          history_cleared_at: nextHistoryClearedAt,
        })
        .eq("id", threadId);

      const senderProfile = Array.isArray(data.profiles)
        ? (data.profiles as unknown as any[])[0]
        : (data.profiles as unknown as any);
      const senderName = senderProfile?.name || "Someone";
      const preview =
        content.length > 80 ? `${content.slice(0, 80)}…` : content;
      const isRequestNotify = nextStatus === "pending";

      void this.createNotification(recipientId, {
        message: isRequestNotify
          ? `${senderName} sent a message request: "${preview}"`
          : `${senderName} sent you a message`,
        link: `dm:${threadId}:${senderId}`,
        type: isRequestNotify ? "dm_message_request" : "dm_message",
        data: {
          threadId,
          senderId,
          messageId: data.id,
          preview,
          status: nextStatus,
        },
      }).catch((err) => {
        logger.error("Failed to create DM notification", {
          error: err,
          recipientId,
          threadId,
        });
      });

      const withReply = await this.attachReplyPreview(data, "dm_messages");
      return {
        id: withReply.id,
        sender: mapProfileSender(
          resolveNestedProfile(withReply.profiles),
          withReply.sender_id,
        ),
        senderId: withReply.sender_id,
        recipientId,
        timestamp: new Date(withReply.timestamp),
        type: "TEXT" as const,
        text: withReply.text,
        editedAt: withReply.edited_at || undefined,
        removedAt: withReply.removed_at || undefined,
        isRemoved: !!withReply.removed_at,
        upvotes: 0,
        downvotes: 0,
        flaggedAsSimilarUserIds: [],
        clientMessageId:
          withReply.client_message_id || options?.clientMessageId || undefined,
        replyToMessageId: withReply.reply_to_message_id || undefined,
        replyTo: withReply.replyTo || undefined,
        threadRootId: withReply.thread_root_id || undefined,
        replyCount: 0,
        receiptStatus: "sent" as const,
        threadStatus: nextStatus,
        isMessageRequest: nextStatus === "pending",
      } as unknown as Message;
    } catch (error: any) {
      logger.error("Exception sending DM", {
        error: error.message,
        senderId,
        recipientId,
      });
      throw error;
    }
  }

  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    if (!blockerId || !blockedId || blockerId === blockedId) {
      throw new Error("Invalid block request");
    }
    const { error } = await this.supabase
      .from("user_blocks")
      .upsert(
        { blocker_id: blockerId, blocked_id: blockedId },
        { onConflict: "blocker_id,blocked_id" },
      );
    if (error) throw error;
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    const { error } = await this.supabase
      .from("user_blocks")
      .delete()
      .eq("blocker_id", blockerId)
      .eq("blocked_id", blockedId);
    if (error) throw error;
  }

  async listBlockedUserIds(blockerId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from("user_blocks")
      .select("blocked_id")
      .eq("blocker_id", blockerId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || [])
      .map((row: { blocked_id?: string }) => row.blocked_id)
      .filter((id: string | undefined): id is string => typeof id === "string");
  }

  async isDmBlockedBetween(userIdA: string, userIdB: string): Promise<boolean> {
    const { usersAreBlocked } = await import("../utils/userSettingsPolicy");
    return usersAreBlocked(this.supabase, userIdA, userIdB);
  }

  async didUserBlock(blockerId: string, blockedId: string): Promise<boolean> {
    if (!blockerId || !blockedId || blockerId === blockedId) return false;
    const { data, error } = await this.supabase
      .from("user_blocks")
      .select("blocker_id")
      .eq("blocker_id", blockerId)
      .eq("blocked_id", blockedId)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    return !!data?.blocker_id;
  }

  async acceptDmMessageRequest(
    threadId: string,
    userId: string,
  ): Promise<{
    id: string;
    status: "open";
    requestedBy: null;
  }> {
    const { data: thread, error } = await this.supabase
      .from("dm_threads")
      .select("id, participant_ids, status, requested_by")
      .eq("id", threadId)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    if (!thread) throw new Error("Thread not found");

    const pids = Array.isArray(thread.participant_ids)
      ? thread.participant_ids
      : [];
    if (!pids.includes(userId)) throw new Error("Access denied");
    if (thread.status === "open") {
      return { id: thread.id, status: "open", requestedBy: null };
    }
    if (thread.status !== "pending") {
      throw new Error("This message request cannot be accepted");
    }
    if (thread.requested_by === userId) {
      throw new Error("Only the recipient can accept this message request");
    }

    const otherId = pids.find((id: string) => id !== userId);
    if (otherId && (await this.isDmBlockedBetween(userId, otherId))) {
      throw new Error("You cannot message this user");
    }

    const { error: updateError } = await this.supabase
      .from("dm_threads")
      .update({ status: "open", requested_by: null })
      .eq("id", threadId);
    if (updateError) throw updateError;

    // North-star metric (Phase 3 · O): accepting a request is the accepter
    // opening a channel for the requester, so the accepter is the actor.
    // objectType is deliberately NULL: the learning_connections CHECK allows
    // only challenge|question|deck|note|listing|order|review|profile, and a
    // 'dm_thread' value would fail it — silently, since record() swallows.
    if (thread?.requested_by) {
      const { getLearningConnectionsService } = await import("./learningConnections");
      await getLearningConnectionsService(this).record({
        actorId: userId,
        beneficiaryId: thread.requested_by as string,
        kind: "dm_accepted",
        objectId: threadId,
      });
    }

    if (typeof thread.requested_by === "string") {
      void this.createNotification(thread.requested_by, {
        message: "Your message request was accepted",
        link: `dm:${threadId}:${userId}`,
        type: "dm_message",
        data: { threadId, senderId: userId, status: "open" },
      }).catch((err) => {
        logger.warn("Failed to notify requester of accepted DM request", {
          err,
          threadId,
        });
      });
    }

    return { id: threadId, status: "open", requestedBy: null };
  }

  async declineDmMessageRequest(
    threadId: string,
    userId: string,
  ): Promise<{
    id: string;
    status: "declined";
    requestedBy: string | null;
  }> {
    const { data: thread, error } = await this.supabase
      .from("dm_threads")
      .select("id, participant_ids, status, requested_by")
      .eq("id", threadId)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    if (!thread) throw new Error("Thread not found");

    const pids = Array.isArray(thread.participant_ids)
      ? thread.participant_ids
      : [];
    if (!pids.includes(userId)) throw new Error("Access denied");
    if (thread.status === "declined") {
      return {
        id: thread.id,
        status: "declined",
        requestedBy:
          typeof thread.requested_by === "string" ? thread.requested_by : null,
      };
    }
    if (thread.status !== "pending") {
      throw new Error("This message request cannot be declined");
    }
    if (thread.requested_by === userId) {
      throw new Error("Only the recipient can decline this message request");
    }

    const { error: updateError } = await this.supabase
      .from("dm_threads")
      .update({ status: "declined" })
      .eq("id", threadId);
    if (updateError) throw updateError;

    return {
      id: threadId,
      status: "declined",
      requestedBy:
        typeof thread.requested_by === "string" ? thread.requested_by : null,
    };
  }

  async searchMessages(
    query: string,
    options: {
      groupId?: string;
      userId?: string;
      limit?: number;
      requestingUserId?: string;
    } = {},
  ): Promise<Message[]> {
    const { groupId, userId, limit = 50, requestingUserId } = options;

    // Build search query
    let searchQuery = this.supabase
      .from("messages")
      .select(
        `
        id,
        group_id,
        sender_id,
        type,
        text,
        question_data,
        flagged_as_similar_user_ids,
        timestamp,
        profiles!sender_id (
          id,
          name,
          username,
          avatar_url
        )
      `,
      )
      .ilike("text", `%${query}%`)
      .is("removed_at", null)
      .eq("is_archived", false)
      .limit(limit);

    if (groupId) {
      searchQuery = searchQuery.eq("group_id", groupId);
    }

    if (userId) {
      searchQuery = searchQuery.eq("sender_id", userId);
    }

    // If requesting user is specified, only search in groups they're members of
    if (requestingUserId && !groupId) {
      const { data: memberGroups, error: memberError } = await this.supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", requestingUserId);

      if (memberError) throw memberError;

      const groupIds = memberGroups?.map((mg) => mg.group_id) || [];
      if (groupIds.length === 0) return [];

      searchQuery = searchQuery.in("group_id", groupIds);
    }

    const { data, error } = await searchQuery.order("timestamp", {
      ascending: false,
    });

    if (error) throw error;

    return (data || []).map((msg: any) => ({
      id: msg.id,
      groupId: msg.group_id,
      sender: mapProfileSender(msg.profiles, msg.sender_id),
      senderId: msg.sender_id,
      timestamp: msg.timestamp
        ? new Date(msg.timestamp).toISOString()
        : new Date().toISOString(),
      flaggedAsSimilarUserIds: msg.flagged_as_similar_user_ids || [],
      upvotes: 0,
      downvotes: 0,
      ...this.normalizeMessageRecord(msg),
    }));
  }

  // Notification Methods for API Routes
  async getUserNotifications(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      unreadOnly?: boolean;
    } = {},
  ): Promise<Notification[]> {
    const { page = 1, limit = 20, unreadOnly = false } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `notifications:${userId}:${page}:${limit}:${unreadOnly}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        let query = this.supabase
          .from("notifications")
          .select("*")
          .eq("user_id", userId);

        if (unreadOnly) {
          query = query.eq("read", false);
        }

        const { data, error } = await query
          .order("date", { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) throw error;

        return data || [];
      },
      { ttl: 120 },
    ); // Cache for 2 minutes
  }

  async getNotificationById(
    notificationId: string,
    userId?: string,
  ): Promise<Notification | null> {
    const cacheKey = `notification:${notificationId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("notifications")
          .select("*")
          .eq("id", notificationId)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null; // Not found
          throw error;
        }

        // Check if notification belongs to user
        if (userId && data.user_id !== userId) {
          return null; // Access denied
        }

        return data;
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  async createNotification(
    userId: string,
    notificationData: {
      message: string;
      link?: string;
      type?: string;
      data?: Record<string, unknown>;
      force?: boolean;
    },
  ): Promise<Notification | null> {
    if (!notificationData.force) {
      const { data: profile, error: profileError } = await this.supabase
        .from("profiles")
        .select("settings")
        .eq("id", userId)
        .single();

      if (!profileError && profile) {
        const { shouldCreateInAppNotification } =
          await import("../utils/userSettingsPolicy");
        if (
          !shouldCreateInAppNotification(
            profile.settings,
            notificationData.type,
          )
        ) {
          return null;
        }
      }

      const type = notificationData.type || "info";
      const { CHAT_MUTEABLE_NOTIFICATION_TYPES } =
        await import("@lantern/shared/utils/chatMute");
      if (CHAT_MUTEABLE_NOTIFICATION_TYPES.has(type)) {
        const data = notificationData.data || {};
        const groupId = typeof data.groupId === "string" ? data.groupId : null;
        const threadId =
          typeof data.threadId === "string" ? data.threadId : null;
        if (groupId && (await this.isChatMuted(userId, "group", groupId))) {
          return null;
        }
        if (threadId && (await this.isChatMuted(userId, "dm", threadId))) {
          return null;
        }
      }
    }

    const { data, error } = await this.supabase
      .from("notifications")
      .insert({
        user_id: userId,
        message: notificationData.message,
        link: notificationData.link,
        type: notificationData.type || "info",
        data: notificationData.data || {},
        read: false,
      })
      .select()
      .single();

    if (error) throw error;

    // Invalidate caches
    await cacheService.deletePattern(`notifications:${userId}:*`);
    await cacheService.delete(`notifications:stats:${userId}`);

    void this.sendExpoPushForNotification(userId, notificationData);

    return data;
  }

  async markNotificationAsRead(
    notificationId: string,
  ): Promise<Notification | null> {
    const { data, error } = await this.supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", notificationId)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    // Invalidate caches
    await cacheService.delete(`notification:${notificationId}`);
    await cacheService.deletePattern(`notifications:${data.user_id}:*`);
    await cacheService.delete(`notifications:stats:${data.user_id}`);

    return data;
  }

  async markAllNotificationsAsRead(userId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false)
      .select("id");

    if (error) throw error;

    const updatedCount = data?.length || 0;

    // Invalidate caches
    await cacheService.deletePattern(`notifications:${userId}:*`);
    await cacheService.delete(`notifications:stats:${userId}`);

    return updatedCount;
  }

  async deleteNotification(notificationId: string): Promise<boolean> {
    // Get notification first to know which user to invalidate
    const { data: notification, error: fetchError } = await this.supabase
      .from("notifications")
      .select("user_id")
      .eq("id", notificationId)
      .single();

    if (fetchError) {
      if (fetchError.code === "PGRST116") return false; // Not found
      throw fetchError;
    }

    const { error } = await this.supabase
      .from("notifications")
      .delete()
      .eq("id", notificationId);

    if (error) throw error;

    // Invalidate caches
    await cacheService.delete(`notification:${notificationId}`);
    await cacheService.deletePattern(`notifications:${notification.user_id}:*`);
    await cacheService.delete(`notifications:stats:${notification.user_id}`);

    return true;
  }

  async deleteAllNotifications(userId: string): Promise<number> {
    // Count notifications first
    const { count, error: countError } = await this.supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (countError) throw countError;

    // Delete all notifications for user
    const { error } = await this.supabase
      .from("notifications")
      .delete()
      .eq("user_id", userId);

    if (error) throw error;

    // Invalidate caches
    await cacheService.deletePattern(`notifications:${userId}:*`);
    await cacheService.deletePattern(`notification:*`);
    await cacheService.delete(`notifications:stats:${userId}`);

    return count || 0;
  }

  async getNotificationStats(userId: string): Promise<{
    total: number;
    unread: number;
    read: number;
  }> {
    const cacheKey = `notifications:stats:${userId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("notifications")
          .select("read")
          .eq("user_id", userId);

        if (error) throw error;

        const total = data?.length || 0;
        const unread = data?.filter((n) => !n.read).length || 0;
        const read = total - unread;

        return { total, unread, read };
      },
      { ttl: 60 },
    ); // Cache for 1 minute
  }

  async createBulkNotifications(
    notifications: Array<{
      userId: string;
      message: string;
      link?: string;
      type?: string;
    }>,
  ): Promise<Notification[]> {
    const notificationsToInsert = notifications.map((n) => ({
      user_id: n.userId,
      message: n.message,
      link: n.link,
      type: n.type || "info",
      read: false,
    }));

    const { data, error } = await this.supabase
      .from("notifications")
      .insert(notificationsToInsert)
      .select();

    if (error) throw error;

    // Invalidate caches for affected users
    const affectedUserIds = [...new Set(notifications.map((n) => n.userId))];
    for (const userId of affectedUserIds) {
      await cacheService.deletePattern(`notifications:${userId}:*`);
    }

    return data || [];
  }

  // Test Methods for API Routes
  async getUserTests(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      status?: string;
      /** Academic archive filter (test_sessions.course_id; unfiled → IS NULL, course → eq); replaces the dead config->>subject path. */
      courseFilter?: CourseFilter;
      /** Same, one level down (test_sessions.topic_id): unfiled → no topic in that course. */
      topicFilter?: CourseFilter;
      lean?: boolean;
      sort?: "newest" | "oldest" | "highestScore";
      from?: string;
      to?: string;
    } = {},
  ): Promise<{ tests: any[]; total: number }> {
    const {
      page = 1,
      limit = 20,
      status,
      courseFilter,
      topicFilter,
      lean = false,
      sort = "newest",
      from,
      to,
    } = options;
    const offset = (page - 1) * limit;
    const sortKey = sort || "newest";
    const fromKey = from || "";
    const toKey = to || "";

    const cacheKey = `tests:${userId}:${page}:${limit}:${status || ""}:course:${courseFilterKey(courseFilter)}:topic:${courseFilterKey(topicFilter)}:${lean ? "lean" : "full"}:${sortKey}:${fromKey}:${toKey}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        // Completed lean history only needs scores + config for charts, so omit
        // the questions so all-time pagination stays payload-light. user_answers
        // IS read, because the dashboard's "Avg / question" and total study time
        // are derived from per-answer timings — but it is folded into two numbers
        // below and never sent to the client, so the response stays lean.
        const completedLean = lean && status === "completed";
        const selectCols = lean
          ? `
          id,
          start_time,
          end_time,
          is_offline,
          config,
          course_id,
          status,
          session_kind,
          current_question_index,
          remaining_time_seconds,
          paused_at,
          updated_at,
          title,
          ${completedLean ? "" : "questions,"}
          user_answers,
          test_results (
            score,
            correct_answers_count,
            total_questions
          )
        `
          : `
          *,
          test_results (
            score,
            correct_answers_count,
            total_questions
          )
        `;

        let query = this.supabase
          .from("test_sessions")
          .select(selectCols, { count: "exact" })
          .eq("user_id", userId);

        if (status === "completed") {
          query = query.eq("status", "completed");
        } else if (status === "paused") {
          query = query.eq("status", "paused");
        } else if (status === "in_progress") {
          query = query.in("status", ["in_progress", "paused"]);
        } else if (status === "not_started") {
          query = query.is("start_time", null);
        } else if (status === "abandoned") {
          query = query.eq("status", "abandoned");
        }

        query = applyCourseFilter(query, "course_id", courseFilter);
        query = applyCourseFilter(query, "topic_id", topicFilter);

        if (from) {
          query = query.gte("start_time", from);
        }
        if (to) {
          query = query.lte("start_time", to);
        }

        const orderByUpdated =
          status === "paused" || status === "in_progress";
        if (sortKey === "oldest") {
          query = query.order(
            orderByUpdated ? "updated_at" : "start_time",
            { ascending: true },
          );
        } else if (sortKey === "highestScore") {
          // Prefer score from joined test_results; fall back below if PostgREST rejects the order.
          query = query
            .order("score", {
              referencedTable: "test_results",
              ascending: false,
              nullsFirst: false,
            })
            .order("start_time", { ascending: false });
        } else {
          query = query.order(
            orderByUpdated ? "updated_at" : "start_time",
            { ascending: false },
          );
        }

        let { data, error, count } = await query.range(
          offset,
          offset + limit - 1,
        );

        if (error && sortKey === "highestScore") {
          logger.warn("highestScore order failed; falling back to newest", {
            error: error.message,
          });
          let fallback = this.supabase
            .from("test_sessions")
            .select(selectCols, { count: "exact" })
            .eq("user_id", userId);
          if (status === "completed") fallback = fallback.eq("status", "completed");
          else if (status === "paused") fallback = fallback.eq("status", "paused");
          else if (status === "in_progress") {
            fallback = fallback.in("status", ["in_progress", "paused"]);
          } else if (status === "not_started")
            fallback = fallback.is("start_time", null);
          else if (status === "abandoned")
            fallback = fallback.eq("status", "abandoned");
          fallback = applyCourseFilter(fallback, "course_id", courseFilter);
          fallback = applyCourseFilter(fallback, "topic_id", topicFilter);
          if (from) fallback = fallback.gte("start_time", from);
          if (to) fallback = fallback.lte("start_time", to);
          const retry = await fallback
            .order("start_time", { ascending: false })
            .range(offset, offset + limit - 1);
          data = retry.data;
          error = retry.error;
          count = retry.count;
          if (!error && Array.isArray(data)) {
            data = [...data].sort((a: any, b: any) => {
              const aScore = Array.isArray(a.test_results)
                ? a.test_results[0]?.score
                : a.test_results?.score;
              const bScore = Array.isArray(b.test_results)
                ? b.test_results[0]?.score
                : b.test_results?.score;
              return (bScore || 0) - (aScore || 0);
            });
          }
        }

        if (error && topicFilterApplies(topicFilter) && isMissingTopicColumn(error)) {
          // No session can carry a topic before the migration: a named topic
          // matches nothing, and "no topic" matches every session.
          if (topicFilter?.kind === "course") return { tests: [], total: 0 };
          return this.getUserTests(userId, { ...options, topicFilter: undefined });
        }

        if (error) throw error;

        const tests = (data || []).map((session: any) =>
          mapTestListRow(session, lean),
        );

        // Rows saved before the title was persisted at creation carry only
        // the note id. One batched query per page fills them in, and the
        // result is cached with the page, so this costs nothing on a hit.
        await this.attachSourceNoteTitles(tests, userId);

        return {
          tests,
          total: typeof count === "number" ? count : tests.length,
        };
      },
      { ttl: 300 },
    );
  }

  async getTestById(testId: string, userId?: string): Promise<any | null> {
    const cacheKey = userId
      ? `test:${testId}:user:${userId}`
      : `test:${testId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("test_sessions")
          .select("*")
          .eq("id", testId)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null; // Not found
          throw error;
        }

        // Check if test belongs to user
        if (userId && data.user_id !== userId) {
          return null; // Access denied
        }

        return data;
      },
      { ttl: 600 },
    ); // Cache for 10 minutes
  }

  /**
   * The session row `userId` is allowed to read, and on what footing.
   *
   * `getTestById` answers only for the owner, which made GET /tests/:id a 404
   * for a group test another member launched — so a client that fell back to
   * it (a retake off a history row, which no longer carries questions) had
   * nowhere left to get the questions from and could only say "question data
   * is no longer available".
   *
   * Group access is READ-ONLY and deliberately narrower than ownership: it
   * grants the questions the group's bank produced, never another student's
   * answers. Callers must strip the attempt — see `sanitizeSessionForGroupPeer`.
   */
  async resolveTestSessionForCaller(
    testId: string,
    userId: string,
  ): Promise<{ session: any; access: "owner" | "group" } | null> {
    const owned = await this.getTestById(testId, userId);
    if (owned) return { session: owned, access: "owner" };

    // Not the owner. The only other readable case is a group session whose
    // group this caller belongs to; everything else stays a 404.
    const { data, error } = await this.supabase
      .from("test_sessions")
      .select("*")
      .eq("id", testId)
      .maybeSingle();
    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }
    if (!data) return null;

    const groupId = data.config?.groupId;
    if (typeof groupId !== "string" || !groupId) return null;
    if (!(await this.isGroupMember(groupId, userId))) return null;

    return { session: data, access: "group" };
  }

  async createTest(testConfig: any, userId: string): Promise<any> {
    // Check if this is a completed test session (has questions and user_answers)
    const isCompletedSession =
      testConfig.questions && testConfig.questions.length > 0;

    const courseId = resolveCourseIdFromConfigLike(testConfig);
    // Topic is validated against the course this session is filed under, so a
    // wrong-course topic 400s before anything is written.
    const topicId = await this.resolveArtefactTopic({
      topicId: resolveTopicIdFromConfigLike(testConfig),
      courseId,
    });

    const insertData: any = {
      user_id: userId,
      course_id: courseId,
      ...(topicId !== undefined ? { topic_id: topicId } : {}),
    };

    if (isCompletedSession) {
      // This is a completed test being saved
      insertData.config = testConfig.config || testConfig;
      insertData.questions = testConfig.questions || [];
      insertData.user_answers = testConfig.user_answers || {};
      insertData.start_time = testConfig.start_time;
      insertData.end_time = testConfig.end_time;
      insertData.is_offline = testConfig.is_offline || false;
      insertData.status = "completed";
      insertData.session_kind = testConfig.session_kind || testConfig.sessionKind || "test";
      insertData.title = testConfig.title || null;
      insertData.current_question_index =
        typeof testConfig.current_question_index === "number"
          ? testConfig.current_question_index
          : 0;
      insertData.updated_at = new Date().toISOString();
    } else {
      // This is a new test configuration
      insertData.config = testConfig;
      insertData.questions = [];
      insertData.user_answers = {};
      insertData.status = "in_progress";
      insertData.session_kind = "test";
      insertData.updated_at = new Date().toISOString();
    }

    const { data, error } = await writeWithTopicFallback(
      (row) => this.supabase.from("test_sessions").insert(row).select().single(),
      insertData,
    );

    if (error) throw error;

    // Invalidate caches
    await cacheService.deletePattern(`tests:${userId}:*`);

    return data;
  }

  /**
   * Create a personal, not-yet-started test from a set of questions — the shape
   * "Available Tests" lists (questions present, no end_time, status
   * in_progress).
   *
   * POST /tests cannot express this: it treats any payload carrying questions
   * as a COMPLETED session, so a quiz generated from a note had nowhere to be
   * saved as a launchable test.
   */
  async createPersonalTest(
    payload: {
      title: string;
      questions: any[];
      sourceNoteId?: string | null;
      /** Deck the questions were drawn from — the deck→test path. */
      sourceDeckId?: string | null;
      sourceJobId?: string | null;
      courseId?: string | null;
      topicId?: string | null;
      config?: Record<string, any> | null;
    },
    userId: string,
  ): Promise<any> {
    const courseId =
      typeof payload.courseId === "string" && payload.courseId ? payload.courseId : null;
    const topicId = await this.resolveArtefactTopic({
      topicId: payload.topicId,
      courseId,
    });

    const sourceNoteId =
      typeof payload.sourceNoteId === "string" && payload.sourceNoteId
        ? payload.sourceNoteId
        : null;
    // Resolve the note's title ONCE, here, so every later read is a plain
    // config read. The client prints "From <title>" under a note quiz; without
    // this the field was absent and the list rendered "From undefined".
    // A client-supplied title is only a fallback, and only for a note the
    // caller actually linked: it is never trusted over the note's own row.
    const sourceNoteTitle = sourceNoteId
      ? (await this.fetchNoteTitles([sourceNoteId], userId)).get(sourceNoteId) ??
        normalizeSourceNoteTitle((payload.config as any)?.sourceNoteTitle)
      : null;

    // Same rule as the note above, one source over: the deck's OWN name wins
    // over anything the client sent, and is resolved once at creation so every
    // later read is a plain config read.
    const sourceDeckId =
      typeof payload.sourceDeckId === "string" && payload.sourceDeckId
        ? payload.sourceDeckId
        : null;
    const sourceDeckTitle = sourceDeckId
      ? ((await this.fetchDeckTitles([sourceDeckId], userId)).get(sourceDeckId) ??
        normalizeSourceNoteTitle((payload.config as any)?.sourceDeckTitle))
      : null;

    const config = {
      ...(payload.config && typeof payload.config === "object" ? payload.config : {}),
      title: payload.title,
      // The mobile Tests list names a session from `config.name` (then
      // `testName`); without it a refetch renamed every note quiz "Untitled
      // Test" the moment it left the client-side insert behind.
      name: payload.title,
      numberOfQuestions: payload.questions.length,
      courseId,
      // Provenance lives in config, not a column: no migration is needed for
      // the note link, and the client reads it straight back off the session.
      ...(sourceNoteId ? { sourceNoteId } : {}),
      // Always written, so a client-supplied value can never outlive the
      // resolved one (or survive on a test that links to no note at all).
      sourceNoteTitle,
      ...(sourceDeckId ? { sourceDeckId } : {}),
      sourceDeckTitle,
      ...(payload.sourceJobId ? { sourceJobId: payload.sourceJobId } : {}),
      source: sourceNoteId
        ? "note"
        : sourceDeckId
          ? "deck"
          : (payload.config as any)?.source || "personal",
    };

    const { data, error } = await writeWithTopicFallback(
      (row) => this.supabase.from("test_sessions").insert(row).select().single(),
      {
        user_id: userId,
        course_id: courseId,
        ...(topicId !== undefined ? { topic_id: topicId } : {}),
        config,
        questions: payload.questions,
        user_answers: {},
        // No end_time and a non-empty question list is exactly what the mobile
        // Tests list filters for; anything else would silently not appear.
        status: "in_progress",
        session_kind: "test",
        title: payload.title,
        current_question_index: 0,
        is_offline: false,
        updated_at: new Date().toISOString(),
      },
    );

    if (error) throw error;

    await cacheService.deletePattern(`tests:${userId}:*`);

    return data;
  }

  mapTestSessionRowToClient(session: any) {
    const questions = Array.isArray(session.questions) ? session.questions : [];
    // Legacy submit stored Object.values(userAnswers) as a JSON array; draft
    // complete stores a Record. Coerce both so history hydrate keeps answers.
    const answers = coerceRawUserAnswers(
      session.user_answers ?? session.userAnswers,
      questions,
    );
    return {
      id: session.id,
      config: session.config || {},
      courseId: session.course_id ?? session.config?.courseId ?? null,
      ...topicIdOf(session),
      questions,
      userAnswers: answers,
      currentQuestionIndex: session.current_question_index || 0,
      startTime: session.start_time ? new Date(session.start_time) : new Date(),
      endTime: session.end_time ? new Date(session.end_time) : undefined,
      remainingTime:
        typeof session.remaining_time_seconds === "number"
          ? session.remaining_time_seconds
          : undefined,
      isOffline: session.is_offline || false,
      sessionKind: session.session_kind || "test",
      status: session.status || "in_progress",
      title: session.title || undefined,
      updatedAt: session.updated_at || undefined,
      pausedAt: session.paused_at || undefined,
      userId: session.user_id,
      // Everything a launch needs without a second read: how many questions
      // there are, and where the test came from. `sourceNoteId` is how a
      // generated quiz links back to the note that produced it.
      questionCount: questions.length || session.config?.numberOfQuestions || 0,
      sourceNoteId: session.config?.sourceNoteId ?? null,
      /** @see mapTestListRow — same contract: a string or null, never absent. */
      sourceNoteTitle: normalizeSourceNoteTitle(session.config?.sourceNoteTitle),
      sourceDeckId: session.config?.sourceDeckId ?? null,
      sourceDeckTitle: normalizeSourceNoteTitle(session.config?.sourceDeckTitle),
      sourceJobId: session.config?.sourceJobId ?? null,
      /**
       * Resolved source of the session — {noteId, deckId, groupId, title}, each
       * a string or null. This is what a retake reads to name what it is
       * relaunching; it never has to parse `config` itself.
       */
      provenance: buildTestProvenance(session),
    };
  }

  /**
   * The titles of `noteIds` this user owns, as an id → title map. One query,
   * whatever the page size; ids with no readable note are simply absent.
   * Never throws: a missing title degrades the "From <note>" line, it does
   * not fail the test list.
   */
  private async fetchNoteTitles(
    noteIds: string[],
    userId: string,
  ): Promise<Map<string, string>> {
    const titles = new Map<string, string>();
    const ids = Array.from(
      new Set(noteIds.filter((id): id is string => typeof id === "string" && !!id)),
    );
    if (ids.length === 0 || !userId) return titles;
    try {
      const { data, error } = await this.supabase
        .from("notes")
        .select("id, title")
        .eq("user_id", userId)
        .in("id", ids);
      if (error) throw error;
      for (const note of (data || []) as any[]) {
        const title = normalizeSourceNoteTitle(note?.title);
        if (note?.id && title) titles.set(String(note.id), title);
      }
    } catch (err) {
      logger.warn("Could not resolve source note titles", {
        userId,
        count: ids.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return titles;
  }

  /**
   * The names of `deckIds` this user owns, as an id → name map. Same contract
   * as `fetchNoteTitles`: one query, never throws, ids with no readable deck
   * are simply absent (a missing name degrades "From <deck>", it does not fail
   * the save).
   */
  private async fetchDeckTitles(
    deckIds: string[],
    userId: string,
  ): Promise<Map<string, string>> {
    const titles = new Map<string, string>();
    const ids = Array.from(
      new Set(deckIds.filter((id): id is string => typeof id === "string" && !!id)),
    );
    if (ids.length === 0 || !userId) return titles;
    try {
      const { data, error } = await this.supabase
        .from("decks")
        .select("id, name")
        .eq("user_id", userId)
        .in("id", ids);
      if (error) throw error;
      for (const deck of (data || []) as any[]) {
        const title = normalizeSourceNoteTitle(deck?.name);
        if (deck?.id && title) titles.set(String(deck.id), title);
      }
    } catch (err) {
      logger.warn("Could not resolve source deck titles", {
        userId,
        count: ids.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return titles;
  }

  /**
   * The display title of a source a personal test is about to be created from
   * — a note or a deck this caller owns — or null. Used to default the test's
   * title when the client sends none.
   */
  async resolvePersonalTestSourceTitle(
    source: { noteId?: string | null; deckId?: string | null },
    userId: string,
  ): Promise<string | null> {
    if (typeof source.noteId === "string" && source.noteId) {
      const found = (await this.fetchNoteTitles([source.noteId], userId)).get(source.noteId);
      if (found) return found;
    }
    if (typeof source.deckId === "string" && source.deckId) {
      const found = (await this.fetchDeckTitles([source.deckId], userId)).get(source.deckId);
      if (found) return found;
    }
    return null;
  }

  /**
   * Backfill `sourceNoteTitle` on mapped test rows written before the title
   * was persisted at creation. One batched note query per page, and only for
   * the rows that actually link to a note and lack a title.
   */
  async attachSourceNoteTitles<
    T extends { sourceNoteId?: string | null; sourceNoteTitle?: string | null },
  >(rows: T[], userId: string): Promise<T[]> {
    const missing = rows.filter(
      (row) =>
        row &&
        typeof row.sourceNoteId === "string" &&
        !!row.sourceNoteId &&
        !row.sourceNoteTitle,
    );
    if (missing.length === 0) return rows;
    const titles = await this.fetchNoteTitles(
      missing.map((row) => row.sourceNoteId as string),
      userId,
    );
    for (const row of missing) {
      row.sourceNoteTitle = titles.get(row.sourceNoteId as string) ?? null;
    }
    return rows;
  }

  async createTestDraft(
    payload: {
      config: any;
      /** Academic archive reference; also mirrored into config.courseId by the route. */
      courseId?: string | null;
      /** Topic within `courseId`; rejected (400) if it belongs to another course. */
      topicId?: string | null;
      questions: any[];
      user_answers?: Record<string, any>;
      start_time?: string;
      session_kind?: "test" | "study";
      title?: string;
      current_question_index?: number;
      remaining_time_seconds?: number | null;
      is_offline?: boolean;
      client_id?: string;
    },
    userId: string,
  ): Promise<any> {
    const now = new Date().toISOString();
    const courseId = resolveCourseIdFromConfigLike(payload);
    const topicId = await this.resolveArtefactTopic({
      topicId: resolveTopicIdFromConfigLike(payload),
      courseId,
    });
    const insertData: any = {
      user_id: userId,
      config: payload.config || {},
      course_id: courseId,
      ...(topicId !== undefined ? { topic_id: topicId } : {}),
      questions: Array.isArray(payload.questions) ? payload.questions : [],
      user_answers: payload.user_answers || {},
      start_time: payload.start_time || now,
      end_time: null,
      is_offline: payload.is_offline || false,
      status: "in_progress",
      session_kind: payload.session_kind === "study" ? "study" : "test",
      current_question_index: Math.max(0, payload.current_question_index || 0),
      remaining_time_seconds:
        typeof payload.remaining_time_seconds === "number"
          ? payload.remaining_time_seconds
          : null,
      title: payload.title || null,
      updated_at: now,
      paused_at: null,
    };

    const { data, error } = await writeWithTopicFallback(
      (row) => this.supabase.from("test_sessions").insert(row).select().single(),
      insertData,
    );

    if (error) throw error;
    await cacheService.deletePattern(`tests:${userId}:*`);
    return this.mapTestSessionRowToClient(data);
  }

  async updateTestDraft(
    draftId: string,
    userId: string,
    updates: {
      user_answers?: Record<string, any>;
      current_question_index?: number;
      remaining_time_seconds?: number | null;
      status?: "in_progress" | "paused";
      title?: string;
      config?: Record<string, unknown>;
    },
  ): Promise<any | null> {
    const existing = await this.getTestById(draftId, userId);
    if (!existing) return null;
    if (existing.status === "completed" || existing.status === "abandoned") {
      throw new Error("Cannot update a finished session");
    }
    if (existing.end_time) {
      throw new Error("Cannot update a finished session");
    }

    const now = new Date().toISOString();
    const patch: any = { updated_at: now };
    // Answers pass through untouched EXCEPT `confidence`, which is validated
    // down to 'sure' | 'unsure' or removed. An unrecognised value stored here
    // would be read back as a confidence level of its own by every analysis.
    if (updates.user_answers !== undefined) {
      patch.user_answers = sanitizeAnswerConfidences(updates.user_answers);
    }
    if (typeof updates.current_question_index === "number") {
      patch.current_question_index = Math.max(0, updates.current_question_index);
    }
    if (updates.remaining_time_seconds !== undefined) {
      patch.remaining_time_seconds = updates.remaining_time_seconds;
    }
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.config && typeof updates.config === "object" && !Array.isArray(updates.config)) {
      const existingConfig =
        existing.config && typeof existing.config === "object" && !Array.isArray(existing.config)
          ? existing.config
          : {};
      patch.config = { ...existingConfig, ...updates.config };
    }
    if (updates.status === "paused") {
      patch.status = "paused";
      patch.paused_at = now;
    } else if (updates.status === "in_progress") {
      patch.status = "in_progress";
      patch.paused_at = null;
    }

    const { data, error } = await this.supabase
      .from("test_sessions")
      .update(patch)
      .eq("id", draftId)
      .eq("user_id", userId)
      .in("status", ["in_progress", "paused"])
      .is("end_time", null)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    await cacheService.delete(`test:${draftId}`);
    await cacheService.delete(`test:${draftId}:user:${userId}`);
    await cacheService.deletePattern(`tests:${userId}:*`);
    return this.mapTestSessionRowToClient(data);
  }

  async completeTestDraft(
    draftId: string,
    userId: string,
    options?: {
      user_answers?: Record<string, any>;
      activityDate?: string;
      score?: number;
      correctAnswersCount?: number;
      totalQuestions?: number;
      /** Merge into session config before completing (fixes mobile draft groupId). */
      config?: Record<string, unknown>;
      /** 'web' | 'mobile' from x-lantern-surface (learning_events.surface); default 'api'. */
      surface?: LearningSurface;
    },
  ): Promise<any> {
    const existing = await this.getTestById(draftId, userId);
    if (!existing) throw new Error("Session not found");
    if (existing.status === "completed") {
      throw new Error("Session already completed");
    }
    if (existing.status === "abandoned") {
      throw new Error("Session was abandoned");
    }

    const now = new Date().toISOString();
    const answers = sanitizeAnswerConfidences(
      options?.user_answers ?? existing.user_answers ?? {},
    );
    const sessionKind = existing.session_kind === "study" ? "study" : "test";
    const existingConfig =
      existing.config && typeof existing.config === "object" && !Array.isArray(existing.config)
        ? existing.config
        : {};
    const configPatch =
      options?.config && typeof options.config === "object" && !Array.isArray(options.config)
        ? options.config
        : null;
    const nextConfig = configPatch ? { ...existingConfig, ...configPatch } : existingConfig;

    const { data, error } = await this.supabase
      .from("test_sessions")
      .update({
        user_answers: answers,
        end_time: now,
        status: "completed",
        updated_at: now,
        remaining_time_seconds: null,
        paused_at: null,
        ...(configPatch ? { config: nextConfig } : {}),
      })
      .eq("id", draftId)
      .eq("user_id", userId)
      .in("status", ["in_progress", "paused"])
      .is("end_time", null)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Session already completed");

    await cacheService.delete(`test:${draftId}`);
    await cacheService.delete(`test:${draftId}:user:${userId}`);

    if (sessionKind === "study") {
      // Study sessions still affect lean history lists / draft caches.
      await cacheService.deletePattern(`tests:${userId}:*`);
      // learning_events: study sessions never reach createTestResult, so emit
      // their question_answered rows here (same once-per-session guard).
      await recordTestSessionAnswers(this, {
        session: data,
        userId,
        surface: options?.surface ?? "api",
      });
      return {
        session: this.mapTestSessionRowToClient(data),
        sessionKind: "study",
        score: null,
        totalQuestions: Array.isArray(data.questions) ? data.questions.length : 0,
        correctAnswersCount: null,
      };
    }

    // createTestResult invalidates tests:${userId}:* after the score row lands.
    const result = await this.createTestResult(
      draftId,
      {
        score: options?.score ?? 0,
        correctAnswersCount: options?.correctAnswersCount ?? 0,
        totalQuestions:
          options?.totalQuestions ??
          (Array.isArray(data.questions) ? data.questions.length : 0),
        activityDate: options?.activityDate,
      },
      userId,
      { surface: options?.surface ?? "api" },
    );

    return {
      session: this.mapTestSessionRowToClient(data),
      sessionKind: "test",
      ...result,
    };
  }

  async abandonTestDraft(draftId: string, userId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("test_sessions")
      .update({
        status: "abandoned",
        updated_at: now,
        remaining_time_seconds: null,
      })
      .eq("id", draftId)
      .eq("user_id", userId)
      .in("status", ["in_progress", "paused"])
      .is("end_time", null)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    await cacheService.delete(`test:${draftId}`);
    await cacheService.delete(`test:${draftId}:user:${userId}`);
    await cacheService.deletePattern(`tests:${userId}:*`);
    return !!data;
  }

  async startTest(testId: string, userId: string): Promise<any | null> {
    // Get test first
    const test = await this.getTestById(testId, userId);
    if (!test) return null;

    // Check if test has already been started (has questions)
    if (test.questions && test.questions.length > 0) {
      throw new Error("Test has already been started");
    }

    // Generate questions based on config (simplified - in real app this would be more complex)
    const questions = this.generateTestQuestions(test.config);

    // RC-04: only the first start wins; empty questions array is the CAS precondition.
    const { data, error } = await this.supabase
      .from("test_sessions")
      .update({
        start_time: new Date().toISOString(),
        questions,
      })
      .eq("id", testId)
      .eq("user_id", userId)
      .eq("questions", [])
      .select()
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      // Bypass stale pre-start cache from the concurrent loser path.
      await cacheService.delete(`test:${testId}`);
      await cacheService.delete(`test:${testId}:user:${userId}`);
      const existing = await this.getTestById(testId, userId);
      if (existing?.questions && existing.questions.length > 0) {
        return existing;
      }
      throw new Error("Test has already been started");
    }

    // Invalidate caches
    await cacheService.delete(`test:${testId}`);
    await cacheService.delete(`test:${testId}:user:${userId}`);
    await cacheService.deletePattern(`tests:${userId}:*`);

    return data;
  }

  async submitTest(
    testId: string,
    userId: string,
    answers: any[],
  ): Promise<any> {
    // Get test first
    const test = await this.getTestById(testId, userId);
    if (!test) throw new Error("Test not found");

    // Calculate score
    const score = this.calculateTestScore(test.questions, answers);
    const correctAnswers = Math.round((score / 100) * test.questions.length);

    // Atomic complete: only the first concurrent submit wins (CONC-02).
    const { data, error } = await this.supabase
      .from("test_sessions")
      .update({
        end_time: new Date().toISOString(),
        // Array form preserved; only `confidence` is validated. @see sanitizeAnswerConfidences
        user_answers: sanitizeAnswerConfidences(answers),
        status: "completed",
        updated_at: new Date().toISOString(),
        remaining_time_seconds: null,
        paused_at: null,
      })
      .eq("id", testId)
      .eq("user_id", userId)
      .is("end_time", null)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new Error("Test has already been completed");
    }

    // Upsert result — UNIQUE(session_id) prevents duplicates under races.
    const { error: resultError } = await this.supabase
      .from("test_results")
      .upsert(
        {
          session_id: testId,
          score,
          total_questions: test.questions.length,
          correct_answers_count: correctAnswers,
        },
        { onConflict: "session_id", ignoreDuplicates: true },
      );

    if (resultError) throw resultError;

    // Update user stats
    await this.updateUserStats(userId, score);

    // Invalidate caches
    await cacheService.delete(`test:${testId}`);
    await cacheService.deletePattern(`tests:${userId}:*`);
    await cacheService.delete(`user:stats:${userId}`);

    return {
      test: data,
      score,
      totalQuestions: test.questions.length,
      correctAnswers,
    };
  }

  async createTestResult(
    testId: string,
    resultData: {
      score: number;
      correctAnswersCount: number;
      totalQuestions: number;
      activityDate?: string;
    },
    userId?: string,
    options: {
      /** 'web' | 'mobile' from x-lantern-surface (learning_events.surface); default 'api'. */
      surface?: LearningSurface;
    } = {},
  ): Promise<any> {
    let score = resultData.score;
    let correctAnswersCount = resultData.correctAnswersCount;
    let totalQuestions = resultData.totalQuestions;

    const test = userId
      ? await this.getTestById(testId, userId)
      : await this.getTestById(testId);
    if (test?.questions?.length && test.user_answers?.length) {
      score = this.calculateTestScore(test.questions, test.user_answers);
      totalQuestions = test.questions.length;
      correctAnswersCount = Math.round((score / 100) * totalQuestions);
    }

    const { data, error } = await this.supabase
      .from("test_results")
      .upsert(
        {
          session_id: testId,
          score,
          correct_answers_count: correctAnswersCount,
          total_questions: totalQuestions,
        },
        { onConflict: "session_id" },
      )
      .select()
      .single();

    if (error) throw error;

    // learning_events: one question_answered per attempted answer. This is the
    // single function both completion paths call (completeTestDraft and
    // POST /tests/:id/results), and recordTestSessionAnswers dedupes on
    // (user_id, session_id) so a session never emits twice. Never throws.
    const eventUserId = userId || (test?.user_id as string | undefined);
    if (test && eventUserId) {
      await recordTestSessionAnswers(this, {
        session: test,
        userId: eventUserId,
        surface: options.surface ?? "api",
      });
    }

    // Invalidate caches. Dashboard Group Performance is built from lean completed
    // history (`tests:${userId}:*` / `/dashboard/summary`), so drop those AFTER
    // the result row exists — earlier deletes race with a refill that still
    // lacks score/correctAnswersCount.
    await cacheService.delete(`test:results:${testId}`);
    if (userId) {
      await cacheService.deletePattern(`tests:${userId}:*`);
      await cacheService.deletePattern(`tests:stats:performance:${userId}:*`);
      await cacheService.delete(`tests:stats:subject:${userId}`);
    }

    let gamification:
      | {
          points: number;
          badges: User["badges"];
          stats: UserStats;
          awardedBadges: User["badges"];
        }
      | undefined;
    if (userId) {
      try {
        gamification = await this.applyTestCompletionGamification(
          userId,
          resultData.activityDate,
        );
        await cacheService.invalidateUserCache(userId);
      } catch (err) {
        logger.warn("Test result gamification sync failed", {
          userId,
          testId,
          err,
        });
      }
    }

    return gamification ? { ...data, gamification } : data;
  }

  async getTestResults(testId: string, userId?: string): Promise<any | null> {
    const cacheKey = `test:results:${testId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("test_results")
          .select("*")
          .eq("session_id", testId)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null; // Not found
          throw error;
        }

        // Check access if userId provided
        const test = userId
          ? await this.getTestById(testId, userId)
          : await this.getTestById(testId);
        if (userId && !test) return null;

        // `correct_answers_count` alone cannot tell a client whether the rest
        // were wrong or never reached, so every results screen guessed
        // (total - correct) and called them all missed. The tally splits the
        // three apart, and carries the confidence the student reported.
        return { ...data, tally: buildAttemptTally(test) };
      },
      { ttl: 1800 },
    ); // Cache for 30 minutes
  }

  async getTestQuestions(testId: string, userId?: string): Promise<any[]> {
    const cacheKey = `test:questions:${testId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const test = await this.getTestById(testId, userId);
        if (!test) return [];

        return test.questions || [];
      },
      { ttl: 1800 },
    ); // Cache for 30 minutes
  }

  async deleteTest(testId: string): Promise<boolean> {
    // Delete test results first
    const { error: resultsError } = await this.supabase
      .from("test_results")
      .delete()
      .eq("session_id", testId);

    if (resultsError) throw resultsError;

    // Delete the test session
    const { error } = await this.supabase
      .from("test_sessions")
      .delete()
      .eq("id", testId);

    if (error) throw error;

    // Invalidate caches
    await cacheService.delete(`test:${testId}`);
    await cacheService.delete(`test:results:${testId}`);
    await cacheService.delete(`test:questions:${testId}`);
    await cacheService.deletePattern(`tests:*`);

    return true;
  }

  async deleteCompletedTestSession(
    sessionId: string,
    userId: string,
  ): Promise<boolean> {
    const { data: session, error: fetchError } = await this.supabase
      .from("test_sessions")
      .select("id, user_id, end_time")
      .eq("id", sessionId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!session || session.user_id !== userId) return false;
    if (!session.end_time) {
      throw new Error("Cannot delete an in-progress test session");
    }

    return this.deleteTest(sessionId);
  }

  async clearCompletedTestHistory(userId: string): Promise<number> {
    const { data: sessions, error } = await this.supabase
      .from("test_sessions")
      .select("id")
      .eq("user_id", userId)
      .not("end_time", "is", null);

    if (error) throw error;
    if (!sessions?.length) return 0;

    const sessionIds = sessions.map((row: { id: string }) => row.id);

    const { error: resultsError } = await this.supabase
      .from("test_results")
      .delete()
      .in("session_id", sessionIds);

    if (resultsError) throw resultsError;

    const { error: sessionsError } = await this.supabase
      .from("test_sessions")
      .delete()
      .in("id", sessionIds);

    if (sessionsError) throw sessionsError;

    for (const sessionId of sessionIds) {
      await cacheService.delete(`test:${sessionId}`);
      await cacheService.delete(`test:results:${sessionId}`);
      await cacheService.delete(`test:questions:${sessionId}`);
    }
    await cacheService.deletePattern(`tests:${userId}:*`);
    await cacheService.delete(`user:${userId}:test-results`);
    await cacheService.delete(`tests:stats:subject:${userId}`);
    await cacheService.deletePattern(`tests:stats:performance:${userId}:*`);
    await cacheService.delete(`user:stats:${userId}`);

    return sessionIds.length;
  }

  async getSubjectStats(userId: string): Promise<any> {
    const cacheKey = `tests:stats:subject:${userId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("test_sessions")
          .select(
            `
          config,
          course_id,
          test_results (score)
        `,
          )
          .eq("user_id", userId)
          .not("end_time", "is", null); // Only completed tests

        if (error) throw error;

        // Group by course (test_sessions.course_id; label = course code).
        // Sessions without a course fall into "General". config.subject was
        // never written by any client, so it is no longer consulted.
        const courseIds = Array.from(
          new Set(
            (data || [])
              .map((test: any) => test.course_id ?? test.config?.courseId)
              .filter((id: unknown): id is string => typeof id === "string" && id.length > 0),
          ),
        );
        const courseLabels = new Map<string, string>();
        if (courseIds.length > 0) {
          const { data: courseRows, error: courseError } = await this.supabase
            .from("courses")
            .select("id, code")
            .in("id", courseIds);
          if (!courseError && courseRows) {
            for (const row of courseRows as Array<{ id: string; code: string }>) {
              courseLabels.set(row.id, row.code);
            }
          }
        }

        const subjectStats: { [key: string]: any } = {};
        data?.forEach((test: any) => {
          const courseId: string | null =
            test.course_id ?? test.config?.courseId ?? null;
          const subject =
            (courseId && courseLabels.get(courseId)) || "General";
          const key = courseId && courseLabels.has(courseId) ? courseId : "general";
          const score = test.test_results?.[0]?.score;
          if (score !== undefined) {
            if (!subjectStats[key]) {
              subjectStats[key] = {
                subject,
                courseId: courseId && courseLabels.has(courseId) ? courseId : null,
                testsTaken: 0,
                averageScore: 0,
                scores: [],
              };
            }
            subjectStats[key].testsTaken++;
            subjectStats[key].scores.push(score);
          }
        });

        // Calculate averages
        Object.values(subjectStats).forEach((stats: any) => {
          stats.averageScore =
            stats.scores.reduce(
              (sum: number, score: number) => sum + score,
              0,
            ) / stats.scores.length;
          delete stats.scores;
        });

        return Object.values(subjectStats);
      },
      { ttl: 600 },
    ); // Cache for 10 minutes
  }

  async getPerformanceStats(
    userId: string,
    period: string = "month",
  ): Promise<any> {
    const cacheKey = `tests:stats:performance:${userId}:${period}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        // Calculate date range based on period
        const now = new Date();
        let startDate: Date;

        switch (period) {
          case "week":
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case "month":
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          case "year":
            startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            break;
          default:
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        const { data, error } = await this.supabase
          .from("test_sessions")
          .select(
            `
          start_time,
          test_results (score)
        `,
          )
          .eq("user_id", userId)
          .not("end_time", "is", null) // Only completed tests
          .gte("start_time", startDate.toISOString());

        if (error) throw error;

        const scores =
          data
            ?.map((test: any) => test.test_results?.[0]?.score)
            .filter((score) => score !== undefined) || [];
        const averageScore =
          scores.length > 0
            ? scores.reduce((sum, score) => sum + score, 0) / scores.length
            : 0;

        return {
          period,
          testsTaken: scores.length,
          averageScore: Math.round(averageScore * 100) / 100,
          highestScore: scores.length > 0 ? Math.max(...scores) : 0,
          lowestScore: scores.length > 0 ? Math.min(...scores) : 0,
        };
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  async getTestTemplates(
    options: {
      page?: number;
      limit?: number;
      subject?: string;
      difficulty?: string;
    } = {},
  ): Promise<any[]> {
    const { page = 1, limit = 20, subject, difficulty } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `tests:templates:${page}:${limit}:${subject || ""}:${difficulty || ""}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        let query = this.supabase.from("test_templates").select("*");

        if (subject) {
          query = query.eq("subject", subject);
        }

        if (difficulty) {
          query = query.eq("difficulty", difficulty);
        }

        const { data, error } = await query
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) throw error;

        return data || [];
      },
      { ttl: 1800 },
    ); // Cache for 30 minutes
  }

  // Gamification Methods for API Routes
  async getLeaderboard(
    options: {
      page?: number;
      limit?: number;
      timeframe?: string;
      metric?: string;
      institutionId?: string;
      ambassador?: boolean;
    } = {},
  ): Promise<any[]> {
    const {
      page = 1,
      limit = 50,
      timeframe = "all",
      metric = "points",
      institutionId,
      ambassador,
    } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `gamification:leaderboard:${page}:${limit}:${timeframe}:${metric}:${institutionId || ""}:${ambassador ? "1" : "0"}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        let query = this.supabase
          .from("profiles")
          .select("id, name, avatar_url, points, stats, is_ambassador, institution_id")
          .order("points", { ascending: false });

        if (ambassador) {
          query = query.eq("is_ambassador", true);
        }
        if (institutionId) {
          query = query.eq("institution_id", institutionId);
        }

        // Apply timeframe filtering if needed (simplified)
        if (timeframe !== "all") {
          // In a real implementation, you'd filter based on recent activity
          // For now, just return all users
        }

        const { data, error } = await query.range(offset, offset + limit - 1);

        if (error) throw error;

        return (data || []).map((user: any, index: number) => ({
          rank: offset + index + 1,
          user: {
            id: user.id,
            name: user.name,
            avatarUrl: user.avatar_url,
            points: user.points || 0,
            stats: user.stats || {},
            campusAmbassador: user.is_ambassador ? 1 : 0,
          },
        }));
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  async getAchievements(
    options: {
      page?: number;
      limit?: number;
      category?: string;
    } = {},
  ): Promise<any[]> {
    const { page = 1, limit = 20, category } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `gamification:achievements:${page}:${limit}:${category || ""}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        let query = this.supabase.from("achievements").select("*");

        if (category) {
          query = query.eq("category", category);
        }

        const { data, error } = await query
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) throw error;

        return data || [];
      },
      { ttl: 1800 },
    ); // Cache for 30 minutes
  }

  async getUserAchievements(
    userId: string,
    options: {
      page?: number;
      limit?: number;
    } = {},
  ): Promise<any[]> {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `gamification:user:achievements:${userId}:${page}:${limit}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("user_achievements")
          .select(
            `
          *,
          achievements (*)
        `,
          )
          .eq("user_id", userId)
          .order("unlocked_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) throw error;

        return (
          data?.map((ua: any) => ({
            ...ua.achievements,
            unlockedAt: ua.unlocked_at,
            progress: ua.progress,
          })) || []
        );
      },
      { ttl: 600 },
    ); // Cache for 10 minutes
  }

  async awardPoints(
    userId: string,
    points: number,
    reason: string,
    source?: string,
  ): Promise<any> {
    // Get current points
    const { data: user, error: userError } = await this.supabase
      .from("profiles")
      .select("points")
      .eq("id", userId)
      .single();

    if (userError) throw userError;

    const currentPoints = user?.points || 0;
    const newPoints = currentPoints + points;

    // Update user points
    const { data, error } = await this.supabase
      .from("profiles")
      .update({ points: newPoints })
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;

    // Optional audit log — table may not exist on older deployments
    const { error: logError } = await this.supabase
      .from("points_transactions")
      .insert({
        user_id: userId,
        points,
        reason,
        source: source || "manual",
      });

    if (logError) {
      logger.warn("points_transactions insert skipped", {
        userId,
        code: logError.code,
        message: logError.message,
      });
    }

    // Invalidate caches
    await cacheService.deletePattern(`gamification:leaderboard:*`);
    await cacheService.delete(`user:stats:${userId}`);
    await cacheService.deletePattern(
      `gamification:user:achievements:${userId}:*`,
    );

    return {
      userId,
      pointsAwarded: points,
      newTotal: newPoints,
      reason,
      source,
    };
  }

  async awardAchievement(userId: string, achievementId: string): Promise<any> {
    // Check if user already has this achievement
    const { data: existing, error: checkError } = await this.supabase
      .from("user_achievements")
      .select("id")
      .eq("user_id", userId)
      .eq("achievement_id", achievementId)
      .single();

    if (checkError && checkError.code !== "PGRST116") throw checkError;

    if (existing) {
      throw new Error("User already has this achievement");
    }

    // Award the achievement
    const { data, error } = await this.supabase
      .from("user_achievements")
      .insert({
        user_id: userId,
        achievement_id: achievementId,
        unlocked_at: new Date().toISOString(),
        progress: 100,
      })
      .select(
        `
        *,
        achievements (*)
      `,
      )
      .single();

    if (error) throw error;

    // Award points for achievement if configured
    const achievement = data.achievements;
    if (achievement.points_reward) {
      await this.awardPoints(
        userId,
        achievement.points_reward,
        `Achievement unlocked: ${achievement.name}`,
        "achievement",
      );
    }

    // Invalidate caches
    await cacheService.deletePattern(
      `gamification:user:achievements:${userId}:*`,
    );

    return {
      ...achievement,
      unlockedAt: data.unlocked_at,
      progress: data.progress,
    };
  }

  async getUserProgress(userId: string): Promise<any> {
    const cacheKey = `gamification:user:progress:${userId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        // Get user stats
        const user = await this.getUserById(userId);
        if (!user) throw new Error("User not found");

        // Get achievements progress
        const { data: achievements, error: achError } = await this.supabase
          .from("user_achievements")
          .select("achievement_id, progress")
          .eq("user_id", userId);

        if (achError) throw achError;

        // Get level info
        const level = await this.getUserLevel(userId);

        return {
          userId,
          points: user.points || 0,
          level: level.currentLevel,
          achievementsUnlocked: achievements?.length || 0,
          nextLevelPoints: level.nextLevelPoints,
          progressToNextLevel: level.progressToNextLevel,
          stats: user.stats || {},
        };
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  async getGamificationStats(): Promise<any> {
    const cacheKey = "gamification:stats";

    return cacheService.cached(
      cacheKey,
      async () => {
        // Get total users
        const { count: totalUsers, error: usersError } = await this.supabase
          .from("profiles")
          .select("id", { count: "exact", head: true });

        // Get total achievements unlocked
        const { count: totalAchievements, error: achError } =
          await this.supabase
            .from("user_achievements")
            .select("id", { count: "exact", head: true });

        // Get total points awarded
        const { data: pointsData, error: pointsError } = await this.supabase
          .from("profiles")
          .select("points");

        if (usersError || achError || pointsError) {
          throw usersError || achError || pointsError;
        }

        const totalPoints =
          pointsData?.reduce((sum, user) => sum + (user.points || 0), 0) || 0;

        return {
          totalUsers: totalUsers || 0,
          totalAchievements: totalAchievements || 0,
          totalPoints,
          averagePointsPerUser: totalUsers ? totalPoints / totalUsers : 0,
        };
      },
      { ttl: 600 },
    ); // Cache for 10 minutes
  }

  // ---------------------------------------------------------------------------
  // Badges
  //
  // There is no `badges` / `user_badges` table — no migration ever created one.
  // Badges live in profiles.badges (JSONB array of Badge objects, the shape
  // checkAndAwardBadges writes) and the gamification lockdown trigger
  // (supabase/migrations/20260704100100_gamification_lockdown.sql) only lets the
  // service role change that column, which is exactly the client this service
  // holds. Everything below reads and writes that column directly.
  // ---------------------------------------------------------------------------

  /**
   * The badge catalogue. Static — it is BADGE_DEFINITIONS, not a table — so the
   * pagination args are honoured only to keep the route's contract. `category`
   * was a column on the table that never existed; badges have no categories, so
   * any non-empty category matches nothing.
   */
  async getBadges(
    options: {
      page?: number;
      limit?: number;
      category?: string;
    } = {},
  ): Promise<any[]> {
    const { page = 1, limit = 20, category } = options;
    if (category) return [];
    const offset = (Math.max(1, page) - 1) * Math.max(1, limit);
    return Object.values(BADGE_DEFINITIONS)
      .map((def) => ({
        id: def.id,
        name: def.baseName,
        description: def.baseDescription(def.levels[0]?.threshold ?? 0),
        icon: def.icon,
        metric: def.metric,
        levels: def.levels,
      }))
      .slice(offset, offset + Math.max(1, limit));
  }

  /** Badges the user holds, newest first, straight from profiles.badges. */
  async getUserBadges(
    userId: string,
    options: {
      page?: number;
      limit?: number;
    } = {},
  ): Promise<any[]> {
    const { page = 1, limit = 20 } = options;
    const offset = (Math.max(1, page) - 1) * Math.max(1, limit);

    const { data, error } = await this.supabase
      .from("profiles")
      .select("badges")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;

    const badges = Array.isArray(data?.badges) ? [...data.badges] : [];
    badges.sort(
      (a: any, b: any) =>
        Date.parse(String(b?.dateAwarded ?? "")) -
          Date.parse(String(a?.dateAwarded ?? "")) || 0,
    );
    return badges.slice(offset, offset + Math.max(1, limit));
  }

  /**
   * Manually grant a badge (admin console). Appends a level-1 Badge object in
   * the exact shape checkAndAwardBadges writes, so the dashboards and the
   * automatic levelling (which looks for `currentLevel + 1`) treat it as any
   * earned badge. Idempotent: a badge the user already holds — at any level —
   * is left untouched and reported as `awarded: false`. Points are not changed;
   * the console has a separate control for that.
   */
  async awardBadge(
    userId: string,
    badgeId: string,
    actorId?: string,
  ): Promise<{
    awarded: boolean;
    badge: ReturnType<typeof createBadge> | null;
    badges: ReturnType<typeof createBadge>[];
  }> {
    if (
      typeof badgeId !== "string" ||
      !Object.prototype.hasOwnProperty.call(BADGE_DEFINITIONS, badgeId)
    ) {
      throw Object.assign(
        new PublicError(
          `Unknown badge id: ${String(badgeId)}. Known ids: ${Object.keys(BADGE_DEFINITIONS).join(", ")}`,
        ),
        { statusCode: 400 },
      );
    }
    const knownId = badgeId as keyof typeof BADGE_DEFINITIONS;

    const { data: profile, error } = await this.supabase
      .from("profiles")
      .select("id, badges")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!profile) {
      throw Object.assign(new PublicError("User not found"), {
        statusCode: 404,
      });
    }

    const current: ReturnType<typeof createBadge>[] = Array.isArray(
      profile.badges,
    )
      ? [...profile.badges]
      : [];
    const existing = current.find((b: any) => b?.id === knownId);
    if (existing) {
      return { awarded: false, badge: existing, badges: current };
    }

    const badge = createBadge(knownId, 1);
    const next = [...current, badge];

    // Service-role client: the only role the lockdown trigger lets write here.
    const { error: writeError } = await this.supabase
      .from("profiles")
      .update({ badges: next })
      .eq("id", userId);
    if (writeError) throw writeError;

    await cacheService.invalidateUserCache(userId);
    await cacheService.deletePattern(`gamification:user:badges:${userId}:*`);
    logger.info("Badge granted manually", { userId, badgeId: knownId, actorId });

    // Phase 3 M: unlocked_badge had no writer. Only the FIRST award reaches
    // here (the already-owned case returns above), so this cannot spam a feed.
    void (async () => {
      const { getActivityFeedService } = await import("./activityFeed");
      await getActivityFeedService(this).record({
        actorId: userId,
        verb: "unlocked_badge",
        objectType: "badge",
        objectId: badgeId,
        audienceType: "followers",
        payload: { title: (badge as { name?: string } | null)?.name ?? null },
      });
    })();

    return { awarded: true, badge, badges: next };
  }

  async getLevels(): Promise<any[]> {
    const cacheKey = "gamification:levels";

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("levels")
          .select("*")
          .order("level_number", { ascending: true });

        if (error) throw error;

        return data || [];
      },
      { ttl: 3600 },
    ); // Cache for 1 hour
  }

  async getUserLevel(userId: string): Promise<any> {
    const cacheKey = `gamification:user:level:${userId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const user = await this.getUserById(userId);
        if (!user) throw new Error("User not found");

        const points = user.points || 0;
        const levels = await this.getLevels();

        // Find current level
        let currentLevel = levels[0]; // Default to first level
        let nextLevel = null;

        for (let i = 0; i < levels.length; i++) {
          if (points >= levels[i].points_required) {
            currentLevel = levels[i];
            nextLevel = levels[i + 1] || null;
          } else {
            break;
          }
        }

        const progressToNextLevel = nextLevel
          ? ((points - currentLevel.points_required) /
              (nextLevel.points_required - currentLevel.points_required)) *
            100
          : 100;

        return {
          currentLevel: currentLevel.level_number,
          levelName: currentLevel.name,
          currentPoints: points,
          pointsRequired: currentLevel.points_required,
          nextLevelPoints:
            nextLevel?.points_required || currentLevel.points_required,
          progressToNextLevel: Math.min(100, Math.max(0, progressToNextLevel)),
          rewards: currentLevel.rewards || [],
        };
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  async recordStudyActivity(
    userId: string,
    type: string,
    amount = 1,
    activityDate?: string,
  ): Promise<any> {
    const vAmount = Math.max(Math.floor(Number(amount) || 1), 0);
    const activityDateStr =
      activityDate && /^\d{4}-\d{2}-\d{2}$/.test(activityDate)
        ? activityDate
        : new Date().toISOString().slice(0, 10);

    const { data, error } = await this.supabase.rpc("record_study_activity", {
      p_user_id: userId,
      p_type: type,
      p_amount: vAmount,
      p_activity_date: activityDateStr,
    });

    if (error) throw error;
    return data;
  }

  private profileToGamificationUser(
    profile: Record<string, unknown>,
    statsOverride?: Partial<UserStats>,
  ): User {
    const normalizedStats = mapUserStatsFromApi(profile.stats || {});
    return {
      id: String(profile.id),
      name: String(profile.name || ""),
      email: String(profile.email || ""),
      password: "",
      phoneNumber: String(profile.phone || ""),
      avatarUrl: String(profile.avatar_url || profile.avatarUrl || ""),
      points: Number(profile.points) || 0,
      badges: (profile.badges as User["badges"]) || [],
      stats: {
        ...initialUserStats,
        ...normalizedStats,
        ...(statsOverride || {}),
      },
    } as User;
  }

  async incrementUserStatsAndAwardBadges(
    userId: string,
    increments: Partial<UserStats>,
  ): Promise<GamificationSyncResult> {
    const profile = await this.getUserById(userId);
    if (!profile) {
      throw new Error("User not found");
    }

    const base = this.profileToGamificationUser(
      profile as unknown as Record<string, unknown>,
    );
    const stats = { ...base.stats };
    for (const key of Object.keys(increments) as (keyof UserStats)[]) {
      const delta = increments[key];
      if (typeof delta === "number" && delta !== 0) {
        stats[key] = (stats[key] || 0) + delta;
      }
    }

    const { updatedUser, awardedBadges } = checkAndAwardBadges({
      ...base,
      stats,
    });
    await this.updateUser(userId, {
      points: updatedUser.points,
      badges: updatedUser.badges,
      stats: updatedUser.stats,
    });
    await cacheService.delete(`user:${userId}`);

    return {
      points: updatedUser.points,
      badges: updatedUser.badges,
      stats: updatedUser.stats,
      awardedBadges,
    };
  }

  /**
   * Recount the badge stats that can be derived from source tables.
   *
   * These were previously only ever incremented on events, so they drifted in
   * both directions and no client agreed with the dashboard: a failed increment
   * is swallowed and silently undercounts, while re-submitting a result re-ran
   * the increment and overcounted. Counting from the rows themselves is
   * self-healing — whatever the history, the answer converges on the truth.
   *
   * Only derivable metrics are returned. gamesWon has no reliable source query
   * yet, so it is deliberately absent and the caller must preserve the stored
   * value rather than treat it as zero. The marketplace counters are derived:
   *   listingsCreated  — every marketplace_listings row the user owns
   *   listingsSold     — distinct listings that are either status 'sold' (manual
   *                      mark-as-sold, or flipped by order completion) or have a
   *                      completed marketplace_orders row for this seller. The
   *                      union catches multi-quantity listings that stay active
   *                      after a sale and sold listings later relisted/archived,
   *                      while never counting one listing twice.
   *   fiveStarReviews  — marketplace_reviews with rating 5 on the user's listings
   *                      (reviews have no seller column; joined via the listing)
   *   offersMade       — marketplace_offers rows where the user is buyer_id. Only
   *                      buyers create offer rows; seller counters update the row
   *                      in place, so buyer_id = "who made the offer".
   */
  async recomputeDerivedUserStats(userId: string): Promise<Partial<UserStats>> {
    const [
      sessions,
      questionCount,
      topQuestion,
      groupCount,
      listingCount,
      soldListings,
      completedOrders,
      fiveStarReviewCount,
      offerCount,
      ambassadorFlag,
    ] = await Promise.all(
      [
        this.supabase
          .from("test_sessions")
          .select("start_time, test_results (score)")
          .eq("user_id", userId)
          .eq("status", "completed"),
        this.supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("sender_id", userId)
          .eq("type", "QUESTION"),
        this.supabase
          .from("messages")
          .select("upvotes")
          .eq("sender_id", userId)
          .eq("type", "QUESTION")
          .order("upvotes", { ascending: false })
          .limit(1)
          .maybeSingle(),
        // createGroup writes `admin_ids: [userId]`, so element 0 is the creator;
        // later admins are appended, leaving that entry intact. Filtering on
        // `admin_ids->>0` directly would be neater, but supabase-js URL-encodes
        // column names and PostgREST then fails to read it as a JSON path — so
        // match on containment, which encodes safely, and check position here.
        this.supabase
          .from("groups")
          .select("admin_ids")
          .contains("admin_ids", [userId]),
        this.supabase
          .from("marketplace_listings")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
        this.supabase
          .from("marketplace_listings")
          .select("id")
          .eq("user_id", userId)
          .eq("status", "sold"),
        this.supabase
          .from("marketplace_orders")
          .select("listing_id")
          .eq("seller_id", userId)
          .eq("status", "completed"),
        // Reviews carry no seller column, so filter through an inner join on the
        // listing: `!inner` makes the embedded filter drop parent rows too, and
        // the exact count is taken over that joined result.
        this.supabase
          .from("marketplace_reviews")
          .select("id, marketplace_listings!inner(user_id)", {
            count: "exact",
            head: true,
          })
          .eq("rating", 5)
          .eq("marketplace_listings.user_id", userId),
        this.supabase
          .from("marketplace_offers")
          .select("id", { count: "exact", head: true })
          .eq("buyer_id", userId),
        this.supabase
          .from("profiles")
          .select("is_ambassador")
          .eq("id", userId)
          .maybeSingle(),
      ],
    );

    // Deduplicate by start-time, matching how the dashboard counts. A genuine
    // double-submit can leave two session rows for one sitting, and the badge
    // count has to agree with the number the user is shown.
    const seenStartTimes = new Set<string>();
    let testsCompleted = 0;
    let highScoreTests = 0;
    let perfectScoreTests = 0;

    for (const row of (sessions.data || []) as any[]) {
      const startTime = String(row.start_time ?? "");
      if (startTime && seenStartTimes.has(startTime)) continue;
      if (startTime) seenStartTimes.add(startTime);

      testsCompleted++;
      const result = Array.isArray(row.test_results)
        ? row.test_results[0]
        : row.test_results;
      const score = Number(result?.score);
      if (!Number.isFinite(score)) continue;
      if (score >= 80) highScoreTests++;
      if (score >= 100) perfectScoreTests++;
    }

    const derived: Partial<UserStats> = {
      testsCompleted,
      highScoreTests,
      perfectScoreTests,
    };

    // A failed count must not be mistaken for "zero of them" — leaving the key
    // out preserves whatever is already stored.
    if (!questionCount.error && typeof questionCount.count === "number") {
      derived.questionsCreated = questionCount.count;
    }
    if (!groupCount.error && Array.isArray(groupCount.data)) {
      derived.groupsCreated = (groupCount.data as any[]).filter((row) => {
        const admins = row?.admin_ids;
        const first = Array.isArray(admins) ? admins[0] : undefined;
        return String(first ?? "") === userId;
      }).length;
    }
    if (!topQuestion.error) {
      derived.questionUpvotesMax = Number(topQuestion.data?.upvotes) || 0;
    }
    if (sessions.error) {
      delete derived.testsCompleted;
      delete derived.highScoreTests;
      delete derived.perfectScoreTests;
      logger.warn("Could not recount test stats; keeping stored values", {
        userId,
        error: sessions.error.message,
      });
    }

    // Marketplace counters — same rule: a failed read leaves the key out.
    if (!listingCount.error && typeof listingCount.count === "number") {
      derived.listingsCreated = listingCount.count;
    }
    if (soldListings.error || completedOrders.error) {
      logger.warn("Could not recount listings sold; keeping stored value", {
        userId,
        error:
          soldListings.error?.message ?? completedOrders.error?.message,
      });
    } else {
      const soldIds = new Set<string>();
      for (const row of (soldListings.data || []) as any[]) {
        if (row?.id) soldIds.add(String(row.id));
      }
      for (const row of (completedOrders.data || []) as any[]) {
        if (row?.listing_id) soldIds.add(String(row.listing_id));
      }
      derived.listingsSold = soldIds.size;
    }
    if (
      !fiveStarReviewCount.error &&
      typeof fiveStarReviewCount.count === "number"
    ) {
      derived.fiveStarReviews = fiveStarReviewCount.count;
    }
    if (!offerCount.error && typeof offerCount.count === "number") {
      derived.offersMade = offerCount.count;
    }
    if (!ambassadorFlag.error) {
      derived.campusAmbassador =
        (ambassadorFlag.data as { is_ambassador?: boolean } | null)?.is_ambassador === true
          ? 1
          : 0;
    }

    return derived;
  }

  async syncGamificationProgress(
    userId: string,
  ): Promise<GamificationSyncResult> {
    // Reconcile against source data before re-evaluating. checkAndAwardBadges
    // only ever looks for currentLevel + 1, so a corrected-downwards count can
    // never revoke a badge the user already holds.
    const derived = await this.recomputeDerivedUserStats(userId).catch((err) => {
      logger.warn("Stat recompute failed; evaluating against stored stats", {
        userId,
        err,
      });
      return {} as Partial<UserStats>;
    });
    return this.syncGamificationProgressWithStats(userId, { stats: derived });
  }

  /** Server-only: apply trusted stats before badge evaluation (e.g. after test completion). */
  async syncGamificationProgressWithStats(
    userId: string,
    options: {
      stats?: Partial<UserStats>;
      activityDate?: string;
    } = {},
  ): Promise<GamificationSyncResult> {
    const profile = await this.getUserById(userId);
    if (!profile) {
      throw new Error("User not found");
    }

    // What the profile holds now, before any recomputed stats are layered on —
    // the baseline for deciding whether this sync actually changed anything.
    const stored = this.profileToGamificationUser(
      profile as unknown as Record<string, unknown>,
    );
    const user = this.profileToGamificationUser(
      profile as unknown as Record<string, unknown>,
      options.stats,
    );
    const { updatedUser, awardedBadges } = checkAndAwardBadges(user);

    // Both clients call this on every dashboard load, so writing unconditionally
    // would mean a profile UPDATE per screen open for no reason. Only persist
    // when the reconciliation or an award genuinely moved something.
    const changed =
      updatedUser.points !== stored.points ||
      JSON.stringify(updatedUser.stats) !== JSON.stringify(stored.stats) ||
      JSON.stringify(updatedUser.badges) !== JSON.stringify(stored.badges);

    if (changed) {
      await this.updateUser(userId, {
        points: updatedUser.points,
        badges: updatedUser.badges,
        stats: updatedUser.stats,
      });
      await cacheService.delete(`user:${userId}`);
    }

    return {
      points: updatedUser.points,
      badges: updatedUser.badges,
      stats: updatedUser.stats,
      awardedBadges,
    };
  }

  // No `score` parameter: the score of the test that triggered this is read back
  // from the saved rows along with every other test, rather than trusted from
  // the caller and added to a running total.
  async applyTestCompletionGamification(
    userId: string,
    activityDate?: string,
  ): Promise<{
    points: number;
    badges: User["badges"];
    stats: UserStats;
    awardedBadges: User["badges"];
  }> {
    const profile = await this.getUserById(userId);
    if (!profile) {
      throw new Error("User not found");
    }

    // Recount from the saved rows instead of incrementing. The result row is
    // upserted on session_id, so it is idempotent — but the old increment was
    // not, and re-submitting a test inflated these counters permanently. The
    // session is marked completed before its result is written, so the test that
    // triggered this is already included; if that ever changes, the count is one
    // low until the next sync rather than wrong forever.
    const stats = {
      ...this.profileToGamificationUser(
        profile as unknown as Record<string, unknown>,
      ).stats,
      ...(await this.recomputeDerivedUserStats(userId).catch((err) => {
        logger.warn("Stat recompute failed after test completion", {
          userId,
          err,
        });
        return {} as Partial<UserStats>;
      })),
    };

    const result = await this.syncGamificationProgressWithStats(userId, {
      stats,
    });
    await this.recordStudyActivity(userId, "test", 1, activityDate).catch(
      (err) => {
        logger.warn("Failed to record study activity after test", {
          userId,
          err,
        });
      },
    );
    await this.recomputeUserStreak(userId, activityDate).catch((err) => {
      logger.warn("Failed to recompute streak after test", { userId, err });
    });
    return result;
  }

  async touchLastSeen(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from("profiles")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) throw error;
  }

  async getStudyActivity(
    userId: string,
    days = 112,
  ): Promise<
    Array<{
      date: string;
      count: number;
      breakdown: Partial<Record<string, number>>;
    }>
  > {
    const since = new Date();
    since.setDate(since.getDate() - Math.max(1, days) + 1);
    const sinceDate = since.toISOString().slice(0, 10);

    const { data, error } = await this.supabase
      .from("study_activity")
      .select(
        "activity_date, count, test_count, flashcard_count, new_flashcard_count, question_count, game_count, daily_quiz_count",
      )
      .eq("user_id", userId)
      .gte("activity_date", sinceDate)
      .order("activity_date", { ascending: true });

    if (error) throw error;

    return (data || []).map((row: any) => ({
      date: row.activity_date,
      count: row.count ?? 0,
      breakdown: {
        test: row.test_count ?? 0,
        flashcard: row.flashcard_count ?? 0,
        flashcard_new: row.new_flashcard_count ?? 0,
        study_question: row.question_count ?? 0,
        game: row.game_count ?? 0,
        daily_quiz: row.daily_quiz_count ?? 0,
      },
    }));
  }

  private parseStreakReferenceDate(referenceDate?: string): Date {
    if (referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
      const [y, m, d] = referenceDate.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  }

  /** Recompute streak from study_activity (heatmap-aligned, client-local dates). */
  async recomputeUserStreak(
    userId: string,
    referenceDate?: string,
  ): Promise<{
    user_id: string;
    current_streak: number;
    longest_streak: number;
    last_login_date: string | null;
    streak_freezes: number;
    updated_at: string;
  }> {
    const STREAK_LOOKBACK_DAYS = 400;
    const activityDays = await this.getStudyActivity(
      userId,
      STREAK_LOOKBACK_DAYS,
    );
    const ref = this.parseStreakReferenceDate(referenceDate);
    const { current, longest, lastActiveDate } = computeStudyStreak(
      activityDays,
      ref,
    );

    const { data: existing } = await this.supabase
      .from("user_streaks")
      .select("streak_freezes, longest_streak")
      .eq("user_id", userId)
      .maybeSingle();

    const streakFreezes = existing?.streak_freezes ?? 0;
    const longestStreak = Math.max(existing?.longest_streak ?? 0, longest);

    const { data, error } = await this.supabase
      .from("user_streaks")
      .upsert(
        {
          user_id: userId,
          current_streak: current,
          longest_streak: longestStreak,
          last_login_date: lastActiveDate,
          streak_freezes: streakFreezes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Helper methods
  private generateTestQuestions(config: any): any[] {
    // Simplified question generation - in a real app this would be more sophisticated
    const questions = [];
    const numQuestions = config.numQuestions || 10;

    for (let i = 0; i < numQuestions; i++) {
      questions.push({
        id: `q${i + 1}`,
        question: `Sample question ${i + 1}?`,
        options: ["A", "B", "C", "D"],
        correctAnswer: "A",
        subject: config.subject || "General",
        difficulty: config.difficulty || "medium",
      });
    }

    return questions;
  }

  private calculateTestScore(questions: any[], answers: any[]): number {
    let correct = 0;
    questions.forEach((question, index) => {
      if (answers[index] === question.correctAnswer) {
        correct++;
      }
    });
    return (correct / questions.length) * 100;
  }

  private async updateUserStats(userId: string, score: number): Promise<void> {
    // Update user stats (simplified)
    const { data: user, error: userError } = await this.supabase
      .from("profiles")
      .select("stats")
      .eq("id", userId)
      .single();

    if (userError) throw userError;

    const currentStats = user?.stats || {};
    const testsTaken = (currentStats.testsTaken || 0) + 1;
    const totalScore = (currentStats.totalScore || 0) + score;
    const averageScore = totalScore / testsTaken;

    const { error } = await this.supabase
      .from("profiles")
      .update({
        stats: {
          ...currentStats,
          testsTaken,
          totalScore,
          averageScore,
        },
      })
      .eq("id", userId);

    if (error) throw error;
  }

  // Group Functions
  async fetchGroups(userId: string): Promise<Group[]> {
    const cacheKey = `user:${userId}:groups`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("group_members")
          .select(
            `
          groups (
            id,
            name,
            avatar_url,
            description,
            last_message,
            last_message_time,
            admin_ids,
            permissions,
            parent_id,
            is_archived,
            invite_id,
            course_id,
            created_at
          )
        `,
          )
          .eq("user_id", userId);

        if (error) throw error;
        return data.map((item: any) => item.groups);
      },
      { ttl: 60 },
    ); // Cache for 1 minute
  }

  async fetchGroupMembers(groupId: string): Promise<User[]> {
    const cacheKey = `group:${groupId}:members`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("group_members")
          .select(
            `
          user_id,
          profiles!user_id (
            id,
            name,
            username,
            avatar_url,
            phone
          )
        `,
          )
          .eq("group_id", groupId)
          .eq("pending", false);

        if (error) throw error;
        const members: User[] = [];
        for (const item of data || []) {
          const profile = Array.isArray(item.profiles)
            ? item.profiles[0]
            : item.profiles;
          if (!profile) continue;
          members.push({
            id: profile.id || item.user_id,
            name: profile.name,
            username: profile.username,
            avatarUrl: profile.avatar_url,
            phoneNumber: profile.phone,
            points: 0,
            badges: [],
            stats: {},
          } as User);
        }
        return members;
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  // Message Functions
  private async findGroupMessageByClientId(
    groupId: string,
    userId: string,
    clientMessageId: string,
  ): Promise<any | null> {
    const { data, error } = await this.supabase
      .from("messages")
      .select("*")
      .eq("group_id", groupId)
      .eq("sender_id", userId)
      .eq("client_message_id", clientMessageId)
      .maybeSingle();

    if (error) {
      logger.error("findGroupMessageByClientId failed", {
        error,
        groupId,
        userId,
        clientMessageId,
      });
      return null;
    }
    return data;
  }

  private async resolveGroupMentionUserIds(
    groupId: string,
    senderId: string,
    content: string,
    explicitIds?: string[],
  ): Promise<string[]> {
    const usernames = extractMentionUsernames(content);
    const members = await this.fetchGroupMembers(groupId);
    const byUsername = new Map<string, string>();
    const usernameById = new Map<string, string>();
    const memberIds: string[] = [];
    for (const m of members || []) {
      const username = (m as any)?.username;
      const id = (m as any)?.id;
      if (typeof id === "string") memberIds.push(id);
      if (username && id) {
        const key = String(username).toLowerCase();
        byUsername.set(key, id);
        usernameById.set(id, key);
      }
    }
    const memberIdSet = new Set(memberIds);
    const fromText = usernames
      .filter((u) => u !== "all")
      .map((u: string) => byUsername.get(u))
      .filter(
        (id: string | undefined): id is string => !!id && id !== senderId,
      );

    // Admins may @all to notify every active member except themselves.
    if (
      usernames.includes("all") &&
      (await this.isGroupAdmin(groupId, senderId))
    ) {
      for (const id of memberIds) {
        if (id !== senderId) fromText.push(id);
      }
    }

    // Only accept client-provided IDs that match @usernames actually in the text
    // (prevents non-admins from mass-notifying via a forged mentionedUserIds list).
    const mentionedUsernameSet = new Set(usernames.filter((u) => u !== "all"));
    const fromExplicit = (explicitIds || []).filter((id) => {
      if (!memberIdSet.has(id) || id === senderId || id === "__all__")
        return false;
      const username = usernameById.get(id);
      return !!username && mentionedUsernameSet.has(username);
    });
    return [...new Set([...fromText, ...fromExplicit])];
  }

  private buildReplyToFromParent(
    parent: any,
    table: "messages" | "dm_messages",
  ): Record<string, unknown> {
    const profile = Array.isArray(parent.profiles)
      ? parent.profiles[0]
      : parent.profiles;
    const isRemoved = !!parent.removed_at;
    if (table === "dm_messages") {
      return {
        id: parent.id,
        senderId: parent.sender_id,
        senderName:
          profile?.name ||
          (profile?.username ? `@${profile.username}` : "Member"),
        type: "TEXT",
        text: isRemoved ? undefined : parent.text,
        isRemoved,
      };
    }
    const qd =
      parent.question_data && typeof parent.question_data === "object"
        ? parent.question_data
        : {};
    return {
      id: parent.id,
      senderId: parent.sender_id,
      senderName:
        profile?.name ||
        (profile?.username ? `@${profile.username}` : "Member"),
      type: parent.type,
      text: isRemoved ? undefined : parent.text,
      questionStem: isRemoved ? undefined : qd.questionStem,
      isRemoved,
    };
  }

  private async attachReplyPreview(
    message: any,
    table: "messages" | "dm_messages" = "messages",
  ): Promise<any> {
    const replyId = message?.reply_to_message_id || message?.replyToMessageId;
    if (!replyId) return message;
    const select =
      table === "dm_messages"
        ? "id, sender_id, text, removed_at, profiles:sender_id(id, name, username)"
        : "id, sender_id, type, text, question_data, removed_at, profiles:sender_id(id, name, username)";
    const { data: parent } = await this.supabase
      .from(table)
      .select(select)
      .eq("id", replyId)
      .maybeSingle();
    if (!parent) return { ...message, replyTo: null };
    return { ...message, replyTo: this.buildReplyToFromParent(parent, table) };
  }

  private async attachReplyPreviewsBatch(
    messages: any[],
    table: "messages" | "dm_messages",
  ): Promise<any[]> {
    if (!messages.length) return messages;
    const replyIds = [
      ...new Set(
        messages
          .map((m) => m?.reply_to_message_id || m?.replyToMessageId)
          .filter((id): id is string => typeof id === "string" && !!id),
      ),
    ];
    if (!replyIds.length) return messages;
    const select =
      table === "dm_messages"
        ? "id, sender_id, text, removed_at, profiles:sender_id(id, name, username)"
        : "id, sender_id, type, text, question_data, removed_at, profiles:sender_id(id, name, username)";
    const { data: parents } = await this.supabase
      .from(table)
      .select(select)
      .in("id", replyIds);
    const byId = new Map((parents || []).map((p: any) => [p.id, p]));
    return messages.map((message) => {
      const replyId = message?.reply_to_message_id || message?.replyToMessageId;
      if (!replyId) return message;
      const parent = byId.get(replyId);
      if (!parent) return { ...message, replyTo: null };
      return {
        ...message,
        replyTo: this.buildReplyToFromParent(parent, table),
      };
    });
  }

  /** Count replies per thread_root_id for messages in a conversation scope. */
  private async attachThreadReplyCounts(
    messages: any[],
    table: "messages" | "dm_messages",
    scopeColumn: "group_id" | "thread_id",
    scopeId: string,
  ): Promise<any[]> {
    if (!messages.length) return messages;
    const candidateRootIds = [
      ...new Set(
        messages.flatMap((m) => {
          const id = m?.id;
          const root = m?.thread_root_id || m?.threadRootId;
          return [id, root].filter(
            (x): x is string => typeof x === "string" && !!x,
          );
        }),
      ),
    ];
    if (!candidateRootIds.length) return messages;

    const { data, error } = await this.supabase
      .from(table)
      .select("thread_root_id")
      .eq(scopeColumn, scopeId)
      .is("removed_at", null)
      .in("thread_root_id", candidateRootIds);

    if (error) {
      logger.warn("attachThreadReplyCounts failed", { error, table, scopeId });
      return messages.map((m) => ({ ...m, replyCount: m.replyCount ?? 0 }));
    }

    const counts = new Map<string, number>();
    for (const row of data || []) {
      const rootId = (row as { thread_root_id?: string }).thread_root_id;
      if (!rootId) continue;
      counts.set(rootId, (counts.get(rootId) || 0) + 1);
    }

    return messages.map((m) => {
      // Only a thread root carries a reply count. Falling back to the root id
      // for replies gave every message in the thread the root's count, so each
      // reply rendered its own "N replies" chip.
      const isThreadRoot = !(m.thread_root_id || m.threadRootId);
      return { ...m, replyCount: isThreadRoot ? counts.get(m.id) || 0 : 0 };
    });
  }

  private async enrichGroupMessageReceipts(
    messages: Message[],
    groupId: string,
    viewerUserId: string,
  ): Promise<Message[]> {
    const hasOwn = messages.some(
      (m) =>
        (m as any).senderId === viewerUserId || m.sender?.id === viewerUserId,
    );
    if (!hasOwn) return messages;

    const { data: members, error } = await this.supabase
      .from("group_members")
      .select("user_id, last_read_at")
      .eq("group_id", groupId)
      .eq("pending", false);

    if (error) {
      logger.warn("enrichGroupMessageReceipts failed", { error, groupId });
      return messages;
    }

    const watermarks = (members || [])
      .filter((m: { user_id: string }) => m.user_id !== viewerUserId)
      .map((m: { last_read_at?: string | null }) => m.last_read_at);

    return messages.map((msg) => {
      const senderId = (msg as any).senderId || msg.sender?.id;
      if (senderId !== viewerUserId) return msg;
      const receipt = computeGroupReceipt(msg.timestamp, watermarks);
      return { ...msg, ...receipt };
    });
  }

  private async enrichDmMessageReceipts(
    messages: Message[],
    threadId: string,
    viewerUserId: string,
    peerUserId: string,
  ): Promise<Message[]> {
    const hasOwn = messages.some(
      (m) =>
        (m as any).senderId === viewerUserId || m.sender?.id === viewerUserId,
    );
    if (!hasOwn) return messages;

    const { data: readStatus, error } = await this.supabase
      .from("dm_read_status")
      .select("last_read_at")
      .eq("thread_id", threadId)
      .eq("user_id", peerUserId)
      .maybeSingle();

    if (error) {
      logger.warn("enrichDmMessageReceipts failed", { error, threadId });
      return messages;
    }

    const peerLastReadAt = readStatus?.last_read_at;
    return messages.map((msg) => {
      const senderId = (msg as any).senderId || msg.sender?.id;
      if (senderId !== viewerUserId) return msg;
      return {
        ...msg,
        receiptStatus: computeDmReceiptStatus(msg.timestamp, peerLastReadAt),
      };
    });
  }

  /** Resolve thread_root_id for a reply; validates parent is in the same conversation. */
  private async resolveThreadRootForReply(
    table: "messages" | "dm_messages",
    replyToMessageId: string,
    scope: { groupId?: string; threadId?: string },
  ): Promise<string> {
    const select =
      table === "messages"
        ? "id, group_id, thread_root_id, removed_at"
        : "id, thread_id, thread_root_id, removed_at";
    const { data: parent, error } = await this.supabase
      .from(table)
      .select(select)
      .eq("id", replyToMessageId)
      .maybeSingle();

    if (error || !parent) {
      throw new Error("Reply target message not found");
    }
    if ((parent as any).removed_at) {
      throw new Error("Cannot reply to a removed message");
    }
    if (table === "messages" && (parent as any).group_id !== scope.groupId) {
      throw new Error("Reply target is not in this group");
    }
    if (
      table === "dm_messages" &&
      (parent as any).thread_id !== scope.threadId
    ) {
      throw new Error("Reply target is not in this conversation");
    }
    const rootId = resolveThreadRootId(
      parent as { id: string; thread_root_id?: string | null },
    );
    if (!rootId) {
      throw new Error("Reply target message not found");
    }
    return rootId;
  }

  /** Lightweight realtime broadcast so open senders can refresh blue ticks. */
  private async broadcastChatRead(
    chatId: string,
    payload: { userId: string; lastReadAt: string },
  ): Promise<void> {
    try {
      const channel = this.supabase.channel(`chat-read:${chatId}`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          void this.supabase.removeChannel(channel);
          reject(new Error("broadcast timeout"));
        }, 2500);
        channel.subscribe(async (status) => {
          if (status !== "SUBSCRIBED") return;
          try {
            await channel.send({
              type: "broadcast",
              event: "read",
              payload,
            });
            resolve();
          } catch (err) {
            reject(err);
          } finally {
            clearTimeout(timer);
            void this.supabase.removeChannel(channel);
          }
        });
      });
    } catch (err) {
      logger.warn("broadcastChatRead failed", { chatId, err });
    }
  }

  async getGroupThread(
    groupId: string,
    rootId: string,
    viewerUserId?: string,
  ): Promise<Message[]> {
    // The thread carries the board post's own row, and the post screen renders
    // it as the header — so it needs the board columns too, or a post opened
    // from a pin older than the loaded page comes back untitled.
    const baseThreadSelect = `
      id,
      group_id,
      sender_id,
      type,
      text,
      question_data,
      flagged_as_similar_user_ids,
      timestamp,
      edited_at,
      removed_at,
      upvotes,
      downvotes,
      is_archived,
      image_url,
      client_message_id,
      reply_to_message_id,
      mentioned_user_ids,
      thread_root_id,
      profiles!sender_id (
        id,
        name,
        username,
        avatar_url
      )
    `;
    const selectClause = await reactionColumns(
      this.supabase,
      await messageColumns(this.supabase, baseThreadSelect),
    );

    const runThread = (columns: string) =>
      Promise.all([
        this.supabase
          .from("messages")
          .select(columns)
          .eq("id", rootId)
          .eq("group_id", groupId)
          .maybeSingle(),
        this.supabase
          .from("messages")
          .select(columns)
          .eq("group_id", groupId)
          .eq("thread_root_id", rootId)
          .order("timestamp", { ascending: true }),
      ]);

    let [{ data: root, error: rootError }, { data: replies, error: repliesError }] =
      await runThread(selectClause);
    if (
      (rootError && isMissingColumnError(rootError)) ||
      (repliesError && isMissingColumnError(repliesError))
    ) {
      // Same two-step ladder as getGroupMessages: drop `reactions` first
      // (20260830120000), then the board columns (20260903120000).
      markMessageReactionsColumnMissing();
      [{ data: root, error: rootError }, { data: replies, error: repliesError }] =
        await runThread(await messageColumns(this.supabase, baseThreadSelect));
    }
    if (
      (rootError && isMissingColumnError(rootError)) ||
      (repliesError && isMissingColumnError(repliesError))
    ) {
      // Pre-migration: no titles and no pins, but the thread still loads.
      markMessageBoardColumnsMissing();
      [{ data: root, error: rootError }, { data: replies, error: repliesError }] =
        await runThread(baseThreadSelect);
    }

    if (rootError) throw rootError;
    if (repliesError) throw repliesError;
    if (!root) return [];

    const combined = [root, ...(replies || [])];
    const withReplies = await this.attachReplyPreviewsBatch(
      combined,
      "messages",
    );
    const withCounts = await this.attachThreadReplyCounts(
      withReplies,
      "messages",
      "group_id",
      groupId,
    );

    const mapped = withCounts.map((msg: any) => ({
      id: msg.id,
      groupId: msg.group_id,
      sender: mapProfileSender(
        resolveNestedProfile(msg.profiles),
        msg.sender_id,
      ),
      senderId: msg.sender_id,
      timestamp: msg.timestamp
        ? new Date(msg.timestamp).toISOString()
        : new Date().toISOString(),
      flaggedAsSimilarUserIds: msg.flagged_as_similar_user_ids || [],
      upvotes: msg.upvotes || 0,
      downvotes: msg.downvotes || 0,
      isArchived: msg.is_archived || false,
      ...this.normalizeMessageRecord(msg),
    })) as Message[];

    if (viewerUserId) {
      return this.enrichGroupMessageReceipts(mapped, groupId, viewerUserId);
    }
    return mapped;
  }

  async getDmThread(
    threadId: string,
    rootId: string,
    viewerUserId: string,
  ): Promise<Message[]> {
    const { data: thread, error: threadError } = await this.supabase
      .from("dm_threads")
      .select("participant_ids, history_cleared_at")
      .eq("id", threadId)
      .maybeSingle();
    if (threadError) throw threadError;
    const participantIds = Array.isArray(thread?.participant_ids)
      ? thread!.participant_ids
      : [];
    if (!participantIds.includes(viewerUserId)) {
      throw new Error("Access denied");
    }
    const peerUserId = participantIds.find((id: string) => id !== viewerUserId);
    if (!peerUserId) {
      throw new Error("Invalid DM thread");
    }
    const historyClearedAt = readDmHistoryClearedAt(
      thread?.history_cleared_at,
      viewerUserId,
    );

    const selectClause = `
      id,
      thread_id,
      sender_id,
      text,
      timestamp,
      edited_at,
      removed_at,
      reply_to_message_id,
      thread_root_id,
      profiles:sender_id (
        id,
        name,
        avatar_url
      )
    `;

    const [
      { data: root, error: rootError },
      { data: replies, error: repliesError },
    ] = await Promise.all([
      this.supabase
        .from("dm_messages")
        .select(selectClause)
        .eq("id", rootId)
        .eq("thread_id", threadId)
        .maybeSingle(),
      this.supabase
        .from("dm_messages")
        .select(selectClause)
        .eq("thread_id", threadId)
        .eq("thread_root_id", rootId)
        .order("timestamp", { ascending: true }),
    ]);

    if (rootError) throw rootError;
    if (repliesError) throw repliesError;
    if (!root) return [];

    const combined = filterMessagesAfterDmHistoryCutoff(
      [root, ...(replies || [])],
      historyClearedAt,
    );
    if (!combined.length) return [];
    const withReplies = await this.attachReplyPreviewsBatch(
      combined,
      "dm_messages",
    );
    const withCounts = await this.attachThreadReplyCounts(
      withReplies,
      "dm_messages",
      "thread_id",
      threadId,
    );

    const mapped = withCounts.map((msg: any) => ({
      id: msg.id,
      threadId: msg.thread_id,
      sender: mapProfileSender(
        resolveNestedProfile(msg.profiles),
        msg.sender_id,
      ),
      senderId: msg.sender_id,
      timestamp: new Date(msg.timestamp),
      type: "TEXT" as const,
      ...(!msg.removed_at ? { text: msg.text } : {}),
      editedAt: msg.edited_at || undefined,
      removedAt: msg.removed_at || undefined,
      isRemoved: !!msg.removed_at,
      upvotes: 0,
      downvotes: 0,
      flaggedAsSimilarUserIds: [],
      replyToMessageId: msg.reply_to_message_id || undefined,
      replyTo: msg.replyTo || undefined,
      threadRootId: msg.thread_root_id || undefined,
      replyCount: typeof msg.replyCount === "number" ? msg.replyCount : 0,
    })) as Message[];

    return this.enrichDmMessageReceipts(
      mapped,
      threadId,
      viewerUserId,
      peerUserId,
    );
  }

  private async notifyMentionedUsers(params: {
    groupId: string;
    senderId: string;
    messageId: string;
    mentionedUserIds: string[];
    preview: string;
    mentionedEveryone?: boolean;
    /** Board mentions link into the community, never into Chat (spec §3.9). */
    link?: string;
  }): Promise<void> {
    const {
      groupId,
      senderId,
      messageId,
      mentionedUserIds,
      preview,
      mentionedEveryone,
    } = params;
    if (!mentionedUserIds.length) return;
    const [groupMeta, sender] = await Promise.all([
      this.getGroupById(groupId),
      this.getUserById(senderId),
    ]);
    const groupName = (groupMeta as any)?.name || "a group";
    const actor =
      sender?.name || (sender?.username ? `@${sender.username}` : "Someone");
    const snippet = preview.slice(0, 80);
    const message = mentionedEveryone
      ? `${actor} mentioned everyone in ${groupName}: ${snippet}`
      : `${actor} mentioned you in ${groupName}: ${snippet}`;
    await Promise.all(
      mentionedUserIds.map((recipientId) =>
        this.createNotification(recipientId, {
          message,
          link: params.link || `/chat/${groupId}?messageId=${messageId}`,
          type: "mention",
          data: {
            groupId,
            messageId,
            senderId,
            preview: snippet,
            mentionedEveryone: !!mentionedEveryone,
          },
        }).catch((err) => {
          logger.warn("Failed to notify mentioned user", {
            err,
            recipientId,
            messageId,
          });
        }),
      ),
    );
  }

  private async notifyReplyRecipient(params: {
    groupId: string;
    senderId: string;
    messageId: string;
    replyToMessageId: string;
    preview: string;
    skipUserIds?: string[];
  }): Promise<void> {
    const {
      groupId,
      senderId,
      messageId,
      replyToMessageId,
      preview,
      skipUserIds,
    } = params;
    const { data: parent, error } = await this.supabase
      .from("messages")
      .select("id, sender_id")
      .eq("id", replyToMessageId)
      .eq("group_id", groupId)
      .maybeSingle();
    if (error || !parent?.sender_id || parent.sender_id === senderId) return;
    if (skipUserIds?.includes(parent.sender_id)) return;

    const [groupMeta, sender] = await Promise.all([
      this.getGroupById(groupId),
      this.getUserById(senderId),
    ]);
    const groupName = (groupMeta as any)?.name || "a group";
    const actor =
      sender?.name || (sender?.username ? `@${sender.username}` : "Someone");
    await this.createNotification(parent.sender_id, {
      message: `${actor} replied to you in ${groupName}: ${preview.slice(0, 80)}`,
      link: `/chat/${groupId}?messageId=${messageId}`,
      type: "reply",
      data: {
        groupId,
        messageId,
        senderId,
        replyToMessageId,
        preview: preview.slice(0, 80),
      },
    }).catch((err) => {
      logger.warn("Failed to notify reply recipient", {
        err,
        messageId,
        replyToMessageId,
      });
    });
  }

  /**
   * Is this group a community BOARD, and if so which community?
   *
   * The surface is decided by the group row, never by which screen mounted it
   * (spec §0), with the one derived exception founder decision 1 records: the
   * community's lounge carries a community_id but STAYS a live chat, so it is
   * excluded here and keeps the full chat behaviour including per-message
   * notifications.
   *
   * Cached briefly under a key `invalidateGroupCache` does NOT match: every
   * send resolves this, and every send also invalidates the group cache.
   */
  /**
   * One member's role INSIDE a community, resolved the same way every other
   * surface resolves it (`communities.created_by` wins, then the membership
   * row). Kept here so the send path can ask "may this person announce?"
   * without importing the communities service and creating a cycle.
   */
  private async resolveCommunityRoleFor(
    userId: string,
    communityId: string | null,
    createdBy: string | null,
  ): Promise<CommunityRole | null> {
    if (!communityId) return null;
    try {
      const { data } = await (this.supabase as any)
        .from("community_members")
        .select("role")
        .eq("community_id", communityId)
        .eq("user_id", userId)
        .is("opted_out_at", null)
        .maybeSingle();
      if (!data) return null;
      return resolveCommunityRole(
        (data as { role?: string | null }).role ?? null,
        userId,
        createdBy,
      );
    } catch (err) {
      // Fail CLOSED: an unresolvable role is not a moderator, so the worst
      // case is an announcement refused, never one forged.
      logger.warn("resolveCommunityRoleFor failed, treating as member", {
        err,
        communityId,
      });
      return null;
    }
  }

  private async resolveBoardContext(groupId: string): Promise<{
    isBoard: boolean;
    communityId: string | null;
    communitySlug: string | null;
    communityCreatedBy: string | null;
    loungeGroupId: string | null;
    adminIds: string[];
  }> {
    const empty = {
      isBoard: false,
      communityId: null,
      communitySlug: null,
      communityCreatedBy: null,
      loungeGroupId: null,
      adminIds: [] as string[],
    };
    if (!groupId) return empty;
    const cacheKey = `board:context:${groupId}`;
    const hit = await cacheService.get<typeof empty>(cacheKey);
    if (hit) return hit;

    const group = await this.getGroupById(groupId);
    if (!group?.communityId) return empty;

    const readCommunity = (columns: string) =>
      (this.supabase as any)
        .from("communities")
        .select(columns)
        .eq("id", group.communityId)
        .maybeSingle();

    type CommunityPointer = {
      slug?: string | null;
      created_by?: string | null;
      lounge_group_id?: string | null;
    };
    let community: CommunityPointer | null = null;
    try {
      // lounge_group_id only exists once 20260829170000 is applied.
      let { data, error } = await readCommunity("id, slug, created_by, lounge_group_id");
      if (error && isMissingColumnError(error)) {
        ({ data, error } = await readCommunity("id, slug, created_by"));
      }
      if (error) throw error;
      community = (data || {}) as CommunityPointer;
    } catch (err) {
      /**
       * The surface itself comes from the GROUP row, which we already have, so
       * a failed community read degrades the deep link (to /discover, never to
       * /chat) rather than failing the send. Deliberately NOT cached: an owner
       * would otherwise be refused a pin for the whole TTL.
       */
      logger.warn("resolveBoardContext: community read failed, degrading", {
        err,
        groupId,
      });
      return {
        isBoard: isCommunityBoard(group),
        communityId: group.communityId,
        communitySlug: null,
        communityCreatedBy: null,
        loungeGroupId: null,
        adminIds: group.adminIds || [],
      };
    }

    const loungeGroupId = community?.lounge_group_id ?? null;
    const context = {
      // The lounge is a chat, not a board (founder decision 1).
      isBoard: loungeGroupId === groupId ? false : isCommunityBoard(group),
      communityId: group.communityId,
      communitySlug: community?.slug ?? null,
      communityCreatedBy: community?.created_by ?? null,
      loungeGroupId,
      adminIds: group.adminIds || [],
    };
    await cacheService.set(cacheKey, context, 300);
    return context;
  }

  /**
   * A board post's comment notification (spec §3.9). Replaces the per-message
   * fan-out, which a board never issues: the root author plus the people
   * already on that thread, minus the sender and anyone already notified by a
   * mention, capped at BOARD_COMMENT_NOTIFY_MAX.
   */
  private async notifyBoardCommentRecipients(params: {
    groupId: string;
    senderId: string;
    messageId: string;
    threadRootId: string;
    preview: string;
    skipUserIds?: string[];
    communitySlug: string | null;
  }): Promise<void> {
    const {
      groupId,
      senderId,
      messageId,
      threadRootId,
      preview,
      skipUserIds,
      communitySlug,
    } = params;

    const [{ data: root }, { data: replies }] = await Promise.all([
      this.supabase
        .from("messages")
        .select("id, sender_id")
        .eq("id", threadRootId)
        .maybeSingle(),
      this.supabase
        .from("messages")
        .select("sender_id")
        .eq("group_id", groupId)
        .eq("thread_root_id", threadRootId)
        .limit(200),
    ]);

    const rootAuthorId = (root as { sender_id?: string } | null)?.sender_id ?? null;
    const skip = new Set([senderId, ...(skipUserIds || [])]);

    const repliers: string[] = [];
    for (const row of (replies || []) as Array<{ sender_id?: string }>) {
      const id = row?.sender_id;
      if (!id || skip.has(id) || id === rootAuthorId || repliers.includes(id)) continue;
      repliers.push(id);
    }

    const recipients: Array<{ id: string; isRootAuthor: boolean }> = [];
    if (rootAuthorId && !skip.has(rootAuthorId)) {
      recipients.push({ id: rootAuthorId, isRootAuthor: true });
    }
    for (const id of repliers) recipients.push({ id, isRootAuthor: false });
    if (!recipients.length) return;

    const [groupMeta, sender] = await Promise.all([
      this.getGroupById(groupId),
      this.getUserById(senderId),
    ]);
    const boardName = (groupMeta as any)?.name || "a board";
    const actor =
      sender?.name || (sender?.username ? `@${sender.username}` : "Someone");
    /**
     * Point at the POST, not at the comment row: a comment has no surface of
     * its own, and `?messageId=` was read by no client. `boardPostDeepLinkPath`
     * falls back to the board link with no slug and to `/discover` with none —
     * never to `/chat/:groupId`, which is the one surface a board must not
     * open in. Links already sent keep working: `?messageId=` is simply a
     * query string on a path that still resolves.
     */
    const link = boardPostDeepLinkPath(communitySlug, groupId, threadRootId);
    const snippet = preview.slice(0, 80);

    await Promise.all(
      recipients.slice(0, BOARD_COMMENT_NOTIFY_MAX).map((recipient) =>
        this.createNotification(recipient.id, {
          message: recipient.isRootAuthor
            ? `${actor} replied to your post in ${boardName}: ${snippet}`
            : `${actor} commented on a post you follow in ${boardName}: ${snippet}`,
          link,
          type: "reply",
          data: {
            groupId,
            messageId,
            senderId,
            threadRootId,
            preview: snippet,
          },
        }).catch((err) => {
          logger.warn("Failed to notify board comment recipient", {
            err,
            recipientId: recipient.id,
            messageId,
          });
        }),
      ),
    );
  }

  async sendMessage(
    groupId: string,
    userId: string,
    content: string,
    clientMessageId?: string,
    options?: {
      replyToMessageId?: string;
      mentionedUserIds?: string[];
      /** Board post title. Dropped (not rejected) pre-migration. */
      subject?: string | null;
      /**
       * A board post's ONE photo, written to `messages.image_url` so a title,
       * a body and a photo are ONE row (§5.2). The column has existed since
       * 20251117020518 and no message path writes it today, so this is the
       * FIRST encoding, not a third one — legacy markdown posts keep
       * rendering through `parseChatImageUrl` / `splitBoardBody`.
       *
       * Re-validated here against the caller and the board, because the path
       * IS the ACL. The route rejects a bad url with 400; this gate is what
       * stops a board's photo column being written from a chat send.
       */
      imageUrl?: string | null;
      /**
       * What a board post IS: discussion | question | announcement | event
       * (20260908120000). Ignored off a board, dropped (not rejected)
       * pre-migration, and REFUSED with a 403 when the sender may not post
       * that kind — `announcement` is moderators-only.
       */
      postKind?: string | null;
    },
  ): Promise<any> {
    let messageData: any;
    let isQuestion = false;
    /**
     * `client_message_id` is client-supplied, and `repost:<id>` is the third
     * clause of the repost discriminator (`isBoardRepostRow`). Refuse the
     * prefix on the ORDINARY send path so it cannot be forged onto a comment
     * that later loses `thread_root_id` to ON DELETE SET NULL, and so a
     * crafted send cannot squat the unique-index slot a real repost needs.
     * Reposts are written by `createBoardRepost`, never here.
     */
    if (
      typeof clientMessageId === "string" &&
      clientMessageId.startsWith(BOARD_REPOST_CLIENT_ID_PREFIX)
    ) {
      logger.warn("sendMessage: refused a reserved repost client_message_id", {
        groupId,
        userId,
      });
      clientMessageId = undefined;
    }
    const replyToMessageId =
      typeof options?.replyToMessageId === "string" && options.replyToMessageId
        ? options.replyToMessageId
        : undefined;

    const board = await this.resolveBoardContext(groupId);
    // A muted member reads everything and writes nothing — on the board, in
    // the lounge and in every channel. Checked before any parsing so a mute
    // cannot be sidestepped by the shape of the payload.
    await assertNotMutedInCommunity(this.supabase, userId, board.communityId);

    /**
     * The whole safety property of a board (spec §3.4): a post whose body
     * happens to be JSON must NOT become a QUESTION. Skipping the parse keeps
     * type='TEXT', leaves question_data null, never fires the
     * groups.question_count trigger, and stops routes/messages.ts writing a
     * group_question_posted learning event — that branch tests the type.
     */
    if (board.isBoard) {
      logger.info("sendMessage: board post, question parsing skipped", {
        groupId,
      });
    } else {
      // First, try to parse as JSON to check if it's a question
      try {
        messageData = JSON.parse(content);
        isQuestion = messageData.type === "QUESTION" || messageData.questionStem;
        logger.info("sendMessage: Parsed content as JSON", {
          isQuestion,
          type: messageData.type,
          hasQuestionStem: !!messageData.questionStem,
        });
      } catch (parseError) {
        // Not JSON, treat as text message
        logger.info("sendMessage: Content is plain text");
        isQuestion = false;
      }
    }

    const mentionSource = isQuestion
      ? String(messageData?.questionStem || content)
      : content;
    const mentionedUserIds = await this.resolveGroupMentionUserIds(
      groupId,
      userId,
      mentionSource,
      options?.mentionedUserIds,
    );

    let threadRootId: string | undefined;
    if (replyToMessageId) {
      threadRootId = await this.resolveThreadRootForReply(
        "messages",
        replyToMessageId,
        {
          groupId,
        },
      );
    }

    if (isQuestion) {
      // Question message
      logger.info("sendMessage: Inserting QUESTION message", {
        groupId,
        userId,
        questionStem: messageData.questionStem?.substring(0, 50),
        questionType: messageData.questionType,
      });

      const insertBase: Record<string, unknown> = {
        group_id: groupId,
        sender_id: userId,
        mentioned_user_ids: mentionedUserIds,
      };
      if (clientMessageId) {
        insertBase.client_message_id = clientMessageId;
      }
      if (replyToMessageId) {
        insertBase.reply_to_message_id = replyToMessageId;
      }
      if (threadRootId) {
        insertBase.thread_root_id = threadRootId;
      }

      const { data, error } = await this.supabase
        .from("messages")
        .insert({
          ...insertBase,
          type: "QUESTION",
          question_data: messageData,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505" && clientMessageId) {
          const existing = await this.findGroupMessageByClientId(
            groupId,
            userId,
            clientMessageId,
          );
          if (existing) return existing;
        }
        logger.error("sendMessage: Failed to insert QUESTION message", {
          error,
        });
        throw error;
      }

      logger.info("sendMessage: QUESTION message inserted successfully", {
        messageId: data.id,
        timestamp: data.timestamp,
      });

      // Invalidate cache
      await cacheService.invalidateGroupCache(groupId);

      await this.incrementUserStatsAndAwardBadges(userId, {
        questionsCreated: 1,
      }).catch((err) => {
        logger.warn("Failed to increment questionsCreated gamification", {
          userId,
          err,
        });
      });

      const questionPreview = messageData.questionStem
        ? `New question: ${String(messageData.questionStem).substring(0, 50)}`
        : "posted a new question";
      void this.supabase
        .from("groups")
        .update({
          last_message: questionPreview,
          last_message_time: data.timestamp || new Date().toISOString(),
        })
        .eq("id", groupId);
      const mentionedEveryone =
        extractMentionUsernames(mentionSource).includes("all");
      void this.notifyGroupMessageRecipients({
        groupId,
        senderId: userId,
        content: questionPreview,
        messageId: data.id,
        excludeUserIds: mentionedUserIds,
      }).catch((err) => {
        logger.error("Failed to notify group message recipients", {
          err,
          groupId,
          messageId: data.id,
        });
      });
      void this.notifyMentionedUsers({
        groupId,
        senderId: userId,
        messageId: data.id,
        mentionedUserIds,
        preview: questionPreview,
        mentionedEveryone,
      });
      if (replyToMessageId) {
        void this.notifyReplyRecipient({
          groupId,
          senderId: userId,
          messageId: data.id,
          replyToMessageId,
          preview: questionPreview,
          skipUserIds: mentionedUserIds,
        });
      }

      const withReply = await this.attachReplyPreview(data);
      return {
        ...withReply,
        threadRootId: withReply.thread_root_id || undefined,
        replyCount: 0,
        receiptStatus: "sent" as const,
        seenByCount: 0,
        seenByTotal: 0,
      };
    } else {
      // Text message
      logger.info("sendMessage: Inserting TEXT message", { groupId, userId });

      const insertBase: Record<string, unknown> = {
        group_id: groupId,
        sender_id: userId,
        mentioned_user_ids: mentionedUserIds,
      };
      if (clientMessageId) {
        insertBase.client_message_id = clientMessageId;
      }
      if (replyToMessageId) {
        insertBase.reply_to_message_id = replyToMessageId;
      }
      if (threadRootId) {
        insertBase.thread_root_id = threadRootId;
      }

      // A board post's optional title. Pre-migration the column does not
      // exist and the title is DROPPED, not rejected (spec §3.1).
      const subject =
        typeof options?.subject === "string" && options.subject.trim()
          ? options.subject.trim().slice(0, BOARD_POST_SUBJECT_MAX)
          : null;
      const withSubject = !!subject && (await hasMessageBoardColumns(this.supabase));

      /**
       * The post's kind. Only meaningful on a board — a group chat message
       * has no kind, and writing one there would put a badge on a chat
       * bubble. An `announcement` is moderators-only and pins itself, so the
       * role is resolved here (the one query it costs is paid only by the
       * rare announcement), and the cap is enforced after the insert.
       */
      const requestedKind = board.isBoard
        ? normalizeBoardPostKind(options?.postKind)
        : BOARD_POST_KIND_DEFAULT;
      let postKind: BoardPostKind = requestedKind;
      if (requestedKind === "announcement") {
        const role = await this.resolveCommunityRoleFor(
          userId,
          board.communityId,
          board.communityCreatedBy,
        );
        if (!canPostBoardKind(role, "announcement")) {
          throw Object.assign(
            new Error(COMMUNITY_MODERATION_COPY.restrictedKind),
            { statusCode: 403 },
          );
        }
      }
      const withPostKind =
        board.isBoard &&
        postKind !== BOARD_POST_KIND_DEFAULT &&
        (await hasMessagePostKind(this.supabase));
      if (!withPostKind) postKind = BOARD_POST_KIND_DEFAULT;
      // An announcement pins itself. Pre-migration `withPostKind` is false, so
      // it degrades to an ordinary post rather than an unlabelled pin that
      // nothing can find again.
      const announcementPin =
        withPostKind && requestedKind === "announcement" ? new Date().toISOString() : null;
      /**
       * `image_url` is written on BOARDS ONLY this phase: group chat and DMs
       * keep sending a photo as its own markdown message, and widening that
       * here would change how every existing chat bubble renders. The path
       * check is repeated (the route already ran it) because this is the last
       * gate before the column is written.
       */
      const attachedImageUrl =
        board.isBoard &&
        typeof options?.imageUrl === "string" &&
        isBoardImageUrlAllowed({
          url: options.imageUrl,
          userId,
          groupId,
          parse: parseStorageObjectUrl,
        })
          ? options.imageUrl
          : null;
      const insertText = (includeSubject: boolean, includeKind: boolean) =>
        (this.supabase as any)
          .from("messages")
          .insert({
            ...insertBase,
            type: "TEXT",
            text: content,
            ...(includeSubject ? { subject } : {}),
            ...(includeKind
              ? {
                  post_kind: postKind,
                  ...(announcementPin
                    ? { pinned_at: announcementPin, pinned_by: userId }
                    : {}),
                }
              : {}),
            ...(attachedImageUrl ? { image_url: attachedImageUrl } : {}),
          })
          .select()
          .single();

      let { data, error } = await insertText(withSubject, withPostKind);
      if (error && withPostKind && isMissingColumnError(error)) {
        // 20260908120000 is not applied: keep the post, drop the kind.
        markMessagePostKindMissing();
        ({ data, error } = await insertText(withSubject, false));
      }
      if (error && withSubject && isMissingColumnError(error)) {
        markMessageBoardColumnsMissing();
        ({ data, error } = await insertText(false, false));
      }

      if (error) {
        if (error.code === "23505" && clientMessageId) {
          const existing = await this.findGroupMessageByClientId(
            groupId,
            userId,
            clientMessageId,
          );
          if (existing) return existing;
        }
        logger.error("sendMessage: Failed to insert TEXT message", { error });
        throw error;
      }

      logger.info("sendMessage: TEXT message inserted successfully", {
        messageId: data.id,
      });

      // Keep group list preview in sync for recipients who have not opened the chat yet.
      void this.supabase
        .from("groups")
        .update({
          last_message: content,
          last_message_time: data.timestamp || new Date().toISOString(),
        })
        .eq("id", groupId)
        .then(({ error: groupUpdateError }) => {
          if (groupUpdateError) {
            logger.warn("Failed to update group last_message after send", {
              groupId,
              error: groupUpdateError,
            });
          }
        });

      const mentionedEveryone =
        extractMentionUsernames(content).includes("all");
      /**
       * Notification policy (§0a decision 3, §3.9). A BOARD post issues NO
       * per-post fan-out: `notifyGroupMessageRecipients` inserts one
       * notification plus one push per non-sender member, which on a
       * community-scale board is a campus-wide push per post. The unread
       * badge is the Phase 1 signal. Mentions still notify immediately, and a
       * comment notifies the thread instead — both into the community, never
       * into Chat.
       */
      // A mention inside a COMMENT must open the post that holds it, so the
      // link carries the thread root when there is one (§8.2).
      const boardLink = board.isBoard
        ? boardPostDeepLinkPath(board.communitySlug, groupId, threadRootId ?? data.id)
        : undefined;

      if (!board.isBoard) {
        void this.notifyGroupMessageRecipients({
          groupId,
          senderId: userId,
          content,
          messageId: data.id,
          excludeUserIds: mentionedUserIds,
        }).catch((err) => {
          logger.error("Failed to notify group message recipients", {
            err,
            groupId,
            messageId: data.id,
          });
        });
      }
      void this.notifyMentionedUsers({
        groupId,
        senderId: userId,
        messageId: data.id,
        mentionedUserIds,
        preview: content,
        mentionedEveryone,
        link: boardLink,
      });
      if (board.isBoard) {
        if (threadRootId) {
          void this.notifyBoardCommentRecipients({
            groupId,
            senderId: userId,
            messageId: data.id,
            threadRootId,
            preview: content,
            skipUserIds: mentionedUserIds,
            communitySlug: board.communitySlug,
          }).catch((err) => {
            logger.warn("Failed to notify board comment recipients", {
              err,
              groupId,
              messageId: data.id,
            });
          });
        }
      } else if (replyToMessageId) {
        void this.notifyReplyRecipient({
          groupId,
          senderId: userId,
          messageId: data.id,
          replyToMessageId,
          preview: content,
          skipUserIds: mentionedUserIds,
        });
      }

      // Invalidate cache
      await cacheService.invalidateGroupCache(groupId);

      const withReply = await this.attachReplyPreview(data);
      return {
        ...withReply,
        threadRootId: withReply.thread_root_id || undefined,
        replyCount: 0,
        receiptStatus: "sent" as const,
        seenByCount: 0,
        seenByTotal: 0,
      };
    }
  }

  /**
   * The board's one pinned post, whatever page it is on — that is the whole
   * reason it has its own endpoint. Pre-migration the columns do not exist and
   * this answers null rather than 500ing the board (spec §3.5).
   *
   * Access is enforced by the caller (`getGroupById(groupId, userId)`), the
   * same way GET /messages/group/:groupId does it.
   */
  async getPinnedMessage(groupId: string): Promise<Message | null> {
    if (!groupId) return null;
    if (!(await hasMessageBoardColumns(this.supabase))) return null;

    const baseSelect = `
      id,
      group_id,
      sender_id,
      type,
      text,
      subject,
      pinned_at,
      pinned_by,
      question_data,
      timestamp,
      edited_at,
      removed_at,
      upvotes,
      downvotes,
      image_url,
      client_message_id,
      reply_to_message_id,
      mentioned_user_ids,
      thread_root_id,
      profiles!sender_id (
        id,
        name,
        username,
        avatar_url
      )
    `;
    // The pinned strip renders the same card as the board list, so it needs
    // the same reaction counts (20260830120000, which may not be applied).
    const select = await reactionColumns(this.supabase, baseSelect);
    const runPinned = (columns: string) =>
      (this.supabase as any)
        .from("messages")
        .select(columns)
        .eq("group_id", groupId)
        .not("pinned_at", "is", null)
        // A pin outlives the post it points at: `remove_chat_message` predates
        // `pinned_at` and never clears it, and a comment can carry a pin from a
        // hand-crafted PUT. Neither belongs on the board's PINNED strip.
        .is("removed_at", null)
        .is("thread_root_id", null)
        .order("pinned_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    let { data, error } = await runPinned(select);
    if (error && isMissingColumnError(error) && select !== baseSelect) {
      // `reactions` (20260830120000) is the only optional column this query
      // adds — the board columns were already probed above — so drop it and
      // keep the pin rather than losing titles and pins process-wide.
      markMessageReactionsColumnMissing();
      ({ data, error } = await runPinned(baseSelect));
    }

    if (error) {
      if (isMissingColumnError(error)) {
        markMessageBoardColumnsMissing();
        return null;
      }
      throw error;
    }
    if (!data) return null;

    const msg = data as any;
    return {
      id: msg.id,
      groupId: msg.group_id,
      sender: mapProfileSender(resolveNestedProfile(msg.profiles), msg.sender_id),
      senderId: msg.sender_id,
      timestamp: msg.timestamp
        ? new Date(msg.timestamp).toISOString()
        : new Date().toISOString(),
      upvotes: msg.upvotes || 0,
      downvotes: msg.downvotes || 0,
      ...this.normalizeMessageRecord(msg),
    } as Message;
  }

  /**
   * Pin or unpin a board post (spec §3.6). One pin per board, cleared
   * server-side and enforced by the unique partial index — a 23505 means
   * another pin landed between the clear and the set, so we clear and retry
   * once rather than handing the client a conflict it cannot act on.
   *
   * Returns a status the route maps to a code, so the reason ("not a board",
   * "not a moderator", "migration not applied") is never collapsed into 500.
   */
  async setMessagePin(
    messageId: string,
    userId: string,
    pinned: boolean,
  ): Promise<MessagePinResult> {
    if (!(await hasMessageBoardColumns(this.supabase))) {
      return { status: "unavailable" };
    }

    const { data: row, error: readError } = await this.supabase
      .from("messages")
      .select("id, group_id, removed_at, thread_root_id")
      .eq("id", messageId)
      .maybeSingle();
    if (readError) {
      if (isMissingColumnError(readError)) {
        markMessageBoardColumnsMissing();
        return { status: "unavailable" };
      }
      throw readError;
    }
    const target = row as {
      group_id?: string;
      removed_at?: string | null;
      thread_root_id?: string | null;
    } | null;
    const groupId = target?.group_id;
    if (!groupId) return { status: "not_found" };

    // Only a live root post can BE pinned. Unpinning stays allowed on both, so
    // a pin left behind by a deletion is still clearable.
    if (pinned && (target?.removed_at || target?.thread_root_id)) {
      return { status: "not_pinnable" };
    }

    // Same access rule as reading the board: membership, or 404.
    const group = await this.getGroupById(groupId, userId);
    if (!group) return { status: "not_found" };

    const board = await this.resolveBoardContext(groupId);
    if (!board.isBoard) return { status: "not_board" };

    const role = board.communityId
      ? resolveCommunityRole(
          await this.communityMemberRole(board.communityId, userId),
          userId,
          board.communityCreatedBy,
        )
      : null;
    if (!canPinOnBoard({ role, adminIds: group.adminIds || [], userId })) {
      return { status: "forbidden" };
    }

    const clearPins = () =>
      (this.supabase as any)
        .from("messages")
        .update({ pinned_at: null, pinned_by: null })
        .eq("group_id", groupId)
        .not("pinned_at", "is", null);

    const applyPin = () =>
      (this.supabase as any)
        .from("messages")
        .update(
          pinned
            ? { pinned_at: new Date().toISOString(), pinned_by: userId }
            : { pinned_at: null, pinned_by: null },
        )
        .eq("id", messageId)
        .select()
        .single();

    if (pinned) await clearPins();
    let { data, error } = await applyPin();
    if (error && (error as { code?: string }).code === "23505" && pinned) {
      await clearPins();
      ({ data, error } = await applyPin());
    }
    if (error) {
      if (isMissingColumnError(error)) {
        markMessageBoardColumnsMissing();
        return { status: "unavailable" };
      }
      throw error;
    }

    await cacheService.deletePattern(`messages:group:${groupId}:*`);
    await cacheService.delete(`message:raw:${messageId}`);

    return { status: "ok", message: data };
  }

  // =========================================================================
  // Board actions — Favorite, Repost, Bookmark, Share (Phase 1)
  //
  // FAVORITE has no code in this section on purpose. It is a REACTION with the
  // emoji pinned to BOARD_FAVORITE_EMOJI ('❤️', already inside
  // CHAT_REACTION_EMOJI): `POST`/`DELETE /messages/:id/reactions` accept it
  // unchanged, `sync_message_reaction_counts` keeps the count, the parent
  // UPDATE rides the realtime channel both clients already subscribe to, and
  // the viewer's own state comes from the existing
  // `GET /messages/group/:groupId/user-reactions`. Zero new tables, zero new
  // endpoints, and nothing here to drift.
  // =========================================================================

  /**
   * The `message_bookmarks` (20260904120000) equivalent of
   * `reactionsMissingTable`. The API is deployed BEFORE the founder
   * hand-applies the migration, so every bookmark call must have a natural
   * fallback rather than a 500.
   */
  private bookmarksMissingTable(error: any): boolean {
    return (
      error?.code === "42P01" ||
      error?.code === "PGRST205" ||
      error?.code === "42703"
    );
  }

  /**
   * Save or unsave a board post for ONE account. Idempotent in both
   * directions: `true` upserts on the primary key, `false` deletes.
   *
   * Authorisation is the same rule as reading the board — an active
   * `group_members` row — resolved through `getAuthorizedGroupMessage`, which
   * treats "no access" as "not found" so a bookmark call cannot be used to
   * probe for message ids.
   */
  async setMessageBookmark(
    messageId: string,
    userId: string,
    bookmarked: boolean,
  ): Promise<MessageBookmarkResult> {
    if (!messageId || !userId) return { status: "not_found" };

    const target = await this.getAuthorizedGroupMessage(messageId, userId);
    if (!target) {
      // A DM message is a real row the viewer may well be allowed to read, but
      // there is no surface that could ever render it as a saved POST, so say
      // so instead of pretending it does not exist.
      const dm = await this.getAuthorizedDmMessage(messageId, userId);
      return dm ? { status: "not_a_board_post" } : { status: "not_found" };
    }

    const run = bookmarked
      ? () =>
          (this.supabase as any)
            .from("message_bookmarks")
            .upsert(
              { user_id: userId, message_id: messageId },
              { onConflict: "user_id,message_id", ignoreDuplicates: true },
            )
      : () =>
          (this.supabase as any)
            .from("message_bookmarks")
            .delete()
            .eq("user_id", userId)
            .eq("message_id", messageId);

    const { error } = await run();
    if (error) {
      if (this.bookmarksMissingTable(error)) return { status: "unavailable" };
      throw error;
    }
    return { status: "ok", bookmarked };
  }

  /**
   * The viewer's saved ids on ONE board, so icons render filled on first
   * paint. Exactly the shape and lifecycle of the existing user-reactions
   * endpoint; `serverBacked: false` tells the client to hide the control and
   * keep today's device-local save.
   */
  async getBookmarkedMessageIdsForGroup(
    groupId: string,
    userId: string,
  ): Promise<{ messageIds: string[]; serverBacked: boolean }> {
    if (!groupId || !userId) return { messageIds: [], serverBacked: true };
    // One query, joined through the FK rather than listing every message id in
    // the group first: a board can hold thousands of posts and the viewer
    // typically has a handful of bookmarks.
    const { data, error } = await (this.supabase as any)
      .from("message_bookmarks")
      // Name the FK constraint (message_bookmarks.message_id -> messages.id,
      // auto-named message_bookmarks_message_id_fkey). Today message_bookmarks
      // has a single FK to messages so a bare `messages!inner` resolves, but
      // that is exactly the state community_members was in the day before a
      // second FK made its bare embed ambiguous (PGRST201) and broke the
      // roster. Naming it keeps this query correct if messages ever gains a
      // second relationship from message_bookmarks. The resource is still
      // called `messages`, so the `.eq("messages.group_id", ...)` below holds.
      .select("message_id, messages!message_bookmarks_message_id_fkey!inner(group_id)")
      .eq("user_id", userId)
      .eq("messages.group_id", groupId);
    if (error) {
      if (this.bookmarksMissingTable(error)) {
        return { messageIds: [], serverBacked: false };
      }
      throw error;
    }
    return {
      messageIds: (data || [])
        .map((row: any) => String(row?.message_id || ""))
        .filter(Boolean),
      serverBacked: true,
    };
  }

  /**
   * "Saved posts", newest-saved-first, across every board.
   *
   * The membership re-check is the single highest-severity line in this
   * feature: bookmarks OUTLIVE membership, so without it a student who left or
   * was removed from a board keeps reading its members-only posts out of their
   * own saved list. `removed_at` rows are excluded for the same reason a
   * takedown works everywhere else.
   *
   * The keyset cursor advances past every bookmark row EXAMINED, not just the
   * ones that survived those two filters — otherwise a page whose rows were
   * all filtered out would loop forever on the same cursor.
   */
  async listBookmarkedPosts(
    userId: string,
    options: { limit?: number; before?: string } = {},
  ): Promise<BoardBookmarkPage> {
    const empty: BoardBookmarkPage = {
      entries: [],
      nextCursor: null,
      serverBacked: true,
    };
    if (!userId) return empty;
    const limit = Math.min(
      BOARD_BOOKMARKS_PAGE_SIZE_MAX,
      Math.max(1, Math.floor(options.limit || BOARD_BOOKMARKS_PAGE_SIZE)),
    );

    let saved = (this.supabase as any)
      .from("message_bookmarks")
      .select("message_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (options.before) saved = saved.lt("created_at", options.before);

    const { data: savedRows, error: savedError } = await saved;
    if (savedError) {
      if (this.bookmarksMissingTable(savedError)) {
        logger.warn("listBookmarkedPosts: message_bookmarks missing, degrading");
        return { entries: [], nextCursor: null, serverBacked: false };
      }
      throw savedError;
    }

    const rows = (savedRows || []) as Array<{
      message_id: string;
      created_at: string;
    }>;
    if (rows.length === 0) return empty;

    // Advance past everything read, so filtered-out rows cannot stall paging.
    const lastExamined = rows[rows.length - 1]?.created_at ?? null;
    const nextCursor = rows.length === limit ? lastExamined : null;
    const savedAtById = new Map(rows.map((r) => [r.message_id, r.created_at]));
    const ids = rows.map((r) => r.message_id);

    const posts = await this.readBoardPostRows(ids);
    if (posts.length === 0) return { entries: [], nextCursor, serverBacked: true };

    const groupIds = [
      ...new Set(posts.map((p: any) => String(p.group_id || "")).filter(Boolean)),
    ];

    // MANDATORY: bookmarks outlive membership.
    const { data: memberships, error: memberError } = await this.supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", userId)
      .eq("pending", false)
      .in("group_id", groupIds);
    if (memberError) throw memberError;
    const allowedGroupIds = new Set(
      (memberships || []).map((m: any) => String(m.group_id)),
    );

    const visible = posts.filter(
      (p: any) => !p.removed_at && allowedGroupIds.has(String(p.group_id)),
    );
    if (visible.length === 0) return { entries: [], nextCursor, serverBacked: true };

    const boards = await this.readBoardContextForGroups([
      ...new Set(visible.map((p: any) => String(p.group_id))),
    ]);
    const visibleIds = visible.map((p: any) => String(p.id));
    const [repostCounts, myReposts, myFavorites] = await Promise.all([
      this.countRepostsFor(visibleIds),
      this.repostedByMeAmong(visibleIds, userId),
      this.favoritedAmong(visibleIds, userId),
    ]);

    const entries: BoardBookmarkEntry[] = visible.map((row: any) => {
      const groupId = String(row.group_id || "");
      const board = boards.get(groupId);
      return {
        post: this.toBoardPostShape(row, {
          bookmarked: true,
          favorited: myFavorites.has(String(row.id)),
          repostCount: repostCounts.get(String(row.id)) || 0,
          repostedByMe: myReposts.has(String(row.id)),
          repostOf: null,
        }),
        groupId,
        boardName: board?.name || "Board",
        communitySlug: board?.communitySlug ?? null,
        communityName: board?.communityName ?? null,
        savedAt: savedAtById.get(String(row.id)) || new Date().toISOString(),
      };
    });

    // Newest-saved-first survives the id round trip.
    entries.sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
    return { entries, nextCursor, serverBacked: true };
  }

  /**
   * One-time import of the device-local saves. Upserts, silently skipping ids
   * the viewer cannot read, so re-running it is harmless — which is what lets
   * a client keep the local key until it has seen a 2xx.
   */
  async importMessageBookmarks(
    userId: string,
    messageIds: string[],
  ): Promise<{ imported: number; serverBacked: boolean }> {
    if (!userId) return { imported: 0, serverBacked: true };
    const ids = [
      ...new Set(
        (Array.isArray(messageIds) ? messageIds : [])
          .filter((id): id is string => typeof id === "string" && !!id.trim())
          .map((id) => id.trim()),
      ),
    ].slice(0, BOARD_BOOKMARK_IMPORT_MAX);
    if (ids.length === 0) return { imported: 0, serverBacked: true };

    const { data: rows, error } = await this.supabase
      .from("messages")
      .select("id, group_id, thread_root_id, removed_at")
      .in("id", ids);
    if (error) throw error;

    const candidates = (rows || []).filter(
      (r: any) => !r.removed_at && !r.thread_root_id && r.group_id,
    );
    if (candidates.length === 0) return { imported: 0, serverBacked: true };

    const { data: memberships, error: memberError } = await this.supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", userId)
      .eq("pending", false)
      .in("group_id", [
        ...new Set(candidates.map((r: any) => String(r.group_id))),
      ]);
    if (memberError) throw memberError;
    const allowed = new Set(
      (memberships || []).map((m: any) => String(m.group_id)),
    );

    /**
     * Every row gets its OWN `created_at`, one millisecond apart, instead of
     * the column default.
     *
     * `DEFAULT NOW()` is the transaction timestamp, so a single multi-row
     * insert stamps all 200 rows identically — and "Saved posts" pages with a
     * STRICT keyset (`created_at < cursor`). One page of 20 would be returned
     * and the cursor would then skip every remaining row sharing that
     * timestamp, silently losing up to 180 of the saves this import exists to
     * rescue. Distinct, descending stamps also keep the imported order stable
     * instead of leaving it to the planner.
     */
    const importedAt = Date.now();
    const importable = candidates
      .filter((r: any) => allowed.has(String(r.group_id)))
      .map((r: any, index: number) => ({
        user_id: userId,
        message_id: String(r.id),
        created_at: new Date(importedAt - index).toISOString(),
      }));
    if (importable.length === 0) return { imported: 0, serverBacked: true };

    const { error: upsertError } = await (this.supabase as any)
      .from("message_bookmarks")
      .upsert(importable, {
        onConflict: "user_id,message_id",
        ignoreDuplicates: true,
      });
    if (upsertError) {
      if (this.bookmarksMissingTable(upsertError)) {
        return { imported: 0, serverBacked: false };
      }
      throw upsertError;
    }
    return { imported: importable.length, serverBacked: true };
  }

  // -------------------------------------------------------------------------
  // Repost
  // -------------------------------------------------------------------------

  /**
   * Bump a post back to the top of the SAME board with the reposter's name on
   * it. An ordinary `messages` row — no schema change, no new `messages.type`:
   *
   *   reply_to_message_id = the original    thread_root_id     = NULL
   *   client_message_id   = `repost:<id>`   type               = 'TEXT'
   *   text                = the quote or NULL
   *
   * Dedupe is free: `idx_messages_group_client_message_id`
   * UNIQUE (group_id, sender_id, client_message_id) WHERE client_message_id IS
   * NOT NULL (20260711170000) makes one-repost-per-person-per-post a DATABASE
   * guarantee, and its 23505 is what answers 409.
   *
   * Cross-board repost is refused because board media ACL is derived from the
   * storage PATH: a repost landing on board B would still point at
   * `note-files/{owner}/chat/{boardA}/…`, which `canAccessStorageObject`
   * correctly refuses to B's members. The only alternatives are copying the
   * object or widening the ACL.
   */
  async createBoardRepost(
    groupId: string,
    userId: string,
    originalId: string,
    quote?: string | null,
  ): Promise<BoardRepostResult> {
    if (!groupId || !userId || !originalId) return { status: "not_found" };

    const trimmedQuote = typeof quote === "string" ? quote.trim() : "";
    if (trimmedQuote.length > BOARD_REPOST_QUOTE_MAX) {
      return { status: "quote_too_long" };
    }

    const board = await this.resolveBoardContext(groupId);
    if (!board.isBoard) return { status: "not_board" };
    // A repost is a write into the community too.
    await assertNotMutedInCommunity(this.supabase, userId, board.communityId);

    const { data: original, error: originalError } = await this.supabase
      .from("messages")
      .select(
        "id, group_id, sender_id, timestamp, removed_at, thread_root_id, reply_to_message_id, client_message_id",
      )
      .eq("id", originalId)
      .maybeSingle();
    if (originalError && originalError.code !== "PGRST116") throw originalError;
    if (!original) return { status: "not_found" };

    const target = original as any;
    if (String(target.group_id) !== groupId) return { status: "not_same_board" };
    if (target.removed_at) return { status: "removed" };
    if (target.thread_root_id) return { status: "not_a_post" };
    if (
      isBoardRepostRow({
        replyToMessageId: target.reply_to_message_id,
        threadRootId: target.thread_root_id,
        clientMessageId: target.client_message_id,
      }) ||
      // An ORPHANED repost — its original was hard-deleted, so
      // `reply_to_message_id` is NULL and the three-clause check no longer
      // recognises it. The surviving `repost:` client id still does, and
      // `sendMessage` refuses that prefix, so nothing else can carry it.
      // Without this, a repost of a repost is reachable via a deleted account.
      boardRepostOriginalId(target.client_message_id) !== null
    ) {
      return { status: "repost_of_repost" };
    }
    if (String(target.sender_id) === userId) {
      const postedAt = Date.parse(target.timestamp);
      if (
        Number.isFinite(postedAt) &&
        Date.now() - postedAt < BOARD_REPOST_SELF_COOLDOWN_MS
      ) {
        return { status: "own_too_soon" };
      }
    }

    // Per-board hourly cap, on top of the route's ordinary message rate limit.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await (this.supabase as any)
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("group_id", groupId)
      .eq("sender_id", userId)
      .like("client_message_id", `${BOARD_REPOST_CLIENT_ID_PREFIX}%`)
      .gte("timestamp", since);
    if (countError) throw countError;
    if ((count || 0) >= BOARD_REPOST_PER_BOARD_HOURLY_MAX) {
      return { status: "too_many" };
    }

    const clientMessageId = boardRepostClientId(originalId);
    const { data, error } = await (this.supabase as any)
      .from("messages")
      .insert({
        group_id: groupId,
        sender_id: userId,
        type: "TEXT",
        text: trimmedQuote || null,
        reply_to_message_id: originalId,
        client_message_id: clientMessageId,
        mentioned_user_ids: [],
      })
      .select()
      .single();

    if (error) {
      if ((error as any).code === "23505") {
        // The slot is taken. If the viewer's own earlier repost was soft
        // removed the row is still there holding the unique key, so a plain
        // 409 would make "repost" permanently impossible. Bring it back
        // instead — that is exactly what the student asked for.
        const revived = await this.reviveRemovedRepost(
          groupId,
          userId,
          clientMessageId,
          trimmedQuote || null,
        );
        if (revived) {
          await cacheService.invalidateGroupCache(groupId);
          return { status: "ok", message: revived };
        }
        return { status: "already" };
      }
      throw error;
    }

    /**
     * Deliberately NOT done here (§6.3 rule 7): no `groups.last_message`
     * update and no notification fan-out. A repost is a bump, not speech —
     * pushing it would be a campus-wide notification for a post everyone on
     * the board has already been able to see.
     */
    await cacheService.invalidateGroupCache(groupId);
    return { status: "ok", message: data };
  }

  /** Un-remove the viewer's own soft-removed repost row rather than 409ing forever. */
  private async reviveRemovedRepost(
    groupId: string,
    userId: string,
    clientMessageId: string,
    text: string | null,
  ): Promise<Record<string, unknown> | null> {
    const { data, error } = await (this.supabase as any)
      .from("messages")
      .select("id, removed_at")
      .eq("group_id", groupId)
      .eq("sender_id", userId)
      .eq("client_message_id", clientMessageId)
      .maybeSingle();
    if (error && (error as any).code !== "PGRST116") return null;
    if (!data || !(data as any).removed_at) return null;

    const { data: revived, error: reviveError } = await (this.supabase as any)
      .from("messages")
      .update({
        removed_at: null,
        removed_by: null,
        text,
        timestamp: new Date().toISOString(),
      })
      .eq("id", (data as any).id)
      .select()
      .single();
    if (reviveError) return null;
    return revived as Record<string, unknown>;
  }

  /**
   * Undo a repost. `:messageId` on the route is the ORIGINAL's id — the whole
   * card acts on the original, and only this one control acts on the repost
   * row, so the client never has to know the repost row's id.
   *
   * It deliberately BYPASSES the 30-minute `CHAT_MESSAGE_MUTATION_WINDOW_MS`
   * that `remove_chat_message` enforces in SQL: a repost is a pointer, not
   * speech, and "you can no longer un-bump this" is not a rule anyone would
   * accept. Scoped to `sender_id = viewer`, so it can only ever reach the
   * caller's own row.
   */
  async undoBoardRepost(
    originalId: string,
    userId: string,
  ): Promise<BoardRepostUndoResult> {
    if (!originalId || !userId) return { status: "not_found" };
    const clientMessageId = boardRepostClientId(originalId);

    const { data, error } = await (this.supabase as any)
      .from("messages")
      .select("id, group_id, removed_at")
      .eq("sender_id", userId)
      .eq("client_message_id", clientMessageId)
      .is("removed_at", null)
      .limit(1);
    if (error) throw error;
    const row = (data || [])[0] as
      | { id: string; group_id: string }
      | undefined;
    if (!row) return { status: "not_found" };

    const repostId = String(row.id);
    const groupId = String(row.group_id);

    // A repost row is not a comment target on any surface, but the API cannot
    // assume a client obeyed that. If anything hangs off it, soft-remove so
    // the thread keeps its shape.
    const { data: children, error: childError } = await this.supabase
      .from("messages")
      .select("id")
      .eq("thread_root_id", repostId)
      .limit(1);
    if (childError) throw childError;

    if ((children || []).length > 0) {
      const removedAt = new Date().toISOString();
      const { error: removeError } = await (this.supabase as any)
        .from("messages")
        .update({ removed_at: removedAt, removed_by: userId, text: null })
        .eq("id", repostId)
        .eq("sender_id", userId);
      if (removeError) throw removeError;
      // remove_chat_message would have written this; going around it for the
      // window bypass must not also lose the audit trail.
      await (this.supabase as any)
        .from("chat_message_audit")
        .insert({
          group_message_id: repostId,
          actor_id: userId,
          action: "REMOVE",
          previous_text: null,
          new_text: null,
        })
        .then(({ error: auditError }: any) => {
          if (auditError) {
            logger.warn("undoBoardRepost: audit insert failed", {
              auditError,
              repostId,
            });
          }
        });
    } else {
      const { error: deleteError } = await (this.supabase as any)
        .from("messages")
        .delete()
        .eq("id", repostId)
        .eq("sender_id", userId);
      if (deleteError) throw deleteError;
    }

    await cacheService.invalidateGroupCache(groupId);
    await cacheService.delete(`message:raw:${repostId}`);
    return { status: "ok", groupId, repostId };
  }

  // -------------------------------------------------------------------------
  // Board page hydration
  // -------------------------------------------------------------------------

  /**
   * Attach `repostOf` and `repostCount` to a board page. Two batched queries
   * for the whole page, modelled on `attachReplyPreviewsBatch` /
   * `attachThreadReplyCounts`, and run ONLY for a roots-only (board) page so
   * chat and comment threads pay nothing.
   *
   * The embed carries a SNIPPET and `hasImage` / `hasAudio` flags — never a
   * media URL. A repost card therefore downloads zero bytes of media, exactly
   * like every other list card.
   */
  private async attachBoardRepostContext(
    rows: any[],
    groupId: string,
  ): Promise<any[]> {
    if (!rows.length) return rows;

    const quotedIds = [
      ...new Set(
        rows
          .filter((row) =>
            isBoardRepostRow({
              replyToMessageId: row?.reply_to_message_id,
              threadRootId: row?.thread_root_id,
              clientMessageId: row?.client_message_id,
            }),
          )
          .map((row) => String(row.reply_to_message_id)),
      ),
    ];

    let quoted = new Map<string, BoardQuotedPost>();
    if (quotedIds.length) {
      const { data, error } = await (this.supabase as any)
        .from("messages")
        .select(
          "id, sender_id, subject, text, image_url, timestamp, removed_at, profiles:sender_id(id, name, username)",
        )
        .in("id", quotedIds);
      if (error) {
        logger.warn("attachBoardRepostContext: quoted read failed", {
          error,
          groupId,
        });
      } else {
        quoted = new Map(
          (data || []).map((row: any) => [
            String(row.id),
            this.toQuotedPost(row),
          ]),
        );
      }
    }

    const counts = await this.countRepostsFor(rows.map((r) => String(r.id)));

    return rows.map((row) => {
      const isRepost = isBoardRepostRow({
        replyToMessageId: row?.reply_to_message_id,
        threadRootId: row?.thread_root_id,
        clientMessageId: row?.client_message_id,
      });
      return {
        ...row,
        repostCount: counts.get(String(row.id)) || 0,
        // A quoted id that does not resolve (the row was read between the two
        // queries) is `null`, and the client renders the card with no embed.
        repostOf: isRepost
          ? (quoted.get(String(row.reply_to_message_id)) ?? null)
          : this.orphanedRepostEmbed(row),
      };
    });
  }

  /**
   * The embed for a repost whose ORIGINAL has been hard-deleted.
   *
   * `messages.reply_to_message_id` is `ON DELETE SET NULL` (20260728120000)
   * and `messages.sender_id` is `ON DELETE CASCADE`, so deleting an account
   * hard-deletes its posts and NULLs the pointer on every repost of them. That
   * fails the first clause of `isBoardRepostRow`, so without this the row stops
   * being recognised as a repost at all and renders as an ordinary post — a
   * blank card when the reposter added no comment, under the reposter's name.
   *
   * `client_message_id` survives the delete and still says `repost:<id>`. It is
   * trustworthy here precisely because `sendMessage` refuses that prefix on the
   * ordinary send path, so only `createBoardRepost` can ever have written it.
   * The embed is a tombstone: `removedAt` set, no author, no snippet, so the
   * card says the original is gone instead of pretending it never existed.
   */
  private orphanedRepostEmbed(row: any): BoardQuotedPost | null {
    if (row?.thread_root_id || row?.reply_to_message_id) return null;
    const originalId = boardRepostOriginalId(row?.client_message_id);
    if (!originalId) return null;
    return {
      id: originalId,
      senderName: "Someone",
      timestamp: row?.timestamp
        ? new Date(row.timestamp).toISOString()
        : new Date().toISOString(),
      subject: null,
      snippet: "",
      hasImage: false,
      hasAudio: false,
      removedAt: row?.timestamp
        ? new Date(row.timestamp).toISOString()
        : new Date().toISOString(),
    };
  }

  /** One `messages` row → the text-only quoted embed. Never a media URL. */
  private toQuotedPost(row: any): BoardQuotedPost {
    const removedAt = row?.removed_at ?? null;
    const profile = resolveNestedProfile(row?.profiles);
    const text = removedAt ? "" : String(row?.text ?? "");
    return {
      id: String(row?.id ?? ""),
      senderName: profile?.name || profile?.username || "Someone",
      timestamp: row?.timestamp
        ? new Date(row.timestamp).toISOString()
        : new Date().toISOString(),
      subject: removedAt ? null : (row?.subject ?? null),
      snippet: removedAt ? "" : boardQuoteSnippet(text, BOARD_QUOTE_SNIPPET_MAX),
      hasImage: !removedAt && !!(row?.image_url || parseChatImageUrl(text)),
      hasAudio: !removedAt && !!parseChatAudioUrl(text),
      removedAt,
    };
  }

  /** How many live reposts point at each of these posts. One batched query. */
  private async countRepostsFor(
    messageIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const ids = [...new Set(messageIds.filter(Boolean))];
    if (!ids.length) return counts;
    const { data, error } = await (this.supabase as any)
      .from("messages")
      .select("reply_to_message_id")
      .is("thread_root_id", null)
      .is("removed_at", null)
      .like("client_message_id", `${BOARD_REPOST_CLIENT_ID_PREFIX}%`)
      .in("reply_to_message_id", ids);
    if (error) {
      logger.warn("countRepostsFor failed", { error });
      return counts;
    }
    for (const row of data || []) {
      const id = String((row as any).reply_to_message_id || "");
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }

  /** Which of these posts the viewer has already reposted. */
  private async repostedByMeAmong(
    messageIds: string[],
    userId: string,
  ): Promise<Set<string>> {
    const mine = new Set<string>();
    const ids = [...new Set(messageIds.filter(Boolean))];
    if (!ids.length || !userId) return mine;
    const { data, error } = await (this.supabase as any)
      .from("messages")
      .select("reply_to_message_id")
      .eq("sender_id", userId)
      .is("thread_root_id", null)
      .is("removed_at", null)
      .like("client_message_id", `${BOARD_REPOST_CLIENT_ID_PREFIX}%`)
      .in("reply_to_message_id", ids);
    if (error) {
      logger.warn("repostedByMeAmong failed", { error });
      return mine;
    }
    for (const row of data || []) {
      const id = String((row as any).reply_to_message_id || "");
      if (id) mine.add(id);
    }
    return mine;
  }

  /** Which of these posts the viewer has favorited (a ❤️ in message_reactions). */
  private async favoritedAmong(
    messageIds: string[],
    userId: string,
  ): Promise<Set<string>> {
    const mine = new Set<string>();
    const ids = [...new Set(messageIds.filter(Boolean))];
    if (!ids.length || !userId) return mine;
    const { data, error } = await (this.supabase as any)
      .from("message_reactions")
      .select("group_message_id")
      .eq("user_id", userId)
      .eq("emoji", BOARD_FAVORITE_EMOJI)
      .in("group_message_id", ids);
    if (error) {
      if (!this.reactionsMissingTable(error)) throw error;
      return mine;
    }
    for (const row of data || []) {
      const id = String((row as any).group_message_id || "");
      if (id) mine.add(id);
    }
    return mine;
  }

  /**
   * Viewer-specific board state — `repostedByMe` and `bookmarked`.
   *
   * MUST run AFTER `cacheService.cached(...)` returns, next to
   * `enrichGroupMessageReceipts`: the 120-second page cache is shared by every
   * member of the board, so putting either flag inside it would show one
   * student another student's bookmarks.
   */
  private async enrichBoardViewerState(
    messages: Message[],
    viewerUserId: string,
  ): Promise<Message[]> {
    if (!messages.length || !viewerUserId) return messages;
    const ids = messages.map((m) => String(m.id));
    const [mine, bookmarked] = await Promise.all([
      this.repostedByMeAmong(ids, viewerUserId),
      this.bookmarkedAmong(ids, viewerUserId),
    ]);
    return messages.map((message) => ({
      ...message,
      repostedByMe: mine.has(String(message.id)),
      bookmarked: bookmarked.has(String(message.id)),
    }));
  }

  /** Which of these posts the viewer saved. `{}` — never a throw — pre-migration. */
  private async bookmarkedAmong(
    messageIds: string[],
    userId: string,
  ): Promise<Set<string>> {
    const saved = new Set<string>();
    const ids = [...new Set(messageIds.filter(Boolean))];
    if (!ids.length || !userId) return saved;
    const { data, error } = await (this.supabase as any)
      .from("message_bookmarks")
      .select("message_id")
      .eq("user_id", userId)
      .in("message_id", ids);
    if (error) {
      if (this.bookmarksMissingTable(error)) {
        logger.warn("bookmarkedAmong: message_bookmarks missing, degrading");
        return saved;
      }
      throw error;
    }
    for (const row of data || []) {
      const id = String((row as any).message_id || "");
      if (id) saved.add(id);
    }
    return saved;
  }

  /** Read board post rows by id, tolerating a database without the board columns. */
  private async readBoardPostRows(ids: string[]): Promise<any[]> {
    if (!ids.length) return [];
    const base = `
      id,
      group_id,
      sender_id,
      type,
      text,
      timestamp,
      edited_at,
      removed_at,
      image_url,
      client_message_id,
      reply_to_message_id,
      thread_root_id,
      profiles:sender_id (id, name, username, avatar_url)
    `;
    const run = (select: string) =>
      (this.supabase as any).from("messages").select(select).in("id", ids);

    let { data, error } = await run(
      await reactionColumns(this.supabase, await messageColumns(this.supabase, base)),
    );
    if (error && isMissingColumnError(error)) {
      markMessageReactionsColumnMissing();
      ({ data, error } = await run(await messageColumns(this.supabase, base)));
    }
    if (error && isMissingColumnError(error)) {
      markMessageBoardColumnsMissing();
      ({ data, error } = await run(base));
    }
    if (error) throw error;
    return (data || []) as any[];
  }

  /** Board name plus community slug/name for a set of groups, for saved rows. */
  private async readBoardContextForGroups(
    groupIds: string[],
  ): Promise<
    Map<string, { name: string; communitySlug: string | null; communityName: string | null }>
  > {
    const out = new Map<
      string,
      { name: string; communitySlug: string | null; communityName: string | null }
    >();
    if (!groupIds.length) return out;
    const { data: groups, error } = await this.supabase
      .from("groups")
      .select("id, name, community_id")
      .in("id", groupIds);
    if (error) {
      logger.warn("readBoardContextForGroups failed", { error });
      return out;
    }
    const communityIds = [
      ...new Set(
        (groups || [])
          .map((g: any) => (g.community_id ? String(g.community_id) : ""))
          .filter(Boolean),
      ),
    ];
    const communities = new Map<string, { slug: string | null; name: string | null }>();
    if (communityIds.length) {
      const { data: rows } = await this.supabase
        .from("communities")
        .select("id, slug, name")
        .in("id", communityIds);
      for (const row of rows || []) {
        communities.set(String((row as any).id), {
          slug: (row as any).slug ?? null,
          name: (row as any).name ?? null,
        });
      }
    }
    for (const group of groups || []) {
      const community = (group as any).community_id
        ? communities.get(String((group as any).community_id))
        : undefined;
      out.set(String((group as any).id), {
        name: String((group as any).name || "Board"),
        communitySlug: community?.slug ?? null,
        communityName: community?.name ?? null,
      });
    }
    return out;
  }

  /** A `messages` row → the shared `BoardPost`, for the saved-posts list. */
  private toBoardPostShape(
    row: any,
    extras: {
      bookmarked: boolean;
      favorited: boolean;
      repostCount: number;
      repostedByMe: boolean;
      repostOf: BoardQuotedPost | null;
    },
  ): BoardBookmarkEntry["post"] {
    const profile = resolveNestedProfile(row?.profiles);
    const removedAt = row?.removed_at ?? null;
    const isQuestion = String(row?.type || "TEXT") === "QUESTION";
    const reactions = normalizeReactions(row?.reactions);
    return {
      id: String(row?.id ?? ""),
      groupId: String(row?.group_id ?? ""),
      senderId: String(row?.sender_id ?? profile?.id ?? ""),
      senderName: profile?.name || profile?.username || "Member",
      senderAvatarUrl: profile?.avatar_url ?? null,
      subject: removedAt ? null : (row?.subject ?? null),
      text: removedAt ? "" : String(row?.text ?? ""),
      timestamp: row?.timestamp
        ? new Date(row.timestamp).toISOString()
        : new Date().toISOString(),
      editedAt: row?.edited_at ?? null,
      removedAt,
      replyCount: 0,
      reactions,
      pinnedAt: row?.pinned_at ?? null,
      pinnedBy: row?.pinned_by ?? null,
      isLegacyQuestion: isQuestion && !removedAt,
      legacyQuestionStem: null,
      imageUrl: row?.image_url
        ? this.normalizeStorageUrl(String(row.image_url))
        : null,
      favoriteCount: reactions[BOARD_FAVORITE_EMOJI] ?? 0,
      favorited: extras.favorited,
      bookmarked: extras.bookmarked,
      repostCount: extras.repostCount,
      repostedByMe: extras.repostedByMe,
      repostOf: extras.repostOf,
    };
  }

  /** The caller's stored role in a community, or null when they are not a member. */
  private async communityMemberRole(
    communityId: string,
    userId: string,
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("community_members")
      .select("role")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .is("opted_out_at", null)
      .maybeSingle();
    if (error) throw error;
    return (data as { role?: string | null } | null)?.role ?? null;
  }

  /** Notify active members after a group message is persisted (message-before-notification ordering). */
  private async notifyGroupMessageRecipients(params: {
    groupId: string;
    senderId: string;
    content: string;
    messageId: string;
    excludeUserIds?: string[];
  }): Promise<void> {
    const { groupId, senderId, content, messageId, excludeUserIds } = params;
    const [{ data: members, error: membersError }, groupMeta, sender] =
      await Promise.all([
        this.supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId)
          .eq("pending", false),
        this.getGroupById(groupId),
        this.getUserById(senderId),
      ]);

    if (membersError) throw membersError;

    const excluded = new Set(excludeUserIds || []);
    const recipientIds = (members || [])
      .map((m) => m.user_id)
      .filter((id) => id && id !== senderId && !excluded.has(id));
    if (!recipientIds.length) return;

    const groupName = groupMeta?.name || "a group";
    const actorLabel =
      sender?.name || (sender?.username ? `@${sender.username}` : "Someone");
    const preview =
      content.length > 50 ? `${content.substring(0, 50)}…` : content;

    await Promise.all(
      recipientIds.map((recipientId) =>
        this.createNotification(recipientId, {
          message: `New message in ${groupName} from ${actorLabel}: "${preview}"`,
          link: `/chat/${groupId}`,
          type: "group_message",
          data: { groupId, messageId, senderId, preview },
        }).catch((err) => {
          logger.error("Failed to create group message notification", {
            err,
            groupId,
            recipientId,
            messageId,
          });
        }),
      ),
    );
  }

  async fetchMessages(groupId: string): Promise<Message[]> {
    const cacheKey = `group:${groupId}:messages`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("messages")
          .select(
            `
          id,
          group_id,
          sender_id,
          type,
          text,
          question_data,
          flagged_as_similar_user_ids,
          timestamp,
          edited_at,
          removed_at,
          upvotes,
          downvotes,
          is_archived,
          image_url,
          profiles!sender_id (
            id,
            name,
            username,
            avatar_url
          )
        `,
          )
          .eq("group_id", groupId)
          .order("timestamp", { ascending: true });

        if (error) throw error;

        // The question pool is read from here, so it needs the same
        // verification progress the chat card shows.
        const withPeerUpvotes = await this.attachPeerUpvotes(data as any[]);

        return withPeerUpvotes.map((msg: any) => ({
          id: msg.id,
          groupId: msg.group_id,
          sender: mapProfileSender(
            resolveNestedProfile(msg.profiles),
            msg.sender_id,
          ),
          timestamp: msg.timestamp
            ? new Date(msg.timestamp).toISOString()
            : new Date().toISOString(),
          flaggedAsSimilarUserIds: msg.flagged_as_similar_user_ids || [],
          upvotes: msg.upvotes || 0,
          downvotes: msg.downvotes || 0,
          isArchived: msg.is_archived || false,
          ...this.normalizeMessageRecord(msg),
        }));
      },
      { ttl: 30 },
    ); // Cache for 30 seconds
  }

  private parseMessageContent(msg: any): Partial<Message> {
    if (msg.type === "TEXT") {
      return {
        type: "TEXT",
        text: msg.text,
      };
    } else if (msg.type === "QUESTION") {
      return {
        type: "QUESTION",
        ...msg.question_data,
      };
    }
    return {};
  }

  // Test Results Functions
  async fetchTestResults(userId: string): Promise<TestResult[]> {
    const cacheKey = `user:${userId}:test-results`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("test_sessions")
          .select(
            `
          *,
          test_results (*)
        `,
          )
          .eq("user_id", userId)
          .order("start_time", { ascending: false });

        if (error) throw error;

        return data.flatMap((session: any) =>
          session.test_results.map((result: any) => ({
            id: result.id,
            session: {
              ...session,
              startTime: session.start_time,
              endTime: session.end_time,
              isOffline: session.is_offline,
              config: session.config,
              questions: session.questions,
              userAnswers: session.user_answers,
            },
            score: result.score,
            totalQuestions: result.total_questions,
            correctAnswersCount: result.correct_answers_count,
          })),
        );
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  // Real-time subscription helpers (for future use)
  getSupabaseClient() {
    return this.supabase;
  }

  async isPlatformAdmin(userId: string): Promise<boolean> {
    const { data: row } = await this.supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (row) return true;

    const { data: authData, error } =
      await this.supabase.auth.admin.getUserById(userId);
    if (error || !authData?.user) return false;
    return authData.user.app_metadata?.is_platform_admin === true;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from("profiles")
        .select("id")
        .limit(1);

      if (error) throw error;
      return true;
    } catch (error) {
      logger.error("Database health check failed:", error);
      return false;
    }
  }

  async verifySupabaseToken(
    accessToken: string,
  ): Promise<{ user: any; isValid: boolean }> {
    try {
      const { data, error } = await this.supabase.auth.getUser(accessToken);
      if (error) {
        return { user: null, isValid: false };
      }
      return { user: data.user, isValid: true };
    } catch (error) {
      logger.error("Token verification failed:", error);
      return { user: null, isValid: false };
    }
  }

  // Marketplace Methods for API Routes
  async getMarketplaceCampuses(countryCode = "NG"): Promise<any[]> {
    const { data, error } = await this.supabase
      .from("marketplace_campuses")
      .select("id, name, city, state, country_code, slug, geopolitical_zone, kind")
      .eq("active", true)
      .eq("country_code", countryCode)
      .order("name", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async getMarketplaceCampusById(campusId: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from("marketplace_campuses")
      .select(
        "id, name, city, state, country_code, slug, active, geopolitical_zone",
      )
      .eq("id", campusId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /**
   * Compact card payloads: keep only the first image per listing (cards render one),
   * signing private-bucket URLs in a single batched createSignedUrls call per bucket
   * instead of one storage round-trip per image. Prefers the 320px grid thumbnail
   * (<path>.thumb.webp, generated at upload) and falls back to the original for
   * listings created before thumbnails existed.
   */
  private async toListingCardRecords(listings: any[]): Promise<any[]> {
    const entries = listings.map((listing) => {
      const images = Array.isArray(listing.images) ? listing.images : [];
      const first =
        images.length > 0 ? this.normalizeStorageUrl(images[0]) : null;
      let parsed: { bucket: string; path: string } | null = null;
      if (first && !first.startsWith("data:")) {
        const candidate = parseStorageObjectUrl(first);
        if (candidate && isPrivateStorageBucket(candidate.bucket))
          parsed = candidate;
      }
      return { first, parsed, imageCount: images.length };
    });

    const refs = entries
      .map((entry, index) =>
        entry.parsed
          ? {
              bucket: entry.parsed.bucket,
              path: entry.parsed.path,
              index,
            }
          : null,
      )
      .filter(Boolean) as Array<{ bucket: string; path: string; index: number }>;

    const signedByIndex = await this.signStorageDisplayUrls(refs, {
      expiresInSeconds: 60 * 60 * 24,
      variant: "thumb",
    });

    const cards = listings.map((listing, index) => {
      const entry = entries[index];
      const cardImage = entry
        ? (signedByIndex.get(index) ?? entry.first)
        : null;
      return {
        ...this.normalizeListingRecord(listing),
        images: cardImage ? [cardImage] : [],
        image_count: entry?.imageCount ?? 0,
      };
    });

    // Phase 3 N: trust on the SELLER EMBED, not only on the creator profile.
    return this.attachSellerTrust(cards);
  }

  /**
   * Attach `seller.trustLevel` / `seller.verificationLevel` to listing rows
   * (Phase 3 · N). One batched lookup for the whole page — creator_stats is
   * service-role only so this cannot be a PostgREST embed, and a per-row query
   * would be N+1 on every browse page.
   *
   * This lives OUTSIDE toListingCardRecords because that function only runs on
   * the `compact` response profile; the default `full` browse response returns
   * the search-RPC rows directly, and attaching trust only in the card builder
   * silently left trust off every default browse response.
   *
   * Idempotent: rows that already carry trust are returned untouched, so the
   * compact path (card builder + RPC branch) does not pay for it twice.
   */
  private async attachSellerTrust(rows: any[]): Promise<any[]> {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const needsTrust = rows.some(
      (row) => row?.seller && (row.seller as any).trustLevel === undefined,
    );
    if (!needsTrust) return rows;

    const trustBySeller = await this.fetchSellerTrust(
      rows.map((row) => row?.user_id).filter(Boolean),
    );
    return rows.map((row) => {
      if (!row?.seller || (row.seller as any).trustLevel !== undefined) return row;
      const trust = trustBySeller.get(row.user_id);
      return {
        ...row,
        seller: {
          ...row.seller,
          trustLevel: trust?.trust_level ?? null,
          verificationLevel: trust?.verification_level ?? 0,
        },
      };
    });
  }

  /**
   * Trust level + verification for a set of sellers, batched and de-duplicated.
   * Never throws: a missing trust chip must not fail a browse page.
   */
  private async fetchSellerTrust(
    sellerIds: string[],
  ): Promise<Map<string, { trust_level: string; verification_level: number }>> {
    const out = new Map<string, { trust_level: string; verification_level: number }>();
    const unique = [...new Set(sellerIds)].filter(Boolean);
    if (unique.length === 0) return out;
    try {
      const [statsResult, profilesResult] = await Promise.all([
        this.supabase
          .from("creator_stats")
          .select("user_id, trust_level")
          .in("user_id", unique),
        this.supabase
          .from("profiles")
          .select("id, verification_level")
          .in("id", unique),
      ]);
      const verificationById = new Map(
        (profilesResult.data || []).map((row: any) => [row.id, row.verification_level ?? 0]),
      );
      for (const row of statsResult.data || []) {
        out.set((row as any).user_id, {
          trust_level: (row as any).trust_level,
          verification_level: verificationById.get((row as any).user_id) ?? 0,
        });
      }
      // A seller with no creator_stats row yet still has a verification level.
      for (const id of unique) {
        if (!out.has(id) && verificationById.has(id)) {
          out.set(id, { trust_level: "new", verification_level: verificationById.get(id) ?? 0 });
        }
      }
    } catch (err) {
      logger.warn("seller trust lookup failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return out;
  }

  /** Trim a normalized listing row to the fields listing cards actually render. */
  private pickCompactListingFields(listing: any): any {
    const {
      id,
      user_id,
      category,
      title,
      description,
      price,
      sale_price,
      sale_ends_at,
      promo_label,
      effective_price,
      is_on_sale,
      location,
      campus_id,
      country_code,
      images,
      image_count,
      status,
      created_at,
      views_count,
      seller,
      is_boosted,
      category_specific_fields,
      quantity,
      rating_avg,
      rating_count,
    } = listing;
    return {
      id,
      user_id,
      category,
      title,
      description,
      price,
      sale_price,
      sale_ends_at,
      promo_label,
      effective_price,
      is_on_sale,
      location,
      campus_id,
      country_code,
      images,
      image_count,
      status,
      created_at,
      views_count,
      seller,
      is_boosted,
      quantity: quantity ?? null,
      // Rating aggregate for card stars; null until the ratings migration runs.
      rating_avg: rating_avg ?? null,
      rating_count: typeof rating_count === "number" ? rating_count : null,
      // Compact cards need condition + taxonomy node without shipping the
      // whole free-form blob.
      condition:
        (category_specific_fields &&
          (category_specific_fields.condition as string | undefined)) ||
        null,
      taxonomyNodeId:
        (category_specific_fields &&
          (category_specific_fields.taxonomyNodeId as string | undefined)) ||
        null,
    };
  }

  /**
   * marketplace_search_listings returns a FIXED column set that omits
   * listing_kind and quantity, so browse rows could not tell a digital listing
   * (question bank / study pack) from a physical one — which let digital
   * listings slip into physical-only flows such as bundle building. Backfill
   * both in one batched query rather than re-creating the RPC signature.
   */
  private async attachListingKinds(rows: any[]): Promise<any[]> {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const needs = rows.filter((r) => r && r.listing_kind === undefined);
    if (needs.length === 0) return rows;
    const ids = Array.from(new Set(needs.map((r) => String(r.id)).filter(Boolean)));
    if (ids.length === 0) return rows;
    try {
      const { data } = await this.supabase
        .from("marketplace_listings")
        .select("id, listing_kind, quantity")
        .in("id", ids);
      const byId = new Map(
        (data || []).map((l: any) => [String(l.id), l]),
      );
      for (const row of rows) {
        const extra = byId.get(String(row.id));
        if (!extra) continue;
        if (row.listing_kind === undefined) row.listing_kind = extra.listing_kind ?? "single";
        if (row.quantity === undefined) row.quantity = extra.quantity ?? null;
      }
    } catch (err) {
      logger.warn("Could not attach listing_kind to browse rows", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return rows;
  }

  /**
   * The rating aggregate columns + votes table ship in migration
   * 20260828160000, which is applied by hand like every migration here. Until
   * it runs, any explicit reference to the columns fails with 42703; after one
   * such failure we stop asking for 10 minutes so browse traffic does not pay
   * a doomed extra round trip on every request.
   */
  private ratingColumnsBrokenUntil = 0;

  private ratingColumnsAvailable(): boolean {
    return Date.now() >= this.ratingColumnsBrokenUntil;
  }

  private isMissingRatingColumn(error: any): boolean {
    return (
      error?.code === "42703" &&
      typeof error?.message === "string" &&
      error.message.includes("rating_")
    );
  }

  private noteRatingColumnsMissing(): void {
    this.ratingColumnsBrokenUntil = Date.now() + 10 * 60 * 1000;
  }

  async getMarketplaceListings(
    options: {
      page?: number;
      limit?: number;
      category?: string;
      categories?: string[];
      includeCustomCategories?: boolean;
      search?: string;
      minPrice?: number;
      maxPrice?: number;
      location?: string;
      campusId?: string;
      countryCode?: string;
      condition?: string;
      /** Keep only listings whose rating_avg is at least this (1–5). */
      minRating?: number;
      taxonomyNodeId?: string;
      taxonomyNodeIds?: string[];
      includeUnclassified?: boolean;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      responseProfile?: "compact" | "full";
    } = {},
  ): Promise<{ data: any[]; total: number }> {
    const {
      page = 1,
      limit = 20,
      category,
      categories,
      includeCustomCategories = false,
      search,
      minPrice,
      maxPrice,
      location,
      campusId,
      countryCode,
      condition,
      minRating,
      taxonomyNodeId,
      taxonomyNodeIds,
      includeUnclassified = false,
      sortBy = "trending",
      sortOrder = "desc",
      responseProfile = "full",
    } = options;
    const profile = this.getResponseProfile(responseProfile);

    const offset = (page - 1) * limit;
    const categoryList =
      categories && categories.length > 0 ? categories : undefined;

    const taxonomyFilter =
      taxonomyNodeId && isKnownTaxonomyNodeId(taxonomyNodeId)
        ? taxonomyNodeId
        : undefined;
    // Group browse: the set of leaves under the node the buyer opened. Unknown
    // ids are dropped rather than passed through, so a stale client cannot turn
    // a browse into a filter that matches nothing.
    const taxonomyFilterList =
      taxonomyNodeIds && taxonomyNodeIds.length > 0
        ? taxonomyNodeIds.filter((id) => isKnownTaxonomyNodeId(id))
        : undefined;

    // Condition and taxonomy node live inside category_specific_fields JSONB,
    // which the search RPC can't filter on — those queries use the fallback
    // path (degrading trending to created_at). Rating sort/filter also go
    // through the fallback: the pre-migration RPC would silently coerce an
    // unknown sort to trending, which is worse than an honest degradation.
    const wantsRatingQuery = sortBy === "rating" || minRating !== undefined;
    const useSearchRpc =
      !condition &&
      !taxonomyFilter &&
      !taxonomyFilterList?.length &&
      !wantsRatingQuery &&
      (Boolean(search) ||
        Boolean(category) ||
        Boolean(categoryList) ||
        minPrice !== undefined ||
        maxPrice !== undefined ||
        Boolean(location) ||
        sortBy === "trending" ||
        sortBy === "sale_first");

    if (useSearchRpc) {
      const { data: rpcRows, error: rpcError } = await this.supabase.rpc(
        "marketplace_search_listings",
        {
          p_search: search || "",
          p_page: page,
          p_limit: limit,
          p_category: category || null,
          p_min_price: minPrice ?? null,
          p_max_price: maxPrice ?? null,
          p_location: location || null,
          p_sort_by: sortBy,
          p_sort_order: sortOrder,
          p_campus_id: campusId || null,
          p_country_code: countryCode || null,
          p_categories: categoryList ?? null,
          p_include_custom: includeCustomCategories,
        },
      );

      if (!rpcError && rpcRows) {
        const rows = rpcRows as any[];
        const total =
          rows.length > 0 ? Number(rows[0].total_count) || rows.length : 0;
        const mapped = await this.attachListingKinds(
          rows.map((row) => {
            const { total_count: _totalCount, profiles, ...rest } = row;
            return { ...rest, seller: profiles || row.seller };
          }),
        );
        if (profile === "compact") {
          const cards = await this.toListingCardRecords(mapped);
          return {
            data: cards.map((row) => this.pickCompactListingFields(row)),
            total,
          };
        }
        // The `full` profile returns the RPC rows directly and never reaches
        // toListingCardRecords, so trust has to be attached here too — this is
        // the DEFAULT browse response.
        return { data: await this.attachSellerTrust(mapped), total };
      }
      if (rpcError) {
        console.warn(
          "marketplace_search_listings RPC failed, falling back to ilike query",
          rpcError.message,
        );
      }
    }

    const buildFallbackQuery = (withRatings: boolean) => {
      const selectClause =
        profile === "compact"
          ? `
        id,
        user_id,
        category,
        title,
        description,
        price,
        sale_price,
        sale_ends_at,
        promo_label,
        location,
        campus_id,
        country_code,
        images,
        created_at,
        status,
        views_count,
        quantity,
        category_specific_fields,${withRatings ? "\n        rating_avg,\n        rating_count," : ""}
        seller:profiles!user_id (
          id,
          name,
          avatar_url
        )
      `
          : `
        *,
        seller:profiles!user_id (
          id,
          name,
          avatar_url
        )
      `;

      let query = this.supabase
        .from("marketplace_listings")
        .select(selectClause, { count: "exact" })
        // Reserved stays visible (sale in progress) but purchase APIs still require active.
        .in("status", ["active", "reserved"])
        .range(offset, offset + limit - 1);

      if (countryCode) {
        query = query.eq("country_code", countryCode);
      }

      if (campusId) {
        query = query.eq("campus_id", campusId);
      }

      if (category) {
        query = query.eq("category", category);
      } else if (categoryList) {
        const inList = `category.in.(${categoryList.join(",")})`;
        query = includeCustomCategories
          ? query.or(`${inList},category.like.custom:*`)
          : query.or(inList);
      }

      if (search) {
        query = query.ilike("title", `%${search}%`);
      }

      if (minPrice !== undefined) {
        query = query.gte("price", minPrice);
      }

      if (maxPrice !== undefined) {
        query = query.lte("price", maxPrice);
      }

      if (location) {
        query = query.ilike("location", `%${location}%`);
      }

      if (condition) {
        query = query.eq("category_specific_fields->>condition", condition);
      }

      if (taxonomyFilter) {
        // Node ids contain dots; quote the eq value so PostgREST does not split
        // `academic.materials.textbooks.course` into extra filter segments.
        const quoted = `"${taxonomyFilter.replace(/"/g, "")}"`;
        query = includeUnclassified
          ? query.or(
              `category_specific_fields->>taxonomyNodeId.eq.${quoted},category_specific_fields->>taxonomyNodeId.is.null`,
            )
          : query.eq("category_specific_fields->>taxonomyNodeId", taxonomyFilter);
      } else if (taxonomyFilterList && taxonomyFilterList.length > 0) {
        // A group browse never also asks for unfiled rows: a node either owns
        // its whole listing category — in which case the category filter alone
        // already says it, and unfiled rows belong — or it owns only part of
        // one, in which case an unfiled row cannot be placed inside it. So a
        // plain IN is enough here, and the client escapes the values.
        query = query.in(
          "category_specific_fields->>taxonomyNodeId",
          taxonomyFilterList,
        );
      }

      // Pre-migration the rating columns do not exist: the filter is skipped
      // and the sort degrades to newest — the same honest degradation trending
      // already makes on this path.
      if (withRatings && minRating !== undefined) {
        query = query.gte("rating_avg", minRating);
      }

      if (sortBy === "rating" && withRatings) {
        // "Top rated" is always best-first; unrated listings sink to the end.
        query = query
          .order("rating_avg", { ascending: false, nullsFirst: false })
          .order("rating_count", { ascending: false })
          .order("created_at", { ascending: false });
      } else {
        // Fallback path: trending/sale_first require the RPC; degrade to created_at.
        const fallbackSort =
          sortBy === "trending" || sortBy === "sale_first" || sortBy === "rating"
            ? "created_at"
            : sortBy;
        const fallbackAscending =
          sortBy === "rating" ? false : sortOrder === "asc";
        query = query.order(fallbackSort, { ascending: fallbackAscending });
      }

      return query;
    };

    const attemptRatings = this.ratingColumnsAvailable();
    let { data, error, count } = await buildFallbackQuery(attemptRatings);
    if (error && attemptRatings && this.isMissingRatingColumn(error)) {
      this.noteRatingColumnsMissing();
      ({ data, error, count } = await buildFallbackQuery(false));
    }
    if (error) throw error;

    const rows = data || [];
    const total = count ?? rows.length;

    if (profile === "compact") {
      const cards = await this.toListingCardRecords(rows);
      return {
        data: cards.map((row) => this.pickCompactListingFields(row)),
        total,
      };
    }

    const normalized = await Promise.all(
      rows.map((listing: any) => this.normalizeListingRecordAsync(listing)),
    );
    // Phase 3 N: the FALLBACK path (condition filters, and any sort the RPC
    // cannot serve) has to attach trust too. Doing it only on the RPC branch
    // meant a shipped filter silently returned listings with no trust at all.
    return { data: await this.attachSellerTrust(normalized), total };
  }

  /** Batch fetch of active listings by id (recently-viewed rail). Card-shaped payloads. */
  async getMarketplaceListingsByIds(ids: string[]): Promise<any[]> {
    if (ids.length === 0) return [];
    const buildBatchQuery = (withRatings: boolean) =>
      this.supabase
        .from("marketplace_listings")
        .select(
          `
        id,
        user_id,
        category,
        title,
        description,
        price,
        sale_price,
        sale_ends_at,
        promo_label,
        location,
        campus_id,
        country_code,
        images,
        created_at,
        status,
        views_count,
        quantity,
        category_specific_fields,${withRatings ? "\n        rating_avg,\n        rating_count," : ""}
        seller:profiles!user_id (
          id,
          name,
          avatar_url
        )
      `,
        )
        .in("id", ids)
        .eq("status", "active");

    const attemptRatings = this.ratingColumnsAvailable();
    let { data, error } = await buildBatchQuery(attemptRatings);
    if (error && attemptRatings && this.isMissingRatingColumn(error)) {
      this.noteRatingColumnsMissing();
      ({ data, error } = await buildBatchQuery(false));
    }
    if (error) throw error;

    const cards = await this.toListingCardRecords(data || []);
    const byId = new Map(
      cards.map((row: any) => [row.id, this.pickCompactListingFields(row)]),
    );
    // Preserve the caller's id order (most recently viewed first).
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  /**
   * Related listings for a product page: same category plus same course,
   * ranked by campus / course / taxonomy / price proximity.
   */
  async getRelatedMarketplaceListings(
    listing: {
      id: string;
      category?: string;
      campus_id?: string | null;
      course_id?: string | null;
      price?: number | null;
      category_specific_fields?: Record<string, unknown> | null;
    },
    limit = 6,
  ): Promise<any[]> {
    try {
      return await this.getRelatedMarketplaceListingsInner(listing, limit);
    } catch (error) {
      // Pre-migration: rating columns in the select 42703 — degrade and retry.
      if (this.ratingColumnsAvailable() && this.isMissingRatingColumn(error)) {
        this.noteRatingColumnsMissing();
        return this.getRelatedMarketplaceListingsInner(listing, limit);
      }
      throw error;
    }
  }

  private async getRelatedMarketplaceListingsInner(
    listing: {
      id: string;
      category?: string;
      campus_id?: string | null;
      course_id?: string | null;
      price?: number | null;
      category_specific_fields?: Record<string, unknown> | null;
    },
    limit = 6,
  ): Promise<any[]> {
    const client = this.getClient();
    const similarSelect =
      "id, title, price, images, category, location, campus_id, category_specific_fields, created_at, status" +
      (this.ratingColumnsAvailable() ? ", rating_avg, rating_count" : "");

    let sameCategory: any[] = [];
    if (listing.category) {
      const { data, error } = await client
        .from("marketplace_listings")
        .select(similarSelect)
        .eq("category", listing.category)
        .eq("status", "active")
        .neq("id", listing.id)
        .order("created_at", { ascending: false })
        .limit(24);
      if (error) throw error;
      sameCategory = data || [];
    }

    let sameCourse: any[] = [];
    const courseId = listing.course_id;
    if (courseId) {
      const { data, error } = await client
        .from("marketplace_listings")
        .select(similarSelect)
        .eq("course_id", courseId)
        .eq("status", "active")
        .neq("id", listing.id)
        .order("created_at", { ascending: false })
        .limit(12);
      if (!error) {
        sameCourse = data || [];
      }
    }

    let sameCampus: any[] = [];
    if (listing.campus_id) {
      const { data } = await client
        .from("marketplace_listings")
        .select(similarSelect)
        .eq("campus_id", listing.campus_id)
        .eq("status", "active")
        .neq("id", listing.id)
        .order("created_at", { ascending: false })
        .limit(12);
      sameCampus = data || [];
    }

    const byId = new Map<string, any>();
    for (const row of [...sameCategory, ...sameCourse, ...sameCampus]) {
      if (row?.id) byId.set(row.id, row);
    }
    const ranked = rankRelatedListings(
      listing,
      Array.from(byId.values()),
      limit,
    );
    return this.signSimilarListingCards(ranked);
  }

  async getMarketplaceCategoryAnalytics(): Promise<
    Array<{
      category: string;
      total: number;
      active: number;
      sold: number;
    }>
  > {
    const { data, error } = await this.supabase.rpc(
      "marketplace_category_analytics",
    );
    if (!error && data) {
      return (data as any[]).map((row) => ({
        category: String(row.category || "unknown"),
        total: Number(row.total) || 0,
        active: Number(row.active) || 0,
        sold: Number(row.sold) || 0,
      }));
    }
    if (error) {
      console.warn(
        "marketplace_category_analytics RPC failed, falling back to full scan",
        error.message,
      );
    }

    const { data: rows, error: scanError } = await this.supabase
      .from("marketplace_listings")
      .select("category, status");
    if (scanError) throw scanError;

    const counts = new Map<
      string,
      { total: number; active: number; sold: number }
    >();
    for (const row of rows || []) {
      const category = String(row.category || "unknown");
      const entry = counts.get(category) || { total: 0, active: 0, sold: 0 };
      entry.total += 1;
      if (row.status === "active") entry.active += 1;
      if (row.status === "sold") entry.sold += 1;
      counts.set(category, entry);
    }

    return Array.from(counts.entries())
      .map(([category, stats]) => ({ category, ...stats }))
      .sort((a, b) => b.total - a.total);
  }

  async getMarketplaceListingById(
    listingId: string,
    options?: { requireActive?: boolean },
  ): Promise<any | null> {
    let query = this.supabase
      .from("marketplace_listings")
      .select(
        `
        *,
        seller:profiles!user_id (
          id,
          name,
          avatar_url
        ),
        campus:marketplace_campuses!campus_id (
          id,
          name,
          city,
          state,
          slug,
          country_code,
          geopolitical_zone
        )
      `,
      )
      .eq("id", listingId);

    if (options?.requireActive) {
      query = query.eq("status", "active");
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    if (!data) return null;
    // Phase 3 N: the listing DETAIL seller row is where a buyer decides whether
    // to trust the seller, so it carries the trust chip too. attachSellerTrust
    // is idempotent and batched; here the batch is one row.
    const normalized = await this.normalizeListingRecordAsync(data);
    const [withTrust] = await this.attachSellerTrust([normalized]);
    return withTrust ?? normalized;
  }

  /**
   * Public marketplace detail: active listings for anyone; owners/admins may view non-active.
   */
  async getMarketplaceListingForViewer(
    listingId: string,
    viewerId?: string | null,
  ): Promise<any | null> {
    const listing = await this.getMarketplaceListingById(listingId);
    if (!listing) return null;

    // Reserved = sale in progress: visible (read-only), but buy/offer paths still require active.
    if (listing.status === "active" || listing.status === "reserved") return listing;

    if (!viewerId) return null;

    if (listing.user_id === viewerId) return listing;

    const isAdmin = await this.isPlatformAdmin(viewerId).catch(() => false);
    return isAdmin ? listing : null;
  }

  async createMarketplaceListing(
    listingData: any,
    userId: string,
  ): Promise<any> {
    const { normalizeMarketplacePricing } =
      await import("../utils/marketplacePricing");
    const campusId = listingData.campus_id ?? listingData.campusId;
    if (!campusId) {
      throw new Error("Campus or city metadata is required");
    }
    const pricing = normalizeMarketplacePricing({
      price: listingData.price,
      sale_price: listingData.sale_price,
      salePrice: listingData.salePrice,
    });
    // Mass-assignment guard: validate/strip client-supplied fields that are
    // otherwise written verbatim into privileged columns.
    const listingKind =
      listingData.listing_kind || listingData.listingKind || "single";
    assertValidListingKind(listingKind);
    assertValidListingQuantity(listingData.quantity);
    assertValidBundleItems(
      listingData.bundle_items ?? listingData.bundleItems,
    );
    // Academic archive reference, plus the topic inside it — rejected (400)
    // when the topic belongs to another course, or to no course at all.
    const courseId = listingData.course_id ?? listingData.courseId ?? null;
    const topicId = await this.resolveArtefactTopic({
      topicId:
        listingData.topic_id !== undefined
          ? listingData.topic_id
          : listingData.topicId,
      courseId,
    });
    // Transform camelCase to snake_case for database columns
    const dbData = {
      user_id: userId,
      category: listingData.category,
      title: listingData.title,
      description: listingData.description,
      price: pricing.price,
      sale_price: pricing.sale_price,
      sale_ends_at:
        pricing.sale_price != null
          ? (listingData.sale_ends_at ?? listingData.saleEndsAt ?? null)
          : null,
      promo_label: listingData.promo_label ?? listingData.promoLabel,
      location: listingData.location,
      campus_id: campusId,
      country_code: MARKETPLACE_DEFAULT_COUNTRY,
      currency: MARKETPLACE_DEFAULT_CURRENCY,
      images: sanitizeListingImages(listingData.images),
      category_specific_fields: stripServerOwnedListingFields(
        listingData.categorySpecificFields ||
          listingData.category_specific_fields ||
          {},
      ),
      listing_kind: listingKind,
      bundle_items: listingData.bundle_items || listingData.bundleItems || [],
      quantity: listingData.quantity ?? null,
      status: listingData.status || "active",
      // Academic archive reference (validated as UUID by the route).
      course_id: courseId,
      ...(topicId !== undefined ? { topic_id: topicId } : {}),
      // Rights attestation state — SERVER-SET by the route / publish service
      // (services/moderation.ts listingRightsFields); the route strips any
      // client-supplied rights_* keys before they reach here. Defaults to the
      // unattested state so a plain (non-academic) listing is honest too.
      rights_status: listingData.rights_status ?? "unattested",
      rights_attested_at: listingData.rights_attested_at ?? null,
      rights_attestation_version: listingData.rights_attestation_version ?? null,
    };

    const { data, error } = await writeWithTopicFallback(
      (row) =>
        this.supabase.from("marketplace_listings").insert(row).select().single(),
      dbData,
    );

    if (error) {
      logger.error("Failed to create marketplace listing:", error);
      throw error;
    }
    return data;
  }

  async updateMarketplaceListing(
    listingId: string,
    updates: any,
    options: { actorIsAdmin?: boolean } = {},
  ): Promise<any | null> {
    // Sellers cannot edit a listing moderation took down, nor move any listing
    // along a transition the shared lifecycle table forbids (e.g. relisting a
    // removed one by smuggling status into an edit). Admin callers keep full
    // control; routes/admin.ts writes with the raw client anyway.
    if (!options.actorIsAdmin) {
      await assertSellerListingUpdateAllowed(this, listingId, updates?.status);
    }
    const dbUpdates: Record<string, unknown> = {};
    const assign = (key: string, ...sources: string[]) => {
      for (const source of sources) {
        if (updates?.[source] !== undefined) {
          dbUpdates[key] = updates[source];
          return;
        }
      }
    };

    assign("category", "category");
    assign("title", "title");
    assign("description", "description");
    assign("promo_label", "promo_label", "promoLabel");
    assign("location", "location");
    if (
      (updates?.campus_id !== undefined || updates?.campusId !== undefined) &&
      !(updates.campus_id ?? updates.campusId)
    ) {
      throw new Error("Campus or city metadata cannot be removed");
    }
    assign("campus_id", "campus_id", "campusId");
    if (
      updates?.country_code !== undefined ||
      updates?.countryCode !== undefined
    ) {
      dbUpdates.country_code = MARKETPLACE_DEFAULT_COUNTRY;
    }
    if (updates?.currency !== undefined) {
      dbUpdates.currency = MARKETPLACE_DEFAULT_CURRENCY;
    }
    if (updates?.images !== undefined) {
      dbUpdates.images = sanitizeListingImages(updates.images);
    }
    // Mass-assignment guard on category_specific_fields: strip client-supplied
    // boost/promotion keys, but preserve any existing server-owned boost state
    // so a routine edit doesn't silently wipe a paid boost.
    if (
      updates?.categorySpecificFields !== undefined ||
      updates?.category_specific_fields !== undefined
    ) {
      const clientFields = stripServerOwnedListingFields(
        updates.categorySpecificFields ?? updates.category_specific_fields,
      );
      const current = await this.getMarketplaceListingById(listingId);
      const preserved = pickServerOwnedListingFields(
        current?.category_specific_fields ??
          current?.categorySpecificFields,
      );
      dbUpdates.category_specific_fields = { ...clientFields, ...preserved };
    }
    // listing_kind is immutable after create: allowing a client to change it
    // (e.g. flip a 'single' to 'question_bank') would orphan/misroute the
    // listing. Deliberately not assigned here.
    if (
      updates?.bundle_items !== undefined ||
      updates?.bundleItems !== undefined
    ) {
      const bundleItems = updates.bundle_items ?? updates.bundleItems;
      assertValidBundleItems(bundleItems);
      dbUpdates.bundle_items = bundleItems;
    }
    if (updates?.quantity !== undefined) {
      assertValidListingQuantity(updates.quantity);
      dbUpdates.quantity = updates.quantity;
    }
    assign("status", "status");

    const touchesPricing =
      updates?.price !== undefined ||
      updates?.sale_price !== undefined ||
      updates?.salePrice !== undefined ||
      updates?.sale_ends_at !== undefined ||
      updates?.saleEndsAt !== undefined;
    if (touchesPricing) {
      const { normalizeMarketplacePricing } =
        await import("../utils/marketplacePricing");
      const current = await this.getMarketplaceListingById(listingId);
      const pricing = normalizeMarketplacePricing({
        price: updates?.price !== undefined ? updates.price : current?.price,
        sale_price:
          updates?.sale_price !== undefined || updates?.salePrice !== undefined
            ? (updates.sale_price ?? updates.salePrice)
            : current?.sale_price,
      });
      dbUpdates.price = pricing.price;
      dbUpdates.sale_price = pricing.sale_price;
      if (pricing.sale_price == null) {
        dbUpdates.sale_ends_at = null;
      } else if (
        updates?.sale_ends_at !== undefined ||
        updates?.saleEndsAt !== undefined
      ) {
        dbUpdates.sale_ends_at = updates.sale_ends_at ?? updates.saleEndsAt;
      }
    }

    if (Object.keys(dbUpdates).length === 0) {
      return this.getMarketplaceListingById(listingId);
    }

    const { data, error } = await this.supabase
      .from("marketplace_listings")
      .update(dbUpdates)
      .eq("id", listingId)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    if (updates?.status === "sold" && data?.user_id) {
      await this.maybeLogManualSoldBudget(listingId, data.user_id);
    }

    return data;
  }

  async deleteMarketplaceListing(listingId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from("marketplace_listings")
      .delete()
      .eq("id", listingId);

    if (error) throw error;
    return true;
  }

  /**
   * Delete a listing without destroying order history. marketplace_orders.listing_id
   * is ON DELETE CASCADE, so a raw delete of a listing hard-deletes every order on
   * it — including paid/completed ones with their receipts and payment evidence.
   * Guard at the application layer:
   *   - any OPEN order (money moving, pickup pending, or a dispute) → block (409)
   *   - only terminal orders (completed/cancelled) → archive the listing, keeping
   *     the rows and their receipts intact
   *   - no orders at all → hard-delete
   * Defense-in-depth at the DB layer (FK → ON DELETE RESTRICT) ships as an
   * unapplied migration.
   */
  async deleteMarketplaceListingSafely(
    listingId: string,
  ): Promise<{ outcome: "deleted" | "archived"; openOrders: number; totalOrders: number }> {
    const { data: orderRows, error } = await this.supabase
      .from("marketplace_orders")
      .select("status")
      .eq("listing_id", listingId);
    if (error) throw error;

    const rows = (orderRows || []) as Array<{ status: string }>;
    const openOrders = rows.filter((r) =>
      OPEN_ORDER_STATUSES.includes(r.status),
    ).length;

    if (openOrders > 0) {
      const err = new Error(
        `This listing has ${openOrders} active order${openOrders === 1 ? "" : "s"} in progress. Cancel or complete them before removing the listing.`,
      ) as Error & { statusCode: number };
      err.statusCode = 409;
      throw err;
    }

    if (rows.length > 0) {
      // Terminal orders exist — preserve their receipts/payment evidence by
      // archiving the listing instead of cascade-deleting.
      const { error: archiveError } = await this.supabase
        .from("marketplace_listings")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("id", listingId);
      if (archiveError) throw archiveError;
      return { outcome: "archived", openOrders: 0, totalOrders: rows.length };
    }

    await this.deleteMarketplaceListing(listingId);
    return { outcome: "deleted", openOrders: 0, totalOrders: 0 };
  }

  /**
   * Count/return new listings matching a saved search since it was last checked.
   *
   * `peek` distinguishes a badge poll (Explore opening) from a "mark as seen"
   * action. The background alerts job (marketplaceAlerts) uses last_checked_at
   * as its notification cursor, so a consuming poll would advance the watermark
   * past every new listing and the job would never notify. A peek returns the
   * same count without touching last_checked_at.
   *
   * Returns null when the saved search doesn't exist or isn't owned by the user.
   */
  async getSavedSearchMatches(
    userId: string,
    searchId: string,
    options: { peek?: boolean } = {},
  ): Promise<{ count: number; listings: any[] } | null> {
    const { data: search, error: searchErr } = await this.supabase
      .from("saved_searches")
      .select("*")
      .eq("id", searchId)
      .eq("user_id", userId)
      .single();

    if (searchErr || !search) return null;

    // Fall back to created_at when the search has never been checked — mirrors
    // the alerts job, and avoids a null comparison that would return nothing.
    const since = search.last_checked_at || search.created_at;

    let query = this.supabase
      .from("marketplace_listings")
      .select("id, title, price, images, category, location, created_at")
      .eq("status", "active")
      .gt("created_at", since);

    const f = (search.filters || {}) as Record<string, any>;
    if (f.category) query = query.eq("category", f.category);
    if (f.search)
      query = query.or(
        `title.ilike.%${f.search}%,description.ilike.%${f.search}%`,
      );
    if (f.minPrice) query = query.gte("price", f.minPrice);
    if (f.maxPrice) query = query.lte("price", f.maxPrice);
    if (f.location) query = query.ilike("location", `%${f.location}%`);

    query = query.order("created_at", { ascending: false }).limit(20);

    const { data: listings, error: listErr } = await query;
    if (listErr) throw listErr;

    if (!options.peek) {
      await this.supabase
        .from("saved_searches")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", searchId);
    }

    return { count: listings?.length || 0, listings: listings || [] };
  }

  /**
   * Verified-purchase check: a review requires a delivered order
   * (buyer_confirmed/completed) or an inquiry the seller marked purchased —
   * the legacy chat-deal path predating orders. Sellers cannot review
   * their own listings.
   */
  async canUserReviewListing(
    listingId: string,
    userId: string,
  ): Promise<{ eligible: boolean; reason?: string }> {
    const listing = await this.getMarketplaceListingById(listingId);
    if (!listing) return { eligible: false, reason: "Listing not found" };
    if (listing.user_id === userId || listing.seller_id === userId) {
      return { eligible: false, reason: "You cannot review your own listing" };
    }

    const { data: orderRows, error: orderError } = await this.supabase
      .from("marketplace_orders")
      .select("id")
      .eq("listing_id", listingId)
      .eq("buyer_id", userId)
      .in("status", ["buyer_confirmed", "completed"])
      .limit(1);
    if (orderError) throw orderError;
    if (orderRows && orderRows.length > 0) return { eligible: true };

    // Phase 2 G defect the plan called out: eligibility was order-only, so
    // somebody who acquired a FREE digital product owns it, has studied it, and
    // still could not review it — no order row ever existed. An entitlement is
    // the same proof of delivery for digital goods that a completed order is
    // for physical ones.
    const { data: entitlementRows, error: entitlementError } = await this.supabase
      .from("marketplace_question_bank_entitlements")
      .select("listing_id")
      .eq("listing_id", listingId)
      .eq("user_id", userId)
      .limit(1);
    if (entitlementError) throw entitlementError;
    if (entitlementRows && entitlementRows.length > 0) return { eligible: true };

    const { data: inquiryRows, error: inquiryError } = await this.supabase
      .from("marketplace_inquiries")
      .select("id")
      .eq("listing_id", listingId)
      .eq("buyer_id", userId)
      .eq("status", "purchased")
      .limit(1);
    if (inquiryError) throw inquiryError;
    if (inquiryRows && inquiryRows.length > 0) return { eligible: true };

    return {
      eligible: false,
      reason: "Reviews are limited to buyers who completed a purchase",
    };
  }

  async addMarketplaceReview(
    listingId: string,
    reviewerId: string,
    review: { rating: number; comment?: string },
  ): Promise<any> {
    const rating = Number(review.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      const err: any = new Error("Rating must be a whole number from 1 to 5");
      err.statusCode = 400;
      throw err;
    }
    if (review.comment != null && String(review.comment).length > 2000) {
      const err: any = new Error("Comment is too long (2000 characters max)");
      err.statusCode = 400;
      throw err;
    }

    const eligibility = await this.canUserReviewListing(listingId, reviewerId);
    if (!eligibility.eligible) {
      const err: any = new Error(
        eligibility.reason || "You are not eligible to review this listing",
      );
      err.statusCode = 403;
      throw err;
    }

    const { MARKETPLACE_REVIEW_SELECT, mapMarketplaceReviewRow } =
      await import("./marketplaceReviewMapping");
    const { data, error } = await this.supabase
      .from("marketplace_reviews")
      .upsert(
        {
          listing_id: listingId,
          reviewer_id: reviewerId,
          rating,
          comment: review.comment,
        },
        { onConflict: "listing_id,reviewer_id" },
      )
      .select(MARKETPLACE_REVIEW_SELECT)
      .single();

    if (error) throw error;

    // North-star metric (Phase 3 · O): the SELLER is the actor — their product
    // is what helped the buyer, and the review is the evidence. Note this is an
    // UPSERT, so editing a review re-runs it; the weekly unique index collapses
    // same-week edits, and an edit months later is a fresh, honest signal.
    try {
      const { data: listingRow } = await this.supabase
        .from("marketplace_listings")
        .select("user_id, course_id")
        .eq("id", listingId)
        .maybeSingle();
      const sellerId = (listingRow as { user_id?: string } | null)?.user_id;
      if (sellerId) {
        const { getLearningConnectionsService } = await import("./learningConnections");
        await getLearningConnectionsService(this).record({
          actorId: sellerId,
          beneficiaryId: reviewerId,
          kind: "review_left",
          // object_type must describe object_id. Every other writer pairs them
          // ('challenge'+challengeId, 'question'+messageId); `listingId` is a
          // listing id, so 'review' here would mislabel it.
          objectType: "listing",
          objectId: listingId,
          courseId: (listingRow as { course_id?: string | null } | null)?.course_id ?? null,
        });
      }
    } catch {
      /* metric is best-effort; the review already committed */
    }

    return mapMarketplaceReviewRow(data as any);
  }

  async getMarketplaceReviews(
    listingId: string,
    viewerId?: string,
  ): Promise<any[]> {
    const { MARKETPLACE_REVIEW_SELECT, mapMarketplaceReviewRow } =
      await import("./marketplaceReviewMapping");
    const { data, error } = await this.supabase
      .from("marketplace_reviews")
      .select(MARKETPLACE_REVIEW_SELECT)
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const reviews = (data || []).map((row: any) => mapMarketplaceReviewRow(row));
    return this.attachMarketplaceReviewSignals(listingId, reviews, viewerId);
  }

  /**
   * Decorate mapped review rows with read-time signals:
   * - verifiedPurchase: the reviewer holds one of the same proofs the write
   *   gate (canUserReviewListing) accepts — delivered order, digital
   *   entitlement, or a seller-confirmed 'purchased' inquiry.
   * - helpfulCount / viewerMarkedHelpful from marketplace_review_votes.
   * Every lookup is best-effort: a missing votes table (migration not applied
   * yet) or a failed join must never block the review list — the fields are
   * simply absent and clients hide the corresponding UI.
   */
  private async attachMarketplaceReviewSignals(
    listingId: string,
    reviews: any[],
    viewerId?: string,
  ): Promise<any[]> {
    if (reviews.length === 0) return reviews;

    const reviewIds = reviews.map((review) => review.id).filter(Boolean);
    const reviewerIds = [
      ...new Set(reviews.map((review) => review.reviewer_id).filter(Boolean)),
    ];

    let votesByReview: Map<string, number> | null = null;
    const viewerVoted = new Set<string>();
    try {
      const { data: voteRows, error: voteError } = await this.supabase
        .from("marketplace_review_votes")
        .select("review_id, voter_id")
        .in("review_id", reviewIds);
      if (voteError) throw voteError;
      votesByReview = new Map();
      for (const row of voteRows || []) {
        const reviewId = (row as any).review_id as string;
        votesByReview.set(reviewId, (votesByReview.get(reviewId) ?? 0) + 1);
        if (viewerId && (row as any).voter_id === viewerId) {
          viewerVoted.add(reviewId);
        }
      }
    } catch {
      votesByReview = null; // table missing pre-migration, or transient failure
    }

    const verifiedReviewers = new Set<string>();
    if (reviewerIds.length > 0) {
      try {
        const [orders, entitlements, inquiries] = await Promise.all([
          this.supabase
            .from("marketplace_orders")
            .select("buyer_id")
            .eq("listing_id", listingId)
            .in("buyer_id", reviewerIds)
            .in("status", ["buyer_confirmed", "completed"]),
          this.supabase
            .from("marketplace_question_bank_entitlements")
            .select("user_id")
            .eq("listing_id", listingId)
            .in("user_id", reviewerIds),
          this.supabase
            .from("marketplace_inquiries")
            .select("buyer_id")
            .eq("listing_id", listingId)
            .in("buyer_id", reviewerIds)
            .eq("status", "purchased"),
        ]);
        for (const row of orders.data || []) {
          verifiedReviewers.add((row as any).buyer_id);
        }
        for (const row of entitlements.data || []) {
          verifiedReviewers.add((row as any).user_id);
        }
        for (const row of inquiries.data || []) {
          verifiedReviewers.add((row as any).buyer_id);
        }
        return reviews.map((review) => ({
          ...review,
          verifiedPurchase: verifiedReviewers.has(review.reviewer_id),
          ...(votesByReview
            ? {
                helpfulCount: votesByReview.get(review.id) ?? 0,
                ...(viewerId
                  ? { viewerMarkedHelpful: viewerVoted.has(review.id) }
                  : {}),
              }
            : {}),
        }));
      } catch {
        // fall through: return reviews with vote data only (if any)
      }
    }

    if (!votesByReview) return reviews;
    return reviews.map((review) => ({
      ...review,
      helpfulCount: votesByReview!.get(review.id) ?? 0,
      ...(viewerId ? { viewerMarkedHelpful: viewerVoted.has(review.id) } : {}),
    }));
  }

  /**
   * Add or remove the viewer's "helpful" reaction on a review.
   * 404 unknown review, 400 self-vote, 503 while the votes table has not been
   * migrated yet (clients never show the control in that state).
   */
  async setMarketplaceReviewVote(
    listingId: string,
    reviewId: string,
    voterId: string,
    helpful: boolean,
  ): Promise<{ helpfulCount: number; viewerMarkedHelpful: boolean }> {
    const { data: review, error: reviewError } = await this.supabase
      .from("marketplace_reviews")
      .select("id, listing_id, reviewer_id")
      .eq("id", reviewId)
      .maybeSingle();
    if (reviewError) throw reviewError;
    if (!review || (review as any).listing_id !== listingId) {
      const err: any = new Error("Review not found");
      err.statusCode = 404;
      throw err;
    }
    if ((review as any).reviewer_id === voterId) {
      const err: any = new Error("You cannot mark your own review as helpful");
      err.statusCode = 400;
      throw err;
    }

    const missingTable = (error: any) =>
      error?.code === "42P01" || error?.code === "PGRST205";

    if (helpful) {
      const { error } = await this.supabase
        .from("marketplace_review_votes")
        .upsert(
          { review_id: reviewId, voter_id: voterId },
          { onConflict: "review_id,voter_id", ignoreDuplicates: true },
        );
      if (error) {
        if (missingTable(error)) {
          const err: any = new Error("Review reactions are not available yet");
          err.statusCode = 503;
          throw err;
        }
        throw error;
      }
    } else {
      const { error } = await this.supabase
        .from("marketplace_review_votes")
        .delete()
        .eq("review_id", reviewId)
        .eq("voter_id", voterId);
      if (error) {
        if (missingTable(error)) {
          const err: any = new Error("Review reactions are not available yet");
          err.statusCode = 503;
          throw err;
        }
        throw error;
      }
    }

    const { count, error: countError } = await this.supabase
      .from("marketplace_review_votes")
      .select("id", { count: "exact", head: true })
      .eq("review_id", reviewId);
    if (countError) throw countError;

    return { helpfulCount: count ?? 0, viewerMarkedHelpful: helpful };
  }

  async buyMarketplaceListingNow(
    listingId: string,
    buyerId: string,
    couponCode?: string,
    quantity?: number,
  ): Promise<{ order: Record<string, unknown>; budgetLogged?: boolean }> {
    const { getMarketplaceOrdersService } = await import("./marketplaceOrders");
    const order = await getMarketplaceOrdersService(this).createOrderFromBuyNow(
      listingId,
      buyerId,
      couponCode,
      quantity,
    );
    return { order, budgetLogged: false };
  }

  async boostMarketplaceListing(
    listingId: string,
    userId: string,
    durationHours: number = 72,
  ): Promise<any> {
    const listing = await this.getMarketplaceListingById(listingId);
    if (!listing) throw new Error("Listing not found");
    if (listing.user_id !== userId)
      throw new Error("Unauthorized: You do not own this listing");

    const existingFields =
      listing.category_specific_fields || listing.categorySpecificFields || {};
    const boostedUntil = existingFields.boosted_until as string | undefined;
    if (boostedUntil && new Date(boostedUntil) > new Date()) {
      return this.normalizeListingRecord(listing);
    }

    const { getMarketplaceSellerToolsService } =
      await import("./marketplaceSellerTools");
    await getMarketplaceSellerToolsService(this).consumeBoostCredit(userId);

    const newBoostedUntil = new Date(
      Date.now() + durationHours * 60 * 60 * 1000,
    ).toISOString();
    const categorySpecificFields = {
      ...existingFields,
      boosted_until: newBoostedUntil,
      boost_level: "standard",
    };

    const { data, error } = await this.supabase
      .from("marketplace_listings")
      .update({
        category_specific_fields: categorySpecificFields,
        updated_at: new Date().toISOString(),
      })
      .eq("id", listingId)
      .select("*")
      .single();

    if (error) throw error;
    return this.normalizeListingRecordAsync(data);
  }

  async reportMarketplaceListing(
    listingId: string,
    reporterId: string,
    report: { reason: string; details?: string },
  ): Promise<any> {
    const { normalizeMarketplaceReportReason } = await import(
      "../utils/marketplaceReportReason"
    );
    const { reason, details } = normalizeMarketplaceReportReason(
      report.reason,
      report.details,
    );

    const { data, error } = await this.supabase
      .from("marketplace_reports")
      .insert({
        listing_id: listingId,
        reporter_id: reporterId,
        reason,
        details,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async initiateMarketplaceTransaction(
    listingId: string,
    buyerId: string,
    amount: number,
    source: "buy_now" | "offer_accept" = "buy_now",
    options?: { skipBudgetLog?: boolean },
  ): Promise<any> {
    // Get listing to verify seller
    const listing = await this.getMarketplaceListingById(listingId);
    if (!listing) throw new Error("Listing not found");

    const { data, error } = await this.supabase
      .from("marketplace_transactions")
      .insert({
        buyer_id: buyerId,
        seller_id: listing.user_id,
        listing_id: listingId,
        amount,
      })
      .select()
      .single();

    if (error) throw error;

    if (!options?.skipBudgetLog) {
      await this.logMarketplaceBudgetTransactions({
        listingId,
        listingTitle: listing.title || "Marketplace item",
        amount,
        sellerId: listing.user_id,
        buyerId,
        marketplaceTransactionId: data.id,
        source,
      });
    }

    return data;
  }

  async logMarketplaceBudgetTransactions(params: {
    listingId: string;
    listingTitle: string;
    amount: number;
    sellerId: string;
    buyerId?: string;
    marketplaceTransactionId?: string;
    source: "buy_now" | "offer_accept" | "manual_sold";
  }): Promise<boolean> {
    const amount = Number(params.amount) || 0;
    if (amount <= 0 || !params.sellerId) return false;

    const date = new Date().toISOString().split("T")[0];
    const title = params.listingTitle || "Marketplace item";
    const rows: Record<string, unknown>[] = [];

    if (params.marketplaceTransactionId && params.buyerId) {
      const { purchaseTxId, saleTxId } = buildMarketplaceBudgetTxIds(
        params.marketplaceTransactionId,
      );
      rows.push(
        {
          id: purchaseTxId,
          user_id: params.buyerId,
          type: MARKETPLACE_BUDGET_TYPES.PURCHASE,
          amount,
          category: MARKETPLACE_BUDGET_CATEGORIES.PURCHASE,
          description: buildMarketplacePurchaseDescription(title),
          date,
        },
        {
          id: saleTxId,
          user_id: params.sellerId,
          type: MARKETPLACE_BUDGET_TYPES.SALE,
          amount,
          category: MARKETPLACE_BUDGET_CATEGORIES.SALE,
          description: buildMarketplaceSaleDescription(title),
          date,
        },
      );
    } else if (params.source === "manual_sold") {
      rows.push({
        id: buildManualSaleBudgetTxId(params.listingId),
        user_id: params.sellerId,
        type: MARKETPLACE_BUDGET_TYPES.SALE,
        amount,
        category: MARKETPLACE_BUDGET_CATEGORIES.SALE,
        description: buildMarketplaceSaleDescription(title),
        date,
      });
    }

    if (rows.length === 0) return false;

    const { error } = await this.supabase
      .from("budget_transactions")
      .upsert(rows, { onConflict: "id" });

    if (error) {
      logger.warn("Failed to log marketplace budget transactions", {
        error,
        source: params.source,
      });
      return false;
    }
    return true;
  }

  async maybeLogManualSoldBudget(
    listingId: string,
    sellerId: string,
  ): Promise<boolean> {
    const { data: existingTxn } = await this.supabase
      .from("marketplace_transactions")
      .select("id")
      .eq("listing_id", listingId)
      .limit(1)
      .maybeSingle();

    if (existingTxn) return false;

    const listing = await this.getMarketplaceListingById(listingId);
    if (!listing) return false;

    return this.logMarketplaceBudgetTransactions({
      listingId,
      listingTitle: listing.title || "Marketplace item",
      amount: Number(listing.price) || 0,
      sellerId,
      source: "manual_sold",
    });
  }

  async finalizeOfferAcceptSale(
    offerId: string,
    actorId?: string,
  ): Promise<{ orderId: string; budgetLogged: boolean }> {
    const { getMarketplaceOrdersService } = await import("./marketplaceOrders");
    const order = await getMarketplaceOrdersService(
      this,
    ).createOrderFromOfferAccept(offerId, actorId);
    return { orderId: order.id, budgetLogged: false };
  }

  // Get unread message count for a group for a specific user
  async getGroupUnreadCount(groupId: string, userId: string): Promise<number> {
    try {
      // Get user's last read timestamp for this group
      const { data: memberData, error: memberError } = await this.supabase
        .from("group_members")
        .select("last_read_at")
        .eq("group_id", groupId)
        .eq("user_id", userId)
        .single();

      if (memberError) {
        console.error("Error getting last_read_at:", memberError);
        return 0;
      }

      const lastReadAt = memberData?.last_read_at || new Date(0).toISOString();

      // Count messages after last read that were not sent by the user
      const { count, error: countError } = await this.supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("group_id", groupId)
        .neq("sender_id", userId)
        .is("removed_at", null)
        .eq("is_archived", false)
        .gt("timestamp", lastReadAt);

      if (countError) {
        console.error("Error counting unread messages:", countError);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error("Error in getGroupUnreadCount:", error);
      return 0;
    }
  }

  // Get unread counts for all groups a user is in - OPTIMIZED: single query instead of N+1
  async getAllGroupUnreadCounts(
    userId: string,
  ): Promise<Record<string, number>> {
    try {
      // Use batch RPC function for single-query performance
      const { data, error } = await this.supabase.rpc(
        "get_unread_counts_batch",
        { p_user_id: userId },
      );

      if (error) {
        console.error("Error in batch unread counts:", error);
        if (process.env.NODE_ENV === "production") {
          return {};
        }
        return await this.getAllGroupUnreadCountsFallback(userId);
      }

      // Convert array result to Record
      const unreadCounts: Record<string, number> = {};
      if (data && Array.isArray(data)) {
        for (const item of data) {
          unreadCounts[item.group_id] = item.unread_count || 0;
        }
      }

      return unreadCounts;
    } catch (error) {
      console.error("Error in getAllGroupUnreadCounts:", error);
      return {};
    }
  }

  // Fallback method for environments without the batch function
  private async getAllGroupUnreadCountsFallback(
    userId: string,
  ): Promise<Record<string, number>> {
    try {
      // Get all groups the user is a member of with their last_read_at
      const { data: memberships, error: memberError } = await this.supabase
        .from("group_members")
        .select("group_id, last_read_at")
        .eq("user_id", userId);

      if (memberError || !memberships) {
        console.error("Error getting memberships:", memberError);
        return {};
      }

      const unreadCounts: Record<string, number> = {};

      // For each group, count unread messages
      for (const membership of memberships) {
        const lastReadAt = membership.last_read_at || new Date(0).toISOString();

        const { count, error: countError } = await this.supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("group_id", membership.group_id)
          .neq("sender_id", userId)
          .is("removed_at", null)
          .eq("is_archived", false)
          .gt("timestamp", lastReadAt);

        if (!countError) {
          unreadCounts[membership.group_id] = count || 0;
        }
      }

      return unreadCounts;
    } catch (error) {
      console.error("Error in getAllGroupUnreadCountsFallback:", error);
      return {};
    }
  }

  // Mark group as read for a user
  async markGroupAsRead(
    groupId: string,
    userId: string,
  ): Promise<{ success: boolean; previousLastReadAt: string | null }> {
    try {
      // Capture the prior marker before overwriting so clients can scroll to first unread.
      const { data: membership, error: readError } = await this.supabase
        .from("group_members")
        .select("last_read_at, joined_at")
        .eq("group_id", groupId)
        .eq("user_id", userId)
        .maybeSingle();

      if (readError) {
        console.error(
          "Error reading group membership for mark-as-read:",
          readError,
        );
        return { success: false, previousLastReadAt: null };
      }

      const previousLastReadAt: string | null =
        membership?.last_read_at || membership?.joined_at || null;

      const { error } = await this.supabase
        .from("group_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("group_id", groupId)
        .eq("user_id", userId);

      if (error) {
        console.error("Error marking group as read:", error);
        return { success: false, previousLastReadAt };
      }

      // Invalidate cache
      cacheService.delete(`group:unread:${groupId}:${userId}`);
      cacheService.delete(`user:unread:${userId}`);

      const lastReadAt = new Date().toISOString();
      void this.broadcastChatRead(groupId, { userId, lastReadAt });

      return { success: true, previousLastReadAt };
    } catch (error) {
      console.error("Error in markGroupAsRead:", error);
      return { success: false, previousLastReadAt: null };
    }
  }

  // Get unread DM count for a thread for a specific user
  async getDMUnreadCount(threadId: string, userId: string): Promise<number> {
    try {
      // Get user's last read timestamp for this thread
      const [{ data: readStatus }, { data: threadMeta }] = await Promise.all([
        this.supabase
          .from("dm_read_status")
          .select("last_read_at")
          .eq("thread_id", threadId)
          .eq("user_id", userId)
          .maybeSingle(),
        this.supabase
          .from("dm_threads")
          .select("history_cleared_at")
          .eq("id", threadId)
          .maybeSingle(),
      ]);

      // If no read status exists, count all messages not from this user
      const lastReadAt = readStatus?.last_read_at || new Date(0).toISOString();
      const historyClearedAt = readDmHistoryClearedAt(
        threadMeta?.history_cleared_at,
        userId,
      );
      const unreadFloor = effectiveDmUnreadFloor(lastReadAt, historyClearedAt);

      // Count messages after last read (and after delete cutoff) not sent by the user
      const { count, error: countError } = await this.supabase
        .from("dm_messages")
        .select("id", { count: "exact", head: true })
        .eq("thread_id", threadId)
        .neq("sender_id", userId)
        .is("removed_at", null)
        .gt("timestamp", unreadFloor);

      if (countError) {
        console.error("Error counting unread DMs:", countError);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error("Error in getDMUnreadCount:", error);
      return 0;
    }
  }

  // Get all DM unread counts for a user - OPTIMIZED: single query instead of N+1
  async getAllDMUnreadCounts(userId: string): Promise<Record<string, number>> {
    try {
      // Use batch RPC function for single-query performance
      const { data, error } = await this.supabase.rpc(
        "get_dm_unread_counts_batch",
        { p_user_id: userId },
      );

      if (error) {
        console.error("Error in batch DM unread counts:", error);
        if (process.env.NODE_ENV === "production") {
          return {};
        }
        return await this.getAllDMUnreadCountsFallback(userId);
      }

      // Convert array result to Record of unread counts
      const unreadCounts: Record<string, number> = {};
      if (data && Array.isArray(data)) {
        for (const item of data) {
          // Calculate unread based on last_read_at vs messages
          unreadCounts[item.thread_id] = item.unread_count || 0;
        }
      }

      return unreadCounts;
    } catch (error) {
      console.error("Error in getAllDMUnreadCounts:", error);
      return {};
    }
  }

  // Fallback method for environments without the batch function
  private async getAllDMUnreadCountsFallback(
    userId: string,
  ): Promise<Record<string, number>> {
    try {
      // Get all DM threads the user is part of
      const { data: threads, error: threadError } = await this.supabase
        .from("dm_threads")
        .select("id, participant_ids");

      if (threadError || !threads) {
        console.error("Error getting DM threads:", threadError);
        return {};
      }

      // Filter to threads that include this user
      const userThreads = threads.filter((t: any) => {
        const participantIds = t.participant_ids;
        return Array.isArray(participantIds) && participantIds.includes(userId);
      });

      const unreadCounts: Record<string, number> = {};

      for (const thread of userThreads) {
        const count = await this.getDMUnreadCount(thread.id, userId);
        unreadCounts[thread.id] = count;
      }

      return unreadCounts;
    } catch (error) {
      console.error("Error in getAllDMUnreadCountsFallback:", error);
      return {};
    }
  }

  // Mark DM thread as read for a user; returns previous last_read_at for unread anchoring.
  async markDMAsRead(
    threadId: string,
    userId: string,
  ): Promise<{ success: boolean; previousLastReadAt: string | null }> {
    try {
      // Only participants may write read status for a thread.
      const { data: thread, error: threadError } = await this.supabase
        .from("dm_threads")
        .select("participant_ids")
        .eq("id", threadId)
        .single();

      const participantIds = Array.isArray(thread?.participant_ids)
        ? thread.participant_ids
        : [];
      if (threadError || !participantIds.includes(userId)) {
        console.error("markDMAsRead: user is not a participant of this thread");
        return { success: false, previousLastReadAt: null };
      }

      const { data: prior } = await this.supabase
        .from("dm_read_status")
        .select("last_read_at")
        .eq("thread_id", threadId)
        .eq("user_id", userId)
        .maybeSingle();
      const previousLastReadAt = prior?.last_read_at || null;

      const lastReadAt = new Date().toISOString();
      const { error } = await this.supabase.from("dm_read_status").upsert(
        {
          thread_id: threadId,
          user_id: userId,
          last_read_at: lastReadAt,
        },
        { onConflict: "thread_id,user_id" },
      );

      if (error) {
        console.error("Error marking DM as read:", error);
        return { success: false, previousLastReadAt };
      }

      void this.broadcastChatRead(threadId, { userId, lastReadAt });

      return { success: true, previousLastReadAt };
    } catch (error) {
      console.error("Error in markDMAsRead:", error);
      return { success: false, previousLastReadAt: null };
    }
  }

  // "Delete for me": hide from inbox (hidden_by) and set a history cutoff so
  // pre-delete messages never resurface for this user. The other participant
  // keeps their full history; marketplace inquiry FKs are preserved.
  // A new message clears hidden_by (thread resurrects) but keeps history_cleared_at.
  async deleteDmThread(threadId: string, userId: string): Promise<boolean> {
    try {
      // Verify the user is a participant of this thread
      const { data: thread, error: fetchError } = await this.supabase
        .from("dm_threads")
        .select("participant_ids, hidden_by, history_cleared_at")
        .eq("id", threadId)
        .single();

      if (fetchError || !thread) {
        console.error("DM thread not found:", fetchError);
        return false;
      }

      const participantIds = Array.isArray(thread.participant_ids)
        ? thread.participant_ids
        : [];
      if (!participantIds.includes(userId)) {
        console.error("User is not a participant of this DM thread");
        return false;
      }

      const hiddenBy: string[] = Array.isArray(thread.hidden_by)
        ? thread.hidden_by
        : [];
      const clearedAt = new Date().toISOString();
      const nextHiddenBy = hiddenBy.includes(userId)
        ? hiddenBy
        : [...hiddenBy, userId];
      const nextHistoryClearedAt = withDmHistoryClearedAt(
        thread.history_cleared_at,
        userId,
        clearedAt,
      );

      const { error: updateError } = await this.supabase
        .from("dm_threads")
        .update({
          hidden_by: nextHiddenBy,
          history_cleared_at: nextHistoryClearedAt,
        })
        .eq("id", threadId);

      if (updateError) {
        console.error("Error hiding DM thread:", updateError);
        return false;
      }

      // Anchor read cursor at delete time so unread math cannot revive old rows
      // before history_cleared_at is applied everywhere.
      await this.supabase.from("dm_read_status").upsert(
        {
          thread_id: threadId,
          user_id: userId,
          last_read_at: clearedAt,
        },
        { onConflict: "thread_id,user_id" },
      );

      return true;
    } catch (error) {
      console.error("Error in deleteDmThread:", error);
      return false;
    }
  }

  // Archive a DM thread for a specific user
  async archiveDmThread(threadId: string, userId: string): Promise<boolean> {
    try {
      const { data: thread, error: fetchError } = await this.supabase
        .from("dm_threads")
        .select("participant_ids, archived_by")
        .eq("id", threadId)
        .single();

      if (fetchError || !thread) {
        console.error("DM thread not found:", fetchError);
        return false;
      }

      const participantIds = Array.isArray(thread.participant_ids)
        ? thread.participant_ids
        : [];
      if (!participantIds.includes(userId)) {
        console.error("User is not a participant of this DM thread");
        return false;
      }

      const archivedBy = Array.isArray(thread.archived_by)
        ? thread.archived_by
        : [];
      if (archivedBy.includes(userId)) return true; // Already archived

      const { error } = await this.supabase
        .from("dm_threads")
        .update({ archived_by: [...archivedBy, userId] })
        .eq("id", threadId);

      if (error) {
        console.error("Error archiving DM thread:", error);
        return false;
      }
      return true;
    } catch (error) {
      console.error("Error in archiveDmThread:", error);
      return false;
    }
  }

  // Unarchive a DM thread for a specific user
  async unarchiveDmThread(threadId: string, userId: string): Promise<boolean> {
    try {
      const { data: thread, error: fetchError } = await this.supabase
        .from("dm_threads")
        .select("archived_by")
        .eq("id", threadId)
        .single();

      if (fetchError || !thread) {
        console.error("DM thread not found:", fetchError);
        return false;
      }

      const archivedBy = Array.isArray(thread.archived_by)
        ? thread.archived_by
        : [];
      const { error } = await this.supabase
        .from("dm_threads")
        .update({
          archived_by: archivedBy.filter((id: string) => id !== userId),
        })
        .eq("id", threadId);

      if (error) {
        console.error("Error unarchiving DM thread:", error);
        return false;
      }
      return true;
    } catch (error) {
      console.error("Error in unarchiveDmThread:", error);
      return false;
    }
  }

  async isChatMuted(
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("chat_mutes")
      .select("muted_until")
      .eq("user_id", userId)
      .eq("scope_type", scopeType)
      .eq("scope_id", scopeId)
      .maybeSingle();
    if (error || !data?.muted_until) return false;
    return new Date(data.muted_until).getTime() > Date.now();
  }

  async getChatMute(
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
  ): Promise<{ muted: boolean; mutedUntil: string | null }> {
    const { data, error } = await this.supabase
      .from("chat_mutes")
      .select("muted_until")
      .eq("user_id", userId)
      .eq("scope_type", scopeType)
      .eq("scope_id", scopeId)
      .maybeSingle();
    if (error || !data?.muted_until) {
      return { muted: false, mutedUntil: null };
    }
    const mutedUntil = data.muted_until as string;
    const muted = new Date(mutedUntil).getTime() > Date.now();
    if (!muted) {
      // Opportunistically clean expired rows.
      void this.supabase
        .from("chat_mutes")
        .delete()
        .eq("user_id", userId)
        .eq("scope_type", scopeType)
        .eq("scope_id", scopeId);
      return { muted: false, mutedUntil: null };
    }
    return { muted: true, mutedUntil };
  }

  private async assertChatMuteAccess(
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
  ): Promise<boolean> {
    if (scopeType === "group") {
      const { data, error } = await this.supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", scopeId)
        .eq("user_id", userId)
        .eq("pending", false)
        .maybeSingle();
      return !error && !!data;
    }
    const { data, error } = await this.supabase
      .from("dm_threads")
      .select("participant_ids")
      .eq("id", scopeId)
      .maybeSingle();
    if (error || !data) return false;
    const pids = Array.isArray(data.participant_ids)
      ? data.participant_ids
      : [];
    return pids.includes(userId);
  }

  async setChatMute(
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
    mutedUntil: Date,
  ): Promise<{ muted: boolean; mutedUntil: string } | null> {
    const allowed = await this.assertChatMuteAccess(userId, scopeType, scopeId);
    if (!allowed) return null;
    if (
      !(mutedUntil instanceof Date) ||
      Number.isNaN(mutedUntil.getTime()) ||
      mutedUntil.getTime() <= Date.now()
    ) {
      return null;
    }
    const untilIso = mutedUntil.toISOString();
    const { data, error } = await this.supabase
      .from("chat_mutes")
      .upsert(
        {
          user_id: userId,
          scope_type: scopeType,
          scope_id: scopeId,
          muted_until: untilIso,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,scope_type,scope_id" },
      )
      .select("muted_until")
      .single();
    if (error || !data) {
      logger.error("Failed to set chat mute", {
        error,
        userId,
        scopeType,
        scopeId,
      });
      return null;
    }
    return { muted: true, mutedUntil: data.muted_until as string };
  }

  async clearChatMute(
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
  ): Promise<boolean> {
    const allowed = await this.assertChatMuteAccess(userId, scopeType, scopeId);
    if (!allowed) return false;
    const { error } = await this.supabase
      .from("chat_mutes")
      .delete()
      .eq("user_id", userId)
      .eq("scope_type", scopeType)
      .eq("scope_id", scopeId);
    if (error) {
      logger.error("Failed to clear chat mute", {
        error,
        userId,
        scopeType,
        scopeId,
      });
      return false;
    }
    return true;
  }

  // ============ MARKETPLACE SELLER DASHBOARD METHODS ============

  // Get listings by seller (for seller dashboard)
  async getListingsBySeller(
    userId: string,
    status?: string,
  ): Promise<any[]> {
    // No course/topic filter here: the seller dashboard (/marketplace/my-listings)
    // only ever narrows by status. No client sends courseId/topicId, so the
    // archive-filter plumbing that once lived here was unreachable and removed.
    let query = this.supabase
      .from("marketplace_listings")
      .select(
        `
        *,
        favorites_count:marketplace_favorites(count),
        inquiries_count:marketplace_inquiries(count)
      `,
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (status === "active") {
      // Active shelf includes reserved (sale in progress) for seller inventory.
      query = query.in("status", ["active", "reserved"]);
    } else if (status === "inactive") {
      // The Inactive shelf also holds listings moderation took down, so a
      // takedown is visible (read-only) to the seller instead of vanishing.
      query = query.in("status", [
        "inactive",
        ...MARKETPLACE_MODERATED_LISTING_STATUSES,
      ]);
    } else if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      logger.error("Error fetching seller listings:", error);
      throw error;
    }

    const mapped = (data || []).map((listing) => ({
      ...listing,
      favorites_count: listing.favorites_count?.[0]?.count || 0,
      inquiries_count: listing.inquiries_count?.[0]?.count || 0,
    }));
    // Grid cards only need the first image; prefer upload-time thumbs.
    return this.toListingCardRecords(mapped);
  }

  /** Sign similar-listing rails with thumb-or-original for the first image. */
  async signSimilarListingCards(listings: any[]): Promise<any[]> {
    return this.toListingCardRecords(listings || []);
  }

  // Update listing status (active, inactive, sold)
  async updateListingStatus(
    listingId: string,
    status: string,
    userId: string,
  ): Promise<any> {
    // Verify ownership
    const { data: listing } = await this.supabase
      .from("marketplace_listings")
      .select("user_id, status, title")
      .eq("id", listingId)
      .single();

    if (!listing || listing.user_id !== userId) {
      throw new Error("Unauthorized: You do not own this listing");
    }

    const previousStatus = listing.status;

    // Seller-side transitions are limited to the shared lifecycle table: a
    // listing moderation removed/suspended, one held by an open order, or an
    // archived one cannot be flipped back to active (or anywhere) from here.
    if (!isMarketplaceListingStatus(status)) {
      throw listingStateError("Unknown listing status", 400);
    }
    if (isMarketplaceListingStatus(previousStatus)) {
      const refusal = sellerListingTransitionError(previousStatus, status);
      if (refusal) throw listingStateError(refusal, 403);
    }

    const { data, error } = await this.supabase
      .from("marketplace_listings")
      .update({ status })
      .eq("id", listingId)
      .select()
      .single();

    if (error) throw error;

    if (status === "sold") {
      await this.maybeLogManualSoldBudget(listingId, userId);
    }

    if (status === "active" && previousStatus !== "active") {
      const { notifyListingBackAvailable } =
        await import("./marketplaceFavoriteAlerts");
      await notifyListingBackAvailable(
        this,
        { id: listingId, user_id: userId, title: data.title || listing.title },
        previousStatus,
      );
    }

    return data;
  }

  /**
   * Count at most one view per registered viewer (never anonymous / owner /
   * repeat opens). Returns true only when views_count was actually bumped.
   */
  async incrementListingViews(
    listingId: string,
    viewerId?: string | null,
  ): Promise<boolean> {
    if (!viewerId) return false;
    try {
      const { data, error } = await this.supabase.rpc("increment_listing_views", {
        listing_id: listingId,
        viewer_id: viewerId,
      });
      if (error) {
        logger.warn("Unique listing view RPC failed", {
          listingId,
          viewerId,
          error: error.message,
        });
        return false;
      }
      return data === true;
    } catch (err) {
      logger.error("Failed to increment listing views", {
        listingId,
        viewerId,
        error: err,
      });
      return false;
    }
  }

  // Get seller stats
  async getSellerStats(userId: string): Promise<{
    totalListings: number;
    activeListings: number;
    soldListings: number;
    completedOrders: number;
    totalViews: number;
    totalInquiries: number;
    totalFavorites: number;
  }> {
    const [listingsRes, ordersRes] = await Promise.all([
      this.supabase
        .from("marketplace_listings")
        .select(
          `
          id,
          status,
          views_count,
          favorites:marketplace_favorites(count),
          inquiries:marketplace_inquiries(count)
        `,
        )
        .eq("user_id", userId),
      this.supabase
        .from("marketplace_orders")
        .select("id", { count: "exact", head: true })
        .eq("seller_id", userId)
        .eq("status", "completed"),
    ]);

    const { data: listings, error } = listingsRes;
    if (error) throw error;
    if (ordersRes.error) throw ordersRes.error;

    return {
      totalListings: listings?.length || 0,
      activeListings:
        listings?.filter((l) => l.status === "active" || l.status === "reserved")
          .length || 0,
      soldListings: listings?.filter((l) => l.status === "sold").length || 0,
      completedOrders: ordersRes.count || 0,
      totalViews:
        listings?.reduce((sum, l) => sum + (l.views_count || 0), 0) || 0,
      totalInquiries:
        listings?.reduce((sum, l) => sum + (l.inquiries?.[0]?.count || 0), 0) ||
        0,
      totalFavorites:
        listings?.reduce((sum, l) => sum + (l.favorites?.[0]?.count || 0), 0) ||
        0,
    };
  }

  // ============ MARKETPLACE FAVORITES METHODS ============

  // Add listing to favorites
  async addFavorite(userId: string, listingId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from("marketplace_favorites")
      .insert({ user_id: userId, listing_id: listingId })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        // Already favorited
        return { alreadyExists: true };
      }
      throw error;
    }
    return data;
  }

  // Remove listing from favorites
  async removeFavorite(userId: string, listingId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from("marketplace_favorites")
      .delete()
      .eq("user_id", userId)
      .eq("listing_id", listingId);

    if (error) throw error;
    return true;
  }

  // Get user's favorites
  async getUserFavorites(userId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from("marketplace_favorites")
      .select(
        `
        id,
        created_at,
        listing:marketplace_listings(
          *,
          profiles!user_id(id, name, avatar_url)
        )
      `,
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data || []).map((favorite: any) =>
      this.normalizeFavoriteRecord(favorite),
    );
  }

  // Check if listing is favorited by user
  async isListingFavorited(
    userId: string,
    listingId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("marketplace_favorites")
      .select("id")
      .eq("user_id", userId)
      .eq("listing_id", listingId)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return !!data;
  }

  // ============ MARKETPLACE INQUIRIES METHODS ============

  // Create an inquiry (when buyer contacts seller about a listing)
  async createInquiry(
    listingId: string,
    buyerId: string,
    sellerId: string,
    dmThreadId: string,
    initialMessage: string,
  ): Promise<any> {
    // marketplace_inquiries.dm_thread_id FK requires dm_threads(id) first.
    // Contact-seller used to insert the inquiry before sendDirectMessage upserted the thread → 500.
    const sortedIds = [buyerId, sellerId].sort();
    const { error: threadError } = await this.supabase
      .from("dm_threads")
      .upsert(
        {
          id: dmThreadId,
          participant_ids: sortedIds,
          participants: {},
          last_message: initialMessage,
          last_message_time: new Date().toISOString(),
          status: "open",
          requested_by: null,
        },
        { onConflict: "id" },
      );
    if (threadError) {
      logger.error("Error ensuring DM thread for marketplace inquiry", {
        error: threadError,
        dmThreadId,
      });
      throw new Error(`Failed to create DM thread: ${threadError.message}`);
    }

    const { data, error } = await this.supabase
      .from("marketplace_inquiries")
      .insert({
        listing_id: listingId,
        buyer_id: buyerId,
        seller_id: sellerId,
        dm_thread_id: dmThreadId,
        initial_message: initialMessage,
        status: "open",
      })
      .select(
        `
        *,
        listing:marketplace_listings(*),
        buyer:profiles!buyer_id(id, name, avatar_url),
        seller:profiles!seller_id(id, name, avatar_url)
      `,
      )
      .single();

    if (error) {
      if (error.code === "23505") {
        // Inquiry already exists, return it
        return this.getInquiryByListingAndBuyer(listingId, buyerId);
      }
      throw error;
    }
    return this.stripInquiryListingModeration(data);
  }

  // Get inquiry by listing and buyer
  async getInquiryByListingAndBuyer(
    listingId: string,
    buyerId: string,
  ): Promise<any> {
    const { data, error } = await this.supabase
      .from("marketplace_inquiries")
      .select(
        `
        *,
        listing:marketplace_listings(*),
        buyer:profiles!buyer_id(id, name, avatar_url),
        seller:profiles!seller_id(id, name, avatar_url)
      `,
      )
      .eq("listing_id", listingId)
      .eq("buyer_id", buyerId)
      .maybeSingle();

    if (error) throw error;
    return this.stripInquiryListingModeration(data);
  }

  /**
   * The inquiry embeds the whole listing row (`marketplace_listings(*)`), which
   * would carry the owner/admin-only rights/takedown/appeal columns to the
   * buyer. Strip them from the embed; the inquiry itself is untouched.
   */
  private stripInquiryListingModeration<T extends { listing?: unknown } | null>(inquiry: T): T {
    if (!inquiry || typeof inquiry !== "object") return inquiry;
    const listing = (inquiry as { listing?: unknown }).listing;
    if (!listing || typeof listing !== "object") return inquiry;
    return {
      ...(inquiry as Record<string, unknown>),
      listing: Array.isArray(listing)
        ? listing.map((row) => stripListingModerationFields(row as Record<string, unknown>))
        : stripListingModerationFields(listing as Record<string, unknown>),
    } as T;
  }

  // Get seller's inquiries
  async getSellerInquiries(sellerId: string, status?: string): Promise<any[]> {
    let query = this.supabase
      .from("marketplace_inquiries")
      .select(
        `
        *,
        listing:marketplace_listings(id, title, price, images, status),
        buyer:profiles!buyer_id(id, name, avatar_url)
      `,
      )
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((inquiry: any) =>
      this.normalizeInquiryRecord(inquiry),
    );
  }

  // Get buyer's inquiries
  async getBuyerInquiries(buyerId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from("marketplace_inquiries")
      .select(
        `
        *,
        listing:marketplace_listings(id, title, price, images, status),
        seller:profiles!seller_id(id, name, avatar_url)
      `,
      )
      .eq("buyer_id", buyerId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data || []).map((inquiry: any) =>
      this.normalizeInquiryRecord(inquiry),
    );
  }

  // Update inquiry status
  async updateInquiryStatus(
    inquiryId: string,
    status: string,
    userId: string,
  ): Promise<any> {
    // Verify user is participant
    const { data: inquiry } = await this.supabase
      .from("marketplace_inquiries")
      .select("buyer_id, seller_id")
      .eq("id", inquiryId)
      .single();

    if (
      !inquiry ||
      (inquiry.buyer_id !== userId && inquiry.seller_id !== userId)
    ) {
      const err = new Error("Inquiry not found");
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }

    // Only the seller may attest a purchase. canUserReviewListing treats an
    // inquiry the seller marked 'purchased' as verified-purchase evidence, so a
    // buyer flipping their own inquiry to 'purchased' could self-mint a fake
    // "verified purchase" review without ever buying. Buyers may still move an
    // inquiry through open/negotiating/closed.
    if (status === "purchased" && inquiry.seller_id !== userId) {
      const err = new Error(
        "Only the seller can mark an inquiry as purchased",
      );
      (err as Error & { statusCode?: number }).statusCode = 403;
      throw err;
    }

    const { data, error } = await this.supabase
      .from("marketplace_inquiries")
      .update({ status })
      .eq("id", inquiryId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Get inquiry by DM thread
  async getInquiryByThread(threadId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from("marketplace_inquiries")
      .select(
        `
        *,
        listing:marketplace_listings(id, title, price, images, status, user_id)
      `,
      )
      .eq("dm_thread_id", threadId)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data ? this.normalizeInquiryRecord(data) : data;
  }

  // ============ MARKETPLACE NOTIFICATIONS ============

  // Create notification for new inquiry
  async createInquiryNotification(
    sellerId: string,
    buyerName: string,
    listingTitle: string,
    inquiryId: string,
  ): Promise<void> {
    await this.createNotification(sellerId, {
      type: "marketplace_inquiry",
      message: `${buyerName} is interested in your listing "${listingTitle}"`,
      link: `/marketplace/inquiries/${inquiryId}`,
    });
  }

  // Create notification for listing purchase
  async createPurchaseNotification(
    sellerId: string,
    buyerName: string,
    listingTitle: string,
    transactionId: string,
  ): Promise<void> {
    await this.createNotification(sellerId, {
      type: "marketplace_purchase",
      message: `${buyerName} purchased your listing "${listingTitle}"`,
      link: `/marketplace/transactions/${transactionId}`,
    });
  }

  // ============ CUSTOM CATEGORIES ============

  async getCustomCategories(): Promise<any[]> {
    const { data, error } = await this.supabase
      .from("custom_categories")
      .select("*")
      .order("usage_count", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async createCustomCategory(name: string, userId: string): Promise<any> {
    // Upsert: if name exists, return existing
    const { data: existing } = await this.supabase
      .from("custom_categories")
      .select("*")
      .eq("name", name)
      .single();

    if (existing) return existing;

    const { data, error } = await this.supabase
      .from("custom_categories")
      .insert({ name, created_by: userId })
      .select()
      .single();

    if (error) {
      // Handle race condition: another insert happened between select and insert
      if (error.code === "23505") {
        const { data: raceData } = await this.supabase
          .from("custom_categories")
          .select("*")
          .eq("name", name)
          .single();
        return raceData;
      }
      throw error;
    }
    return data;
  }

  async incrementCategoryUsage(categoryName: string): Promise<void> {
    // Increment usage_count by 1 for the given category
    const { data } = await this.supabase
      .from("custom_categories")
      .select("usage_count")
      .eq("name", categoryName)
      .single();

    if (data) {
      await this.supabase
        .from("custom_categories")
        .update({ usage_count: (data.usage_count || 0) + 1 })
        .eq("name", categoryName);
    }
  }

  // ============ USER PREFERENCES ============

  async getUserPreferences(userId: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows returned
      logger.error("Error fetching user preferences", { userId, error });
      throw error;
    }

    return data;
  }

  async upsertUserPreferences(
    userId: string,
    prefs: { theme?: string; preferences?: Record<string, any> },
  ): Promise<any> {
    const { data, error } = await this.supabase
      .from("user_preferences")
      .upsert(
        {
          user_id: userId,
          theme: prefs.theme || "light",
          preferences: prefs.preferences || {},
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id",
        },
      )
      .select()
      .single();

    if (error) {
      logger.error("Error upserting user preferences", { userId, error });
      throw error;
    }

    return data;
  }

  // ─── Course topics (Phase 1 · A) ──────────────────────────────

  /**
   * The topic to store on an artefact, validated against the course the row
   * will END UP with — not the one in the request body. Returns undefined for
   * "leave topic_id alone", so a write before the migration never names the
   * column at all.
   */
  async resolveArtefactTopic(input: {
    /** undefined = the write does not mention a topic. */
    topicId?: unknown;
    /** undefined = the write does not change the course. */
    courseId?: unknown;
    /** The row's course before this write; omit on create — nothing to orphan. */
    currentCourseId?: string | null;
  }): Promise<string | null | undefined> {
    const { topicId, courseId, currentCourseId } = input;

    if (topicId === undefined) {
      // A patch that moves the artefact to another course (or unfiles it) must
      // take the topic with it: a topic outliving its course is exactly the
      // orphan the invariant forbids.
      const movedCourse =
        courseId !== undefined &&
        currentCourseId !== undefined &&
        String(courseId ?? "") !== String(currentCourseId ?? "");
      return movedCourse ? null : undefined;
    }
    if (topicId === null || topicId === "") return null;

    const effectiveCourseId =
      courseId !== undefined
        ? typeof courseId === "string" && courseId
          ? courseId
          : null
        : (currentCourseId ?? null);
    return getCourseTopicsService(this).resolveForArtefact(
      topicId,
      effectiveCourseId,
    );
  }

  /**
   * Same, for a PATCH: reads the row's current course (the only way to know
   * what it ends up with) and only when the answer depends on it.
   */
  private async resolveArtefactTopicPatch(
    table: string,
    id: string,
    updates: { topicId?: unknown; courseId?: unknown },
  ): Promise<string | null | undefined> {
    if (updates.topicId === undefined && updates.courseId === undefined) {
      return undefined;
    }
    return this.resolveArtefactTopic({
      topicId: updates.topicId,
      courseId: updates.courseId,
      currentCourseId: await this.currentArtefactCourseId(table, id),
    });
  }

  /** The artefact's course as stored today; null when it has none (or is gone). */
  private async currentArtefactCourseId(
    table: string,
    id: string,
  ): Promise<string | null> {
    // supabase-js RESOLVES on a Postgres error, so an unchecked read here would
    // report "this artefact has no course" for a transient failure — which both
    // rejects a valid topic and silently CLEARS an existing one on a patch that
    // merely re-sends the same course. Fail the write instead of guessing.
    const { data, error } = await this.supabase
      .from(table)
      .select("course_id")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as { course_id?: string | null } | null)?.course_id ?? null;
  }

  // ─── Notes ───────────────────────────────────────────────────

  private mapNote(
    row: any,
    extras?: {
      accessRole?: "owner" | "editor" | "viewer" | "group_member";
      owner?: {
        id: string;
        name?: string;
        username?: string;
        avatarUrl?: string;
      };
    },
  ) {
    return {
      id: row.id,
      userId: row.user_id,
      folderId: row.folder_id || undefined,
      groupId: row.group_id || undefined,
      courseId: row.course_id ?? null,
      studySetId: row.study_set_id ?? null,
      ...topicIdOf(row),
      title: row.title,
      body: row.body || "",
      summary: row.summary || undefined,
      sourceType: row.source_type || "typed",
      youtubeUrl: row.youtube_url || undefined,
      youtubeVideoId: row.youtube_video_id || undefined,
      isShared: row.is_shared || false,
      // Intentionally omit dormant plaintext share_token (secure links use note_share_links).
      copiedFromNoteId: row.copied_from_note_id || undefined,
      isArchived: Boolean(row.is_archived),
      isPinned: Boolean(row.is_pinned),
      pinnedAt: row.pinned_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version:
        typeof row.version === "number"
          ? row.version
          : Number(row.version) || 1,
      accessRole: extras?.accessRole,
      owner: extras?.owner,
    };
  }

  /**
   * Canonical note access resolver for read/list/mutation gates.
   * Roles: owner > editor > viewer > group_member.
   */
  async resolveNoteAccess(
    noteId: string,
    userId: string,
  ): Promise<{
    noteId: string;
    ownerId: string;
    accessRole: "owner" | "editor" | "viewer" | "group_member";
    canEdit: boolean;
    isOwner: boolean;
    groupId?: string;
  } | null> {
    const { data, error } = await this.supabase
      .from("notes")
      .select("id, user_id, group_id")
      .eq("id", noteId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    if (data.user_id === userId) {
      return {
        noteId: data.id,
        ownerId: data.user_id,
        accessRole: "owner",
        canEdit: true,
        isOwner: true,
        groupId: data.group_id || undefined,
      };
    }

    const { data: collab } = await this.supabase
      .from("note_collaborators")
      .select("role")
      .eq("note_id", noteId)
      .eq("user_id", userId)
      .maybeSingle();

    if (collab?.role === "editor" || collab?.role === "owner") {
      return {
        noteId: data.id,
        ownerId: data.user_id,
        accessRole: "editor",
        canEdit: true,
        isOwner: false,
        groupId: data.group_id || undefined,
      };
    }
    if (collab?.role === "viewer") {
      return {
        noteId: data.id,
        ownerId: data.user_id,
        accessRole: "viewer",
        canEdit: false,
        isOwner: false,
        groupId: data.group_id || undefined,
      };
    }

    if (data.group_id) {
      const { data: member } = await this.supabase
        .from("group_members")
        .select("user_id, pending")
        .eq("group_id", data.group_id)
        .eq("user_id", userId)
        .eq("pending", false)
        .maybeSingle();
      if (member) {
        return {
          noteId: data.id,
          ownerId: data.user_id,
          accessRole: "group_member",
          canEdit: false,
          isOwner: false,
          groupId: data.group_id,
        };
      }
    }

    return null;
  }

  async isNoteOwner(userId: string, noteId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("notes")
      .select("user_id")
      .eq("id", noteId)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data && data.user_id === userId);
  }

  private async getNoteOwnerPresentation(ownerId: string) {
    const { data } = await this.supabase
      .from("profiles")
      .select("id, name, username, avatar_url")
      .eq("id", ownerId)
      .maybeSingle();
    if (!data) return { id: ownerId };
    return {
      id: data.id,
      name: data.name || undefined,
      username: data.username || undefined,
      avatarUrl: data.avatar_url || undefined,
    };
  }

  private mapNoteFolder(row: any) {
    return {
      id: row.id,
      userId: row.user_id,
      groupId: row.group_id || undefined,
      parentId: row.parent_id || undefined,
      courseId: row.course_id ?? null,
      name: row.name,
      color: row.color || "#6366f1",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getNoteFolders(userId: string) {
    const { data, error } = await this.supabase
      .from("note_folders")
      .select("*")
      .eq("user_id", userId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data || []).map((row: any) => this.mapNoteFolder(row));
  }

  // A folder carries no topic: notes/decks/test sessions are what get filed
  // under a syllabus topic, and nothing reads note_folders.topic_id.
  async createNoteFolder(
    userId: string,
    payload: {
      name: string;
      color?: string;
      groupId?: string;
      parentId?: string;
      courseId?: string | null;
    },
  ) {
    const { data, error } = await this.supabase
      .from("note_folders")
      .insert({
        user_id: userId,
        name: payload.name,
        color: payload.color || "#6366f1",
        group_id: payload.groupId || null,
        parent_id: payload.parentId || null,
        course_id: payload.courseId || null,
      })
      .select()
      .single();
    if (error) throw error;
    return this.mapNoteFolder(data);
  }

  async updateNoteFolder(
    userId: string,
    folderId: string,
    updates: {
      name?: string;
      color?: string;
      courseId?: string | null;
    },
  ) {
    const { courseId, ...rest } = updates;
    const dbUpdates: Record<string, unknown> = {
      ...rest,
      updated_at: new Date().toISOString(),
    };
    if (courseId !== undefined) dbUpdates.course_id = courseId || null;
    const { data, error } = await this.supabase
      .from("note_folders")
      .update(dbUpdates)
      .eq("id", folderId)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw error;
    return this.mapNoteFolder(data);
  }

  async deleteNoteFolder(userId: string, folderId: string) {
    const { error } = await this.supabase
      .from("note_folders")
      .delete()
      .eq("id", folderId)
      .eq("user_id", userId);
    if (error) throw error;
    return true;
  }

  async getNotes(
    userId: string,
    options?: {
      folderId?: string;
      groupId?: string;
      archived?: boolean;
      /** Academic archive filter (notes.course_id): unfiled → IS NULL, course → eq. */
      courseFilter?: CourseFilter;
      /** Same, one level down (notes.topic_id): unfiled → no topic in that course. */
      topicFilter?: CourseFilter;
    },
  ) {
    const buildOwnedQuery = (withTopic: boolean) => {
      let query = this.supabase
        .from("notes")
        .select("*")
        .eq("user_id", userId)
        .order("is_pinned", { ascending: false })
        .order("updated_at", { ascending: false });

      if (options?.folderId) query = query.eq("folder_id", options.folderId);
      if (options?.groupId) query = query.eq("group_id", options.groupId);
      query = applyCourseFilter(query, "course_id", options?.courseFilter);
      if (withTopic) {
        query = applyCourseFilter(query, "topic_id", options?.topicFilter);
      }
      if (options?.archived === true) query = query.eq("is_archived", true);
      else if (options?.archived === false) query = query.eq("is_archived", false);
      return query;
    };

    // A topic filter narrows to one course's shelf just like a course filter.
    const courseFiltered =
      options?.courseFilter?.kind === "course" ||
      options?.courseFilter?.kind === "unfiled" ||
      topicFilterApplies(options?.topicFilter);

    // Annotated because the two builds project different columns; keep it an
    // array type so the mapped rows below stay inferable.
    let { data: ownedRows, error: ownedError }: { data: any[] | null; error: any } =
      await buildOwnedQuery(true);
    if (
      ownedError &&
      topicFilterApplies(options?.topicFilter) &&
      isMissingTopicColumn(ownedError)
    ) {
      // No note can carry a topic before the migration: a named topic matches
      // nothing, and "no topic" matches every note.
      if (options?.topicFilter?.kind === "course") return [];
      ({ data: ownedRows, error: ownedError } = await buildOwnedQuery(false));
    }
    if (ownedError) throw ownedError;

    // Notes moderation removed (notes.removed_by_admin_at, migration
    // 20260822140000) disappear from the list for everyone but admins. Filtered
    // in JS rather than .is(...) so the query still works before the column
    // exists.
    const owned = (ownedRows || [])
      .filter((row: any) => !row?.removed_by_admin_at)
      .map((row: any) => this.mapNote(row, { accessRole: "owner" }));

    // Folder/group/course filtered lists stay owned-only (shared notes keep owner's placement).
    if (options?.folderId || options?.groupId || courseFiltered) {
      return this.attachNoteSearchText(owned);
    }

    const { data: collabRows, error: collabError } = await this.supabase
      .from("note_collaborators")
      .select("note_id, role, notes(*)")
      .eq("user_id", userId);
    if (collabError) throw collabError;

    const ownedIds = new Set(owned.map((n) => n.id));
    const ownerIds = Array.from(
      new Set(
        (collabRows || [])
          .map((row: any) => row.notes?.user_id)
          .filter(
            (id: unknown): id is string =>
              typeof id === "string" && id !== userId,
          ),
      ),
    );
    const ownerMap = new Map<
      string,
      { id: string; name?: string; username?: string; avatarUrl?: string }
    >();
    await Promise.all(
      ownerIds.map(async (ownerId) => {
        ownerMap.set(ownerId, await this.getNoteOwnerPresentation(ownerId));
      }),
    );

    const shared = (collabRows || [])
      .filter((row: any) => {
        if (!row.notes || ownedIds.has(row.notes.id)) return false;
        if (row.notes.removed_by_admin_at) return false;
        if (options?.archived === true) return Boolean(row.notes.is_archived);
        if (options?.archived === false) return !row.notes.is_archived;
        return true;
      })
      .map((row: any) => {
        const role =
          row.role === "editor" || row.role === "owner"
            ? ("editor" as const)
            : ("viewer" as const);
        return this.mapNote(row.notes, {
          accessRole: role,
          owner: ownerMap.get(row.notes.user_id) || { id: row.notes.user_id },
        });
      });

    const sorted = [...owned, ...shared].sort((a, b) => {
      const pinDelta = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
      if (pinDelta !== 0) return pinDelta;
      return (
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    });
    return this.attachNoteSearchText(sorted);
  }

  /**
   * Imported notes (PDF/slides/photos/YouTube/audio) store their content in
   * attachment `extracted_text`, not in `body` — so the client's title+body
   * search never matches them. Attach a capped, concatenated copy of that text
   * as `searchText` for notes whose body is empty (the unsearchable set), so the
   * client filter can match on it. Only empty-body notes are read here to keep
   * both the DB read and the list payload small: notes with a typed body are
   * already searchable by that body and gain no coverage worth the bloat.
   */
  private async attachNoteSearchText<T extends { id: string; body?: string; searchText?: string }>(
    notes: T[],
  ): Promise<T[]> {
    const NOTE_SEARCH_TEXT_MAX_CHARS = 2000;
    const importedIds = notes
      .filter((n) => !n.body || !n.body.trim())
      .map((n) => n.id);
    if (importedIds.length === 0) return notes;

    const { data, error } = await this.supabase
      .from("note_attachments")
      .select("note_id, extracted_text")
      .in("note_id", importedIds);
    if (error) throw error;
    if (!data || data.length === 0) return notes;

    const textByNote = new Map<string, string>();
    for (const row of data as Array<{
      note_id: string;
      extracted_text: string | null;
    }>) {
      const text =
        typeof row.extracted_text === "string" ? row.extracted_text.trim() : "";
      if (!text) continue;
      const existing = textByNote.get(row.note_id);
      if (existing && existing.length >= NOTE_SEARCH_TEXT_MAX_CHARS) continue;
      const combined = existing ? `${existing} ${text}` : text;
      textByNote.set(row.note_id, combined.slice(0, NOTE_SEARCH_TEXT_MAX_CHARS));
    }
    if (textByNote.size === 0) return notes;

    return notes.map((note) => {
      const searchText = textByNote.get(note.id);
      return searchText ? { ...note, searchText } : note;
    });
  }

  async getNote(noteId: string, userId: string) {
    const access = await this.resolveNoteAccess(noteId, userId);
    if (!access) {
      // 404, matching the sibling write paths below. Status-less, this read
      // surfaced to callers as a 500 "Something went wrong" and was reported
      // to Sentry as a server crash.
      const err = new Error("Note not found or access denied") as Error & {
        status?: number;
      };
      err.status = 404;
      throw err;
    }

    const { data, error } = await this.supabase
      .from("notes")
      .select("*")
      .eq("id", noteId)
      .single();
    if (error) throw error;

    const owner = access.isOwner
      ? undefined
      : await this.getNoteOwnerPresentation(access.ownerId);

    return this.mapNote(data, {
      accessRole: access.accessRole,
      owner,
    });
  }

  async createNote(
    userId: string,
    payload: {
      title?: string;
      body?: string;
      folderId?: string;
      groupId?: string;
      sourceType?: string;
      youtubeUrl?: string;
      youtubeVideoId?: string;
      summary?: string;
      copiedFromNoteId?: string;
      courseId?: string | null;
      studySetId?: string | null;
      topicId?: string | null;
    },
    options: {
      /** 'web' | 'mobile' from x-lantern-surface (learning_events.surface); default 'api'. */
      surface?: LearningSurface;
    } = {},
  ) {
    const topicId = await this.resolveArtefactTopic({
      topicId: payload.topicId,
      courseId: payload.courseId,
    });
    const { data, error } = await writeWithTopicFallback(
      (row) => this.supabase.from("notes").insert(row).select().single(),
      {
        user_id: userId,
        title: payload.title || "Untitled Note",
        body: payload.body || "",
        folder_id: payload.folderId || null,
        group_id: payload.groupId || null,
        course_id: payload.courseId || null,
        ...(payload.studySetId !== undefined ? { study_set_id: payload.studySetId || null } : {}),
        ...(topicId !== undefined ? { topic_id: topicId } : {}),
        source_type: payload.sourceType || "typed",
        youtube_url: payload.youtubeUrl || null,
        youtube_video_id: payload.youtubeVideoId || null,
        summary: payload.summary || null,
        copied_from_note_id: payload.copiedFromNoteId || null,
      },
    );
    if (error) throw error;
    // learning_events: note_created — every creation path (typed, PDF/slides/
    // image/audio/YouTube imports) lands here; only POST /notes knows the
    // surface header, the rest default to 'api'. Never throws.
    await recordLearningEvent(this, {
      userId,
      eventType: "note_created",
      targetType: "note",
      targetId: data?.id,
      noteId: data?.id,
      groupId: data?.group_id ?? null,
      courseId: data?.course_id ?? null,
      surface: options.surface ?? "api",
      occurredAt: data?.created_at ?? null,
    });
    return this.mapNote(data, { accessRole: "owner" });
  }

  async canEditNote(userId: string, noteId: string): Promise<boolean> {
    const access = await this.resolveNoteAccess(noteId, userId);
    return Boolean(access?.canEdit);
  }

  async updateNote(
    userId: string,
    noteId: string,
    updates: Record<string, unknown>,
    options: {
      expectedVersion?: number;
      expectedUpdatedAt?: string;
      /** AI/system writers may retry once after a concurrent user edit. */
      allowRetryOnConflict?: boolean;
    } = {},
  ) {
    const access = await this.resolveNoteAccess(noteId, userId);
    if (!access?.canEdit) {
      const err = new Error("Note not found or access denied") as Error & {
        code?: string;
        status?: number;
      };
      err.code = "PGRST116";
      err.status = 403;
      throw err;
    }

    // Folder/group placement lives in a single global column that belongs to the
    // note's owner. A non-owner editor writing folderId/groupId would pull the
    // note out of the OWNER's folder into an id that means nothing to them, so it
    // vanishes from the owner's folder view. Drop placement changes from
    // non-owners — their title/body edits still save, and the client hides the
    // "Move to folder" control for shared notes anyway.
    if (!access.isOwner) {
      delete (updates as Record<string, unknown>).folderId;
      delete (updates as Record<string, unknown>).groupId;
      // Course is the owner's archive taxonomy, same as folder placement —
      // and so is the topic inside it.
      delete (updates as Record<string, unknown>).courseId;
      delete (updates as Record<string, unknown>).studySetId;
      delete (updates as Record<string, unknown>).topicId;
    }

    const dbUpdates: Record<string, unknown> = {};
    if (updates.title !== undefined) dbUpdates.title = updates.title;
    if (updates.body !== undefined) dbUpdates.body = updates.body;
    if (updates.summary !== undefined) dbUpdates.summary = updates.summary;
    if (updates.folderId !== undefined)
      dbUpdates.folder_id = updates.folderId || null;
    if (updates.groupId !== undefined)
      dbUpdates.group_id = updates.groupId || null;
    if (updates.courseId !== undefined)
      dbUpdates.course_id = updates.courseId || null;
    if (updates.studySetId !== undefined)
      dbUpdates.study_set_id = updates.studySetId || null;
    // Validated against the course the note ENDS UP with, before the first
    // write attempt, so a wrong-course topic 400s instead of being stored.
    const topicId = await this.resolveArtefactTopicPatch("notes", noteId, updates);
    if (topicId !== undefined) dbUpdates.topic_id = topicId;
    if (updates.isShared !== undefined) dbUpdates.is_shared = updates.isShared;
    if (updates.youtubeUrl !== undefined)
      dbUpdates.youtube_url = updates.youtubeUrl;
    if (updates.youtubeVideoId !== undefined)
      dbUpdates.youtube_video_id = updates.youtubeVideoId;
    if (updates.isPinned !== undefined) {
      const pinned = Boolean(updates.isPinned);
      dbUpdates.is_pinned = pinned;
      dbUpdates.pinned_at = pinned ? new Date().toISOString() : null;
    }
    if (updates.isArchived !== undefined) {
      const archived = Boolean(updates.isArchived);
      dbUpdates.is_archived = archived;
      if (archived) {
        dbUpdates.is_pinned = false;
        dbUpdates.pinned_at = null;
      }
    }

    const maxAttempts = options.allowRetryOnConflict ? 2 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { data: current, error: currentError } = await this.supabase
        .from("notes")
        .select("updated_at, version")
        .eq("id", noteId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) {
        const err = new Error("Note not found or access denied") as Error & {
          code?: string;
          status?: number;
        };
        err.code = "PGRST116";
        err.status = 404;
        throw err;
      }

      const expectedVersion =
        options.expectedVersion != null && attempt === 0
          ? Number(options.expectedVersion)
          : Number(current.version) || 1;
      const expectedUpdatedAt =
        options.expectedUpdatedAt && attempt === 0
          ? options.expectedUpdatedAt
          : (current.updated_at as string);

      // Trigger bumps version/updated_at; CAS against the values we last read.
      const runUpdate = (payload: Record<string, unknown>) => {
        let query = this.supabase
          .from("notes")
          .update(payload)
          .eq("id", noteId);
        if (Number.isFinite(expectedVersion)) {
          query = query.eq("version", expectedVersion);
        } else if (expectedUpdatedAt) {
          query = query.eq("updated_at", expectedUpdatedAt);
        }
        return query.select().maybeSingle();
      };

      const { data, error } = await writeWithTopicFallback(runUpdate, dbUpdates);
      if (error) throw error;
      if (data) return this.mapNote(data);

      if (attempt + 1 >= maxAttempts) {
        const latest = await this.getNote(noteId, userId).catch(() => null);
        throw new VersionConflictError(
          "Note was updated elsewhere. Refresh and try again.",
          latest,
        );
      }
    }

    throw new VersionConflictError(
      "Note was updated elsewhere. Refresh and try again.",
    );
  }

  async deleteNote(userId: string, noteId: string) {
    const { error } = await this.supabase
      .from("notes")
      .delete()
      .eq("id", noteId)
      .eq("user_id", userId);
    if (error) throw error;
    return true;
  }

  async getNoteAttachment(noteId: string, attachmentId: string) {
    const { data, error } = await this.supabase
      .from("note_attachments")
      .select("*")
      .eq("note_id", noteId)
      .eq("id", attachmentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      noteId: data.note_id,
      type: data.type,
      fileUrl: data.file_url || undefined,
      fileName: data.file_name || undefined,
      extractedText: data.extracted_text || undefined,
      metadata: data.metadata || {},
      createdAt: data.created_at,
    };
  }

  async updateNoteAttachment(
    attachmentId: string,
    updates: { metadata?: Record<string, unknown>; extractedText?: string },
  ) {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.metadata !== undefined) dbUpdates.metadata = updates.metadata;
    if (updates.extractedText !== undefined)
      dbUpdates.extracted_text = updates.extractedText;

    const { data, error } = await this.supabase
      .from("note_attachments")
      .update(dbUpdates)
      .eq("id", attachmentId)
      .select()
      .single();
    if (error) throw error;
    return {
      id: data.id,
      noteId: data.note_id,
      type: data.type,
      fileUrl: data.file_url || undefined,
      fileName: data.file_name || undefined,
      extractedText: data.extracted_text || undefined,
      metadata: data.metadata || {},
      createdAt: data.created_at,
    };
  }

  async uploadNoteFile(params: {
    storagePath: string;
    buffer: Buffer;
    contentType: string;
    upsert?: boolean;
  }): Promise<{ path: string }> {
    const bucket = "note-files";
    const isImage = (params.contentType || "").toLowerCase().startsWith("image/");
    const attemptUpload = async () =>
      this.supabase.storage
        .from(bucket)
        .upload(params.storagePath, params.buffer, {
          contentType: params.contentType,
          cacheControl: isImage ? IMMUTABLE_IMAGE_CACHE_CONTROL : "3600",
          upsert: params.upsert === true,
        });

    let uploadResult = await attemptUpload();
    if (
      uploadResult.error &&
      typeof uploadResult.error.message === "string" &&
      uploadResult.error.message.toLowerCase().includes("bucket") &&
      uploadResult.error.message.toLowerCase().includes("not found")
    ) {
      await this.supabase.storage.createBucket(bucket, { public: false });
      uploadResult = await attemptUpload();
    }

    const { error } = uploadResult;
    if (error) {
      logger.error("Error uploading note file:", {
        error,
        path: params.storagePath,
      });
      throw new Error(error.message);
    }
    return { path: params.storagePath };
  }

  /**
   * Mint a short-lived signed upload URL so browsers can PUT lecture audio
   * directly to Supabase Storage (avoids CF Worker / API body size & timeout).
   */
  async createSignedNoteFileUploadUrl(storagePath: string): Promise<{
    signedUrl: string;
    token: string;
    path: string;
  }> {
    const bucket = "note-files";
    if (
      !storagePath ||
      storagePath.includes("..") ||
      storagePath.startsWith("/") ||
      storagePath.includes("\\")
    ) {
      throw new Error("Invalid storage path");
    }

    const attempt = async () =>
      this.supabase.storage.from(bucket).createSignedUploadUrl(storagePath);

    let result = await attempt();
    if (
      result.error &&
      typeof result.error.message === "string" &&
      result.error.message.toLowerCase().includes("bucket") &&
      result.error.message.toLowerCase().includes("not found")
    ) {
      await this.supabase.storage.createBucket(bucket, { public: false });
      result = await attempt();
    }

    if (result.error || !result.data?.signedUrl || !result.data?.token) {
      logger.error("Error creating signed note-file upload URL:", {
        error: result.error,
        path: storagePath,
      });
      throw new Error(
        result.error?.message || "Failed to create signed upload URL",
      );
    }

    return {
      signedUrl: this.normalizeStorageUrl(result.data.signedUrl),
      token: result.data.token,
      path: result.data.path || storagePath,
    };
  }

  async createSignedNoteFileUrl(
    storagePath: string,
    expiresInSeconds = 60 * 60 * 24,
    variant: "thumb" | "original" = "original",
  ): Promise<string> {
    return this.createSignedStorageUrlWithVariant(
      "note-files",
      storagePath,
      expiresInSeconds,
      variant,
    );
  }

  async deleteNoteFile(storagePath: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from("note-files")
      .remove([storagePath]);
    if (error) {
      logger.warn("Failed to delete note file from storage", {
        error,
        storagePath,
      });
    }
  }

  async downloadNoteFile(
    storagePath: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const { data, error } = await this.supabase.storage
      .from("note-files")
      .download(storagePath);
    if (error || !data) {
      throw new Error(error?.message || "Failed to download note file");
    }
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const lower = storagePath.toLowerCase();
    let contentType = "application/octet-stream";
    if (lower.endsWith(".pdf")) contentType = "application/pdf";
    else if (lower.endsWith(".pptx")) {
      contentType =
        "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    } else if (lower.endsWith(".ppt"))
      contentType = "application/vnd.ms-powerpoint";
    else if (lower.endsWith(".png")) contentType = "image/png";
    else if (lower.endsWith(".gif")) contentType = "image/gif";
    else if (lower.endsWith(".webp")) contentType = "image/webp";
    else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
      contentType = "image/jpeg";
    else {
      const detected = detectImageMime(buffer);
      if (detected) contentType = detected;
    }
    return { buffer, contentType };
  }

  resolveNoteAttachmentStoragePath(attachment: {
    fileUrl?: string;
    metadata?: Record<string, unknown>;
    type?: string;
  }): string | null {
    const meta = attachment.metadata || {};
    if (
      typeof meta.previewStoragePath === "string" &&
      meta.previewStoragePath
    ) {
      return meta.previewStoragePath;
    }
    if (typeof meta.storagePath === "string" && meta.storagePath) {
      return meta.storagePath;
    }
    if (!attachment.fileUrl) return null;
    try {
      const url = new URL(attachment.fileUrl);
      const marker = "/storage/v1/object/";
      const idx = url.pathname.indexOf(marker);
      if (idx === -1) return null;
      let after = url.pathname.slice(idx + marker.length);
      if (after.startsWith("sign/")) after = after.slice("sign/".length);
      if (after.startsWith("public/")) after = after.slice("public/".length);
      const parts = after.split("/");
      if (parts.length < 2) return null;
      const bucket = parts[0];
      if (bucket !== "note-files") return null;
      return decodeURIComponent(parts.slice(1).join("/"));
    } catch {
      return null;
    }
  }

  async getNoteAttachments(noteId: string) {
    const { data, error } = await this.supabase
      .from("note_attachments")
      .select("*")
      .eq("note_id", noteId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      noteId: row.note_id,
      type: row.type,
      fileUrl: row.file_url || undefined,
      fileName: row.file_name || undefined,
      extractedText: row.extracted_text || undefined,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    }));
  }

  async addNoteAttachment(
    noteId: string,
    payload: {
      type: string;
      fileUrl?: string;
      fileName?: string;
      extractedText?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const { data, error } = await this.supabase
      .from("note_attachments")
      .insert({
        note_id: noteId,
        type: payload.type,
        file_url: payload.fileUrl || null,
        file_name: payload.fileName || null,
        extracted_text: payload.extractedText || null,
        metadata: payload.metadata || {},
      })
      .select()
      .single();
    if (error) throw error;
    return {
      id: data.id,
      noteId: data.note_id,
      type: data.type,
      fileUrl: data.file_url || undefined,
      fileName: data.file_name || undefined,
      extractedText: data.extracted_text || undefined,
      metadata: data.metadata || {},
      createdAt: data.created_at,
    };
  }

  async getNoteCollaborators(noteId: string) {
    const { data, error } = await this.supabase
      .from("note_collaborators")
      // Name the FK constraint (note_collaborators.user_id -> profiles.id,
      // auto-named note_collaborators_user_id_fkey). note_collaborators has a
      // single FK to profiles today, so a bare `profiles(...)` resolves — the
      // same single-FK state community_members was in before a second FK made
      // its bare embed ambiguous (PGRST201) and broke the roster. Naming it now
      // keeps this correct if profiles ever gains a second relationship here.
      // The resource is still called `profiles`, so `row.profiles` below holds.
      .select("*, profiles!note_collaborators_user_id_fkey(id, name, avatar_url)")
      .eq("note_id", noteId);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      noteId: row.note_id,
      userId: row.user_id,
      role: row.role,
      addedAt: row.added_at,
      user: row.profiles
        ? {
            id: row.profiles.id,
            name: row.profiles.name,
            avatarUrl: row.profiles.avatar_url,
          }
        : undefined,
    }));
  }

  async addNoteCollaborator(
    noteId: string,
    ownerId: string,
    collaboratorUserId: string,
    role: string = "editor",
  ) {
    const note = await this.getNote(noteId, ownerId);
    if (note.userId !== ownerId)
      throw new Error("Only the note owner can add collaborators");

    const normalizedRole = role === "viewer" ? "viewer" : "editor";
    const resolvedUserId =
      await this.resolveCollaboratorUserId(collaboratorUserId);
    if (resolvedUserId === ownerId) {
      throw new Error("You cannot add yourself as a collaborator.");
    }

    const { data: existing } = await this.supabase
      .from("note_collaborators")
      .select("role")
      .eq("note_id", noteId)
      .eq("user_id", resolvedUserId)
      .maybeSingle();

    const grantRole =
      existing?.role === "editor" && normalizedRole === "viewer"
        ? "editor"
        : normalizedRole;

    const { data, error } = await this.supabase
      .from("note_collaborators")
      .upsert({
        note_id: noteId,
        user_id: resolvedUserId,
        role: grantRole,
      })
      .select()
      .single();
    if (error) throw error;

    const actor = await this.getNoteOwnerPresentation(ownerId);
    void this.createNotification(resolvedUserId, {
      type: "note_share_invite",
      message: `${actor.name || actor.username || "Someone"} shared "${note.title}" with you`,
      link: `/notes/${noteId}`,
      data: { noteId, role: grantRole, fromUserId: ownerId },
    }).catch(() => {});

    return {
      noteId: data.note_id,
      userId: data.user_id,
      role: data.role,
      addedAt: data.added_at,
    };
  }

  async removeNoteCollaborator(
    noteId: string,
    ownerId: string,
    collaboratorUserId: string,
  ) {
    const note = await this.getNote(noteId, ownerId);
    if (note.userId !== ownerId)
      throw new Error("Only the note owner can remove collaborators");

    const { error } = await this.supabase
      .from("note_collaborators")
      .delete()
      .eq("note_id", noteId)
      .eq("user_id", collaboratorUserId);
    if (error) throw error;
    return true;
  }

  async updateNoteCollaboratorRole(
    noteId: string,
    ownerId: string,
    collaboratorUserId: string,
    role: "viewer" | "editor",
  ) {
    if (!(await this.isNoteOwner(ownerId, noteId))) {
      throw new Error("Only the note owner can change collaborator roles");
    }
    if (collaboratorUserId === ownerId) {
      throw new Error("Cannot change the owner role via collaborator update");
    }
    const { data, error } = await this.supabase
      .from("note_collaborators")
      .update({ role })
      .eq("note_id", noteId)
      .eq("user_id", collaboratorUserId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Collaborator not found");
    return {
      noteId: data.note_id,
      userId: data.user_id,
      role: data.role,
      addedAt: data.added_at,
    };
  }

  /** Collaborator leaves a shared note (self-remove). Owners cannot leave. */
  async leaveNoteCollaboration(noteId: string, userId: string) {
    if (await this.isNoteOwner(userId, noteId)) {
      throw new Error("Note owners cannot leave their own note");
    }
    const access = await this.resolveNoteAccess(noteId, userId);
    if (
      !access ||
      (access.accessRole !== "viewer" && access.accessRole !== "editor")
    ) {
      throw new Error("You are not a collaborator on this note");
    }
    const { error } = await this.supabase
      .from("note_collaborators")
      .delete()
      .eq("note_id", noteId)
      .eq("user_id", userId);
    if (error) throw error;
    return true;
  }

  async createNoteShareLink(
    noteId: string,
    ownerId: string,
    role: "viewer" | "editor",
    options?: { expiresAt?: string | null },
  ) {
    const { generateNoteShareToken, hashNoteShareToken, buildNoteShareWebUrl } =
      await import("./noteShareTokens");
    if (!(await this.isNoteOwner(ownerId, noteId))) {
      throw new Error("Only the note owner can create share links");
    }
    if (role !== "viewer" && role !== "editor") {
      throw new Error("role must be viewer or editor");
    }

    const token = generateNoteShareToken();
    const tokenHash = hashNoteShareToken(token);
    const { data, error } = await this.supabase
      .from("note_share_links")
      .insert({
        note_id: noteId,
        created_by: ownerId,
        token_hash: tokenHash,
        role,
        expires_at: options?.expiresAt || null,
      })
      .select(
        "id, note_id, role, expires_at, revoked_at, created_at, last_redeemed_at",
      )
      .single();
    if (error) throw error;

    return {
      id: data.id,
      noteId: data.note_id,
      role: data.role as "viewer" | "editor",
      expiresAt: data.expires_at || undefined,
      revokedAt: data.revoked_at || undefined,
      createdAt: data.created_at,
      lastRedeemedAt: data.last_redeemed_at || undefined,
      // Plaintext returned once for the owner to copy; never stored.
      token,
      url: buildNoteShareWebUrl(token),
    };
  }

  async listNoteShareLinks(noteId: string, ownerId: string) {
    if (!(await this.isNoteOwner(ownerId, noteId))) {
      throw new Error("Only the note owner can list share links");
    }
    const { data, error } = await this.supabase
      .from("note_share_links")
      .select(
        "id, note_id, role, expires_at, revoked_at, created_at, last_redeemed_at",
      )
      .eq("note_id", noteId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      noteId: row.note_id,
      role: row.role as "viewer" | "editor",
      expiresAt: row.expires_at || undefined,
      revokedAt: row.revoked_at || undefined,
      createdAt: row.created_at,
      lastRedeemedAt: row.last_redeemed_at || undefined,
      isActive:
        !row.revoked_at &&
        (!row.expires_at || new Date(row.expires_at) > new Date()),
    }));
  }

  async revokeNoteShareLink(noteId: string, ownerId: string, linkId: string) {
    if (!(await this.isNoteOwner(ownerId, noteId))) {
      throw new Error("Only the note owner can revoke share links");
    }
    const { data, error } = await this.supabase
      .from("note_share_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", linkId)
      .eq("note_id", noteId)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Share link not found or already revoked");
    return true;
  }

  async previewNoteShareLink(token: string, userId: string) {
    const { hashNoteShareToken, isValidNoteShareTokenFormat } =
      await import("./noteShareTokens");
    if (!isValidNoteShareTokenFormat(token)) {
      const err = new Error("Invalid share link") as Error & { code?: string };
      err.code = "share_link_invalid";
      throw err;
    }
    const tokenHash = hashNoteShareToken(token);
    const { data: link, error } = await this.supabase
      .from("note_share_links")
      .select("id, note_id, role, expires_at, revoked_at, created_by")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (error) throw error;
    if (!link) {
      const err = new Error("Share link not found") as Error & {
        code?: string;
      };
      err.code = "share_link_not_found";
      throw err;
    }
    if (link.revoked_at) {
      const err = new Error("This share link has been revoked") as Error & {
        code?: string;
      };
      err.code = "share_link_revoked";
      throw err;
    }
    if (link.expires_at && new Date(link.expires_at) <= new Date()) {
      const err = new Error("This share link has expired") as Error & {
        code?: string;
      };
      err.code = "share_link_expired";
      throw err;
    }

    const { data: note, error: noteError } = await this.supabase
      .from("notes")
      .select("id, title, user_id")
      .eq("id", link.note_id)
      .single();
    if (noteError) throw noteError;

    const owner = await this.getNoteOwnerPresentation(note.user_id);
    const existing = await this.resolveNoteAccess(note.id, userId);

    return {
      shareLinkId: link.id,
      noteId: note.id,
      title: note.title,
      role: link.role as "viewer" | "editor",
      owner,
      alreadyHasAccess: Boolean(existing),
      currentAccessRole: existing?.accessRole,
      isOwner: note.user_id === userId,
    };
  }

  async acceptNoteShareLink(token: string, userId: string) {
    const { hashNoteShareToken, isValidNoteShareTokenFormat } =
      await import("./noteShareTokens");
    if (!isValidNoteShareTokenFormat(token)) {
      const err = new Error("Invalid share link") as Error & { code?: string };
      err.code = "share_link_invalid";
      throw err;
    }
    const tokenHash = hashNoteShareToken(token);
    const { data, error } = await this.supabase.rpc("accept_note_share_link", {
      p_token_hash: tokenHash,
      p_user_id: userId,
    });
    if (error) {
      const message = error.message || "Failed to accept share link";
      const err = new Error(
        message.includes("share_link_revoked")
          ? "This share link has been revoked"
          : message.includes("share_link_expired")
            ? "This share link has expired"
            : message.includes("share_link_not_found")
              ? "Share link not found"
              : "Failed to accept share link",
      ) as Error & { code?: string };
      if (message.includes("share_link_revoked"))
        err.code = "share_link_revoked";
      else if (message.includes("share_link_expired"))
        err.code = "share_link_expired";
      else if (message.includes("share_link_not_found"))
        err.code = "share_link_not_found";
      throw err;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.note_id) {
      throw new Error("Failed to accept share link");
    }

    const note = await this.getNote(row.note_id, userId);

    // Notify owner (best-effort) when a new collaborator accepts
    if (!row.already_accepted && note.userId !== userId) {
      const { data: profile } = await this.supabase
        .from("profiles")
        .select("name, username")
        .eq("id", userId)
        .maybeSingle();
      // NB: this local `actor` is the REDEEMER's DISPLAY NAME for the
      // notification copy — it is the person being HELPED, i.e. the exact
      // opposite of a learning-connection actorId. Do not reuse it below.
      const actor = profile?.name || profile?.username || "Someone";

      // North-star metric (Phase 3 · O): the note's author is the actor.
      // Phase 3 M: the feed verb that matched this hook had no writer.
      void (async () => {
        const { getActivityFeedService } = await import("./activityFeed");
        await getActivityFeedService(this).record({
          actorId: note.userId,
          verb: "shared_note",
          objectType: "note",
          objectId: note.id,
          audienceType: "followers",
          courseId: (note as { courseId?: string | null }).courseId ?? null,
          payload: { title: (note as { title?: string }).title ?? null },
        });
      })();

      void (async () => {
        const { getLearningConnectionsService } = await import("./learningConnections");
        await getLearningConnectionsService(this).record({
          actorId: note.userId,
          beneficiaryId: userId,
          kind: "note_redeemed",
          objectType: "note",
          objectId: note.id,
          courseId: (note as { courseId?: string | null }).courseId ?? null,
        });
      })();

      void this.createNotification(note.userId, {
        type: "note_share_accepted",
        message: `${actor} accepted your invite to "${note.title}"`,
        link: `/notes/${note.id}`,
        data: {
          noteId: note.id,
          redeemerUserId: userId,
          role: row.granted_role,
        },
      }).catch(() => {});
    }

    return {
      note,
      grantedRole: row.granted_role as string,
      alreadyAccepted: Boolean(row.already_accepted),
      shareLinkId: row.share_link_id as string,
    };
  }

  /**
   * Detached personal copy: note body + storage-backed attachments.
   * Excludes collaborators, comments, group membership, and quiz history.
   */
  async copyNoteForUser(sourceNoteId: string, userId: string) {
    const source = await this.getNote(sourceNoteId, userId);
    const attachments = await this.getNoteAttachments(sourceNoteId);

    const copyTitle = source.title?.startsWith("Copy of ")
      ? source.title
      : `Copy of ${source.title || "Untitled Note"}`;

    const created = await this.createNote(userId, {
      title: copyTitle,
      body: source.body || "",
      summary: source.summary,
      sourceType: source.sourceType,
      youtubeUrl: source.youtubeUrl,
      youtubeVideoId: source.youtubeVideoId,
      // Personal copy is never group-shared by default
      folderId: undefined,
      groupId: undefined,
      copiedFromNoteId: source.id,
    });

    for (const attachment of attachments) {
      let fileUrl = attachment.fileUrl as string | undefined;
      const storagePath = this.resolveNoteAttachmentStoragePath(attachment);
      if (storagePath) {
        try {
          const downloaded = await this.downloadNoteFile(storagePath);
          const newPath = buildNoteStoragePath(
            userId,
            attachment.fileName || "file",
          );
          await this.uploadNoteFile({
            storagePath: newPath,
            buffer: downloaded.buffer,
            contentType: downloaded.contentType,
          });
          fileUrl = newPath;
        } catch (err) {
          logger.warn(
            "Failed to copy note attachment file; keeping metadata only",
            {
              err,
              sourceNoteId,
              attachmentId: attachment.id,
            },
          );
          // External URLs (youtube) or failed downloads: preserve original fileUrl if external
          if (storagePath && fileUrl === storagePath) {
            fileUrl = undefined;
          }
        }
      }

      await this.addNoteAttachment(created.id, {
        type: attachment.type,
        fileUrl,
        fileName: attachment.fileName,
        extractedText: attachment.extractedText,
        metadata: {
          ...(attachment.metadata || {}),
          copiedFromAttachmentId: attachment.id,
        },
      });
    }

    return this.getNote(created.id, userId);
  }

  async getNoteComments(noteId: string) {
    const { data, error } = await this.supabase
      .from("note_comments")
      .select(NOTE_COMMENT_SELECT)
      .eq("note_id", noteId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map((row: any) => mapNoteCommentRow(row));
  }

  async addNoteComment(noteId: string, userId: string, comment: string) {
    const { data, error } = await this.supabase
      .from("note_comments")
      .insert({ note_id: noteId, user_id: userId, comment })
      .select(NOTE_COMMENT_SELECT)
      .single();
    if (error) throw error;
    return mapNoteCommentRow(data as any);
  }

  async shareNoteWithGroup(noteId: string, userId: string, groupId: string) {
    return this.updateNote(userId, noteId, { groupId, isShared: true });
  }

  private mapNoteQuiz(row: any) {
    return {
      date: String(row.updated_at || row.created_at || "").slice(0, 10),
      noteId: row.note_id,
      questions: Array.isArray(row.questions) ? row.questions : [],
      answers:
        row.answers && typeof row.answers === "object" ? row.answers : {},
      completed: Boolean(row.completed),
      studyGoal: row.study_goal || "retention",
    };
  }

  async getNoteQuiz(userId: string, noteId: string) {
    await this.getNote(noteId, userId);
    const { data, error } = await this.supabase
      .from("note_quizzes")
      .select("*")
      .eq("note_id", noteId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data ? this.mapNoteQuiz(data) : null;
  }

  /**
   * REL-02: a quiz with recorded answers or a completed run must never be
   * overwritten by regenerate. Shared by upsertNoteQuiz and the quiz route's
   * pre-generation check (so a refused regenerate never burns an AI call).
   */
  isNoteQuizProtected(
    quiz:
      | { completed?: boolean; answers?: Record<string, unknown> | null }
      | null
      | undefined,
  ): boolean {
    if (!quiz) return false;
    const answerCount =
      quiz.answers && typeof quiz.answers === "object"
        ? Object.keys(quiz.answers).length
        : 0;
    return Boolean(quiz.completed) || answerCount > 0;
  }

  async upsertNoteQuiz(
    userId: string,
    noteId: string,
    payload: {
      studyGoal: string;
      questions: unknown[];
    },
  ) {
    await this.getNote(noteId, userId);

    // REL-02: never wipe an in-progress or completed quiz on regenerate.
    // `reused: true` tells the client the questions it got back are the old
    // ones, not a fresh generation (absent means fresh).
    const existing = await this.getNoteQuiz(userId, noteId);
    if (existing) {
      if (this.isNoteQuizProtected(existing)) {
        return { ...existing, reused: true };
      }

      // Race guard is `completed = false` only. Do NOT add a jsonb equality
      // filter here: postgrest-js serializes `.eq("answers", {})` as
      // `answers=eq.[object Object]`, which Postgres cannot cast to jsonb, so
      // every regenerate of an untouched quiz 500'd after the AI had already
      // generated the new questions.
      const { data, error } = await this.supabase
        .from("note_quizzes")
        .update({
          study_goal: payload.studyGoal,
          questions: payload.questions,
          answers: {},
          completed: false,
          updated_at: new Date().toISOString(),
        })
        .eq("note_id", noteId)
        .eq("user_id", userId)
        .eq("completed", false)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        // The quiz was completed between the pre-check and the update; hand
        // back the winner's quiz rather than wipe it.
        const raced = await this.getNoteQuiz(userId, noteId);
        if (raced) return { ...raced, reused: true };
        throw new Error("Failed to update note quiz");
      }
      return this.mapNoteQuiz(data);
    }

    const { data, error } = await this.supabase
      .from("note_quizzes")
      .insert({
        note_id: noteId,
        user_id: userId,
        study_goal: payload.studyGoal,
        questions: payload.questions,
        answers: {},
        completed: false,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) {
      // Concurrent first insert: return the winner's row rather than wipe.
      if (error.code === "23505") {
        const raced = await this.getNoteQuiz(userId, noteId);
        if (raced) return raced;
      }
      throw error;
    }
    return this.mapNoteQuiz(data);
  }

  async updateNoteQuiz(
    userId: string,
    noteId: string,
    updates: { answers?: Record<string, string>; completed?: boolean },
  ) {
    await this.getNote(noteId, userId);
    const dbUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.answers !== undefined) dbUpdates.answers = updates.answers;
    if (updates.completed !== undefined)
      dbUpdates.completed = updates.completed;

    const { data, error } = await this.supabase
      .from("note_quizzes")
      .update(dbUpdates)
      .eq("note_id", noteId)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw error;
    return this.mapNoteQuiz(data);
  }

  async getAdminAnalytics(days: number): Promise<AdminAnalyticsPayload> {
    const [{ data, error }, { data: zoneData, error: zoneError }] =
      await Promise.all([
        this.supabase.rpc("admin_analytics", { p_days: days }),
        this.supabase.rpc("marketplace_zone_analytics", { p_days: days }),
      ]);
    if (error) throw error;

    const analytics = data as AdminAnalyticsPayload;
    if (zoneError || !zoneData || typeof zoneData !== "object") {
      if (zoneError) {
        logger.warn("marketplace_zone_analytics RPC failed", {
          error: zoneError.message,
        });
      }
      return analytics;
    }

    const zones = zoneData as {
      gmvByZone?: Array<{ zone: string; gmv: number; orders: number }>;
      listingsByZone?: Array<{
        zone: string;
        total: number;
        active: number;
        sold: number;
      }>;
      searchesByZone?: Array<{ zone: string; count: number }>;
      searchesByCampus?: Array<{ campus: string; count: number }>;
    };
    return {
      ...analytics,
      marketplaceKpis: analytics.marketplaceKpis
        ? {
            ...analytics.marketplaceKpis,
            gmvByZone: zones.gmvByZone || [],
            listingsByZone: zones.listingsByZone || [],
          }
        : analytics.marketplaceKpis,
      searchAnalytics: analytics.searchAnalytics
        ? {
            ...analytics.searchAnalytics,
            searchesByCampus:
              zones.searchesByCampus ||
              analytics.searchAnalytics.searchesByCampus,
            searchesByZone: zones.searchesByZone || [],
          }
        : analytics.searchAnalytics,
    };
  }
}

export interface AdminAnalyticsPayload {
  periodDays: number;
  kpis: {
    totalUsers: number;
    dau: number;
    wau: number;
    mau: number;
    mobileAppUsers: number;
    webOnlyUsers: number;
    activeGroups: number;
  };
  marketplaceKpis?: {
    gmv: number;
    ordersCount: number;
    aov: number;
    disputedRate: number;
    disputedCount: number;
    gmvByCategory: Array<{ category: string; gmv: number; orders: number }>;
    gmvByCampus: Array<{ campus: string; gmv: number; orders: number }>;
    gmvByZone?: Array<{ zone: string; gmv: number; orders: number }>;
    listingsByZone?: Array<{
      zone: string;
      total: number;
      active: number;
      sold: number;
    }>;
  };
  retentionCohorts?: {
    signups: number;
    d1: number;
    d7: number;
    d30: number;
    d1Count: number;
    d7Count: number;
    d30Count: number;
  };
  searchAnalytics?: {
    topQueries: Array<{ query: string; count: number }>;
    zeroResultQueries: Array<{ query: string; count: number }>;
    searchesByCampus: Array<{ campus: string; count: number }>;
    searchesByZone?: Array<{ zone: string; count: number }>;
    totalSearches: number;
  };
  acquisitionFunnel?: {
    guestListingViews: number;
    signupStarted: number;
    signupsCompleted: number;
    onboardingCompleted: number;
  };
  studyFunnel?: {
    testsStarted: number;
    testsCompleted: number;
    testsCompletedWeb: number;
    testsCompletedMobile: number;
    flashcardSessionsStarted: number;
    flashcardSessionsCompleted: number;
    notesCreated: number;
    aiToolUses: number;
    aiToolsByType: Record<string, number>;
  };
  platformFromEvents?: {
    webDau: number;
    mobileDau: number;
    webActivePeriod: number;
    mobileActivePeriod: number;
  };
  streakDistribution: Record<string, number>;
  featureTotals: {
    tests: number;
    flashcards: number;
    newFlashcards: number;
    questions: number;
    games: number;
    dailyQuizzes: number;
    studyActions: number;
  };
  aiByFeature: Record<string, number>;
  platformSplit: {
    mobileAppUsers: number;
    webOnlyUsers: number;
  };
  series: Array<{
    date: string;
    signups: number;
    activeUsers: number;
    tests: number;
    flashcards: number;
    newFlashcards: number;
    questions: number;
    games: number;
    dailyQuizzes: number;
    groupMessages: number;
    dmMessages: number;
    aiEvents: number;
    newListings: number;
    orders: number;
    gmv?: number;
  }>;
}

// Configuration - do NOT create singleton at module level
// The server.ts initializes the service with proper config
// export const supabaseService = new SupabaseService(dbConfig);
