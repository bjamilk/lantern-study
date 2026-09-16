/**
 * SupabaseService — the API server's single data-access layer.
 *
 * This module holds ONE Supabase client built from the SERVICE ROLE key
 * (`constructor` → `data/client.ts`'s `createDataClient`) and every route
 * handler in the server reaches Postgres and Storage through it.
 *
 * ## The service role bypasses RLS
 *
 * The service-role key is a superuser credential: row-level security does not
 * apply to it. Every policy in `supabase/migrations/*` is invisible from here.
 * So each method below must carry its OWN ownership or membership predicate —
 * `.eq("user_id", userId)`, `isGroupMember`, `verifyDeckAccess`,
 * `resolveNoteAccess`, `isDmThreadParticipant`, `isPlatformAdmin`. A method
 * that forgets is a full-table read for whoever calls it; RLS will not catch
 * the mistake, and neither will a test that only exercises the happy path.
 * The same rule is what makes the public/unauthenticated endpoints that call
 * in here dangerous by default.
 *
 * ## Layout
 *
 * Module scope first (payload coercion, cover-image constants and errors,
 * marketplace write sanitizers, `mapTestListRow`, community-mute guard), then
 * `class SupabaseService` in these blocks, in file order:
 *
 *   storage references + the storage ACL  ·  users/profiles  ·  groups and
 *   membership  ·  group messages, votes, reactions  ·  decks and flashcards
 *   (incl. FSRS review and per-question stats)  ·  image/file uploads  ·
 *   offline bundles  ·  direct messages and blocks  ·  notifications  ·
 *   tests and test sessions  ·  gamification (points, badges, levels,
 *   streaks)  ·  chat internals (threads, mentions, receipts, `sendMessage`)
 *   ·  board actions (favorite, repost, bookmark) and board hydration  ·
 *   admin/health  ·  marketplace (listings, reviews, orders, favorites,
 *   inquiries, seller dashboard)  ·  unread counts, mutes, DM thread state ·
 *   custom categories and user preferences  ·  academic filing
 *   (course/topic resolution)  ·  notes (folders, collaborators, share links,
 *   attachments, quizzes)  ·  admin analytics.
 *
 * ## What it touches
 *
 * Tables (partial, by traffic): `messages`, `group_members`, `profiles`,
 * `dm_threads`, `dm_messages`, `dm_read_status`, `marketplace_listings`,
 * `marketplace_orders`, `marketplace_reviews`, `marketplace_review_votes`,
 * `marketplace_favorites`, `marketplace_inquiries`, `marketplace_offers`,
 * `marketplace_transactions`, `marketplace_reports`, `marketplace_campuses`,
 * `marketplace_question_bank_entitlements`, `test_sessions`, `test_results`,
 * `test_templates`, `flashcards`, `flashcard_comments`, `decks`,
 * `deck_collaborators`, `notifications`, `groups`, `communities`,
 * `community_members`, `notes`, `note_collaborators`, `note_attachments`,
 * `note_share_links`, `note_folders`, `note_comments`, `note_quizzes`,
 * `user_question_stats`, `question_votes`, `message_reactions`,
 * `message_bookmarks`, `chat_mutes`, `chat_message_audit`, `user_blocks`,
 * `offline_bundles`, `achievements`, `user_achievements`,
 * `points_transactions`, `levels`, `user_streaks`, `study_activity`,
 * `study_sets`, `saved_searches`, `custom_categories`, `user_preferences`,
 * `budget_transactions`, `creator_stats`, `courses`, `platform_admins`.
 * Plus the `admin_analytics` RPC.
 *
 * Storage buckets (all private; the allowlist is
 * `PRIVATE_STORAGE_BUCKETS` in `@lantern/shared/utils/storageUrl`):
 * `flashcard-images`, `question-images`, `marketplace-images`, `note-files`,
 * `profile-avatars`, `group-avatars`, `job-resumes`, `cover-images`.
 *
 * ## Caching convention
 *
 * Reads go through `cacheService.cached(key, loader, { ttl })` and writes
 * invalidate by key or by `deletePattern` / `invalidateUserCache` /
 * `invalidateGroupCache`. Two rules:
 *
 *  1. A cache key covering user-scoped data must either be user-scoped, or
 *     the access decision must be made OUTSIDE the loader. `cached` skips the
 *     loader on a hit, so a check that lives inside it runs only on a miss.
 *     `getNotificationById` had exactly that bug and was fixed by hotfix H3 —
 *     read the comment there before you move any predicate into a loader.
 *  2. Invalidation sites and the key they clear are spread across files
 *     (`routes/notifications.ts`, `routes/messages.ts`); changing a key shape
 *     without finding them leaves stale rows served until the TTL expires.
 *
 * ## Repo traps that bite in this file
 *
 *  - PostgREST embeds: a SECOND foreign key between two tables makes a bare
 *    `select("… , other(*)")` ambiguous and fails at RUNTIME with PGRST201 —
 *    a migration is not safe just because its SQL is. Bare embeds are frozen
 *    by `services/postgrestEmbedDisambiguation.test.ts`; name the constraint
 *    (`other!fk_name(*)`) rather than adding to the allowlist.
 *  - `onConflict` cannot use a PARTIAL unique index. PostgREST 500s on such
 *    an upsert, which is how every reaction and favorite broke silently for
 *    several releases.
 *  - Schema-degradation ladders: several methods retry a query with a column
 *    or table dropped when the migration that adds it is unapplied. They are
 *    load-bearing — see the KNOWN ISSUE at `reactionsMissingTable`.
 *  - A new `@lantern/shared` subpath needs an entry in the api-server
 *    `tsconfig` `paths` or it compiles locally and fails only in CI, and a
 *    stale `packages/shared/dist` makes `tsc` disagree with the runtime.
 */
import * as dataClient from "./data/client";
import {
  mapChatMessageRow,
  mapProfileSender,
  resolveNestedProfile,
} from "./data/mappers";
import {
  COVER_IMAGE_BUCKET,
  COVER_IMAGE_MIGRATION,
  COVER_TABLE_BY_KIND,
  CoverColumnMissingError,
  CoverStorageUnavailableError,
  isMissingCoverPathColumn,
} from "./data/coverImages";
export {
  COVER_IMAGE_BUCKET,
  COVER_IMAGE_MIGRATION,
  COVER_TABLE_BY_KIND,
  CoverColumnMissingError,
  CoverStorageUnavailableError,
  isMissingCoverPathColumn,
};
import * as academicData from "./data/academic";
import * as decksData from "./data/decks";
import * as uploadsData from "./data/uploads";
import {
  resolveCourseIdFromConfigLike,
  resolveStudySetIdFromConfigLike,
  topicFilterApplies,
  writeWithTopicFallback,
} from "./data/academic";
export { resolveStudySetIdFromConfigLike };
import * as adminAnalyticsData from "./data/adminAnalytics";
import type { AdminAnalyticsPayload } from "./data/adminAnalytics";
import * as categoriesData from "./data/categories";
import * as gamificationData from "./data/gamification";
import type { GamificationSyncResult } from "./data/gamification";
import * as groupsData from "./data/groups";
import * as notificationsData from "./data/notifications";
import * as testsData from "./data/tests";
import {
  buildAttemptTally,
  buildTestProvenance,
  mapTestListRow,
  normalizeSourceNoteTitle,
  topicIdOf,
} from "./data/testMappers";
export {
  buildAttemptTally,
  buildTestProvenance,
  mapTestListRow,
  normalizeSourceNoteTitle,
};
import * as offlineBundlesData from "./data/offlineBundles";
import * as storageAclData from "./data/storageAcl";
import * as usersData from "./data/users";
import {
  DatabaseConfig,
  User,
  Group,
  Message,
  TestResult,
  Notification,
} from "../types";
import { cacheService } from "./cache";
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
  normalizeCoverRef,
  parseStorageObjectUrl,
  parseStoredStorageRef,
} from "@lantern/shared/utils/storageUrl";
import {
  resolveThreadRootId,
  computeDmReceiptStatus,
  computeGroupReceipt,
  parseChatAudioUrl,
  parseChatImageUrl,
} from "@lantern/shared/utils/chatMedia";
import { normalizeReactions } from "@lantern/shared/chat";
import { toServerGroupPayload } from "@lantern/shared/groups";
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
import { detectImageMime } from "../utils/fileValidation";
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
import { IMMUTABLE_IMAGE_CACHE_CONTROL } from "./imageProcessing";

type UserStats = typeof initialUserStats;

// `GamificationSyncResult` moved to `data/gamification.ts` (monolith lane M1c,
// step 12) with the three methods that were its only users. Type-imported
// above for the delegations' return types.


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

// `ProfileSenderRow`, `mapProfileSender` and `resolveNestedProfile` moved to
// `data/mappers.ts` (monolith lane M1, step 4) alongside `mapChatMessageRow`,
// the chat-message envelope they build. They stay module-private to the data
// layer: nothing outside it imported them.

// `mapProfileRowToUser`, `toNullableInt` and `buildProfileUpsertRow` moved to
// `data/users.ts` (monolith lane M1b, step 6) with the USERS AND PROFILES
// section, their only caller. They stay module-private to the data layer.

// `resolveCourseIdFromConfigLike` moved to `data/academic.ts` (monolith lane
// M1c, step 9): the OFFLINE BUNDLES and TESTS sections are its only callers
// and they now land in two different data modules. Imported above.

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

// `topicIdOf` and `topicFilterApplies` moved to `data/testMappers.ts` and
// `data/academic.ts` respectively (monolith lane M1c, step 11), so
// `data/tests.ts` can read them without importing this file back. Both are
// imported above; the remaining call sites here are unchanged.

/**
 * Run a write, retrying it without `topic_id` when that column is not there
 * yet (20260826120000 unapplied). Nothing can hold a topic before the
 * migration — resolveForArtefact rejects every id — so the only value that can
 * reach here is a clear, and clearing a column that does not exist is a no-op.
 * A missing topic must never fail the note/deck/test/listing it rode in on.
 */
// `resolveStudySetIdFromConfigLike` moved to `data/academic.ts` (monolith lane
// M1c, step 11) beside its course twin. Re-exported below so
// `studySetIdFromConfig.test.ts` keeps importing it from this path.

// `writeWithTopicFallback` moved to `data/academic.ts` (monolith lane M1b,
// step 7): it is the write half of the course/topic filing that module owns,
// and `data/decks.ts` needs it too. Imported above; 14 call sites unchanged.

// The COVER IMAGES block (bucket + migration names, the missing-column
// predicate, the two typed errors, the kind->table map) moved to
// `data/coverImages.ts` (monolith lane M1b, step 7) so `data/decks.ts` can
// use it without importing this file. Re-exported below, unchanged, for
// `routes/notes.ts` and `coverImages.test.ts`.

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

// `normalizeSourceNoteTitle`, `buildTestProvenance`, `buildAttemptTally` and
// `mapTestListRow` moved to `data/testMappers.ts` (monolith lane M1c, step 11)
// so `data/tests.ts` can use them without importing this file back. Imported
// above and re-exported below: every importer, and the public-surface freeze,
// sees exactly the same four names.

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

// `isTransientAuthError` now lives in `data/client.ts` beside the token
// verification that is its only caller. Re-exported here because
// `middleware/auth.ts` imports it from this path.
export { isTransientAuthError } from "./data/client";

export class SupabaseService {
  private supabase;
  private supabaseUrl: string;
  // DEFAULT_GROUP_PAGE_SIZE / MAX_GROUP_PAGE_SIZE moved to `data/groups.ts`
  // (monolith lane M1c, step 10) with `getGroups`, their only reader.
  private static readonly DEFAULT_DECK_PAGE_SIZE = 20;
  private static readonly MAX_DECK_PAGE_SIZE = 50;
  // DEFAULT_FLASHCARD_PAGE_SIZE / MAX_FLASHCARD_PAGE_SIZE moved to
  // `data/offlineBundles.ts` (monolith lane M1c, step 9) with `getFlashcards`,
  // their only reader.
  private static readonly DEFAULT_MESSAGE_PAGE_SIZE = 50;
  private static readonly MAX_MESSAGE_PAGE_SIZE = 100;

  private getResponseProfile(profile?: string): "compact" | "full" {
    return profile === "compact" ? "compact" : "full";
  }

  // ===========================================================================
  // STORAGE REFERENCES, SIGNED URLS AND THE STORAGE ACL
  //
  // EXTRACTED (monolith lane M1b, step 5): the bodies now live in
  // `data/storageAcl.ts` — read the invariants there before changing anything
  // here. What is left is delegation.
  //
  // The gate's artefact-read predicates (`verifyDeckAccess`,
  // `resolveNoteAccess`, `isGroupMember`, `isDmThreadParticipant`,
  // `isProfileVisibleToViewer`, `canViewPeerChatAvatar`) still live in this
  // file, in sections later lanes own, so they are INJECTED as `deps` rather
  // than imported — that keeps `data/storageAcl.ts` a leaf.
  //
  // The deps object is built INLINE at each call site (the same shape
  // `createNotification` uses below), and its arrows read `this.<method>` at
  // CALL time. That is what keeps `storageAccess.test.ts`'s
  // `jest.spyOn(service, 'isProfileVisibleToViewer')` working, and it avoids
  // adding a helper method that the public-surface freeze would flag.
  // ===========================================================================

  /** Rewrite legacy localhost:54321 storage URLs to the configured Supabase URL. */
  private normalizeStorageUrl(url: string): string {
    return storageAclData.normalizeStorageUrl(this.supabaseUrl, url);
  }

  resolveStorageReference(
    bucket?: string,
    path?: string,
    url?: string,
  ): { bucket: string; path: string } | null {
    return storageAclData.resolveStorageReference(
      this.supabaseUrl,
      bucket,
      path,
      url,
    );
  }

  async createSignedStorageUrl(
    bucket: string,
    path: string,
    expiresInSeconds?: number,
  ): Promise<string> {
    return storageAclData.createSignedStorageUrl(
      this.supabase,
      this.supabaseUrl,
      bucket,
      path,
      expiresInSeconds,
    );
  }

  /**
   * Sign a storage object for display. When variant is `thumb`, prefer the
   * sibling `<path>.thumb.webp` and fall back to the original if missing.
   * ACL checks must always use the original path.
   */
  async createSignedStorageUrlWithVariant(
    bucket: string,
    path: string,
    expiresInSeconds?: number,
    variant: "thumb" | "original" = "original",
  ): Promise<string> {
    return storageAclData.createSignedStorageUrlWithVariant(
      this.supabase,
      this.supabaseUrl,
      bucket,
      path,
      expiresInSeconds,
      variant,
    );
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
    return storageAclData.signStorageDisplayUrls(
      this.supabase,
      this.supabaseUrl,
      refs,
      options,
    );
  }

  async signStorageDisplayUrl(
    url: string,
    expiresInSeconds = 60 * 60 * 24,
    variant: "thumb" | "original" = "original",
  ): Promise<string> {
    return storageAclData.signStorageDisplayUrl(
      this.supabase,
      this.supabaseUrl,
      url,
      expiresInSeconds,
      variant,
    );
  }

  async canAccessStorageObject(
    userId: string | null,
    bucket: string,
    path: string,
  ): Promise<boolean> {
    return storageAclData.canAccessStorageObject(
      this.supabase,
      {
        verifyDeckAccess: (uid, deckId, level) =>
          this.verifyDeckAccess(uid, deckId, level),
        resolveNoteAccess: (noteId, uid) => this.resolveNoteAccess(noteId, uid),
        isDmThreadParticipant: (threadId, uid) =>
          this.isDmThreadParticipant(threadId, uid),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        isProfileVisibleToViewer: (viewerId, targetId) =>
          this.isProfileVisibleToViewer(viewerId, targetId),
        canViewPeerChatAvatar: (viewerId, peerId) =>
          this.canViewPeerChatAvatar(viewerId, peerId),
      },
      userId,
      bucket,
      path,
    );
  }

  /** @internal — no caller outside this file. */
  private escapeIlikePattern(value: string): string {
    return storageAclData.escapeIlikePattern(value);
  }

  /** True when stored image_url refers to exactly this storage object (not a substring plant). */
  private storageUrlMatchesObject(
    imageUrl: string | null | undefined,
    bucket: string,
    path: string,
  ): boolean {
    return storageAclData.storageUrlMatchesObject(imageUrl, bucket, path);
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
    return storageAclData.canAccessFlashcardImage(
      this.supabase,
      {
        verifyDeckAccess: (uid, deckId, level) =>
          this.verifyDeckAccess(uid, deckId, level),
      },
      userId,
      path,
    );
  }

  /**
   * True when the image is on a group message the user can see, and the uploader
   * (path owner) is also a member of that group (blocks URL planting).
   */
  private async canAccessQuestionImage(
    userId: string,
    path: string,
  ): Promise<boolean> {
    return storageAclData.canAccessQuestionImage(
      this.supabase,
      { isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid) },
      userId,
      path,
    );
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
    this.supabase = dataClient.createDataClient(config);
  }

  // Get the raw Supabase client for direct operations (RPC calls, etc.)
  getClient() {
    return this.supabase;
  }

  // ===========================================================================
  // USERS AND PROFILES
  //
  // CRUD over `profiles` plus the derived reads clients treat as part of a
  // user: stats (`getUserStats`), group membership (`getUserGroups`), push
  // token registration, and account export/erasure entry points
  // (`exportUserData`, `deleteUser`, `deleteUserProfileOnly`).
  //
  // Visibility is decided HERE, not by RLS: `isProfileVisibleToViewer` is the
  // predicate every non-self profile read must pass, and `canViewPeerChatAvatar`
  // is the narrower "we share a DM or a group" grant used for chat bubbles.
  // The storage ACL above calls both.
  //
  // Display names are scrubbed of email addresses on the way out
  // (`scrubEmailFromDisplayName`) because a signup that defaulted the name to
  // the email would otherwise publish it.
  //
  // Caching: `user:${userId}:profile` and friends, invalidated by
  // `cacheService.invalidateUserCache(userId)` on every write. A profile edit
  // also has to clear the places the profile is EMBEDDED — group member lists,
  // message author previews — which is what
  // `invalidateProfilePresentationCaches` does with `deletePattern`.
  // ===========================================================================
  // User/Profile Functions
  //
  // EXTRACTED (monolith lane M1b, step 6): the bodies now live in
  // `data/users.ts`, together with the three module-scope helpers only this
  // section used (`mapProfileRowToUser`, `toNullableInt`,
  // `buildProfileUpsertRow`). What is left here is delegation.

  async fetchUserProfile(userId: string): Promise<User | null> {
    return usersData.fetchUserProfile(this.supabase, userId);
  }

  async updateUserProfile(
    userId: string,
    updates: Partial<User>,
  ): Promise<User> {
    return usersData.updateUserProfile(this.supabase, userId, updates);
  }

  async updateExpoPushToken(userId: string, token: string): Promise<void> {
    return usersData.updateExpoPushToken(this.supabase, userId, token);
  }

  async clearExpoPushToken(userId: string): Promise<void> {
    return usersData.clearExpoPushToken(this.supabase, userId);
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
    return usersData.sendExpoPushForNotification(
      this.supabase,
      userId,
      notification,
    );
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
    return usersData.createUserProfile(this.supabase, profile);
  }

  // New User Methods for API Routes
  async getUsers(
    options: { page?: number; limit?: number; search?: string } = {},
  ): Promise<User[]> {
    return usersData.getUsers(this.supabase, options);
  }

  async getUserById(userId: string): Promise<User | null> {
    return usersData.getUserById(this.supabase, userId);
  }

  async isProfileVisibleToViewer(
    viewerId: string,
    targetId: string,
  ): Promise<boolean> {
    return usersData.isProfileVisibleToViewer(this.supabase, viewerId, targetId);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return usersData.getUserByEmail(this.supabase, email);
  }

  /**
   * Resolve a UUID, @username, email, or display name to a profile id.
   * SEC-06: resolution failures use one generic message (no email/ID existence leak).
   */
  async resolveCollaboratorUserId(identifier: string): Promise<string> {
    return usersData.resolveCollaboratorUserId(this.supabase, identifier);
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
    return usersData.createUser(this.supabase, userData);
  }

  /** @internal — no caller outside this file. */
  private async invalidateProfilePresentationCaches(
    userId: string,
  ): Promise<void> {
    return usersData.invalidateProfilePresentationCaches(this.supabase, userId);
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
    return usersData.updateUser(this.supabase, userId, updates, options);
  }

  /**
   * @deprecated Loses the deletion report. Call
   * `deleteUserAccountFully` directly — it returns `{ ok, found, purged,
   * failures }` and a caller that only sees this boolean cannot tell a complete
   * erasure from one that left files in a bucket. Kept for back-compat; `false`
   * means "no such account", never "partially deleted".
   */
  async deleteUser(userId: string): Promise<boolean> {
    // The lazy `import()` stays HERE, at the facade, because
    // `deleteUserAccountFully` takes the whole `SupabaseService` — importing
    // it from `data/users.ts` would point the data layer back at this file.
    return usersData.deleteUser(
      {
        deleteUserAccountFully: async (id) =>
          (await import("./userDataLifecycle")).deleteUserAccountFully(this, id),
      },
      userId,
    );
  }

  async exportUserData(userId: string): Promise<Record<string, unknown>> {
    return usersData.exportUserData(
      this.supabase,
      {
        exportUserDataArchive: async (id) =>
          (await import("./userDataLifecycle")).exportUserDataArchive(this, id),
      },
      userId,
    );
  }

  /** @deprecated use deleteUser — kept for internal reference */
  async deleteUserProfileOnly(userId: string): Promise<boolean> {
    return usersData.deleteUserProfileOnly(this.supabase, userId);
  }

  async getUserStats(userId: string): Promise<any> {
    return usersData.getUserStats(this.supabase, userId);
  }

  async getUserGroups(
    userId: string,
    options: { page?: number; limit?: number } = {},
  ): Promise<Group[]> {
    return usersData.getUserGroups(this.supabase, userId, options);
  }

  // ===========================================================================
  // GROUPS AND MEMBERSHIP
  //
  // `groups` + `group_members`, plus the invite lifecycle (invite id lookup,
  // accept/decline, batch add) and the roster reads.
  //
  // This block owns the authorization primitives the rest of the file leans
  // on, so they are the most reused predicates in the server:
  //
  //   isGroupMember(groupId, userId)        — may read the group's content
  //   isGroupAdmin(groupId, userId)         — may moderate it
  //   isDmThreadParticipant(threadId, uid)  — the DM equivalent
  //   getAuthorizedGroupMessage(...)        — membership + the message row
  //   getAuthorizedDmMessage(...)           — participation + the message row
  //   canNotifyUser(...)                    — may address a notification at them
  //
  // Prefer the `getAuthorized*Message` helpers over fetching a message and
  // checking membership separately: they are what makes "can see" and "can
  // read this row" one decision. They prove membership only — a write on
  // someone ELSE's message additionally needs author-or-admin, which is the
  // rule `routes/messages.ts` applies for both `/status` and the
  // similarity-flag route.
  //
  // Paging is clamped by the DEFAULT_/MAX_GROUP_PAGE_SIZE constants on the
  // class; list caches are keyed `groups:list:*` and every membership change
  // clears them by pattern alongside the per-group and per-user caches.
  // ===========================================================================
  // EXTRACTED (monolith lane M1c, step 10): the bodies now live in
  // `data/groups.ts`. `DEFAULT_GROUP_PAGE_SIZE`, `MAX_GROUP_PAGE_SIZE` and
  // `GROUP_COLUMNS_BASE` moved with them — nothing outside the section read
  // any of the three.
  //
  // Eight of these call a sibling predicate. The `deps` literal is written out
  // INLINE at those eight call sites, and it MUST stay that way: suites across
  // `routes/messages.*`, `routes/groups.*`, `supabase.bookmarks.test.ts` and
  // `storageAccess.test.ts` stub exactly these predicates on a stand-in and
  // drive the entry point through `SupabaseService.prototype.<m>.call(self, …)`.
  // An instance field holding the deps reads as `undefined` there, and the
  // arrows read `this.<method>` at CALL time so a `jest.spyOn` still
  // intercepts.
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
    return groupsData.getGroups(
      this.supabase,
      {
        getGroupById: (id, uid) => this.getGroupById(id, uid),
        isGroupMember: (id, uid) => this.isGroupMember(id, uid),
        isDmThreadParticipant: (tid, uid) =>
          this.isDmThreadParticipant(tid, uid),
        acceptGroupInvite: (id, uid) => this.acceptGroupInvite(id, uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
        incrementUserStatsAndAwardBadges: (uid, increments) =>
          this.incrementUserStatsAndAwardBadges(uid, increments),
      },
      options,
    );
  }

  async getGroupById(groupId: string, userId?: string): Promise<Group | null> {
    return groupsData.getGroupById(this.supabase, groupId, userId);
  }

  async createGroup(
    groupData: Partial<Group>,
    userId: string,
    memberIds: string[] = [],
  ): Promise<Group> {
    return groupsData.createGroup(
      this.supabase,
      {
        getGroupById: (id, uid) => this.getGroupById(id, uid),
        isGroupMember: (id, uid) => this.isGroupMember(id, uid),
        isDmThreadParticipant: (tid, uid) =>
          this.isDmThreadParticipant(tid, uid),
        acceptGroupInvite: (id, uid) => this.acceptGroupInvite(id, uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
        incrementUserStatsAndAwardBadges: (uid, increments) =>
          this.incrementUserStatsAndAwardBadges(uid, increments),
      },
      groupData,
      userId,
      memberIds,
    );
  }

  async updateGroup(
    groupId: string,
    updates: Partial<Group>,
  ): Promise<Group | null> {
    return groupsData.updateGroup(
      this.supabase,
      {
        getGroupById: (id, uid) => this.getGroupById(id, uid),
        isGroupMember: (id, uid) => this.isGroupMember(id, uid),
        isDmThreadParticipant: (tid, uid) =>
          this.isDmThreadParticipant(tid, uid),
        acceptGroupInvite: (id, uid) => this.acceptGroupInvite(id, uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
        incrementUserStatsAndAwardBadges: (uid, increments) =>
          this.incrementUserStatsAndAwardBadges(uid, increments),
      },
      groupId,
      updates,
    );
  }

  async getGroupByInviteId(inviteId: string): Promise<Group | null> {
    return groupsData.getGroupByInviteId(this.supabase, inviteId);
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
    return groupsData.addGroupMember(
      this.supabase,
      {
        getGroupById: (id, uid) => this.getGroupById(id, uid),
        isGroupMember: (id, uid) => this.isGroupMember(id, uid),
        isDmThreadParticipant: (tid, uid) =>
          this.isDmThreadParticipant(tid, uid),
        acceptGroupInvite: (id, uid) => this.acceptGroupInvite(id, uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
        incrementUserStatsAndAwardBadges: (uid, increments) =>
          this.incrementUserStatsAndAwardBadges(uid, increments),
      },
      groupId,
      userId,
      options,
    );
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
    return groupsData.addGroupMembersBatch(this.supabase, groupId, userIds);
  }

  async acceptGroupInvite(groupId: string, userId: string): Promise<boolean> {
    return groupsData.acceptGroupInvite(this.supabase, groupId, userId);
  }

  async declineGroupInvite(groupId: string, userId: string): Promise<boolean> {
    return groupsData.declineGroupInvite(this.supabase, groupId, userId);
  }

  async getPendingGroupInvitesForUser(userId: string): Promise<
    Array<{
      groupId: string;
      groupName: string;
      avatarUrl?: string;
      invitedAt?: string;
    }>
  > {
    return groupsData.getPendingGroupInvitesForUser(this.supabase, userId);
  }

  async isGroupMember(groupId: string, userId: string): Promise<boolean> {
    return groupsData.isGroupMember(this.supabase, groupId, userId);
  }

  async isDmThreadParticipant(
    threadId: string,
    userId: string,
  ): Promise<boolean> {
    return groupsData.isDmThreadParticipant(this.supabase, threadId, userId);
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
    return groupsData.getAuthorizedDmMessage(
      this.supabase,
      {
        getGroupById: (id, uid) => this.getGroupById(id, uid),
        isGroupMember: (id, uid) => this.isGroupMember(id, uid),
        isDmThreadParticipant: (tid, uid) =>
          this.isDmThreadParticipant(tid, uid),
        acceptGroupInvite: (id, uid) => this.acceptGroupInvite(id, uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
        incrementUserStatsAndAwardBadges: (uid, increments) =>
          this.incrementUserStatsAndAwardBadges(uid, increments),
      },
      messageId,
      userId,
    );
  }

  /**
   * True when viewer may see peer's profile avatar in chat (DM partner or shared active group),
   * even if the peer's profile visibility is private.
   */
  async canViewPeerChatAvatar(
    viewerId: string,
    peerId: string,
  ): Promise<boolean> {
    return groupsData.canViewPeerChatAvatar(this.supabase, viewerId, peerId);
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
    return groupsData.getAuthorizedGroupMessage(
      this.supabase,
      messageId,
      userId,
    );
  }

  async isGroupAdmin(groupId: string, userId: string): Promise<boolean> {
    return groupsData.isGroupAdmin(
      this.supabase,
      {
        getGroupById: (id, uid) => this.getGroupById(id, uid),
        isGroupMember: (id, uid) => this.isGroupMember(id, uid),
        isDmThreadParticipant: (tid, uid) =>
          this.isDmThreadParticipant(tid, uid),
        acceptGroupInvite: (id, uid) => this.acceptGroupInvite(id, uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
        incrementUserStatsAndAwardBadges: (uid, increments) =>
          this.incrementUserStatsAndAwardBadges(uid, increments),
      },
      groupId,
      userId,
    );
  }

  /** Whether an authenticated user may deliver a notification to another user. */
  async canNotifyUser(
    requestingUserId: string,
    targetUserId: string,
    link?: string,
  ): Promise<boolean> {
    return groupsData.canNotifyUser(
      this.supabase,
      {
        getGroupById: (id, uid) => this.getGroupById(id, uid),
        isGroupMember: (id, uid) => this.isGroupMember(id, uid),
        isDmThreadParticipant: (tid, uid) =>
          this.isDmThreadParticipant(tid, uid),
        acceptGroupInvite: (id, uid) => this.acceptGroupInvite(id, uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
        incrementUserStatsAndAwardBadges: (uid, increments) =>
          this.incrementUserStatsAndAwardBadges(uid, increments),
      },
      requestingUserId,
      targetUserId,
      link,
    );
  }

  async removeGroupMember(
    groupId: string,
    userId: string,
  ): Promise<Group | null> {
    return groupsData.removeGroupMember(
      this.supabase,
      {
        getGroupById: (id, uid) => this.getGroupById(id, uid),
        isGroupMember: (id, uid) => this.isGroupMember(id, uid),
        isDmThreadParticipant: (tid, uid) =>
          this.isDmThreadParticipant(tid, uid),
        acceptGroupInvite: (id, uid) => this.acceptGroupInvite(id, uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
        incrementUserStatsAndAwardBadges: (uid, increments) =>
          this.incrementUserStatsAndAwardBadges(uid, increments),
      },
      groupId,
      userId,
    );
  }

  async deleteGroup(groupId: string): Promise<void> {
    return groupsData.deleteGroup(this.supabase, groupId);
  }

  async getGroupMembers(
    groupId: string,
    options: { page?: number; limit?: number; requestingUserId?: string } = {},
  ): Promise<User[]> {
    return groupsData.getGroupMembers(this.supabase, groupId, options);
  }

  async getGroupStats(groupId: string): Promise<any> {
    return groupsData.getGroupStats(this.supabase, groupId);
  }

  // ===========================================================================
  // GROUP MESSAGES — reads, edits, votes, reactions
  //
  // `messages` is the busiest table in the file and serves three products at
  // once: group chat, the community board, and the peer question bank. A row's
  // `type`/`questionType` decides which, so a change here lands on all three.
  //
  // What lives in this block:
  //   - paged reads (`getGroupMessages`, `getMessageById`) with the reply,
  //     thread-count, receipt and peer-upvote enrichments attached afterwards
  //     rather than embedded, so one missing table degrades one field;
  //   - edit/remove (`editChatMessage`, `removeChatMessage`) with the pin
  //     cleanup and the cache/preview refresh that must follow every mutation
  //     (`refreshChatPreview`, `invalidateChatMessageMutation`,
  //     `refreshChatMessageNotifications`);
  //   - peer verification: `voteQuestion` / `removeVote` on `question_votes`,
  //     with `syncQuestionStatusAfterVote` recomputing the question's status
  //     from `countPeerUpvotes` + `canVerifyQuestion` in shared;
  //   - emoji reactions on `message_reactions`, one table for group and DM.
  //
  // Authorization is the CALLER's job on every write here: these methods take
  // ids and write. Route handlers must have gone through
  // `getAuthorizedGroupMessage` / `getAuthorizedDmMessage` first, and for a
  // write on content the caller did not author, the author-or-group-admin rule.
  // ===========================================================================
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

        return withPeerUpvotes
          .reverse()
          .map((msg: any) =>
            mapChatMessageRow(msg, this.normalizeMessageRecord(msg)),
          );
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
  // KNOWN ISSUE (tracked, deferred F10: planned refactor stage — the
  // schemaCapabilities consolidation rides with the services/supabase.ts
  // god-object split, and moving these ladders piecemeal ahead of it would
  // spread a half-migrated convention across a 17k-line file):
  // this is one of several ad-hoc schema-degradation
  // ladders in this file (see also `bookmarksMissingTable`,
  // `isMissingRatingColumn`, `writeWithTopicFallback`,
  // `isMissingCoverPathColumn`) that compare `error.code` against '42P01' /
  // '42703' / 'PGRST204' / 'PGRST205' inline instead of using the
  // `schemaCapabilities.ts` helpers. They cannot simply be deleted: the repo
  // keeps no record of which migrations are actually applied to production, so
  // there is no way to prove from the tree that the column or table now exists.
  // Consolidate them behind schemaCapabilities before removing any.
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
    // The `onConflict` target must name a PLAIN unique index. PostgREST cannot
    // use a PARTIAL unique index (`… WHERE group_message_id IS NOT NULL`) as a
    // conflict target, and the upsert then 500s at runtime with no compile-time
    // or test signal — that is exactly how every reaction and every favorite
    // broke silently for several releases. `message_reactions` carries one
    // nullable FK per scope, which makes a partial index the tempting shape;
    // it is not a usable one. Verify the index before changing this string.
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

  // ===========================================================================
  // DECKS AND FLASHCARDS
  //
  // `decks`, `flashcards`, `deck_collaborators`, `flashcard_comments`, and the
  // per-question mastery in `user_question_stats`.
  //
  // Access predicate: `verifyDeckAccess(userId, deckId, "read" | "edit")` is
  // the ONE gate — owner, collaborator at the right role, or a share that
  // grants read. `getAccessibleDeckIds` is its bulk form for list queries, and
  // `getDeckForUser` / `getFlashcardForUser` are the fetch-plus-check pairs.
  // The storage ACL calls `verifyDeckAccess` for cover and flashcard images,
  // so widening it widens image access too.
  //
  // Spaced repetition: `reviewFlashcard` runs `calculateFsrsData` from shared
  // and writes the scheduling columns back, honouring `getSrsMaxInterval` from
  // the user's normalized settings. Deck statistics are derived, and
  // `resetDeckStatistics` clears them.
  //
  // Bulk creation (`createDeckWithCards`) prefers an RPC for atomicity and
  // falls back to a deck insert plus card insert with
  // `deleteDeckRowBestEffort` as the compensating action when the cards fail —
  // a half-created deck is worse than none.
  //
  // Concurrent edits raise `VersionConflictError` rather than last-write-wins,
  // so a collaborator never silently overwrites another's edit.
  // ===========================================================================
  // EXTRACTED (monolith lane M1b, step 7): the bodies now live in
  // `data/decks.ts`. The deck ACCESS gate (`verifyDeckAccess`,
  // `getAccessibleDeckIds`, `getDeckForUser`) is not there yet — it sits
  // inside the OFFLINE BUNDLES banner below, misfiled, and moves with that
  // section — so it, and the course/topic resolvers, are injected as `deps`.
  //
  // The literal is written out INLINE at all eleven call sites, and it MUST
  // stay that way. Several `supabase.*.test.ts` suites invoke these methods
  // through `SupabaseService.prototype.<m>.call({ supabase }, …)` on a bare
  // stand-in that never ran a constructor, so an instance field holding the
  // deps reads as `undefined` there (it fails exactly this way — try it). The
  // arrows also read `this.<method>` at CALL time, so a `jest.spyOn` still
  // intercepts.

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
    return decksData.createDeck(
      this.supabase,
      {
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getDeckForUser: (id, uid) => this.getDeckForUser(id, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        resolveArtefactTopicPatch: (table, id, updates) =>
          this.resolveArtefactTopicPatch(table, id, updates),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      deckData,
      userId,
    );
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
    return decksData.createDeckWithCards(
      this.supabase,
      {
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getDeckForUser: (id, uid) => this.getDeckForUser(id, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        resolveArtefactTopicPatch: (table, id, updates) =>
          this.resolveArtefactTopicPatch(table, id, updates),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      deckData,
      cards,
      userId,
    );
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
    return decksData.addCardsToExistingDeck(
      this.supabase,
      {
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getDeckForUser: (id, uid) => this.getDeckForUser(id, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        resolveArtefactTopicPatch: (table, id, updates) =>
          this.resolveArtefactTopicPatch(table, id, updates),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      deckId,
      cards,
      userId,
    );
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
    return decksData.tryCreateDeckWithCardsRpc(
      this.supabase,
      deckData,
      topicId,
      cards,
      userId,
    );
  }

  private async getDeckRow(deckId: string): Promise<any> {
    return decksData.getDeckRow(
      this.supabase,
      deckId,
    );
  }

  private async getDeckCardRows(deckId: string): Promise<any[]> {
    return decksData.getDeckCardRows(
      this.supabase,
      deckId,
    );
  }

  /** Best effort: report whether the orphan deck row is actually gone. */
  private async deleteDeckRowBestEffort(deckId: string): Promise<boolean> {
    return decksData.deleteDeckRowBestEffort(
      this.supabase,
      deckId,
    );
  }

  private async invalidateDeckCaches(userId: string, deckId?: string): Promise<void> {
    return decksData.invalidateDeckCaches(
      this.supabase,
      userId,
      deckId,
    );
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
    return decksData.getDecks(
      this.supabase,
      {
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getDeckForUser: (id, uid) => this.getDeckForUser(id, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        resolveArtefactTopicPatch: (table, id, updates) =>
          this.resolveArtefactTopicPatch(table, id, updates),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      userId,
      includeShared,
      options,
    );
  }

  async getSharedDecks(): Promise<any[]> {
    return decksData.getSharedDecks(
      this.supabase,
    );
  }

  async getDeckCollaborators(deckId: string, userId: string): Promise<any[]> {
    return decksData.getDeckCollaborators(
      this.supabase,
      {
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getDeckForUser: (id, uid) => this.getDeckForUser(id, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        resolveArtefactTopicPatch: (table, id, updates) =>
          this.resolveArtefactTopicPatch(table, id, updates),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      deckId,
      userId,
    );
  }

  async addDeckCollaborator(
    deckId: string,
    userId: string,
    role: string = "editor",
    requesterId?: string,
  ): Promise<any> {
    return decksData.addDeckCollaborator(
      this.supabase,
      {
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getDeckForUser: (id, uid) => this.getDeckForUser(id, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        resolveArtefactTopicPatch: (table, id, updates) =>
          this.resolveArtefactTopicPatch(table, id, updates),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      deckId,
      userId,
      role,
      requesterId,
    );
  }

  async removeDeckCollaborator(
    deckId: string,
    userId: string,
    requesterId?: string,
  ): Promise<boolean> {
    return decksData.removeDeckCollaborator(
      this.supabase,
      {
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getDeckForUser: (id, uid) => this.getDeckForUser(id, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        resolveArtefactTopicPatch: (table, id, updates) =>
          this.resolveArtefactTopicPatch(table, id, updates),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      deckId,
      userId,
      requesterId,
    );
  }

  async getDeck(deckId: string): Promise<any | null> {
    return decksData.getDeck(
      this.supabase,
      deckId,
    );
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
    return decksData.updateDeck(
      this.supabase,
      {
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getDeckForUser: (id, uid) => this.getDeckForUser(id, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        resolveArtefactTopicPatch: (table, id, updates) =>
          this.resolveArtefactTopicPatch(table, id, updates),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      deckId,
      updates,
      userId,
    );
  }

  async deleteDeck(deckId: string, userId: string): Promise<boolean> {
    return decksData.deleteDeck(
      this.supabase,
      {
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getDeckForUser: (id, uid) => this.getDeckForUser(id, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        resolveArtefactTopicPatch: (table, id, updates) =>
          this.resolveArtefactTopicPatch(table, id, updates),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      deckId,
      userId,
    );
  }

  async exportDeck(deckId: string, userId: string): Promise<any | null> {
    return decksData.exportDeck(
      this.supabase,
      {
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getDeckForUser: (id, uid) => this.getDeckForUser(id, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        resolveArtefactTopicPatch: (table, id, updates) =>
          this.resolveArtefactTopicPatch(table, id, updates),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      deckId,
      userId,
    );
  }

  async importDeck(importData: any, userId: string): Promise<any> {
    return decksData.importDeck(
      this.supabase,
      importData,
      userId,
    );
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
    return decksData.replaceDeckCards(
      this.supabase,
      deckId,
      cards,
    );
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
    return decksData.createFlashcard(
      this.supabase,
      {
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getDeckForUser: (id, uid) => this.getDeckForUser(id, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        resolveArtefactTopicPatch: (table, id, updates) =>
          this.resolveArtefactTopicPatch(table, id, updates),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      flashcardData,
    );
  }

  // ===========================================================================
  // IMAGE AND FILE UPLOADS
  //
  // Every bytes-into-Storage path in the server: flashcard images, deck/note/
  // study-set covers, marketplace listing images, chat images and audio,
  // question images, profile and group avatars, and note file attachments.
  //
  // The shared shape, and the parts a new upload must copy:
  //   - a size ceiling checked on the decoded buffer, before any processing;
  //   - `assertImageMagicBytes` — the declared content type is never trusted;
  //     a file is what its bytes say it is;
  //   - `processImageForUpload` normalizes to WebP (animated GIFs pass
  //     through) and yields an optional thumb, uploaded best-effort by
  //     `uploadSiblingThumb` so a thumb failure never fails the real upload;
  //   - a path whose FIRST segment is the owner's user id, because the storage
  //     ACL above derives authorization from that segment. Owner and artefact
  //     id segments are stripped to `[A-Za-z0-9_-]` so neither can introduce a
  //     separator or a traversal;
  //   - `upsert: false` plus a timestamp in the filename, because the objects
  //     are served with an immutable cache header and reusing a path would
  //     serve the old picture forever;
  //   - the bucket is created on demand by the service role, so there is no
  //     manual dashboard step — but a new bucket must also be added to
  //     `PRIVATE_STORAGE_BUCKETS`, or the deny-by-default gate refuses to sign
  //     anything in it.
  //
  // Callers persist the returned PATH, never the URL: signed URLs expire (24 h
  // maximum), and a frozen signed URL stored in a row is how chat and board
  // photos went blank after a day.
  // ===========================================================================
  // EXTRACTED (monolith lane M1b, step 8): the bodies now live in
  // `data/uploads.ts`. Signing is INJECTED rather than imported sibling-to-
  // sibling from `data/storageAcl.ts`: `coverImages.test.ts` spies on
  // `createSignedStorageUrl` HERE and asserts the upload returns what the spy
  // produced, so a direct call would step around it. The two chat uploads also
  // take the group / DM membership checks, which still live in this file.
  //
  // The literals are INLINE for the reason spelled out on the decks block
  // above: these methods are also invoked on bare stand-ins in tests.

  /** Best-effort sibling thumb upload; failures never fail the parent upload. */
  private async uploadSiblingThumb(
    bucket: string,
    filePath: string,
    thumb: Buffer | null,
  ): Promise<void> {
    return uploadsData.uploadSiblingThumb(
      this.supabase,
      bucket,
      filePath,
      thumb,
    );
  }

  async uploadFlashcardImage(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    folder?: string;
  }): Promise<{ url: string; path: string }> {
    return uploadsData.uploadFlashcardImage(
      this.supabase,
      {
        createSignedStorageUrl: (bucket, path, ttl) =>
          this.createSignedStorageUrl(bucket, path, ttl),
        createSignedStorageUrlWithVariant: (bucket, path, ttl, variant) =>
          this.createSignedStorageUrlWithVariant(bucket, path, ttl, variant),
      },
      params,
    );
  }

  /**
   * Cheap probe: is `cover_path` there at all?
   *
   * Called BEFORE any byte is uploaded. Storing first and discovering the
   * missing column afterwards leaves an orphan object behind on every attempt
   * — and the cleanup runs against the same storage that may itself be the
   * thing that is broken. One `select ... limit 1` costs nothing and makes a
   * missing migration a clean 503.
   */
  async assertCoverColumn(
    kind: "deck" | "note" | "study-set",
  ): Promise<void> {
    return uploadsData.assertCoverColumn(
      this.supabase,
      kind,
    );
  }

  /**
   * Store a deck/note cover image.
   *
   * Mirrors uploadFlashcardImage: magic-byte validated, normalized to WebP
   * (animated GIFs pass through), with a best-effort 320px sibling thumb. The
   * caller persists the returned PATH — the signed URLs expire in 24h.
   */
  async uploadCoverImage(params: {
    userId: string;
    kind: "deck" | "note" | "study-set";
    id: string;
    fileName: string;
    base64Data: string;
    contentType: string;
  }): Promise<{ path: string; url: string; thumbUrl: string | null }> {
    return uploadsData.uploadCoverImage(
      this.supabase,
      {
        createSignedStorageUrl: (bucket, path, ttl) =>
          this.createSignedStorageUrl(bucket, path, ttl),
        createSignedStorageUrlWithVariant: (bucket, path, ttl, variant) =>
          this.createSignedStorageUrlWithVariant(bucket, path, ttl, variant),
      },
      params,
    );
  }

  /** Best-effort removal of a cover object and its sibling thumb. Never throws. */
  async deleteCoverObject(coverPath: string | null | undefined): Promise<void> {
    return uploadsData.deleteCoverObject(
      this.supabase,
      coverPath,
    );
  }

  /**
   * Write (or clear with null) a deck cover path. Owner-scoped.
   * Returns the PREVIOUS path so the caller can delete the replaced object.
   */
  async setDeckCoverPath(
    deckId: string,
    userId: string,
    coverPath: string | null,
  ): Promise<{ previousPath: string | null }> {
    return uploadsData.setDeckCoverPath(
      this.supabase,
      deckId,
      userId,
      coverPath,
    );
  }

  /** Same for notes. Owner-scoped: a cover is the owner's presentation choice. */
  async setNoteCoverPath(
    noteId: string,
    userId: string,
    coverPath: string | null,
  ): Promise<{ previousPath: string | null }> {
    return uploadsData.setNoteCoverPath(
      this.supabase,
      noteId,
      userId,
      coverPath,
    );
  }

  /**
   * Same for a study set. Owner-scoped for the same reason decks are: a set's
   * cover is the shape the owner chose for it, and `study_sets` rows are
   * already owner-only.
   */
  async setStudySetCoverPath(
    setId: string,
    userId: string,
    coverPath: string | null,
  ): Promise<{ previousPath: string | null }> {
    return uploadsData.setStudySetCoverPath(
      this.supabase,
      setId,
      userId,
      coverPath,
    );
  }

  /** SEC-07: marketplace images — magic-byte validated server upload. */
  async uploadMarketplaceImage(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    listingId?: string;
    purpose?: "shop" | "listing";
  }): Promise<{ url: string; path: string; storageUrl: string }> {
    return uploadsData.uploadMarketplaceImage(
      this.supabase,
      {
        createSignedStorageUrl: (bucket, path, ttl) =>
          this.createSignedStorageUrl(bucket, path, ttl),
        createSignedStorageUrlWithVariant: (bucket, path, ttl, variant) =>
          this.createSignedStorageUrlWithVariant(bucket, path, ttl, variant),
      },
      params,
    );
  }

  /** SEC-07: chat images stored under note-files/{userId}/chat/{groupId}/... */
  async uploadChatImage(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    groupId?: string;
  }): Promise<{ url: string; path: string }> {
    return uploadsData.uploadChatImage(
      this.supabase,
      {
        createSignedStorageUrl: (bucket, path, ttl) =>
          this.createSignedStorageUrl(bucket, path, ttl),
        createSignedStorageUrlWithVariant: (bucket, path, ttl, variant) =>
          this.createSignedStorageUrlWithVariant(bucket, path, ttl, variant),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        isDmThreadParticipant: (threadId, uid) =>
          this.isDmThreadParticipant(threadId, uid),
      },
      params,
    );
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
    return uploadsData.uploadChatAudio(
      this.supabase,
      {
        createSignedStorageUrl: (bucket, path, ttl) =>
          this.createSignedStorageUrl(bucket, path, ttl),
        createSignedStorageUrlWithVariant: (bucket, path, ttl, variant) =>
          this.createSignedStorageUrlWithVariant(bucket, path, ttl, variant),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        isDmThreadParticipant: (threadId, uid) =>
          this.isDmThreadParticipant(threadId, uid),
      },
      params,
    );
  }

  /** SEC-07: question/message images — magic-byte validated server upload. */
  async uploadQuestionImage(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
  }): Promise<{ url: string; path: string }> {
    return uploadsData.uploadQuestionImage(
      this.supabase,
      {
        createSignedStorageUrl: (bucket, path, ttl) =>
          this.createSignedStorageUrl(bucket, path, ttl),
        createSignedStorageUrlWithVariant: (bucket, path, ttl, variant) =>
          this.createSignedStorageUrlWithVariant(bucket, path, ttl, variant),
      },
      params,
    );
  }

  async uploadProfileAvatar(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
  }): Promise<{ url: string; path: string; avatarUrl: string }> {
    return uploadsData.uploadProfileAvatar(
      this.supabase,
      {
        createSignedStorageUrl: (bucket, path, ttl) =>
          this.createSignedStorageUrl(bucket, path, ttl),
        createSignedStorageUrlWithVariant: (bucket, path, ttl, variant) =>
          this.createSignedStorageUrlWithVariant(bucket, path, ttl, variant),
      },
      params,
    );
  }

  async uploadGroupAvatar(params: {
    groupId: string;
    fileName: string;
    base64Data: string;
    contentType: string;
  }): Promise<{ url: string; path: string; avatarUrl: string }> {
    return uploadsData.uploadGroupAvatar(
      this.supabase,
      {
        createSignedStorageUrl: (bucket, path, ttl) =>
          this.createSignedStorageUrl(bucket, path, ttl),
        createSignedStorageUrlWithVariant: (bucket, path, ttl, variant) =>
          this.createSignedStorageUrlWithVariant(bucket, path, ttl, variant),
      },
      params,
    );
  }

  // ===========================================================================
  // OFFLINE BUNDLES
  //
  // `offline_bundles` holds the per-user snapshots the mobile app downloads to
  // study without a connection, filed against a course like every other
  // artefact (`courseFilter`: unfiled → IS NULL, course → eq).
  //
  // Rows are owner-scoped on every read, write and delete; the upsert conflict
  // target is the plain `(user_id, bundle_id)` unique index, so re-saving a
  // bundle replaces the snapshot rather than accumulating copies.
  // ===========================================================================
  // EXTRACTED (monolith lane M1c, step 9): the bodies now live in
  // `data/offlineBundles.ts`. Only the first three methods are really about
  // bundles — the deck access gate, the flashcard row layer and the
  // per-question stats drifted under this banner years ago and move as one
  // unit so the plan's step boundary stays honest. See that module's banner.
  //
  // Several of these methods call each other. The `deps` literal is written
  // out INLINE at all nine call sites that need it, and it MUST stay that way.
  // `supabase.resetDeck.test.ts`, `learningEvents.test.ts` and
  // `supabase.deckWithCards.test.ts` stub these methods on a bare stand-in and
  // drive the entry point through `SupabaseService.prototype.<m>.call(self, …)`;
  // an instance field holding the deps reads as `undefined` there, and the
  // arrows read `this.<method>` at CALL time so a `jest.spyOn` still
  // intercepts.
  // Offline bundle persistence
  async getOfflineBundles(
    userId: string,
    options: {
      /** Academic archive filter (offline_bundles.course_id): unfiled → IS NULL, course → eq. */
      courseFilter?: CourseFilter;
    } = {},
  ): Promise<any[]> {
    return offlineBundlesData.getOfflineBundles(this.supabase, userId, options);
  }

  async saveOfflineBundle(userId: string, bundle: any): Promise<void> {
    return offlineBundlesData.saveOfflineBundle(this.supabase, userId, bundle);
  }

  async deleteOfflineBundle(userId: string, bundleId: string): Promise<void> {
    return offlineBundlesData.deleteOfflineBundle(
      this.supabase,
      userId,
      bundleId,
    );
  }

  async getAccessibleDeckIds(userId: string): Promise<string[]> {
    return offlineBundlesData.getAccessibleDeckIds(this.supabase, userId);
  }

  /** Internal fetch — no access check. */
  private async fetchDeckRecord(deckId: string): Promise<any | null> {
    return offlineBundlesData.fetchDeckRecord(this.supabase, deckId);
  }

  async verifyDeckAccess(
    userId: string,
    deckId: string,
    level: "read" | "edit" | "owner" = "read",
  ): Promise<boolean> {
    return offlineBundlesData.verifyDeckAccess(
      this.supabase,
      {
        service: this,
        fetchDeckRecord: (id) => this.fetchDeckRecord(id),
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getFlashcard: (id) => this.getFlashcard(id),
        getFlashcardForUser: (id, uid) => this.getFlashcardForUser(id, uid),
        updateFlashcard: (id, updates, uid, options) =>
          this.updateFlashcard(id, updates, uid, options),
        attachQuestionStatStems: (rows) => this.attachQuestionStatStems(rows),
        getUserPreferences: (uid) => this.getUserPreferences(uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      userId,
      deckId,
      level,
    );
  }

  async getDeckForUser(deckId: string, userId: string): Promise<any | null> {
    return offlineBundlesData.getDeckForUser(
      this.supabase,
      {
        service: this,
        fetchDeckRecord: (id) => this.fetchDeckRecord(id),
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getFlashcard: (id) => this.getFlashcard(id),
        getFlashcardForUser: (id, uid) => this.getFlashcardForUser(id, uid),
        updateFlashcard: (id, updates, uid, options) =>
          this.updateFlashcard(id, updates, uid, options),
        attachQuestionStatStems: (rows) => this.attachQuestionStatStems(rows),
        getUserPreferences: (uid) => this.getUserPreferences(uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      deckId,
      userId,
    );
  }

  async getFlashcardForUser(
    flashcardId: string,
    userId: string,
  ): Promise<any | null> {
    return offlineBundlesData.getFlashcardForUser(
      this.supabase,
      {
        service: this,
        fetchDeckRecord: (id) => this.fetchDeckRecord(id),
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getFlashcard: (id) => this.getFlashcard(id),
        getFlashcardForUser: (id, uid) => this.getFlashcardForUser(id, uid),
        updateFlashcard: (id, updates, uid, options) =>
          this.updateFlashcard(id, updates, uid, options),
        attachQuestionStatStems: (rows) => this.attachQuestionStatStems(rows),
        getUserPreferences: (uid) => this.getUserPreferences(uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      flashcardId,
      userId,
    );
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
    return offlineBundlesData.getFlashcards(
      this.supabase,
      {
        service: this,
        fetchDeckRecord: (id) => this.fetchDeckRecord(id),
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getFlashcard: (id) => this.getFlashcard(id),
        getFlashcardForUser: (id, uid) => this.getFlashcardForUser(id, uid),
        updateFlashcard: (id, updates, uid, options) =>
          this.updateFlashcard(id, updates, uid, options),
        attachQuestionStatStems: (rows) => this.attachQuestionStatStems(rows),
        getUserPreferences: (uid) => this.getUserPreferences(uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      userId,
      deckId,
      options,
    );
  }

  async getFlashcard(flashcardId: string): Promise<any | null> {
    return offlineBundlesData.getFlashcard(this.supabase, flashcardId);
  }

  async getFlashcardComments(flashcardId: string): Promise<any[]> {
    return offlineBundlesData.getFlashcardComments(this.supabase, flashcardId);
  }

  async addFlashcardComment(
    flashcardId: string,
    userId: string,
    comment: string,
  ): Promise<any> {
    return offlineBundlesData.addFlashcardComment(
      this.supabase,
      flashcardId,
      userId,
      comment,
    );
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
    return offlineBundlesData.reviewFlashcard(
      this.supabase,
      {
        service: this,
        fetchDeckRecord: (id) => this.fetchDeckRecord(id),
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getFlashcard: (id) => this.getFlashcard(id),
        getFlashcardForUser: (id, uid) => this.getFlashcardForUser(id, uid),
        updateFlashcard: (id, updates, uid, options) =>
          this.updateFlashcard(id, updates, uid, options),
        attachQuestionStatStems: (rows) => this.attachQuestionStatStems(rows),
        getUserPreferences: (uid) => this.getUserPreferences(uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      flashcardId,
      userId,
      rating,
      options,
    );
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
    return offlineBundlesData.updateFlashcard(
      this.supabase,
      {
        service: this,
        fetchDeckRecord: (id) => this.fetchDeckRecord(id),
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getFlashcard: (id) => this.getFlashcard(id),
        getFlashcardForUser: (id, uid) => this.getFlashcardForUser(id, uid),
        updateFlashcard: (id, updates, uid, options) =>
          this.updateFlashcard(id, updates, uid, options),
        attachQuestionStatStems: (rows) => this.attachQuestionStatStems(rows),
        getUserPreferences: (uid) => this.getUserPreferences(uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      flashcardId,
      updates,
      userId,
      options,
    );
  }

  async deleteFlashcard(
    flashcardId: string,
    userId?: string,
  ): Promise<boolean> {
    return offlineBundlesData.deleteFlashcard(
      this.supabase,
      {
        service: this,
        fetchDeckRecord: (id) => this.fetchDeckRecord(id),
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getFlashcard: (id) => this.getFlashcard(id),
        getFlashcardForUser: (id, uid) => this.getFlashcardForUser(id, uid),
        updateFlashcard: (id, updates, uid, options) =>
          this.updateFlashcard(id, updates, uid, options),
        attachQuestionStatStems: (rows) => this.attachQuestionStatStems(rows),
        getUserPreferences: (uid) => this.getUserPreferences(uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      flashcardId,
      userId,
    );
  }

  /**
   * Attach question stems / group names from chat messages so dashboards can
   * render "Questions to review" even when lean test history omits questions.
   */
  private async attachQuestionStatStems(rows: any[]): Promise<any[]> {
    return offlineBundlesData.attachQuestionStatStems(this.supabase, rows);
  }

  async getUserQuestionStats(userId: string): Promise<any[]> {
    return offlineBundlesData.getUserQuestionStats(
      this.supabase,
      {
        service: this,
        fetchDeckRecord: (id) => this.fetchDeckRecord(id),
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getFlashcard: (id) => this.getFlashcard(id),
        getFlashcardForUser: (id, uid) => this.getFlashcardForUser(id, uid),
        updateFlashcard: (id, updates, uid, options) =>
          this.updateFlashcard(id, updates, uid, options),
        attachQuestionStatStems: (rows) => this.attachQuestionStatStems(rows),
        getUserPreferences: (uid) => this.getUserPreferences(uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      userId,
    );
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
    return offlineBundlesData.updateUserQuestionStats(
      this.supabase,
      userId,
      questionId,
      stats,
    );
  }

  async getUserQuestionStat(
    userId: string,
    questionId: string,
  ): Promise<any | null> {
    return offlineBundlesData.getUserQuestionStat(
      this.supabase,
      userId,
      questionId,
    );
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
    return offlineBundlesData.upsertUserQuestionStat(
      this.supabase,
      userId,
      questionId,
      stats,
    );
  }

  async resetDeckStatistics(deckId: string, userId: string): Promise<any> {
    return offlineBundlesData.resetDeckStatistics(
      this.supabase,
      {
        service: this,
        fetchDeckRecord: (id) => this.fetchDeckRecord(id),
        verifyDeckAccess: (uid, id, level) =>
          this.verifyDeckAccess(uid, id, level),
        getAccessibleDeckIds: (uid) => this.getAccessibleDeckIds(uid),
        getFlashcard: (id) => this.getFlashcard(id),
        getFlashcardForUser: (id, uid) => this.getFlashcardForUser(id, uid),
        updateFlashcard: (id, updates, uid, options) =>
          this.updateFlashcard(id, updates, uid, options),
        attachQuestionStatStems: (rows) => this.attachQuestionStatStems(rows),
        getUserPreferences: (uid) => this.getUserPreferences(uid),
        getResponseProfile: (profile) => this.getResponseProfile(profile),
      },
      deckId,
      userId,
    );
  }

  // ===========================================================================
  // DIRECT MESSAGES, MESSAGE REQUESTS AND BLOCKS
  //
  // `dm_threads`, `dm_messages`, `dm_read_status`, `user_blocks`, and the
  // cross-thread `searchMessages`.
  //
  // Access predicate: `isDmThreadParticipant(threadId, userId)` — a thread has
  // exactly two participants and nobody else may read it, including through
  // the storage ACL's `note-files/{owner}/chat/dm/{threadId}/…` branch.
  //
  // Two rules that are easy to break:
  //  - Blocks are checked in BOTH directions (`isDmBlockedBetween`) before a
  //    send; `didUserBlock` is the one-directional form and is not sufficient
  //    on its own.
  //  - Delete-for-me is a per-user history cutoff, not a row delete. Every DM
  //    read must apply the caller's cutoff (`.gt("timestamp", historyClearedAt)`)
  //    or a cleared conversation reappears for the person who cleared it while
  //    remaining intact for the other side, which is the intended behaviour.
  //
  // A first message from a stranger lands as a request; `acceptDmMessageRequest`
  // and `declineDmMessageRequest` resolve it.
  // ===========================================================================
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

  // ===========================================================================
  // NOTIFICATIONS
  //
  // `notifications` CRUD plus the bulk fan-out (`createBulkNotifications`) and
  // the unread counters. Delivery to devices rides `sendExpoPushForNotification`
  // in the users block, using the token stored on `profiles`.
  //
  // CACHE SCOPING is the thing to be careful about here. `getNotificationById`
  // caches under the unscoped key `notification:${id}` and therefore makes its
  // ownership decision OUTSIDE `cacheService.cached` — hotfix H3 moved it
  // there, because inside the loader it ran only on a cache MISS and every
  // later caller, any user at all, got a hit that skipped the check and read a
  // stranger's notification for the rest of the 5-minute TTL. The key stays
  // unscoped deliberately: three call sites invalidate by that exact string.
  //
  // `getTestById` in the next block never had this bug — it keys
  // `test:${id}:user:${userId}`, so its in-loader check is per-viewer and
  // correct. Either scope the key or hoist the check; doing neither is the
  // bug.
  // ===========================================================================
  // Notification Methods for API Routes
  //
  // EXTRACTED (monolith lane M1, step 3): the bodies now live in
  // `data/notifications.ts`. `createNotification`'s two outward calls
  // (`isChatMuted`, `sendExpoPushForNotification`) are passed in as `deps`
  // because they belong to sections still in this file.
  async getUserNotifications(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      unreadOnly?: boolean;
    } = {},
  ): Promise<Notification[]> {
    return notificationsData.getUserNotifications(
      this.supabase,
      userId,
      options,
    );
  }

  async getNotificationById(
    notificationId: string,
    userId?: string,
  ): Promise<Notification | null> {
    return notificationsData.getNotificationById(
      this.supabase,
      notificationId,
      userId,
    );
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
    return notificationsData.createNotification(
      this.supabase,
      userId,
      notificationData,
      {
        isChatMuted: (uid, scopeType, scopeId) =>
          this.isChatMuted(uid, scopeType, scopeId),
        sendExpoPushForNotification: (uid, notification) =>
          this.sendExpoPushForNotification(uid, notification),
      },
    );
  }

  async markNotificationAsRead(
    notificationId: string,
  ): Promise<Notification | null> {
    return notificationsData.markNotificationAsRead(
      this.supabase,
      notificationId,
    );
  }

  async markAllNotificationsAsRead(userId: string): Promise<number> {
    return notificationsData.markAllNotificationsAsRead(this.supabase, userId);
  }

  async deleteNotification(notificationId: string): Promise<boolean> {
    return notificationsData.deleteNotification(this.supabase, notificationId);
  }

  async deleteAllNotifications(userId: string): Promise<number> {
    return notificationsData.deleteAllNotifications(this.supabase, userId);
  }

  async getNotificationStats(userId: string): Promise<{
    total: number;
    unread: number;
    read: number;
  }> {
    return notificationsData.getNotificationStats(this.supabase, userId);
  }

  async createBulkNotifications(
    notifications: Array<{
      userId: string;
      message: string;
      link?: string;
      type?: string;
    }>,
  ): Promise<Notification[]> {
    return notificationsData.createBulkNotifications(
      this.supabase,
      notifications,
    );
  }

  // ===========================================================================
  // TESTS AND TEST SESSIONS
  //
  // `test_sessions` (one row per attempt, live or finished), `test_results`
  // (the scored outcome), and `test_templates`. Covers creation from every
  // source — group question bank, a note, a deck, a personal set — the draft
  // lifecycle (`createTestDraft` → `updateTestDraft` →
  // `completeTestDraft` / `abandonTestDraft`), start/submit, and the
  // derived stats (`getSubjectStats`, `getPerformanceStats`).
  //
  // The response shape is a CONTRACT, not an implementation detail. Rows go
  // out through the module-level `mapTestListRow`, which emits the same data
  // twice: flat fields for mobile's "Available Tests" list and a nested
  // `session` object for web. A change that satisfies one side silently makes
  // every test invisible on the other — read the comment on that function
  // before touching it.
  //
  // `test_sessions` has no `created_at`: `start_time` is the creation date and
  // what lists sort by, exposed as `created_at` because that is what shipped
  // clients read.
  //
  // Ownership is a plain `data.user_id !== userId` check on every read;
  // `getTestById` makes it inside its loader safely because its cache key is
  // per-user (see the notifications banner above for the version that was not).
  // ===========================================================================
  // EXTRACTED (monolith lane M1c, step 11): the bodies now live in
  // `data/tests.ts`, and the pure row->DTO shapes they share with this file
  // (`normalizeSourceNoteTitle`, `buildTestProvenance`, `buildAttemptTally`,
  // `mapTestListRow`, `topicIdOf`) moved to `data/testMappers.ts`, which this
  // file imports and re-exports so no importer and no export name changes.
  //
  // Fifteen of these call a sibling or a method still in the monolith. The
  // `deps` literal is written out INLINE at those fifteen call sites, and it
  // MUST stay that way: `routes/tests.*`, `testProvenance.test.ts`,
  // `testDraftLifecycle.test.ts` and `learningEvents.test.ts` stub exactly
  // these on a stand-in and drive the entry point through
  // `SupabaseService.prototype.<m>.call(self, …)`. An instance field holding
  // the deps reads as `undefined` there, and the arrows read `this.<method>`
  // at CALL time so a `jest.spyOn` still intercepts.
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
      /**
       * Only tests filed to this study set (test_sessions.study_set_id).
       *
       * It belongs in the QUERY, not in the caller. The route used to fetch one
       * page and filter it in JS, then report `total: filed.length` and
       * `hasMore: false` — so a set whose tests were older than the newest 20
       * lost them silently, and the count on screen was the count of whatever
       * happened to survive that page. Pushing it down here is what makes
       * pagination and `total` describe the same rows.
       */
      studySetId?: string;
    } = {},
  ): Promise<{ tests: any[]; total: number }> {
    return testsData.getUserTests(
      this.supabase,
      {
        service: this,
        getTestById: (id, uid) => this.getTestById(id, uid),
        getUserTests: (uid, options) => this.getUserTests(uid, options),
        attachSourceNoteTitles: (rows, uid) =>
          this.attachSourceNoteTitles(rows, uid),
        mapTestSessionRowToClient: (session) =>
          this.mapTestSessionRowToClient(session),
        fetchNoteTitles: (ids, uid) => this.fetchNoteTitles(ids, uid),
        fetchDeckTitles: (ids, uid) => this.fetchDeckTitles(ids, uid),
        createTestResult: (id, resultData, uid, options) =>
          this.createTestResult(id, resultData, uid, options),
        deleteTest: (id) => this.deleteTest(id),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        generateTestQuestions: (config) => this.generateTestQuestions(config),
        calculateTestScore: (questions, answers) =>
          this.calculateTestScore(questions, answers),
        updateUserStats: (uid, score) => this.updateUserStats(uid, score),
        applyTestCompletionGamification: (uid, activityDate) =>
          this.applyTestCompletionGamification(uid, activityDate),
      },
      userId,
      options,
    );
  }

  async getTestById(testId: string, userId?: string): Promise<any | null> {
    return testsData.getTestById(
      this.supabase,
      testId,
      userId,
    );
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
    return testsData.resolveTestSessionForCaller(
      this.supabase,
      {
        service: this,
        getTestById: (id, uid) => this.getTestById(id, uid),
        getUserTests: (uid, options) => this.getUserTests(uid, options),
        attachSourceNoteTitles: (rows, uid) =>
          this.attachSourceNoteTitles(rows, uid),
        mapTestSessionRowToClient: (session) =>
          this.mapTestSessionRowToClient(session),
        fetchNoteTitles: (ids, uid) => this.fetchNoteTitles(ids, uid),
        fetchDeckTitles: (ids, uid) => this.fetchDeckTitles(ids, uid),
        createTestResult: (id, resultData, uid) =>
          this.createTestResult(id, resultData, uid),
        deleteTest: (id) => this.deleteTest(id),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        generateTestQuestions: (config) => this.generateTestQuestions(config),
        calculateTestScore: (questions, answers) =>
          this.calculateTestScore(questions, answers),
        updateUserStats: (uid, score) => this.updateUserStats(uid, score),
        applyTestCompletionGamification: (uid, activityDate) =>
          this.applyTestCompletionGamification(uid, activityDate),
      },
      testId,
      userId,
    );
  }

  async createTest(testConfig: any, userId: string): Promise<any> {
    return testsData.createTest(
      this.supabase,
      {
        service: this,
        getTestById: (id, uid) => this.getTestById(id, uid),
        getUserTests: (uid, options) => this.getUserTests(uid, options),
        attachSourceNoteTitles: (rows, uid) =>
          this.attachSourceNoteTitles(rows, uid),
        mapTestSessionRowToClient: (session) =>
          this.mapTestSessionRowToClient(session),
        fetchNoteTitles: (ids, uid) => this.fetchNoteTitles(ids, uid),
        fetchDeckTitles: (ids, uid) => this.fetchDeckTitles(ids, uid),
        createTestResult: (id, resultData, uid) =>
          this.createTestResult(id, resultData, uid),
        deleteTest: (id) => this.deleteTest(id),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        generateTestQuestions: (config) => this.generateTestQuestions(config),
        calculateTestScore: (questions, answers) =>
          this.calculateTestScore(questions, answers),
        updateUserStats: (uid, score) => this.updateUserStats(uid, score),
        applyTestCompletionGamification: (uid, activityDate) =>
          this.applyTestCompletionGamification(uid, activityDate),
      },
      testConfig,
      userId,
    );
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
      studySetId?: string | null;
      config?: Record<string, any> | null;
    },
    userId: string,
  ): Promise<any> {
    return testsData.createPersonalTest(
      this.supabase,
      {
        service: this,
        getTestById: (id, uid) => this.getTestById(id, uid),
        getUserTests: (uid, options) => this.getUserTests(uid, options),
        attachSourceNoteTitles: (rows, uid) =>
          this.attachSourceNoteTitles(rows, uid),
        mapTestSessionRowToClient: (session) =>
          this.mapTestSessionRowToClient(session),
        fetchNoteTitles: (ids, uid) => this.fetchNoteTitles(ids, uid),
        fetchDeckTitles: (ids, uid) => this.fetchDeckTitles(ids, uid),
        createTestResult: (id, resultData, uid) =>
          this.createTestResult(id, resultData, uid),
        deleteTest: (id) => this.deleteTest(id),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        generateTestQuestions: (config) => this.generateTestQuestions(config),
        calculateTestScore: (questions, answers) =>
          this.calculateTestScore(questions, answers),
        updateUserStats: (uid, score) => this.updateUserStats(uid, score),
        applyTestCompletionGamification: (uid, activityDate) =>
          this.applyTestCompletionGamification(uid, activityDate),
      },
      payload,
      userId,
    );
  }

  mapTestSessionRowToClient(session: any) {
    return testsData.mapTestSessionRowToClient(
      this.supabase,
      session,
    );
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
    return testsData.fetchNoteTitles(
      this.supabase,
      noteIds,
      userId,
    );
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
    return testsData.fetchDeckTitles(
      this.supabase,
      deckIds,
      userId,
    );
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
    return testsData.resolvePersonalTestSourceTitle(
      this.supabase,
      {
        service: this,
        getTestById: (id, uid) => this.getTestById(id, uid),
        getUserTests: (uid, options) => this.getUserTests(uid, options),
        attachSourceNoteTitles: (rows, uid) =>
          this.attachSourceNoteTitles(rows, uid),
        mapTestSessionRowToClient: (session) =>
          this.mapTestSessionRowToClient(session),
        fetchNoteTitles: (ids, uid) => this.fetchNoteTitles(ids, uid),
        fetchDeckTitles: (ids, uid) => this.fetchDeckTitles(ids, uid),
        createTestResult: (id, resultData, uid) =>
          this.createTestResult(id, resultData, uid),
        deleteTest: (id) => this.deleteTest(id),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        generateTestQuestions: (config) => this.generateTestQuestions(config),
        calculateTestScore: (questions, answers) =>
          this.calculateTestScore(questions, answers),
        updateUserStats: (uid, score) => this.updateUserStats(uid, score),
        applyTestCompletionGamification: (uid, activityDate) =>
          this.applyTestCompletionGamification(uid, activityDate),
      },
      source,
      userId,
    );
  }

  /**
   * Backfill `sourceNoteTitle` on mapped test rows written before the title
   * was persisted at creation. One batched note query per page, and only for
   * the rows that actually link to a note and lack a title.
   */
  async attachSourceNoteTitles<
    T extends { sourceNoteId?: string | null; sourceNoteTitle?: string | null },
  >(rows: T[], userId: string): Promise<T[]> {
    return testsData.attachSourceNoteTitles(
      this.supabase,
      {
        service: this,
        getTestById: (id, uid) => this.getTestById(id, uid),
        getUserTests: (uid, options) => this.getUserTests(uid, options),
        attachSourceNoteTitles: (rows, uid) =>
          this.attachSourceNoteTitles(rows, uid),
        mapTestSessionRowToClient: (session) =>
          this.mapTestSessionRowToClient(session),
        fetchNoteTitles: (ids, uid) => this.fetchNoteTitles(ids, uid),
        fetchDeckTitles: (ids, uid) => this.fetchDeckTitles(ids, uid),
        createTestResult: (id, resultData, uid) =>
          this.createTestResult(id, resultData, uid),
        deleteTest: (id) => this.deleteTest(id),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        generateTestQuestions: (config) => this.generateTestQuestions(config),
        calculateTestScore: (questions, answers) =>
          this.calculateTestScore(questions, answers),
        updateUserStats: (uid, score) => this.updateUserStats(uid, score),
        applyTestCompletionGamification: (uid, activityDate) =>
          this.applyTestCompletionGamification(uid, activityDate),
      },
      rows,
      userId,
    );
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
      /** Set room the session was started in; also read off `config`. */
      studySetId?: string | null;
    },
    userId: string,
  ): Promise<any> {
    return testsData.createTestDraft(
      this.supabase,
      {
        service: this,
        getTestById: (id, uid) => this.getTestById(id, uid),
        getUserTests: (uid, options) => this.getUserTests(uid, options),
        attachSourceNoteTitles: (rows, uid) =>
          this.attachSourceNoteTitles(rows, uid),
        mapTestSessionRowToClient: (session) =>
          this.mapTestSessionRowToClient(session),
        fetchNoteTitles: (ids, uid) => this.fetchNoteTitles(ids, uid),
        fetchDeckTitles: (ids, uid) => this.fetchDeckTitles(ids, uid),
        createTestResult: (id, resultData, uid) =>
          this.createTestResult(id, resultData, uid),
        deleteTest: (id) => this.deleteTest(id),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        generateTestQuestions: (config) => this.generateTestQuestions(config),
        calculateTestScore: (questions, answers) =>
          this.calculateTestScore(questions, answers),
        updateUserStats: (uid, score) => this.updateUserStats(uid, score),
        applyTestCompletionGamification: (uid, activityDate) =>
          this.applyTestCompletionGamification(uid, activityDate),
      },
      payload,
      userId,
    );
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
    return testsData.updateTestDraft(
      this.supabase,
      {
        service: this,
        getTestById: (id, uid) => this.getTestById(id, uid),
        getUserTests: (uid, options) => this.getUserTests(uid, options),
        attachSourceNoteTitles: (rows, uid) =>
          this.attachSourceNoteTitles(rows, uid),
        mapTestSessionRowToClient: (session) =>
          this.mapTestSessionRowToClient(session),
        fetchNoteTitles: (ids, uid) => this.fetchNoteTitles(ids, uid),
        fetchDeckTitles: (ids, uid) => this.fetchDeckTitles(ids, uid),
        createTestResult: (id, resultData, uid) =>
          this.createTestResult(id, resultData, uid),
        deleteTest: (id) => this.deleteTest(id),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        generateTestQuestions: (config) => this.generateTestQuestions(config),
        calculateTestScore: (questions, answers) =>
          this.calculateTestScore(questions, answers),
        updateUserStats: (uid, score) => this.updateUserStats(uid, score),
        applyTestCompletionGamification: (uid, activityDate) =>
          this.applyTestCompletionGamification(uid, activityDate),
      },
      draftId,
      userId,
      updates,
    );
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
    return testsData.completeTestDraft(
      this.supabase,
      {
        service: this,
        getTestById: (id, uid) => this.getTestById(id, uid),
        getUserTests: (uid, options) => this.getUserTests(uid, options),
        attachSourceNoteTitles: (rows, uid) =>
          this.attachSourceNoteTitles(rows, uid),
        mapTestSessionRowToClient: (session) =>
          this.mapTestSessionRowToClient(session),
        fetchNoteTitles: (ids, uid) => this.fetchNoteTitles(ids, uid),
        fetchDeckTitles: (ids, uid) => this.fetchDeckTitles(ids, uid),
        createTestResult: (id, resultData, uid) =>
          this.createTestResult(id, resultData, uid),
        deleteTest: (id) => this.deleteTest(id),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        generateTestQuestions: (config) => this.generateTestQuestions(config),
        calculateTestScore: (questions, answers) =>
          this.calculateTestScore(questions, answers),
        updateUserStats: (uid, score) => this.updateUserStats(uid, score),
        applyTestCompletionGamification: (uid, activityDate) =>
          this.applyTestCompletionGamification(uid, activityDate),
      },
      draftId,
      userId,
      options,
    );
  }

  async abandonTestDraft(draftId: string, userId: string): Promise<boolean> {
    return testsData.abandonTestDraft(
      this.supabase,
      draftId,
      userId,
    );
  }

  async startTest(testId: string, userId: string): Promise<any | null> {
    return testsData.startTest(
      this.supabase,
      {
        service: this,
        getTestById: (id, uid) => this.getTestById(id, uid),
        getUserTests: (uid, options) => this.getUserTests(uid, options),
        attachSourceNoteTitles: (rows, uid) =>
          this.attachSourceNoteTitles(rows, uid),
        mapTestSessionRowToClient: (session) =>
          this.mapTestSessionRowToClient(session),
        fetchNoteTitles: (ids, uid) => this.fetchNoteTitles(ids, uid),
        fetchDeckTitles: (ids, uid) => this.fetchDeckTitles(ids, uid),
        createTestResult: (id, resultData, uid) =>
          this.createTestResult(id, resultData, uid),
        deleteTest: (id) => this.deleteTest(id),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        generateTestQuestions: (config) => this.generateTestQuestions(config),
        calculateTestScore: (questions, answers) =>
          this.calculateTestScore(questions, answers),
        updateUserStats: (uid, score) => this.updateUserStats(uid, score),
        applyTestCompletionGamification: (uid, activityDate) =>
          this.applyTestCompletionGamification(uid, activityDate),
      },
      testId,
      userId,
    );
  }

  async submitTest(
    testId: string,
    userId: string,
    answers: any[],
  ): Promise<any> {
    return testsData.submitTest(
      this.supabase,
      {
        service: this,
        getTestById: (id, uid) => this.getTestById(id, uid),
        getUserTests: (uid, options) => this.getUserTests(uid, options),
        attachSourceNoteTitles: (rows, uid) =>
          this.attachSourceNoteTitles(rows, uid),
        mapTestSessionRowToClient: (session) =>
          this.mapTestSessionRowToClient(session),
        fetchNoteTitles: (ids, uid) => this.fetchNoteTitles(ids, uid),
        fetchDeckTitles: (ids, uid) => this.fetchDeckTitles(ids, uid),
        createTestResult: (id, resultData, uid) =>
          this.createTestResult(id, resultData, uid),
        deleteTest: (id) => this.deleteTest(id),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        generateTestQuestions: (config) => this.generateTestQuestions(config),
        calculateTestScore: (questions, answers) =>
          this.calculateTestScore(questions, answers),
        updateUserStats: (uid, score) => this.updateUserStats(uid, score),
        applyTestCompletionGamification: (uid, activityDate) =>
          this.applyTestCompletionGamification(uid, activityDate),
      },
      testId,
      userId,
      answers,
    );
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
    return testsData.createTestResult(
      this.supabase,
      {
        service: this,
        getTestById: (id, uid) => this.getTestById(id, uid),
        getUserTests: (uid, options) => this.getUserTests(uid, options),
        attachSourceNoteTitles: (rows, uid) =>
          this.attachSourceNoteTitles(rows, uid),
        mapTestSessionRowToClient: (session) =>
          this.mapTestSessionRowToClient(session),
        fetchNoteTitles: (ids, uid) => this.fetchNoteTitles(ids, uid),
        fetchDeckTitles: (ids, uid) => this.fetchDeckTitles(ids, uid),
        createTestResult: (id, resultData, uid) =>
          this.createTestResult(id, resultData, uid),
        deleteTest: (id) => this.deleteTest(id),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        generateTestQuestions: (config) => this.generateTestQuestions(config),
        calculateTestScore: (questions, answers) =>
          this.calculateTestScore(questions, answers),
        updateUserStats: (uid, score) => this.updateUserStats(uid, score),
        applyTestCompletionGamification: (uid, activityDate) =>
          this.applyTestCompletionGamification(uid, activityDate),
      },
      testId,
      resultData,
      userId,
      options,
    );
  }

  async getTestResults(testId: string, userId?: string): Promise<any | null> {
    return testsData.getTestResults(
      this.supabase,
      {
        service: this,
        getTestById: (id, uid) => this.getTestById(id, uid),
        getUserTests: (uid, options) => this.getUserTests(uid, options),
        attachSourceNoteTitles: (rows, uid) =>
          this.attachSourceNoteTitles(rows, uid),
        mapTestSessionRowToClient: (session) =>
          this.mapTestSessionRowToClient(session),
        fetchNoteTitles: (ids, uid) => this.fetchNoteTitles(ids, uid),
        fetchDeckTitles: (ids, uid) => this.fetchDeckTitles(ids, uid),
        createTestResult: (id, resultData, uid) =>
          this.createTestResult(id, resultData, uid),
        deleteTest: (id) => this.deleteTest(id),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        generateTestQuestions: (config) => this.generateTestQuestions(config),
        calculateTestScore: (questions, answers) =>
          this.calculateTestScore(questions, answers),
        updateUserStats: (uid, score) => this.updateUserStats(uid, score),
        applyTestCompletionGamification: (uid, activityDate) =>
          this.applyTestCompletionGamification(uid, activityDate),
      },
      testId,
      userId,
    );
  }

  async getTestQuestions(testId: string, userId?: string): Promise<any[]> {
    return testsData.getTestQuestions(
      this.supabase,
      {
        service: this,
        getTestById: (id, uid) => this.getTestById(id, uid),
        getUserTests: (uid, options) => this.getUserTests(uid, options),
        attachSourceNoteTitles: (rows, uid) =>
          this.attachSourceNoteTitles(rows, uid),
        mapTestSessionRowToClient: (session) =>
          this.mapTestSessionRowToClient(session),
        fetchNoteTitles: (ids, uid) => this.fetchNoteTitles(ids, uid),
        fetchDeckTitles: (ids, uid) => this.fetchDeckTitles(ids, uid),
        createTestResult: (id, resultData, uid) =>
          this.createTestResult(id, resultData, uid),
        deleteTest: (id) => this.deleteTest(id),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        generateTestQuestions: (config) => this.generateTestQuestions(config),
        calculateTestScore: (questions, answers) =>
          this.calculateTestScore(questions, answers),
        updateUserStats: (uid, score) => this.updateUserStats(uid, score),
        applyTestCompletionGamification: (uid, activityDate) =>
          this.applyTestCompletionGamification(uid, activityDate),
      },
      testId,
      userId,
    );
  }

  async deleteTest(testId: string): Promise<boolean> {
    return testsData.deleteTest(
      this.supabase,
      testId,
    );
  }

  async deleteCompletedTestSession(
    sessionId: string,
    userId: string,
  ): Promise<boolean> {
    return testsData.deleteCompletedTestSession(
      this.supabase,
      {
        service: this,
        getTestById: (id, uid) => this.getTestById(id, uid),
        getUserTests: (uid, options) => this.getUserTests(uid, options),
        attachSourceNoteTitles: (rows, uid) =>
          this.attachSourceNoteTitles(rows, uid),
        mapTestSessionRowToClient: (session) =>
          this.mapTestSessionRowToClient(session),
        fetchNoteTitles: (ids, uid) => this.fetchNoteTitles(ids, uid),
        fetchDeckTitles: (ids, uid) => this.fetchDeckTitles(ids, uid),
        createTestResult: (id, resultData, uid) =>
          this.createTestResult(id, resultData, uid),
        deleteTest: (id) => this.deleteTest(id),
        isGroupMember: (groupId, uid) => this.isGroupMember(groupId, uid),
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
        generateTestQuestions: (config) => this.generateTestQuestions(config),
        calculateTestScore: (questions, answers) =>
          this.calculateTestScore(questions, answers),
        updateUserStats: (uid, score) => this.updateUserStats(uid, score),
        applyTestCompletionGamification: (uid, activityDate) =>
          this.applyTestCompletionGamification(uid, activityDate),
      },
      sessionId,
      userId,
    );
  }

  async clearCompletedTestHistory(userId: string): Promise<number> {
    return testsData.clearCompletedTestHistory(
      this.supabase,
      userId,
    );
  }

  async getSubjectStats(userId: string): Promise<any> {
    return testsData.getSubjectStats(
      this.supabase,
      userId,
    );
  }

  async getPerformanceStats(
    userId: string,
    period: string = "month",
  ): Promise<any> {
    return testsData.getPerformanceStats(
      this.supabase,
      userId,
      period,
    );
  }

  async getTestTemplates(
    options: {
      page?: number;
      limit?: number;
      subject?: string;
      difficulty?: string;
    } = {},
  ): Promise<any[]> {
    return testsData.getTestTemplates(
      this.supabase,
      options,
    );
  }

  // ===========================================================================
  // GAMIFICATION — points, badges, achievements, levels, streaks
  //
  // `points_transactions`, `achievements`, `user_achievements`, `levels`,
  // `user_streaks`, `study_activity`, and the denormalised counters on
  // `profiles` that every client reads as "my stats".
  //
  // The award RULES are not here: they live in
  // `@lantern/shared/utils/gamification` (`BADGE_DEFINITIONS`,
  // `checkAndAwardBadges`) and `@lantern/shared/utils/activity`
  // (`computeStudyStreak`), so web, mobile and the server agree on what earns
  // what. This block persists the outcome and nothing more.
  //
  // Counters on `profiles` are a cache of the event tables, and they drift:
  // `recomputeDerivedUserStats` and `recomputeUserStreak` rebuild them from
  // the source rows, and `syncGamificationProgress*` reconciles the two.
  // Prefer `incrementUserStatsAndAwardBadges` to a bare column bump — it is
  // what runs the badge check afterwards.
  //
  // `applyTestCompletionGamification` is the single entry point the test block
  // calls on submit, so scoring a test awards points, badges, streak and
  // activity in one place.
  // ===========================================================================
  // EXTRACTED (monolith lane M1c, step 12): the bodies now live in
  // `data/gamification.ts`, and the `GamificationSyncResult` type moved with
  // them (type-imported back above for these return types).
  //
  // Nine of these call a sibling or a profile method. The `deps` literal is
  // written out INLINE at those nine call sites, and it MUST stay that way:
  // `supabase.awardBadge.test.ts`, `badgeStatsRecompute.test.ts`,
  // `supabase.boardMessages.test.ts` and `learningEvents.test.ts` stub exactly
  // these on a stand-in and drive the entry point through
  // `SupabaseService.prototype.<m>.call(self, …)`. An instance field holding
  // the deps reads as `undefined` there, and the arrows read `this.<method>`
  // at CALL time so a `jest.spyOn` still intercepts.
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
    return gamificationData.getLeaderboard(
      this.supabase,
      options,
    );
  }

  async getAchievements(
    options: {
      page?: number;
      limit?: number;
      category?: string;
    } = {},
  ): Promise<any[]> {
    return gamificationData.getAchievements(
      this.supabase,
      options,
    );
  }

  async getUserAchievements(
    userId: string,
    options: {
      page?: number;
      limit?: number;
    } = {},
  ): Promise<any[]> {
    return gamificationData.getUserAchievements(
      this.supabase,
      userId,
      options,
    );
  }

  async awardPoints(
    userId: string,
    points: number,
    reason: string,
    source?: string,
  ): Promise<any> {
    return gamificationData.awardPoints(
      this.supabase,
      userId,
      points,
      reason,
      source,
    );
  }

  async awardAchievement(userId: string, achievementId: string): Promise<any> {
    return gamificationData.awardAchievement(
      this.supabase,
      {
        service: this,
        getUserById: (uid) => this.getUserById(uid),
        updateUser: (uid, updates, options) =>
          this.updateUser(uid, updates, options),
        profileToGamificationUser: (profile, statsOverride) =>
          this.profileToGamificationUser(profile, statsOverride),
        parseStreakReferenceDate: (referenceDate) =>
          this.parseStreakReferenceDate(referenceDate),
        awardPoints: (uid, points, reason, source) =>
          this.awardPoints(uid, points, reason, source),
        getLevels: () => this.getLevels(),
        getUserLevel: (uid) => this.getUserLevel(uid),
        getStudyActivity: (uid, days) => this.getStudyActivity(uid, days),
        recordStudyActivity: (uid, type, amount, activityDate) =>
          this.recordStudyActivity(uid, type, amount, activityDate),
        recomputeDerivedUserStats: (uid) => this.recomputeDerivedUserStats(uid),
        recomputeUserStreak: (uid, referenceDate) =>
          this.recomputeUserStreak(uid, referenceDate),
        syncGamificationProgressWithStats: (uid, options) =>
          this.syncGamificationProgressWithStats(uid, options),
      },
      userId,
      achievementId,
    );
  }

  async getUserProgress(userId: string): Promise<any> {
    return gamificationData.getUserProgress(
      this.supabase,
      {
        service: this,
        getUserById: (uid) => this.getUserById(uid),
        updateUser: (uid, updates, options) =>
          this.updateUser(uid, updates, options),
        profileToGamificationUser: (profile, statsOverride) =>
          this.profileToGamificationUser(profile, statsOverride),
        parseStreakReferenceDate: (referenceDate) =>
          this.parseStreakReferenceDate(referenceDate),
        awardPoints: (uid, points, reason, source) =>
          this.awardPoints(uid, points, reason, source),
        getLevels: () => this.getLevels(),
        getUserLevel: (uid) => this.getUserLevel(uid),
        getStudyActivity: (uid, days) => this.getStudyActivity(uid, days),
        recordStudyActivity: (uid, type, amount, activityDate) =>
          this.recordStudyActivity(uid, type, amount, activityDate),
        recomputeDerivedUserStats: (uid) => this.recomputeDerivedUserStats(uid),
        recomputeUserStreak: (uid, referenceDate) =>
          this.recomputeUserStreak(uid, referenceDate),
        syncGamificationProgressWithStats: (uid, options) =>
          this.syncGamificationProgressWithStats(uid, options),
      },
      userId,
    );
  }

  async getGamificationStats(): Promise<any> {
    return gamificationData.getGamificationStats(
      this.supabase,
    );
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
    return gamificationData.getBadges(
      this.supabase,
      options,
    );
  }

  /** Badges the user holds, newest first, straight from profiles.badges. */
  async getUserBadges(
    userId: string,
    options: {
      page?: number;
      limit?: number;
    } = {},
  ): Promise<any[]> {
    return gamificationData.getUserBadges(
      this.supabase,
      userId,
      options,
    );
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
    return gamificationData.awardBadge(
      this.supabase,
      {
        service: this,
        getUserById: (uid) => this.getUserById(uid),
        updateUser: (uid, updates, options) =>
          this.updateUser(uid, updates, options),
        profileToGamificationUser: (profile, statsOverride) =>
          this.profileToGamificationUser(profile, statsOverride),
        parseStreakReferenceDate: (referenceDate) =>
          this.parseStreakReferenceDate(referenceDate),
        awardPoints: (uid, points, reason, source) =>
          this.awardPoints(uid, points, reason, source),
        getLevels: () => this.getLevels(),
        getUserLevel: (uid) => this.getUserLevel(uid),
        getStudyActivity: (uid, days) => this.getStudyActivity(uid, days),
        recordStudyActivity: (uid, type, amount, activityDate) =>
          this.recordStudyActivity(uid, type, amount, activityDate),
        recomputeDerivedUserStats: (uid) => this.recomputeDerivedUserStats(uid),
        recomputeUserStreak: (uid, referenceDate) =>
          this.recomputeUserStreak(uid, referenceDate),
        syncGamificationProgressWithStats: (uid, options) =>
          this.syncGamificationProgressWithStats(uid, options),
      },
      userId,
      badgeId,
      actorId,
    );
  }

  async getLevels(): Promise<any[]> {
    return gamificationData.getLevels(
      this.supabase,
    );
  }

  async getUserLevel(userId: string): Promise<any> {
    return gamificationData.getUserLevel(
      this.supabase,
      {
        service: this,
        getUserById: (uid) => this.getUserById(uid),
        updateUser: (uid, updates, options) =>
          this.updateUser(uid, updates, options),
        profileToGamificationUser: (profile, statsOverride) =>
          this.profileToGamificationUser(profile, statsOverride),
        parseStreakReferenceDate: (referenceDate) =>
          this.parseStreakReferenceDate(referenceDate),
        awardPoints: (uid, points, reason, source) =>
          this.awardPoints(uid, points, reason, source),
        getLevels: () => this.getLevels(),
        getUserLevel: (uid) => this.getUserLevel(uid),
        getStudyActivity: (uid, days) => this.getStudyActivity(uid, days),
        recordStudyActivity: (uid, type, amount, activityDate) =>
          this.recordStudyActivity(uid, type, amount, activityDate),
        recomputeDerivedUserStats: (uid) => this.recomputeDerivedUserStats(uid),
        recomputeUserStreak: (uid, referenceDate) =>
          this.recomputeUserStreak(uid, referenceDate),
        syncGamificationProgressWithStats: (uid, options) =>
          this.syncGamificationProgressWithStats(uid, options),
      },
      userId,
    );
  }

  async recordStudyActivity(
    userId: string,
    type: string,
    amount = 1,
    activityDate?: string,
  ): Promise<any> {
    return gamificationData.recordStudyActivity(
      this.supabase,
      userId,
      type,
      amount,
      activityDate,
    );
  }

  private profileToGamificationUser(
    profile: Record<string, unknown>,
    statsOverride?: Partial<UserStats>,
  ): User {
    return gamificationData.profileToGamificationUser(
      this.supabase,
      profile,
      statsOverride,
    );
  }

  async incrementUserStatsAndAwardBadges(
    userId: string,
    increments: Partial<UserStats>,
  ): Promise<GamificationSyncResult> {
    return gamificationData.incrementUserStatsAndAwardBadges(
      this.supabase,
      {
        service: this,
        getUserById: (uid) => this.getUserById(uid),
        updateUser: (uid, updates, options) =>
          this.updateUser(uid, updates, options),
        profileToGamificationUser: (profile, statsOverride) =>
          this.profileToGamificationUser(profile, statsOverride),
        parseStreakReferenceDate: (referenceDate) =>
          this.parseStreakReferenceDate(referenceDate),
        awardPoints: (uid, points, reason, source) =>
          this.awardPoints(uid, points, reason, source),
        getLevels: () => this.getLevels(),
        getUserLevel: (uid) => this.getUserLevel(uid),
        getStudyActivity: (uid, days) => this.getStudyActivity(uid, days),
        recordStudyActivity: (uid, type, amount, activityDate) =>
          this.recordStudyActivity(uid, type, amount, activityDate),
        recomputeDerivedUserStats: (uid) => this.recomputeDerivedUserStats(uid),
        recomputeUserStreak: (uid, referenceDate) =>
          this.recomputeUserStreak(uid, referenceDate),
        syncGamificationProgressWithStats: (uid, options) =>
          this.syncGamificationProgressWithStats(uid, options),
      },
      userId,
      increments,
    );
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
    return gamificationData.recomputeDerivedUserStats(
      this.supabase,
      userId,
    );
  }

  async syncGamificationProgress(
    userId: string,
  ): Promise<GamificationSyncResult> {
    return gamificationData.syncGamificationProgress(
      this.supabase,
      {
        service: this,
        getUserById: (uid) => this.getUserById(uid),
        updateUser: (uid, updates, options) =>
          this.updateUser(uid, updates, options),
        profileToGamificationUser: (profile, statsOverride) =>
          this.profileToGamificationUser(profile, statsOverride),
        parseStreakReferenceDate: (referenceDate) =>
          this.parseStreakReferenceDate(referenceDate),
        awardPoints: (uid, points, reason, source) =>
          this.awardPoints(uid, points, reason, source),
        getLevels: () => this.getLevels(),
        getUserLevel: (uid) => this.getUserLevel(uid),
        getStudyActivity: (uid, days) => this.getStudyActivity(uid, days),
        recordStudyActivity: (uid, type, amount, activityDate) =>
          this.recordStudyActivity(uid, type, amount, activityDate),
        recomputeDerivedUserStats: (uid) => this.recomputeDerivedUserStats(uid),
        recomputeUserStreak: (uid, referenceDate) =>
          this.recomputeUserStreak(uid, referenceDate),
        syncGamificationProgressWithStats: (uid, options) =>
          this.syncGamificationProgressWithStats(uid, options),
      },
      userId,
    );
  }

  /** Server-only: apply trusted stats before badge evaluation (e.g. after test completion). */
  async syncGamificationProgressWithStats(
    userId: string,
    options: {
      stats?: Partial<UserStats>;
      activityDate?: string;
    } = {},
  ): Promise<GamificationSyncResult> {
    return gamificationData.syncGamificationProgressWithStats(
      this.supabase,
      {
        service: this,
        getUserById: (uid) => this.getUserById(uid),
        updateUser: (uid, updates, options) =>
          this.updateUser(uid, updates, options),
        profileToGamificationUser: (profile, statsOverride) =>
          this.profileToGamificationUser(profile, statsOverride),
        parseStreakReferenceDate: (referenceDate) =>
          this.parseStreakReferenceDate(referenceDate),
        awardPoints: (uid, points, reason, source) =>
          this.awardPoints(uid, points, reason, source),
        getLevels: () => this.getLevels(),
        getUserLevel: (uid) => this.getUserLevel(uid),
        getStudyActivity: (uid, days) => this.getStudyActivity(uid, days),
        recordStudyActivity: (uid, type, amount, activityDate) =>
          this.recordStudyActivity(uid, type, amount, activityDate),
        recomputeDerivedUserStats: (uid) => this.recomputeDerivedUserStats(uid),
        recomputeUserStreak: (uid, referenceDate) =>
          this.recomputeUserStreak(uid, referenceDate),
        syncGamificationProgressWithStats: (uid, options) =>
          this.syncGamificationProgressWithStats(uid, options),
      },
      userId,
      options,
    );
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
    return gamificationData.applyTestCompletionGamification(
      this.supabase,
      {
        service: this,
        getUserById: (uid) => this.getUserById(uid),
        updateUser: (uid, updates, options) =>
          this.updateUser(uid, updates, options),
        profileToGamificationUser: (profile, statsOverride) =>
          this.profileToGamificationUser(profile, statsOverride),
        parseStreakReferenceDate: (referenceDate) =>
          this.parseStreakReferenceDate(referenceDate),
        awardPoints: (uid, points, reason, source) =>
          this.awardPoints(uid, points, reason, source),
        getLevels: () => this.getLevels(),
        getUserLevel: (uid) => this.getUserLevel(uid),
        getStudyActivity: (uid, days) => this.getStudyActivity(uid, days),
        recordStudyActivity: (uid, type, amount, activityDate) =>
          this.recordStudyActivity(uid, type, amount, activityDate),
        recomputeDerivedUserStats: (uid) => this.recomputeDerivedUserStats(uid),
        recomputeUserStreak: (uid, referenceDate) =>
          this.recomputeUserStreak(uid, referenceDate),
        syncGamificationProgressWithStats: (uid, options) =>
          this.syncGamificationProgressWithStats(uid, options),
      },
      userId,
      activityDate,
    );
  }

  async touchLastSeen(userId: string): Promise<void> {
    return gamificationData.touchLastSeen(
      this.supabase,
      userId,
    );
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
    return gamificationData.getStudyActivity(
      this.supabase,
      userId,
      days,
    );
  }

  private parseStreakReferenceDate(referenceDate?: string): Date {
    return gamificationData.parseStreakReferenceDate(
      this.supabase,
      referenceDate,
    );
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
    return gamificationData.recomputeUserStreak(
      this.supabase,
      {
        service: this,
        getUserById: (uid) => this.getUserById(uid),
        updateUser: (uid, updates, options) =>
          this.updateUser(uid, updates, options),
        profileToGamificationUser: (profile, statsOverride) =>
          this.profileToGamificationUser(profile, statsOverride),
        parseStreakReferenceDate: (referenceDate) =>
          this.parseStreakReferenceDate(referenceDate),
        awardPoints: (uid, points, reason, source) =>
          this.awardPoints(uid, points, reason, source),
        getLevels: () => this.getLevels(),
        getUserLevel: (uid) => this.getUserLevel(uid),
        getStudyActivity: (uid, days) => this.getStudyActivity(uid, days),
        recordStudyActivity: (uid, type, amount, activityDate) =>
          this.recordStudyActivity(uid, type, amount, activityDate),
        recomputeDerivedUserStats: (uid) => this.recomputeDerivedUserStats(uid),
        recomputeUserStreak: (uid, referenceDate) =>
          this.recomputeUserStreak(uid, referenceDate),
        syncGamificationProgressWithStats: (uid, options) =>
          this.syncGamificationProgressWithStats(uid, options),
      },
      userId,
      referenceDate,
    );
  }

  // ===========================================================================
  // CHAT INTERNALS AND SEND PATH
  //
  // The private machinery behind group and DM messaging, ending in
  // `sendMessage` — the widest method in the file, because one call has to
  // write the row, resolve mentions, notify the right people, keep thread
  // state consistent and refresh every preview and unread counter.
  //
  // Enrichment helpers (`attachReplyPreview(sBatch)`,
  // `attachThreadReplyCounts`, `enrichGroupMessageReceipts`,
  // `enrichDmMessageReceipts`) run AFTER the row query rather than as embeds,
  // so a table that is missing on this database degrades one field instead of
  // failing the page. They are also where the PostgREST embed trap bites: a
  // second FK between two tables makes a bare embed ambiguous and returns
  // PGRST201 at runtime, which is why several selects below name their
  // constraint explicitly. Bare embeds repo-wide are frozen by
  // `services/postgrestEmbedDisambiguation.test.ts`.
  //
  // Notification fan-out (`notifyMentionedUsers`, `notifyReplyRecipient`,
  // `notifyGroupMessageRecipients`, `notifyBoardCommentRecipients`) is
  // best-effort and capped — a notification failure must not fail the send.
  //
  // `resolveBoardContext` / `resolveCommunityRoleFor` decide whether a message
  // is chat or board content and which community it belongs to, and that is
  // what feeds the community mute check (`assertNotMutedInCommunity`, module
  // scope above) on every write path.
  // ===========================================================================
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

    const mapped = withCounts.map((msg: any) =>
      mapChatMessageRow(msg, this.normalizeMessageRecord(msg)),
    ) as Message[];

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

        // `includeSenderId: false` preserves this loader's long-standing
        // omission of the top-level `senderId`; see the KNOWN ISSUE on
        // `mapChatMessageRow`.
        return withPeerUpvotes.map((msg: any) =>
          mapChatMessageRow(msg, this.normalizeMessageRecord(msg), {
            includeSenderId: false,
          }),
        );
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

  // ===========================================================================
  // CLIENT ESCAPE HATCH, HEALTH AND ADMIN GATE
  //
  // `getSupabaseClient` / `getClient` hand out the raw SERVICE-ROLE client for
  // RPC calls and queries this class does not wrap. Anything built on it
  // inherits the RLS bypass and must carry its own ownership predicate.
  //
  // `isPlatformAdmin` (a `platform_admins` lookup) is the only privilege check
  // in this file, and `verifySupabaseToken` validates a caller's access token
  // against gotrue. `healthCheck` is the readiness probe.
  //
  // EXTRACTED (monolith lane M1, step 2): the bodies of all four now live in
  // `data/client.ts`; what is left here is delegation, kept so the 97
  // importers of this module do not have to move in the same PR.
  // ===========================================================================
  // Real-time subscription helpers (for future use)
  getSupabaseClient() {
    return this.supabase;
  }

  async isPlatformAdmin(userId: string): Promise<boolean> {
    return dataClient.isPlatformAdmin(this.supabase, userId);
  }

  async healthCheck(): Promise<boolean> {
    return dataClient.healthCheck(this.supabase);
  }

  // FIXED (F10): verification used to collapse "this token is bad" and
  // "Supabase is unreachable" into the same `{ isValid: false }`, which is what
  // let one network blip downgrade a signed-in caller to anonymous in
  // `optionalAuthMiddleware`. `verifySupabaseTokenDetailed` keeps the two apart
  // with a `transient` flag; `verifySupabaseToken` is unchanged for the callers
  // that only ever answer 401 either way.
  async verifySupabaseToken(
    accessToken: string,
  ): Promise<{ user: any; isValid: boolean }> {
    return dataClient.verifySupabaseToken(this.supabase, accessToken);
  }

  async verifySupabaseTokenDetailed(
    accessToken: string,
  ): Promise<{ user: any; isValid: boolean; transient: boolean }> {
    return dataClient.verifySupabaseTokenDetailed(this.supabase, accessToken);
  }

  // ===========================================================================
  // MARKETPLACE
  //
  // The largest block in the file: `marketplace_listings`, `marketplace_orders`,
  // `marketplace_reviews` + `marketplace_review_votes`, `marketplace_offers`,
  // `marketplace_transactions`, `marketplace_reports`, `marketplace_campuses`,
  // `marketplace_question_bank_entitlements`, plus the seller dashboard,
  // favorites, inquiries and marketplace notification sub-blocks that follow.
  // Money movement itself is NOT here — that is `services/marketplacePayments.ts`
  // and Paystack; this block owns catalogue, reviews and order bookkeeping, and
  // mirrors sales into `budget_transactions` via `logMarketplaceBudgetTransactions`.
  //
  // Writes are MASS-ASSIGNMENT GUARDED. A listing row carries server-owned
  // fields — boost/promotion state inside `category_specific_fields`,
  // moderation status, seller id — and clients post free-form JSON, so every
  // create/update goes through the sanitizers at module scope
  // (`assertValidListingKind`, image and quantity assertions,
  // `assertSellerListingUpdateAllowed`). A seller may only make a status
  // transition the shared lifecycle table permits, and a moderated listing is
  // read-only. Never write a client payload into `marketplace_listings`
  // directly.
  //
  // Listing reads come in several shapes on purpose: `toListingCardRecords` /
  // `pickCompactListingFields` for browse, the full record for a detail page,
  // and `getMarketplaceListingForViewer` for the viewer-scoped version. Seller
  // trust is attached separately (`attachSellerTrust`), and images are signed
  // on the way out (`normalizeListingRecordAsync`) because stored refs are
  // paths, not URLs.
  //
  // Reviews are gated by `canUserReviewListing` — a review must be backed by a
  // real order, which is what stopped reviews being self-minted.
  //
  // Rating columns degrade: `ratingColumnsAvailable` / `isMissingRatingColumn`
  // drop the rating fields when the migration is unapplied rather than failing
  // browse (see the KNOWN ISSUE on `reactionsMissingTable`).
  // ===========================================================================
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
        const candidate = parseStoredStorageRef(first);
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
      // FIXED (G3 · H0c): a bare Error here reached POST /listings as a generic
      // 500 "Something went wrong" once R5a's `isPlainValidation` heuristic was
      // removed — a seller who left the campus/city out was told the server
      // broke, and their bad input paged 5xx alerting. It is the caller's
      // problem and says so.
      throw new PublicError("Campus or city metadata is required");
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
    // R5a: explicit PublicError, not a bare Error. POST /listings/:id/boost
    // answers these two through respondMarketplaceClientError, which used to
    // classify any bare `new Error` as a 400 by name check; the check is gone,
    // so the intent has to be stated here. Status is unchanged (400).
    if (!listing) throw new PublicError("Listing not found");
    if (listing.user_id !== userId)
      throw new PublicError("Unauthorized: You do not own this listing");

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
  // ===========================================================================
  // UNREAD COUNTS, READ STATE, DM THREAD STATE AND MUTES
  //
  // What drives every badge in both clients: per-group and per-DM unread
  // counts (single and batched), the mark-as-read writes, DM thread
  // delete/archive/unarchive, and `chat_mutes`.
  //
  // The batched counters prefer an RPC and fall back to per-thread queries
  // (`getAllGroupUnreadCountsFallback`, `getAllDMUnreadCountsFallback`) when
  // it is absent — the badge is wrong-but-present rather than missing.
  //
  // `assertChatMuteAccess` is the predicate for mute writes: a caller may only
  // mute a scope they can actually see. `deleteDmThread` is delete-for-me — it
  // stamps a per-user history cutoff rather than removing rows, which is what
  // the DM reads above must honour.
  // ===========================================================================
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
    extras?: { threadId?: string; buyerId?: string },
  ): Promise<void> {
    await this.createNotification(sellerId, {
      type: "marketplace_inquiry",
      message: `${buyerName} is interested in your listing "${listingTitle}"`,
      link: `/marketplace/inquiries/${inquiryId}`,
      data: {
        inquiryId,
        threadId: extras?.threadId,
        buyerId: extras?.buyerId,
      },
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

  // ===========================================================================
  // CUSTOM CATEGORIES AND USER PREFERENCES
  //
  // `custom_categories` is a shared, platform-wide vocabulary ranked by
  // `usage_count` — creating one is a get-or-create by name, not a per-user
  // row, so it is the one write in this file a caller does not own outright.
  //
  // `user_preferences` is strictly owner-scoped; reads normalize through
  // `normalizeUserSettings` in shared so a partial or legacy row still yields
  // every field a client expects.
  // ===========================================================================
  // ============ CUSTOM CATEGORIES ============
  //
  // EXTRACTED (monolith lane M1, step 3): the bodies now live in
  // `data/categories.ts`; what is left here is delegation.

  async getCustomCategories(): Promise<any[]> {
    return categoriesData.getCustomCategories(this.supabase);
  }

  async createCustomCategory(name: string, userId: string): Promise<any> {
    return categoriesData.createCustomCategory(this.supabase, name, userId);
  }

  async incrementCategoryUsage(categoryName: string): Promise<void> {
    return categoriesData.incrementCategoryUsage(this.supabase, categoryName);
  }

  // ============ USER PREFERENCES ============

  async getUserPreferences(userId: string): Promise<any | null> {
    return categoriesData.getUserPreferences(this.supabase, userId);
  }

  async upsertUserPreferences(
    userId: string,
    prefs: { theme?: string; preferences?: Record<string, any> },
  ): Promise<any> {
    return categoriesData.upsertUserPreferences(this.supabase, userId, prefs);
  }

  // ===========================================================================
  // ACADEMIC FILING — courses and topics
  //
  // Where every artefact (note, deck, test session, offline bundle, listing)
  // gets its `course_id` and `topic_id`. The validation rule is that a topic
  // is checked against the course the row will END UP with, not the one in the
  // request body, so a course change cannot orphan a topic.
  //
  // `resolveCourseIdFromConfigLike` (module scope) drops a non-UUID course
  // silently; `resolveTopicIdFromConfigLike` returns the value RAW so an
  // unusable topic id 400s instead of vanishing into a file the student
  // thinks they made.
  //
  // `writeWithTopicFallback` retries a write with `topic_id` (and
  // `study_set_id`) dropped when those columns are not on this database —
  // see the KNOWN ISSUE on `reactionsMissingTable` for why these ladders
  // cannot simply be removed.
  // ===========================================================================
  // ─── Course topics (Phase 1 · A) ──────────────────────────────
  //
  // EXTRACTED (monolith lane M1, step 3): the bodies now live in
  // `data/academic.ts`. The topic lookup is passed in as a
  // `resolveForArtefact` callback so that module stays a leaf and does not
  // import `SupabaseService` back.

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
    return academicData.resolveArtefactTopic(
      (topicId, courseId) =>
        getCourseTopicsService(this).resolveForArtefact(topicId, courseId),
      input,
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
    return academicData.resolveArtefactTopicPatch(
      this.supabase,
      (topicId, courseId) =>
        getCourseTopicsService(this).resolveForArtefact(topicId, courseId),
      table,
      id,
      updates,
    );
  }

  /** The artefact's course as stored today; null when it has none (or is gone). */
  private async currentArtefactCourseId(
    table: string,
    id: string,
  ): Promise<string | null> {
    return academicData.currentArtefactCourseId(this.supabase, table, id);
  }

  // ===========================================================================
  // NOTES
  //
  // `notes`, `note_folders`, `note_collaborators`, `note_attachments`,
  // `note_share_links`, `note_comments`, `note_quizzes`, and the `note-files`
  // storage bucket.
  //
  // Access predicate: `resolveNoteAccess(noteId, userId)` is the ONE gate and
  // it returns the level, not a boolean — owner, collaborator role, or the
  // grant a share link carries. `isNoteOwner` and `canEditNote` are its
  // narrower forms. The storage ACL calls `resolveNoteAccess` for note covers,
  // so widening it widens image access.
  //
  // Sharing has two independent mechanisms and they must not be conflated:
  //  - `note_collaborators` — named users with a role, added/removed/
  //    role-changed explicitly, and `leaveNoteCollaboration` for self-removal;
  //  - `note_share_links` — a revocable token; `previewNoteShareLink` shows
  //    what a link grants before it is accepted, `acceptNoteShareLink`
  //    converts it, and `copyNoteForUser` forks the content instead.
  //
  // Attachments: uploads go through `uploadNoteFile` or a signed upload URL
  // (`createSignedNoteFileUploadUrl`) so large files bypass the API process,
  // and `resolveNoteAttachmentStoragePath` is what maps a stored attachment
  // row back to the object the storage ACL will be asked about. Reads are
  // always freshly signed — never a stored URL.
  //
  // Concurrent edits raise `VersionConflictError` rather than last-write-wins.
  // ===========================================================================
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
      // Raw storage path — the client re-signs it. Undefined (not null) before
      // the cover_path migration is applied, so nothing renders a broken image.
      coverPath: normalizeCoverRef(row.cover_path ?? null),
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
      studySetId?: string;
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
      if (options?.studySetId) query = query.eq("study_set_id", options.studySetId);
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
    if (ownedError && options?.studySetId && isMissingStudySetColumn(ownedError)) {
      return [];
    }
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
    if (options?.folderId || options?.groupId || options?.studySetId || courseFiltered) {
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
      // The cover is the owner's presentation choice, like folder placement.
      delete (updates as Record<string, unknown>).coverPath;
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
    // Only clearing is accepted here; a cover is SET by POST /notes/:id/cover,
    // so a client can never point the column at an arbitrary storage object.
    if (updates.coverPath === null) dbUpdates.cover_path = null;
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

  // ===========================================================================
  // ADMIN ANALYTICS
  //
  // The platform dashboard aggregate, computed in Postgres by the
  // `admin_analytics` RPC rather than assembled here. Callers must gate on
  // `isPlatformAdmin` first — there is no privilege check inside this method,
  // and the service role will happily run it for anyone.
  // ===========================================================================
  async getAdminAnalytics(days: number): Promise<AdminAnalyticsPayload> {
    return adminAnalyticsData.getAdminAnalytics(this.supabase, days);
  }
}

// `AdminAnalyticsPayload` moved to `data/adminAnalytics.ts` with the function
// that builds it; re-exported here because routes import the type from this
// path.
export type { AdminAnalyticsPayload } from "./data/adminAnalytics";

// Configuration - do NOT create singleton at module level
// The server.ts initializes the service with proper config
// export const supabaseService = new SupabaseService(dbConfig);
