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
import * as directMessagesData from "./data/directMessages";
import * as uploadsData from "./data/uploads";
import {
  resolveCourseIdFromConfigLike,
  resolveStudySetIdFromConfigLike,
  topicFilterApplies,
  writeWithTopicFallback,
} from "./data/academic";
export { resolveStudySetIdFromConfigLike };
import * as adminAnalyticsData from "./data/adminAnalytics";
import * as boardActionsData from "./data/boardActions";
import * as groupMessagesData from "./data/groupMessages";
// The MARKETPLACE section (monolith lane M1g, step 18), together with the
// listing write sanitizers that were its only callers. `listingStateError` is
// named separately because `updateListingStatus`, in the inquiries block
// further down, still raises it from this file.
import * as marketplaceData from "./data/marketplace";
import { listingStateError } from "./data/marketplace";
import type {
  ChatMessageMutationResult,
  ChatMessageMutationStatus,
} from "./data/groupMessages";
export type {
  ChatMessageMutationResult,
  ChatMessageMutationStatus,
} from "./data/groupMessages";
import type {
  BoardBookmarkPage,
  BoardRepostResult,
  BoardRepostUndoResult,
  MessageBookmarkResult,
} from "./data/boardActions";
export type {
  BoardBookmarkPage,
  BoardRepostResult,
  BoardRepostUndoResult,
  MessageBookmarkResult,
};
import { assertNotMutedInCommunity } from "./data/communityMute";
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
import * as readStateData from "./data/readState";
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
  sanitizeAnswerConfidences,
  tallyTestAttempt,
} from "@lantern/shared/utils/testHelpers";
import {
  BADGE_DEFINITIONS,
  createBadge,
} from "@lantern/shared/utils/gamification";
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

// `extractMentionUsernames` moved to `data/chatSend.ts` (monolith lane M1f,
// step 17) with the chat section, its only caller.
import * as chatSendData from "./data/chatSend";
import type { MessagePinResult } from "./data/chatSend";
export type { MessagePinResult } from "./data/chatSend";
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


// `ChatMessageMutationStatus` / `ChatMessageMutationResult` moved to
// `data/groupMessages.ts` (monolith lane M1e, step 16) with `editChatMessage`
// and `removeChatMessage`, their only producers. Re-exported above so
// `routes/messages.ts` keeps importing them from here.

// `MessagePinResult` moved to `data/chatSend.ts` (monolith lane M1f, step 17)
// with `setMessagePin`, its only producer. Imported and re-exported above so
// `routes/messages.ts` keeps importing it from here.

// `BoardRepostResult`, `BoardRepostUndoResult`, `MessageBookmarkResult` and
// `BoardBookmarkPage` moved to `data/boardActions.ts` (monolith lane M1d,
// step 15) with the section that produces them. Imported above and re-exported
// there: `routes/messages.ts` still reads `BoardRepostResult` from this path.

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

// The MARKETPLACE LISTING WRITE SANITIZERS (the mass-assignment guard: the
// known-kind list, the image/quantity/bundle assertions, the server-owned-field
// strip/pick pair and `assertSellerListingUpdateAllowed`) moved to
// `data/marketplace.ts` (monolith lane M1g, step 18) with the MARKETPLACE
// section, their only caller. None of them was ever exported, so no importer
// moves; `listingStateError` is imported back below because `updateListingStatus`
// in the inquiries block further down still raises it.

// `normalizeSourceNoteTitle`, `buildTestProvenance`, `buildAttemptTally` and
// `mapTestListRow` moved to `data/testMappers.ts` (monolith lane M1c, step 11)
// so `data/tests.ts` can use them without importing this file back. Imported
// above and re-exported below: every importer, and the public-surface freeze,
// sees exactly the same four names.

// `assertNotMutedInCommunity` moved to `data/communityMute.ts` (monolith lane
// M1d, step 15): `createBoardRepost` went to `data/boardActions.ts` and
// `sendMessage` below is its other caller, so it needed a home neither of them
// owns. It is still a STATIC import at both sites, never a `deps` entry — a
// check a harness can forget to stub is a check the test silently loses.

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
  // DEFAULT_MESSAGE_PAGE_SIZE / MAX_MESSAGE_PAGE_SIZE moved to
  // `data/groupMessages.ts` with `getGroupMessages`, their only reader
  // (monolith lane M1e, step 16). Private statics are not on the prototype, so
  // the surface freeze does not see them move.

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
  // EXTRACTED (monolith lane M1e, step 16): the bodies now live in
  // `services/data/groupMessages.ts`, a plain module of functions over the
  // injected client. The two page-size statics moved with `getGroupMessages`
  // (it was their only reader) and the `ChatMessageMutationResult` types moved
  // with the edit/remove pair and are re-exported from this file, so
  // `routes/messages.ts` is untouched.
  //
  // EVERY sibling call goes through the `deps` literal, written out INLINE at
  // each call site, and it MUST stay that way: `supabase.messageReactions`,
  // `supabase.boardPaging`, `supabase.boardMessages`, `supabase.boardMedia`
  // and `supabase.peerUpvotes` all build a bare `self = { supabase,
  // reactionsMissingTable: proto.x, attachPeerUpvotes: proto.y, … }` and drive
  // the entry point through `SupabaseService.prototype.<m>.call(self, …)`. An
  // instance field holding the deps reads as `undefined` there, and the arrows
  // read `this.<method>` at CALL time so those stubs — and any `jest.spyOn` —
  // still intercept.

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
    return groupMessagesData.getGroupMessages(
      this.supabase,
      {
        getResponseProfile: (value) => this.getResponseProfile(value),
        attachReplyPreviewsBatch: (rows, table) =>
          this.attachReplyPreviewsBatch(rows, table),
        attachThreadReplyCounts: (rows, table, scopeColumn, scopeId) =>
          this.attachThreadReplyCounts(rows, table, scopeColumn, scopeId),
        attachBoardRepostContext: (rows, gid) =>
          this.attachBoardRepostContext(rows, gid),
        attachPeerUpvotes: (messages) => this.attachPeerUpvotes(messages),
        normalizeMessageRecord: (row) => this.normalizeMessageRecord(row),
        enrichGroupMessageReceipts: (messages, gid, viewerUserId) =>
          this.enrichGroupMessageReceipts(messages, gid, viewerUserId),
        enrichBoardViewerState: (messages, viewerUserId) =>
          this.enrichBoardViewerState(messages, viewerUserId),
      },
      groupId,
      options,
    );
  }

  async getMessageById(
    messageId: string,
    userId?: string,
  ): Promise<Message | null> {
    return groupMessagesData.getMessageById(
      this.supabase,
      {
        attachPeerUpvotes: (messages) => this.attachPeerUpvotes(messages),
        normalizeMessageRecord: (row) => this.normalizeMessageRecord(row),
      },
      messageId,
      userId,
    );
  }

  private mapChatMutationRow(
    kind: "group" | "dm",
    row: Record<string, any>,
  ): Record<string, unknown> {
    return groupMessagesData.mapChatMutationRow(kind, row);
  }

  private async refreshChatPreview(
    kind: "group" | "dm",
    row: Record<string, any>,
  ): Promise<void> {
    return groupMessagesData.refreshChatPreview(this.supabase, kind, row);
  }

  private async invalidateChatMessageMutation(
    kind: "group" | "dm",
    row: Record<string, any>,
  ): Promise<void> {
    return groupMessagesData.invalidateChatMessageMutation(kind, row);
  }

  private async refreshChatMessageNotifications(
    kind: "group" | "dm",
    messageId: string,
    action: "edited" | "removed",
    preview?: string,
  ): Promise<void> {
    return groupMessagesData.refreshChatMessageNotifications(
      this.supabase,
      kind,
      messageId,
      action,
      preview,
    );
  }

  async editChatMessage(
    kind: "group" | "dm",
    messageId: string,
    actorId: string,
    content: string,
  ): Promise<ChatMessageMutationResult> {
    return groupMessagesData.editChatMessage(
      this.supabase,
      {
        invalidateChatMessageMutation: (k, row) =>
          this.invalidateChatMessageMutation(k, row),
        refreshChatPreview: (k, row) => this.refreshChatPreview(k, row),
        refreshChatMessageNotifications: (k, id, action, preview) =>
          this.refreshChatMessageNotifications(k, id, action, preview),
        mapChatMutationRow: (k, row) => this.mapChatMutationRow(k, row),
      },
      kind,
      messageId,
      actorId,
      content,
    );
  }

  async removeChatMessage(
    kind: "group" | "dm",
    messageId: string,
    actorId: string,
  ): Promise<ChatMessageMutationResult> {
    return groupMessagesData.removeChatMessage(
      this.supabase,
      {
        clearPinOnRemovedMessage: (message) =>
          this.clearPinOnRemovedMessage(message),
        invalidateChatMessageMutation: (k, row) =>
          this.invalidateChatMessageMutation(k, row),
        refreshChatPreview: (k, row) => this.refreshChatPreview(k, row),
        refreshChatMessageNotifications: (k, id, action, preview) =>
          this.refreshChatMessageNotifications(k, id, action, preview),
        mapChatMutationRow: (k, row) => this.mapChatMutationRow(k, row),
      },
      kind,
      messageId,
      actorId,
    );
  }

  private async clearPinOnRemovedMessage(
    message: Record<string, any>,
  ): Promise<void> {
    return groupMessagesData.clearPinOnRemovedMessage(this.supabase, message);
  }

  private async syncQuestionStatusAfterVote(messageId: string): Promise<{
    upvotes: number;
    downvotes: number;
    groupId: string | null;
    questionStatus?: string;
  }> {
    return groupMessagesData.syncQuestionStatusAfterVote(
      this.supabase,
      {
        countPeerUpvotesForMessage: (id, authorId) =>
          this.countPeerUpvotesForMessage(id, authorId),
      },
      messageId,
    );
  }

  async voteQuestion(
    messageId: string,
    userId: string,
    voteType: "up" | "down",
  ): Promise<any> {
    return groupMessagesData.voteQuestion(
      this.supabase,
      {
        syncQuestionStatusAfterVote: (id) =>
          this.syncQuestionStatusAfterVote(id),
      },
      messageId,
      userId,
      voteType,
    );
  }

  async removeVote(messageId: string, userId: string): Promise<any> {
    return groupMessagesData.removeVote(
      this.supabase,
      {
        syncQuestionStatusAfterVote: (id) =>
          this.syncQuestionStatusAfterVote(id),
      },
      messageId,
      userId,
    );
  }

  private reactionsMissingTable(error: any): boolean {
    return groupMessagesData.reactionsMissingTable(error);
  }

  async addMessageReaction(
    messageId: string,
    userId: string,
    emoji: string,
    scope: "group" | "dm" = "group",
  ): Promise<{ reactions: Record<string, number> }> {
    return groupMessagesData.addMessageReaction(
      this.supabase,
      {
        reactionsMissingTable: (error) => this.reactionsMissingTable(error),
        readMessageReactions: (id, s) => this.readMessageReactions(id, s),
      },
      messageId,
      userId,
      emoji,
      scope,
    );
  }

  async removeMessageReaction(
    messageId: string,
    userId: string,
    emoji: string,
    scope: "group" | "dm" = "group",
  ): Promise<{ reactions: Record<string, number> }> {
    return groupMessagesData.removeMessageReaction(
      this.supabase,
      {
        reactionsMissingTable: (error) => this.reactionsMissingTable(error),
        readMessageReactions: (id, s) => this.readMessageReactions(id, s),
      },
      messageId,
      userId,
      emoji,
      scope,
    );
  }

  /** Authoritative counts straight after a write (the trigger has already run). */
  async readMessageReactions(
    messageId: string,
    scope: "group" | "dm" = "group",
  ): Promise<{ reactions: Record<string, number> }> {
    return groupMessagesData.readMessageReactions(
      this.supabase,
      {
        reactionsMissingTable: (error) => this.reactionsMissingTable(error),
      },
      messageId,
      scope,
    );
  }

  /** How many DISTINCT emoji a message already carries (API-side cap). */
  async countDistinctReactionEmoji(
    messageId: string,
    scope: "group" | "dm" = "group",
  ): Promise<number> {
    return groupMessagesData.countDistinctReactionEmoji(
      {
        readMessageReactions: (id, s) => this.readMessageReactions(id, s),
      },
      messageId,
      scope,
    );
  }

  /** The viewer's own reactions across a group: { messageId: ["👍", "🔥"] }. */
  async getUserReactionsForGroup(
    groupId: string,
    userId: string,
  ): Promise<Record<string, string[]>> {
    return groupMessagesData.getUserReactionsForGroup(
      this.supabase,
      {
        reactionsMissingTable: (error) => this.reactionsMissingTable(error),
      },
      groupId,
      userId,
    );
  }

  /** The viewer's own reactions across a DM thread. */
  async getUserReactionsForThread(
    threadId: string,
    userId: string,
  ): Promise<Record<string, string[]>> {
    return groupMessagesData.getUserReactionsForThread(
      this.supabase,
      {
        reactionsMissingTable: (error) => this.reactionsMissingTable(error),
      },
      threadId,
      userId,
    );
  }

  async countPeerUpvotesForMessage(
    messageId: string,
    authorId: string | null | undefined,
  ): Promise<number> {
    return groupMessagesData.countPeerUpvotesForMessage(
      this.supabase,
      messageId,
      authorId,
    );
  }

  private async attachPeerUpvotes(messages: any[]): Promise<any[]> {
    return groupMessagesData.attachPeerUpvotes(this.supabase, messages);
  }

  async getUserVotesForGroup(
    groupId: string,
    userId: string,
  ): Promise<Record<string, "up" | "down">> {
    return groupMessagesData.getUserVotesForGroup(
      this.supabase,
      groupId,
      userId,
    );
  }

  async updateQuestionStatus(
    messageId: string,
    questionStatus: string,
  ): Promise<any> {
    return groupMessagesData.updateQuestionStatus(
      this.supabase,
      messageId,
      questionStatus,
    );
  }

  async updateMessageFlagged(
    messageId: string,
    flaggedUserIds: string[],
  ): Promise<Message | null> {
    return groupMessagesData.updateMessageFlagged(
      this.supabase,
      messageId,
      flaggedUserIds,
    );
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
  // EXTRACTED (monolith lane M1d, step 14): the bodies now live in
  // `data/directMessages.ts`. Nothing outside the section read any constant of
  // it.
  //
  // Nine call sites reach chat internals still in the CHAT INTERNALS section
  // below (`attachReplyPreview`, `attachReplyPreviewsBatch`,
  // `attachThreadReplyCounts`, `enrichDmMessageReceipts`,
  // `resolveThreadRootForReply`, `createNotification`,
  // `normalizeMessageRecord`), plus the sibling `isDmBlockedBetween` and the
  // `learningConnections` recorder, which needs `this`. The `deps` literal is
  // written out INLINE at those call sites, and it MUST stay that way:
  // `supabase.messageReactions.test.ts` drives `getDirectMessages` through
  // `SupabaseService.prototype.getDirectMessages.call(self, …)` on a bare
  // `{ supabase, attachReplyPreviewsBatch, attachThreadReplyCounts,
  // enrichDmMessageReceipts }` stand-in that never ran a constructor. An
  // instance field holding the deps reads as `undefined` there, and the arrows
  // read `this.<method>` at CALL time so a `jest.spyOn` still intercepts.
  async getDirectMessages(
    userId: string,
    otherUserId: string,
    options: {
      page?: number;
      limit?: number;
    } = {},
  ): Promise<Message[]> {
    return directMessagesData.getDirectMessages(
      this.supabase,
      {
        attachReplyPreviewsBatch: (rows, table) =>
          this.attachReplyPreviewsBatch(rows, table),
        attachThreadReplyCounts: (rows, table, scopeColumn, scopeId) =>
          this.attachThreadReplyCounts(rows, table, scopeColumn, scopeId),
        enrichDmMessageReceipts: (messages, threadId, uid, otherId) =>
          this.enrichDmMessageReceipts(messages, threadId, uid, otherId),
      },
      userId,
      otherUserId,
      options,
    );
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
    return directMessagesData.sendDirectMessage(
      this.supabase,
      {
        attachReplyPreview: (row, table) =>
          this.attachReplyPreview(row, table),
        resolveThreadRootForReply: (table, replyToMessageId, scope) =>
          this.resolveThreadRootForReply(table, replyToMessageId, scope),
        createNotification: (uid, notification) =>
          this.createNotification(uid, notification),
      },
      senderId,
      recipientId,
      content,
      options,
    );
  }

  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    return directMessagesData.blockUser(this.supabase, blockerId, blockedId);
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    return directMessagesData.unblockUser(this.supabase, blockerId, blockedId);
  }

  async listBlockedUserIds(blockerId: string): Promise<string[]> {
    return directMessagesData.listBlockedUserIds(this.supabase, blockerId);
  }

  async isDmBlockedBetween(userIdA: string, userIdB: string): Promise<boolean> {
    return directMessagesData.isDmBlockedBetween(
      this.supabase,
      userIdA,
      userIdB,
    );
  }

  async didUserBlock(blockerId: string, blockedId: string): Promise<boolean> {
    return directMessagesData.didUserBlock(this.supabase, blockerId, blockedId);
  }

  async acceptDmMessageRequest(
    threadId: string,
    userId: string,
  ): Promise<{
    id: string;
    status: "open";
    requestedBy: null;
  }> {
    return directMessagesData.acceptDmMessageRequest(
      this.supabase,
      {
        isDmBlockedBetween: (a, b) => this.isDmBlockedBetween(a, b),
        recordLearningConnection: async (input) => {
          const { getLearningConnectionsService } = await import(
            "./learningConnections"
          );
          await getLearningConnectionsService(this).record(input as never);
        },
        createNotification: (uid, notification) =>
          this.createNotification(uid, notification),
      },
      threadId,
      userId,
    );
  }

  async declineDmMessageRequest(
    threadId: string,
    userId: string,
  ): Promise<{
    id: string;
    status: "declined";
    requestedBy: string | null;
  }> {
    return directMessagesData.declineDmMessageRequest(
      this.supabase,
      threadId,
      userId,
    );
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
    return directMessagesData.searchMessages(
      this.supabase,
      {
        normalizeMessageRecord: (row) => this.normalizeMessageRecord(row),
      },
      query,
      options,
    );
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
  // EXTRACTED (monolith lane M1f, step 17): the bodies now live in
  // `services/data/chatSend.ts`, a plain module of functions over the injected
  // client, together with `extractMentionUsernames` (module scope above until
  // this lane; the chat section was its only caller). The three helpers
  // immediately below — `generateTestQuestions`, `calculateTestScore`,
  // `updateUserStats` — sit under this banner only by where they were pasted:
  // they belong to the tests domain and `data/tests.ts` already consumes them
  // through its own `deps`, so they stayed put rather than being filed under a
  // chat name.
  //
  // EVERY sibling call goes through the `deps` literal, written out INLINE at
  // each call site, and it MUST stay that way: `supabase.sendPath.contract`,
  // `supabase.boardMessages`, `supabase.boardMedia`, `supabase.boardRepost`,
  // `supabase.messagePin`, `supabase.messageReactions` and
  // `supabase.boardPaging` all build a bare `self = { supabase,
  // resolveBoardContext: …, notifyMentionedUsers: …, … }` and drive the entry
  // point through `SupabaseService.prototype.<m>.call(self, …)`. An instance
  // field holding the deps reads as `undefined` there, and the arrows read
  // `this.<method>` at CALL time so those stubs — and any `jest.spyOn` — still
  // intercept. The ONE exception is `assertNotMutedInCommunity`, still a
  // STATIC import at the send site — see the banner in `data/communityMute.ts`.
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
    return chatSendData.fetchGroups(this.supabase, userId);
  }

  async fetchGroupMembers(groupId: string): Promise<User[]> {
    return chatSendData.fetchGroupMembers(this.supabase, groupId);
  }

  // Message Functions
  private async findGroupMessageByClientId(
    groupId: string,
    userId: string,
    clientMessageId: string,
  ): Promise<any | null> {
    return chatSendData.findGroupMessageByClientId(
      this.supabase,
      groupId,
      userId,
      clientMessageId,
    );
  }

  private async resolveGroupMentionUserIds(
    groupId: string,
    senderId: string,
    content: string,
    explicitIds?: string[],
  ): Promise<string[]> {
    return chatSendData.resolveGroupMentionUserIds(
      {
        fetchGroupMembers: (gid) => this.fetchGroupMembers(gid),
        isGroupAdmin: (gid, uid) => this.isGroupAdmin(gid, uid),
      },
      groupId,
      senderId,
      content,
      explicitIds,
    );
  }

  private buildReplyToFromParent(
    parent: any,
    table: "messages" | "dm_messages",
  ): Record<string, unknown> {
    return chatSendData.buildReplyToFromParent(parent, table);
  }

  private async attachReplyPreview(
    message: any,
    table: "messages" | "dm_messages" = "messages",
  ): Promise<any> {
    return chatSendData.attachReplyPreview(
      this.supabase,
      {
        buildReplyToFromParent: (parent, t) =>
          this.buildReplyToFromParent(parent, t),
      },
      message,
      table,
    );
  }

  private async attachReplyPreviewsBatch(
    messages: any[],
    table: "messages" | "dm_messages",
  ): Promise<any[]> {
    return chatSendData.attachReplyPreviewsBatch(
      this.supabase,
      {
        buildReplyToFromParent: (parent, t) =>
          this.buildReplyToFromParent(parent, t),
      },
      messages,
      table,
    );
  }

  /** Count replies per thread_root_id for messages in a conversation scope. */
  private async attachThreadReplyCounts(
    messages: any[],
    table: "messages" | "dm_messages",
    scopeColumn: "group_id" | "thread_id",
    scopeId: string,
  ): Promise<any[]> {
    return chatSendData.attachThreadReplyCounts(
      this.supabase,
      messages,
      table,
      scopeColumn,
      scopeId,
    );
  }

  private async enrichGroupMessageReceipts(
    messages: Message[],
    groupId: string,
    viewerUserId: string,
  ): Promise<Message[]> {
    return chatSendData.enrichGroupMessageReceipts(
      this.supabase,
      messages,
      groupId,
      viewerUserId,
    );
  }

  private async enrichDmMessageReceipts(
    messages: Message[],
    threadId: string,
    viewerUserId: string,
    peerUserId: string,
  ): Promise<Message[]> {
    return chatSendData.enrichDmMessageReceipts(
      this.supabase,
      messages,
      threadId,
      viewerUserId,
      peerUserId,
    );
  }

  /** Resolve thread_root_id for a reply; validates parent is in the same conversation. */
  private async resolveThreadRootForReply(
    table: "messages" | "dm_messages",
    replyToMessageId: string,
    scope: { groupId?: string; threadId?: string },
  ): Promise<string> {
    return chatSendData.resolveThreadRootForReply(
      this.supabase,
      table,
      replyToMessageId,
      scope,
    );
  }

  /** Lightweight realtime broadcast so open senders can refresh blue ticks. */
  private async broadcastChatRead(
    chatId: string,
    payload: { userId: string; lastReadAt: string },
  ): Promise<void> {
    return chatSendData.broadcastChatRead(this.supabase, chatId, payload);
  }

  async getGroupThread(
    groupId: string,
    rootId: string,
    viewerUserId?: string,
  ): Promise<Message[]> {
    return chatSendData.getGroupThread(
      this.supabase,
      {
        attachReplyPreviewsBatch: (rows, table) =>
          this.attachReplyPreviewsBatch(rows, table),
        attachThreadReplyCounts: (rows, table, scopeColumn, scopeId) =>
          this.attachThreadReplyCounts(rows, table, scopeColumn, scopeId),
        normalizeMessageRecord: (row) => this.normalizeMessageRecord(row),
        enrichGroupMessageReceipts: (messages, gid, viewer) =>
          this.enrichGroupMessageReceipts(messages, gid, viewer),
      },
      groupId,
      rootId,
      viewerUserId,
    );
  }

  async getDmThread(
    threadId: string,
    rootId: string,
    viewerUserId: string,
  ): Promise<Message[]> {
    return chatSendData.getDmThread(
      this.supabase,
      {
        attachReplyPreviewsBatch: (rows, table) =>
          this.attachReplyPreviewsBatch(rows, table),
        attachThreadReplyCounts: (rows, table, scopeColumn, scopeId) =>
          this.attachThreadReplyCounts(rows, table, scopeColumn, scopeId),
        enrichDmMessageReceipts: (messages, tid, viewer, peer) =>
          this.enrichDmMessageReceipts(messages, tid, viewer, peer),
      },
      threadId,
      rootId,
      viewerUserId,
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
    return chatSendData.notifyMentionedUsers(
      {
        getGroupById: (gid, uid) => this.getGroupById(gid, uid),
        getUserById: (uid) => this.getUserById(uid),
        createNotification: (uid, notification) =>
          this.createNotification(uid, notification as any),
      },
      params,
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
    return chatSendData.notifyReplyRecipient(
      this.supabase,
      {
        getGroupById: (gid, uid) => this.getGroupById(gid, uid),
        getUserById: (uid) => this.getUserById(uid),
        createNotification: (uid, notification) =>
          this.createNotification(uid, notification as any),
      },
      params,
    );
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
    return chatSendData.resolveCommunityRoleFor(
      this.supabase,
      userId,
      communityId,
      createdBy,
    );
  }

  private async resolveBoardContext(groupId: string): Promise<{
    isBoard: boolean;
    communityId: string | null;
    communitySlug: string | null;
    communityCreatedBy: string | null;
    loungeGroupId: string | null;
    adminIds: string[];
  }> {
    return chatSendData.resolveBoardContext(
      this.supabase,
      { getGroupById: (gid, uid) => this.getGroupById(gid, uid) },
      groupId,
    );
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
    return chatSendData.notifyBoardCommentRecipients(
      this.supabase,
      {
        getGroupById: (gid, uid) => this.getGroupById(gid, uid),
        getUserById: (uid) => this.getUserById(uid),
        createNotification: (uid, notification) =>
          this.createNotification(uid, notification as any),
      },
      params,
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
    return chatSendData.sendMessage(
      this.supabase,
      {
        resolveBoardContext: (gid) => this.resolveBoardContext(gid),
        resolveGroupMentionUserIds: (gid, sid, text, explicitIds) =>
          this.resolveGroupMentionUserIds(gid, sid, text, explicitIds),
        resolveThreadRootForReply: (table, replyToId, scope) =>
          this.resolveThreadRootForReply(table, replyToId, scope),
        findGroupMessageByClientId: (gid, uid, clientId) =>
          this.findGroupMessageByClientId(gid, uid, clientId),
        resolveCommunityRoleFor: (uid, communityId, createdBy) =>
          this.resolveCommunityRoleFor(uid, communityId, createdBy),
        incrementUserStatsAndAwardBadges: (uid, increments) =>
          this.incrementUserStatsAndAwardBadges(uid, increments),
        notifyGroupMessageRecipients: (params) =>
          this.notifyGroupMessageRecipients(params),
        notifyMentionedUsers: (params) => this.notifyMentionedUsers(params),
        notifyReplyRecipient: (params) => this.notifyReplyRecipient(params),
        notifyBoardCommentRecipients: (params) =>
          this.notifyBoardCommentRecipients(params),
        attachReplyPreview: (message, table) =>
          this.attachReplyPreview(message, table),
      },
      groupId,
      userId,
      content,
      clientMessageId,
      options,
    );
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
    return chatSendData.getPinnedMessage(
      this.supabase,
      { normalizeMessageRecord: (row) => this.normalizeMessageRecord(row) },
      groupId,
    );
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
    return chatSendData.setMessagePin(
      this.supabase,
      {
        getGroupById: (gid, uid) => this.getGroupById(gid, uid),
        resolveBoardContext: (gid) => this.resolveBoardContext(gid),
        communityMemberRole: (communityId, uid) =>
          this.communityMemberRole(communityId, uid),
      },
      messageId,
      userId,
      pinned,
    );
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
  // EXTRACTED (monolith lane M1d, step 15): the bodies now live in
  // `data/boardActions.ts`, and the four result types the section declared
  // (`BoardRepostResult`, `BoardRepostUndoResult`, `MessageBookmarkResult`,
  // `BoardBookmarkPage`) moved with them and are re-exported from this file, so
  // `routes/messages.ts` is untouched. `assertNotMutedInCommunity` moved to
  // `data/communityMute.ts` because `sendMessage` below is its other caller;
  // it is still a STATIC import at both sites and must stay one — see the
  // banner there.
  //
  // EVERY sibling call goes through the `deps` literal, written out INLINE at
  // each call site, and it MUST stay that way: `supabase.bookmarks.test.ts`
  // and `supabase.boardRepost.test.ts` build a bare
  // `self = { supabase, bookmarksMissingTable: proto.x, readBoardPostRows:
  // proto.y, … }` and drive the entry point through
  // `SupabaseService.prototype.<m>.call(self, …)`. An instance field holding
  // the deps reads as `undefined` there, and the arrows read `this.<method>`
  // at CALL time so those stubs — and any `jest.spyOn` — still intercept.

  private bookmarksMissingTable(error: any): boolean {
    return boardActionsData.bookmarksMissingTable(error);
  }

  async setMessageBookmark(
    messageId: string,
    userId: string,
    bookmarked: boolean,
  ): Promise<MessageBookmarkResult> {
    return boardActionsData.setMessageBookmark(
      this.supabase,
      {
        getAuthorizedGroupMessage: (id, uid) =>
          this.getAuthorizedGroupMessage(id, uid),
        getAuthorizedDmMessage: (id, uid) =>
          this.getAuthorizedDmMessage(id, uid),
        bookmarksMissingTable: (error) => this.bookmarksMissingTable(error),
      },
      messageId,
      userId,
      bookmarked,
    );
  }

  async getBookmarkedMessageIdsForGroup(
    groupId: string,
    userId: string,
  ): Promise<{ messageIds: string[]; serverBacked: boolean }> {
    return boardActionsData.getBookmarkedMessageIdsForGroup(
      this.supabase,
      {
        bookmarksMissingTable: (error) => this.bookmarksMissingTable(error),
      },
      groupId,
      userId,
    );
  }

  async listBookmarkedPosts(
    userId: string,
    options: { limit?: number; before?: string } = {},
  ): Promise<BoardBookmarkPage> {
    return boardActionsData.listBookmarkedPosts(
      this.supabase,
      {
        bookmarksMissingTable: (error) => this.bookmarksMissingTable(error),
        readBoardPostRows: (ids) => this.readBoardPostRows(ids),
        readBoardContextForGroups: (groupIds) =>
          this.readBoardContextForGroups(groupIds),
        countRepostsFor: (ids) => this.countRepostsFor(ids),
        repostedByMeAmong: (ids, uid) => this.repostedByMeAmong(ids, uid),
        favoritedAmong: (ids, uid) => this.favoritedAmong(ids, uid),
        toBoardPostShape: (row, extras) => this.toBoardPostShape(row, extras),
      },
      userId,
      options,
    );
  }

  async importMessageBookmarks(
    userId: string,
    messageIds: string[],
  ): Promise<{ imported: number; serverBacked: boolean }> {
    return boardActionsData.importMessageBookmarks(
      this.supabase,
      {
        bookmarksMissingTable: (error) => this.bookmarksMissingTable(error),
      },
      userId,
      messageIds,
    );
  }

  // -------------------------------------------------------------------------
  // Repost
  // -------------------------------------------------------------------------

  async createBoardRepost(
    groupId: string,
    userId: string,
    originalId: string,
    quote?: string | null,
  ): Promise<BoardRepostResult> {
    return boardActionsData.createBoardRepost(
      this.supabase,
      {
        resolveBoardContext: (id) => this.resolveBoardContext(id),
        reviveRemovedRepost: (gid, uid, clientMessageId, text) =>
          this.reviveRemovedRepost(gid, uid, clientMessageId, text),
      },
      groupId,
      userId,
      originalId,
      quote,
    );
  }

  private async reviveRemovedRepost(
    groupId: string,
    userId: string,
    clientMessageId: string,
    text: string | null,
  ): Promise<Record<string, unknown> | null> {
    return boardActionsData.reviveRemovedRepost(
      this.supabase,
      groupId,
      userId,
      clientMessageId,
      text,
    );
  }

  async undoBoardRepost(
    originalId: string,
    userId: string,
  ): Promise<BoardRepostUndoResult> {
    return boardActionsData.undoBoardRepost(this.supabase, originalId, userId);
  }

  // -------------------------------------------------------------------------
  // Board page hydration
  // -------------------------------------------------------------------------

  private async attachBoardRepostContext(
    rows: any[],
    groupId: string,
  ): Promise<any[]> {
    return boardActionsData.attachBoardRepostContext(
      this.supabase,
      {
        toQuotedPost: (row) => this.toQuotedPost(row),
        countRepostsFor: (ids) => this.countRepostsFor(ids),
        orphanedRepostEmbed: (row) => this.orphanedRepostEmbed(row),
      },
      rows,
      groupId,
    );
  }

  private orphanedRepostEmbed(row: any): BoardQuotedPost | null {
    return boardActionsData.orphanedRepostEmbed(row);
  }

  private toQuotedPost(row: any): BoardQuotedPost {
    return boardActionsData.toQuotedPost(row);
  }

  private async countRepostsFor(
    messageIds: string[],
  ): Promise<Map<string, number>> {
    return boardActionsData.countRepostsFor(this.supabase, messageIds);
  }

  private async repostedByMeAmong(
    messageIds: string[],
    userId: string,
  ): Promise<Set<string>> {
    return boardActionsData.repostedByMeAmong(this.supabase, messageIds, userId);
  }

  private async favoritedAmong(
    messageIds: string[],
    userId: string,
  ): Promise<Set<string>> {
    return boardActionsData.favoritedAmong(
      this.supabase,
      {
        reactionsMissingTable: (error) => this.reactionsMissingTable(error),
      },
      messageIds,
      userId,
    );
  }

  private async enrichBoardViewerState(
    messages: Message[],
    viewerUserId: string,
  ): Promise<Message[]> {
    return boardActionsData.enrichBoardViewerState(
      {
        repostedByMeAmong: (ids, uid) => this.repostedByMeAmong(ids, uid),
        bookmarkedAmong: (ids, uid) => this.bookmarkedAmong(ids, uid),
      },
      messages,
      viewerUserId,
    );
  }

  private async bookmarkedAmong(
    messageIds: string[],
    userId: string,
  ): Promise<Set<string>> {
    return boardActionsData.bookmarkedAmong(
      this.supabase,
      {
        bookmarksMissingTable: (error) => this.bookmarksMissingTable(error),
      },
      messageIds,
      userId,
    );
  }

  private async readBoardPostRows(ids: string[]): Promise<any[]> {
    return boardActionsData.readBoardPostRows(this.supabase, ids);
  }

  private async readBoardContextForGroups(
    groupIds: string[],
  ): Promise<
    Map<string, { name: string; communitySlug: string | null; communityName: string | null }>
  > {
    return boardActionsData.readBoardContextForGroups(this.supabase, groupIds);
  }

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
    return boardActionsData.toBoardPostShape(
      {
        normalizeStorageUrl: (url) => this.normalizeStorageUrl(url),
      },
      row,
      extras,
    );
  }

  private async communityMemberRole(
    communityId: string,
    userId: string,
  ): Promise<string | null> {
    return boardActionsData.communityMemberRole(
      this.supabase,
      communityId,
      userId,
    );
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

        return withPeerUpvotes.map((msg: any) =>
          mapChatMessageRow(msg, this.normalizeMessageRecord(msg)),
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
  // EXTRACTED (monolith lane M1g, step 18): the bodies now live in
  // `services/data/marketplace.ts`, a plain module of functions over the
  // injected client, together with the listing write sanitizers that were at
  // module scope above (this section was their only caller; none of them was
  // ever exported, so no importer moves). Read the invariants in that file
  // before changing anything here. What is left is delegation — plus the
  // rating-column circuit breaker below, which is per-INSTANCE state.
  //
  // EVERY sibling call goes through the `deps` literal, written out INLINE at
  // each call site, and it MUST stay that way: `supabase.listingMassAssignment`,
  // `supabase.listingModerationLock`, `supabase.listingDelete`,
  // `supabase.reviews` and `supabase.reviewSignals` all build a bare `self = {
  // supabase, getMarketplaceListingById: …, toListingCardRecords: …, … }` and
  // drive the entry point through `SupabaseService.prototype.<m>.call(self, …)`.
  // An instance field holding the deps reads as `undefined` there, and the
  // arrows read `this.<method>` at CALL time so those stubs — and any
  // `jest.spyOn` — still intercept.
  //
  // The three collaborator services this section reached through
  // `get<X>Service(this)` (marketplace orders, seller tools, learning
  // connections) are injected the same way, and their `await import(...)`
  // stays HERE, so the module specifier a test mocks is unchanged.
  // Marketplace Methods for API Routes
  async getMarketplaceCampuses(countryCode = "NG"): Promise<any[]> {
    return marketplaceData.getMarketplaceCampuses(this.supabase, countryCode);
  }

  async getMarketplaceCampusById(campusId: string): Promise<any | null> {
    return marketplaceData.getMarketplaceCampusById(this.supabase, campusId);
  }

  private async toListingCardRecords(listings: any[]): Promise<any[]> {
    return marketplaceData.toListingCardRecords(
      {
        attachSellerTrust: (rows) => this.attachSellerTrust(rows),
        normalizeListingRecord: (l) => this.normalizeListingRecord(l),
        normalizeStorageUrl: (url) => this.normalizeStorageUrl(url),
        signStorageDisplayUrls: (refs, options) =>
          this.signStorageDisplayUrls(refs, options),
      },
      listings,
    );
  }

  private async attachSellerTrust(rows: any[]): Promise<any[]> {
    return marketplaceData.attachSellerTrust(
      {
        fetchSellerTrust: (ids) => this.fetchSellerTrust(ids),
      },
      rows,
    );
  }

  private async fetchSellerTrust(
    sellerIds: string[],
  ): Promise<Map<string, { trust_level: string; verification_level: number }>> {
    return marketplaceData.fetchSellerTrust(this.supabase, sellerIds);
  }

  private pickCompactListingFields(listing: any): any {
    return marketplaceData.pickCompactListingFields(listing);
  }

  private async attachListingKinds(rows: any[]): Promise<any[]> {
    return marketplaceData.attachListingKinds(this.supabase, rows);
  }

  /**
   * The rating aggregate columns + votes table ship in migration
   * 20260828160000, which is applied by hand like every migration here. Until
   * it runs, any explicit reference to the columns fails with 42703; after one
   * such failure we stop asking for 10 minutes so browse traffic does not pay
   * a doomed extra round trip on every request.
   *
   * This timestamp and its two accessors are the ONE piece of the MARKETPLACE
   * section that did not move to `data/marketplace.ts` (monolith lane M1g,
   * step 18): it is per-INSTANCE state, and `supabase.reviewSignals.test.ts`
   * asserts it as such (`expect(self.ratingColumnsAvailable()).toBe(false)`).
   * Both accessors are injected into the moved bodies through `deps`.
   */
  private ratingColumnsBrokenUntil = 0;

  private ratingColumnsAvailable(): boolean {
    return Date.now() >= this.ratingColumnsBrokenUntil;
  }

  private isMissingRatingColumn(error: any): boolean {
    return marketplaceData.isMissingRatingColumn(error);
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
    return marketplaceData.getMarketplaceListings(
      this.supabase,
      {
        attachListingKinds: (rows) => this.attachListingKinds(rows),
        attachSellerTrust: (rows) => this.attachSellerTrust(rows),
        getResponseProfile: (p) => this.getResponseProfile(p),
        isMissingRatingColumn: (error) => this.isMissingRatingColumn(error),
        normalizeListingRecordAsync: (l) => this.normalizeListingRecordAsync(l),
        noteRatingColumnsMissing: () => this.noteRatingColumnsMissing(),
        pickCompactListingFields: (l) => this.pickCompactListingFields(l),
        ratingColumnsAvailable: () => this.ratingColumnsAvailable(),
        toListingCardRecords: (l) => this.toListingCardRecords(l),
      },
      options,
    );
  }

  async getMarketplaceListingsByIds(ids: string[]): Promise<any[]> {
    return marketplaceData.getMarketplaceListingsByIds(
      this.supabase,
      {
        isMissingRatingColumn: (error) => this.isMissingRatingColumn(error),
        noteRatingColumnsMissing: () => this.noteRatingColumnsMissing(),
        pickCompactListingFields: (l) => this.pickCompactListingFields(l),
        ratingColumnsAvailable: () => this.ratingColumnsAvailable(),
        toListingCardRecords: (l) => this.toListingCardRecords(l),
      },
      ids,
    );
  }

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
    return marketplaceData.getRelatedMarketplaceListings(
      {
        getRelatedMarketplaceListingsInner: (l, lim) =>
          this.getRelatedMarketplaceListingsInner(l, lim),
        isMissingRatingColumn: (error) => this.isMissingRatingColumn(error),
        noteRatingColumnsMissing: () => this.noteRatingColumnsMissing(),
        ratingColumnsAvailable: () => this.ratingColumnsAvailable(),
      },
      listing,
      limit,
    );
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
    return marketplaceData.getRelatedMarketplaceListingsInner(
      {
        getClient: () => this.getClient(),
        ratingColumnsAvailable: () => this.ratingColumnsAvailable(),
        signSimilarListingCards: (l) => this.signSimilarListingCards(l),
      },
      listing,
      limit,
    );
  }

  async getMarketplaceCategoryAnalytics(): Promise<
    Array<{
      category: string;
      total: number;
      active: number;
      sold: number;
    }>
  > {
    return marketplaceData.getMarketplaceCategoryAnalytics(this.supabase);
  }

  async getMarketplaceListingById(
    listingId: string,
    options?: { requireActive?: boolean },
  ): Promise<any | null> {
    return marketplaceData.getMarketplaceListingById(
      this.supabase,
      {
        attachSellerTrust: (rows) => this.attachSellerTrust(rows),
        normalizeListingRecordAsync: (l) => this.normalizeListingRecordAsync(l),
      },
      listingId,
      options,
    );
  }

  async getMarketplaceListingForViewer(
    listingId: string,
    viewerId?: string | null,
  ): Promise<any | null> {
    return marketplaceData.getMarketplaceListingForViewer(
      {
        getMarketplaceListingById: (lid, options) =>
          this.getMarketplaceListingById(lid, options),
        isPlatformAdmin: (uid) => this.isPlatformAdmin(uid),
      },
      listingId,
      viewerId,
    );
  }

  async createMarketplaceListing(
    listingData: any,
    userId: string,
  ): Promise<any> {
    return marketplaceData.createMarketplaceListing(
      this.supabase,
      {
        resolveArtefactTopic: (input) => this.resolveArtefactTopic(input),
      },
      listingData,
      userId,
    );
  }

  async updateMarketplaceListing(
    listingId: string,
    updates: any,
    options: { actorIsAdmin?: boolean } = {},
  ): Promise<any | null> {
    return marketplaceData.updateMarketplaceListing(
      this.supabase,
      {
        getMarketplaceListingById: (lid, options) =>
          this.getMarketplaceListingById(lid, options),
        maybeLogManualSoldBudget: (lid, sid) => this.maybeLogManualSoldBudget(lid, sid),
      },
      listingId,
      updates,
      options,
    );
  }

  async deleteMarketplaceListing(listingId: string): Promise<boolean> {
    return marketplaceData.deleteMarketplaceListing(this.supabase, listingId);
  }

  async deleteMarketplaceListingSafely(
    listingId: string,
  ): Promise<{ outcome: "deleted" | "archived"; openOrders: number; totalOrders: number }> {
    return marketplaceData.deleteMarketplaceListingSafely(
      this.supabase,
      {
        deleteMarketplaceListing: (lid) => this.deleteMarketplaceListing(lid),
      },
      listingId,
    );
  }

  async getSavedSearchMatches(
    userId: string,
    searchId: string,
    options: { peek?: boolean } = {},
  ): Promise<{ count: number; listings: any[] } | null> {
    return marketplaceData.getSavedSearchMatches(
      this.supabase,
      userId,
      searchId,
      options,
    );
  }

  async canUserReviewListing(
    listingId: string,
    userId: string,
  ): Promise<{ eligible: boolean; reason?: string }> {
    return marketplaceData.canUserReviewListing(
      this.supabase,
      {
        getMarketplaceListingById: (lid, options) =>
          this.getMarketplaceListingById(lid, options),
      },
      listingId,
      userId,
    );
  }

  async addMarketplaceReview(
    listingId: string,
    reviewerId: string,
    review: { rating: number; comment?: string },
  ): Promise<any> {
    return marketplaceData.addMarketplaceReview(
      this.supabase,
      {
        canUserReviewListing: (lid, uid) => this.canUserReviewListing(lid, uid),
        recordLearningConnection: async (input) => {
          const { getLearningConnectionsService } = await import(
            "./learningConnections"
          );
          await getLearningConnectionsService(this).record(input as never);
        },
      },
      listingId,
      reviewerId,
      review,
    );
  }

  async getMarketplaceReviews(
    listingId: string,
    viewerId?: string,
  ): Promise<any[]> {
    return marketplaceData.getMarketplaceReviews(
      this.supabase,
      {
        attachMarketplaceReviewSignals: (lid, reviews, viewerId) =>
          this.attachMarketplaceReviewSignals(lid, reviews, viewerId),
      },
      listingId,
      viewerId,
    );
  }

  private async attachMarketplaceReviewSignals(
    listingId: string,
    reviews: any[],
    viewerId?: string,
  ): Promise<any[]> {
    return marketplaceData.attachMarketplaceReviewSignals(
      this.supabase,
      listingId,
      reviews,
      viewerId,
    );
  }

  async setMarketplaceReviewVote(
    listingId: string,
    reviewId: string,
    voterId: string,
    helpful: boolean,
  ): Promise<{ helpfulCount: number; viewerMarkedHelpful: boolean }> {
    return marketplaceData.setMarketplaceReviewVote(
      this.supabase,
      listingId,
      reviewId,
      voterId,
      helpful,
    );
  }

  async buyMarketplaceListingNow(
    listingId: string,
    buyerId: string,
    couponCode?: string,
    quantity?: number,
  ): Promise<{ order: Record<string, unknown>; budgetLogged?: boolean }> {
    return marketplaceData.buyMarketplaceListingNow(
      {
        createOrderFromBuyNow: async (lid, buyerId, couponCode, quantity) => {
          const { getMarketplaceOrdersService } = await import(
            "./marketplaceOrders"
          );
          return getMarketplaceOrdersService(this).createOrderFromBuyNow(
            lid,
            buyerId,
            couponCode,
            quantity,
          );
        },
      },
      listingId,
      buyerId,
      couponCode,
      quantity,
    );
  }

  async boostMarketplaceListing(
    listingId: string,
    userId: string,
    durationHours: number = 72,
  ): Promise<any> {
    return marketplaceData.boostMarketplaceListing(
      this.supabase,
      {
        consumeBoostCredit: async (sellerId) => {
          const { getMarketplaceSellerToolsService } =
            await import("./marketplaceSellerTools");
          return getMarketplaceSellerToolsService(this).consumeBoostCredit(
            sellerId,
          );
        },
        getMarketplaceListingById: (lid, options) =>
          this.getMarketplaceListingById(lid, options),
        normalizeListingRecord: (l) => this.normalizeListingRecord(l),
        normalizeListingRecordAsync: (l) => this.normalizeListingRecordAsync(l),
      },
      listingId,
      userId,
      durationHours,
    );
  }

  async reportMarketplaceListing(
    listingId: string,
    reporterId: string,
    report: { reason: string; details?: string },
  ): Promise<any> {
    return marketplaceData.reportMarketplaceListing(
      this.supabase,
      listingId,
      reporterId,
      report,
    );
  }

  async initiateMarketplaceTransaction(
    listingId: string,
    buyerId: string,
    amount: number,
    source: "buy_now" | "offer_accept" = "buy_now",
    options?: { skipBudgetLog?: boolean },
  ): Promise<any> {
    return marketplaceData.initiateMarketplaceTransaction(
      this.supabase,
      {
        getMarketplaceListingById: (lid, options) =>
          this.getMarketplaceListingById(lid, options),
        logMarketplaceBudgetTransactions: (params) =>
          this.logMarketplaceBudgetTransactions(params),
      },
      listingId,
      buyerId,
      amount,
      source,
      options,
    );
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
    return marketplaceData.logMarketplaceBudgetTransactions(
      this.supabase,
      params,
    );
  }

  async maybeLogManualSoldBudget(
    listingId: string,
    sellerId: string,
  ): Promise<boolean> {
    return marketplaceData.maybeLogManualSoldBudget(
      this.supabase,
      {
        getMarketplaceListingById: (lid, options) =>
          this.getMarketplaceListingById(lid, options),
        logMarketplaceBudgetTransactions: (params) =>
          this.logMarketplaceBudgetTransactions(params),
      },
      listingId,
      sellerId,
    );
  }

  async finalizeOfferAcceptSale(
    offerId: string,
    actorId?: string,
  ): Promise<{ orderId: string; budgetLogged: boolean }> {
    return marketplaceData.finalizeOfferAcceptSale(
      {
        createOrderFromOfferAccept: async (offerId, actorId) => {
          const { getMarketplaceOrdersService } = await import(
            "./marketplaceOrders"
          );
          return getMarketplaceOrdersService(this).createOrderFromOfferAccept(
            offerId,
            actorId,
          );
        },
      },
      offerId,
      actorId,
    );
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
  // EXTRACTED (monolith lane M1d, step 13): the bodies now live in
  // `data/readState.ts`. Nothing outside the section read any constant of it.
  //
  // Seven of these call a sibling — the two batched counters call their
  // fallback, the DM fallback calls `getDMUnreadCount`, both mark-as-read
  // writes call `broadcastChatRead` (still in CHAT INTERNALS below) and both
  // mute writes call `assertChatMuteAccess`. The `deps` literal is written out
  // INLINE at those call sites, and it MUST stay that way: the arrows read
  // `this.<method>` at CALL time, so a `jest.spyOn` on the prototype still
  // intercepts and a bare `{ supabase }` stand-in that never ran a constructor
  // still works. An instance field holding the deps reads as `undefined`
  // there.
  async getGroupUnreadCount(groupId: string, userId: string): Promise<number> {
    return readStateData.getGroupUnreadCount(this.supabase, groupId, userId);
  }

  // Get unread counts for all groups a user is in - OPTIMIZED: single query instead of N+1
  async getAllGroupUnreadCounts(
    userId: string,
  ): Promise<Record<string, number>> {
    return readStateData.getAllGroupUnreadCounts(
      this.supabase,
      {
        getAllGroupUnreadCountsFallback: (uid) =>
          this.getAllGroupUnreadCountsFallback(uid),
      },
      userId,
    );
  }

  // Fallback method for environments without the batch function
  private async getAllGroupUnreadCountsFallback(
    userId: string,
  ): Promise<Record<string, number>> {
    return readStateData.getAllGroupUnreadCountsFallback(this.supabase, userId);
  }

  // Mark group as read for a user
  async markGroupAsRead(
    groupId: string,
    userId: string,
  ): Promise<{ success: boolean; previousLastReadAt: string | null }> {
    return readStateData.markGroupAsRead(
      this.supabase,
      {
        broadcastChatRead: (chatId, payload) =>
          this.broadcastChatRead(chatId, payload),
      },
      groupId,
      userId,
    );
  }

  // Get unread DM count for a thread for a specific user
  async getDMUnreadCount(threadId: string, userId: string): Promise<number> {
    return readStateData.getDMUnreadCount(this.supabase, threadId, userId);
  }

  // Get all DM unread counts for a user - OPTIMIZED: single query instead of N+1
  async getAllDMUnreadCounts(userId: string): Promise<Record<string, number>> {
    return readStateData.getAllDMUnreadCounts(
      this.supabase,
      {
        getAllDMUnreadCountsFallback: (uid) =>
          this.getAllDMUnreadCountsFallback(uid),
      },
      userId,
    );
  }

  // Fallback method for environments without the batch function
  private async getAllDMUnreadCountsFallback(
    userId: string,
  ): Promise<Record<string, number>> {
    return readStateData.getAllDMUnreadCountsFallback(
      this.supabase,
      {
        getDMUnreadCount: (tid, uid) => this.getDMUnreadCount(tid, uid),
      },
      userId,
    );
  }

  // Mark DM thread as read for a user; returns previous last_read_at for unread anchoring.
  async markDMAsRead(
    threadId: string,
    userId: string,
  ): Promise<{ success: boolean; previousLastReadAt: string | null }> {
    return readStateData.markDMAsRead(
      this.supabase,
      {
        broadcastChatRead: (chatId, payload) =>
          this.broadcastChatRead(chatId, payload),
      },
      threadId,
      userId,
    );
  }

  // "Delete for me": hide from inbox (hidden_by) and set a history cutoff so
  // pre-delete messages never resurface for this user. The other participant
  // keeps their full history; marketplace inquiry FKs are preserved.
  // A new message clears hidden_by (thread resurrects) but keeps history_cleared_at.
  async deleteDmThread(threadId: string, userId: string): Promise<boolean> {
    return readStateData.deleteDmThread(this.supabase, threadId, userId);
  }

  // Archive a DM thread for a specific user
  async archiveDmThread(threadId: string, userId: string): Promise<boolean> {
    return readStateData.archiveDmThread(this.supabase, threadId, userId);
  }

  // Unarchive a DM thread for a specific user
  async unarchiveDmThread(threadId: string, userId: string): Promise<boolean> {
    return readStateData.unarchiveDmThread(this.supabase, threadId, userId);
  }

  async isChatMuted(
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
  ): Promise<boolean> {
    return readStateData.isChatMuted(
      this.supabase,
      userId,
      scopeType,
      scopeId,
    );
  }

  async getChatMute(
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
  ): Promise<{ muted: boolean; mutedUntil: string | null }> {
    return readStateData.getChatMute(this.supabase, userId, scopeType, scopeId);
  }

  private async assertChatMuteAccess(
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
  ): Promise<boolean> {
    return readStateData.assertChatMuteAccess(
      this.supabase,
      userId,
      scopeType,
      scopeId,
    );
  }

  async setChatMute(
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
    mutedUntil: Date,
  ): Promise<{ muted: boolean; mutedUntil: string } | null> {
    return readStateData.setChatMute(
      this.supabase,
      {
        assertChatMuteAccess: (uid, type, id) =>
          this.assertChatMuteAccess(uid, type, id),
      },
      userId,
      scopeType,
      scopeId,
      mutedUntil,
    );
  }

  async clearChatMute(
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
  ): Promise<boolean> {
    return readStateData.clearChatMute(
      this.supabase,
      {
        assertChatMuteAccess: (uid, type, id) =>
          this.assertChatMuteAccess(uid, type, id),
      },
      userId,
      scopeType,
      scopeId,
    );
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
