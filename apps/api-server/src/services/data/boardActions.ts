/**
 * data/boardActions.ts — favourite, repost, bookmark and share: the Phase 1
 * board actions, plus the board-page hydration they feed.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1d, step 15):
 * the BOARD ACTIONS (favourite/repost/bookmark) section, 20 methods, together
 * with the four result types the section defines. `services/supabase.ts`
 * re-exports those types, so `routes/messages.ts` and every other importer is
 * untouched.
 *
 * FAVORITE has no write path here on purpose (see the section note below): it
 * is a reaction, so only the READ side — `favoritedAmong` — lives here.
 *
 * ## What it touches
 *
 * Tables: `messages`, `message_bookmarks`, `message_reactions`,
 * `group_members`, `groups`, `communities`, `community_members`,
 * `chat_message_audit`. No storage buckets, no RPCs.
 *
 * ## The gotchas
 *
 * 1. BOOKMARKS OUTLIVE MEMBERSHIP. `listBookmarkedPosts` re-checks
 *    `group_members` for every board a saved post belongs to. It is the single
 *    highest-severity line in the feature: without it a student who left or
 *    was removed from a board keeps reading its members-only posts out of
 *    their own saved list.
 *
 * 2. THE KEYSET CURSOR ADVANCES PAST EVERY ROW EXAMINED, not just the rows
 *    that survived the membership and `removed_at` filters — otherwise a page
 *    whose rows were all filtered out loops forever on the same cursor. For
 *    the same reason `importMessageBookmarks` stamps each row its own
 *    `created_at` one millisecond apart instead of letting `DEFAULT NOW()`
 *    give 200 rows an identical transaction timestamp.
 *
 * 3. `message_bookmarks` (20260904120000) IS DEPLOYED BEFORE IT EXISTS. The
 *    API ships ahead of the hand-applied migration, so every bookmark call
 *    degrades through `bookmarksMissingTable` to `serverBacked: false` /
 *    `status: "unavailable"` rather than 500ing. Same shape as
 *    `reactionsMissingTable`.
 *
 * 4. VIEWER STATE MUST NOT ENTER THE PAGE CACHE. `enrichBoardViewerState` runs
 *    AFTER `cacheService.cached(...)` returns, because the 120-second board
 *    page cache is shared by every member — putting `repostedByMe` or
 *    `bookmarked` inside it would show one student another student's
 *    bookmarks.
 *
 * 5. A REPOST IS A BUMP, NOT SPEECH. `createBoardRepost` deliberately writes
 *    no `groups.last_message` and fans out no notification, and
 *    `undoBoardRepost` deliberately bypasses the 30-minute chat mutation
 *    window while still writing the `chat_message_audit` row that
 *    `remove_chat_message` would have written.
 *
 * 6. The community mute guard is a STATIC import from `data/communityMute.ts`,
 *    never a `deps` entry — see the banner there for why.
 *
 * ## Why the cross-method calls go back through `deps`
 *
 * Every sibling and every reach into another section goes through `deps`, with
 * no exceptions: `supabase.bookmarks.test.ts` and `supabase.boardRepost.test.ts`
 * both build a bare `self = { supabase, bookmarksMissingTable: proto.x,
 * readBoardPostRows: proto.y, … }` and drive the entry point through
 * `SupabaseService.prototype.<m>.call(self, …)`. A local sibling call would
 * step around exactly the stubs those harnesses install. The facade builds the
 * `deps` literal INLINE at each call site, as arrows that read `this.<method>`
 * at CALL time.
 */
import { logger } from "../../utils/logger";
import { normalizeReactions } from "@lantern/shared/chat";
import {
  BOARD_BOOKMARK_IMPORT_MAX,
  BOARD_BOOKMARKS_PAGE_SIZE,
  BOARD_BOOKMARKS_PAGE_SIZE_MAX,
  BOARD_FAVORITE_EMOJI,
  BOARD_QUOTE_SNIPPET_MAX,
  BOARD_REPOST_CLIENT_ID_PREFIX,
  BOARD_REPOST_PER_BOARD_HOURLY_MAX,
  BOARD_REPOST_QUOTE_MAX,
  BOARD_REPOST_SELF_COOLDOWN_MS,
  boardQuoteSnippet,
  boardRepostClientId,
  boardRepostOriginalId,
  isBoardRepostRow,
  type BoardBookmarkEntry,
  type BoardQuotedPost,
} from "@lantern/shared/network";
import {
  parseChatAudioUrl,
  parseChatImageUrl,
} from "@lantern/shared/utils/chatMedia";

import { cacheService } from "../cache";
import {
  isMissingColumnError,
  markMessageBoardColumnsMissing,
  markMessageReactionsColumnMissing,
  messageColumns,
  reactionColumns,
} from "../schemaCapabilities";
import { Message } from "../../types";

import type { DataClient } from "./client";
import { assertNotMutedInCommunity } from "./communityMute";
import { resolveNestedProfile } from "./mappers";

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

/** What `resolveBoardContext` (still in the monolith) answers. */
export type BoardContext = {
  isBoard: boolean;
  communityId: string | null;
  communitySlug: string | null;
  communityCreatedBy: string | null;
  loungeGroupId: string | null;
  adminIds: string[];
};

/**
 * Everything a moved body used to reach through `this`.
 *
 * Build this literal INLINE at each delegating call site, with arrows that
 * read `this.<method>` at CALL time. Hoisting it to an instance field compiles
 * and passes the surface freeze, but breaks every suite that invokes these
 * methods on a bare `{ supabase }` stand-in that never ran a constructor, and
 * bypasses every `jest.spyOn` on the class.
 */
export type BoardActionDeps = {
  /** Siblings in this module — dispatched dynamically, see the banner. */
  bookmarksMissingTable: (error: any) => boolean;
  countRepostsFor: (messageIds: string[]) => Promise<Map<string, number>>;
  repostedByMeAmong: (
    messageIds: string[],
    userId: string,
  ) => Promise<Set<string>>;
  favoritedAmong: (
    messageIds: string[],
    userId: string,
  ) => Promise<Set<string>>;
  bookmarkedAmong: (
    messageIds: string[],
    userId: string,
  ) => Promise<Set<string>>;
  readBoardPostRows: (ids: string[]) => Promise<any[]>;
  readBoardContextForGroups: (
    groupIds: string[],
  ) => Promise<
    Map<
      string,
      { name: string; communitySlug: string | null; communityName: string | null }
    >
  >;
  toBoardPostShape: (
    row: any,
    extras: {
      bookmarked: boolean;
      favorited: boolean;
      repostCount: number;
      repostedByMe: boolean;
      repostOf: BoardQuotedPost | null;
    },
  ) => BoardBookmarkEntry["post"];
  toQuotedPost: (row: any) => BoardQuotedPost;
  orphanedRepostEmbed: (row: any) => BoardQuotedPost | null;
  reviveRemovedRepost: (
    groupId: string,
    userId: string,
    clientMessageId: string,
    text: string | null,
  ) => Promise<Record<string, unknown> | null>;
  /** Groups / storage / chat internals, elsewhere in the server. */
  getAuthorizedGroupMessage: (
    messageId: string,
    userId: string,
  ) => Promise<{
    id: string;
    group_id: string;
    sender_id: string;
    type: string;
  } | null>;
  getAuthorizedDmMessage: (
    messageId: string,
    userId: string,
  ) => Promise<{ id: string; threadId: string } | null>;
  /** Chat internals, still in the monolith (lane M1d step 17 moves it). */
  resolveBoardContext: (groupId: string) => Promise<BoardContext>;
  reactionsMissingTable: (error: any) => boolean;
  normalizeStorageUrl: (url: string) => string;
};

/**
 * The `message_bookmarks` (20260904120000) equivalent of
 * `reactionsMissingTable`. The API is deployed BEFORE the founder
 * hand-applies the migration, so every bookmark call must have a natural
 * fallback rather than a 500.
 */
export function bookmarksMissingTable(error: any): boolean {
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
export async function setMessageBookmark(
  supabase: DataClient,
  deps: Pick<
    BoardActionDeps,
    "getAuthorizedGroupMessage" | "getAuthorizedDmMessage" | "bookmarksMissingTable"
  >,
  messageId: string,
  userId: string,
  bookmarked: boolean,
): Promise<MessageBookmarkResult> {
  if (!messageId || !userId) return { status: "not_found" };

  const target = await deps.getAuthorizedGroupMessage(messageId, userId);
  if (!target) {
    // A DM message is a real row the viewer may well be allowed to read, but
    // there is no surface that could ever render it as a saved POST, so say
    // so instead of pretending it does not exist.
    const dm = await deps.getAuthorizedDmMessage(messageId, userId);
    return dm ? { status: "not_a_board_post" } : { status: "not_found" };
  }

  const run = bookmarked
    ? () =>
        (supabase as any)
          .from("message_bookmarks")
          .upsert(
            { user_id: userId, message_id: messageId },
            { onConflict: "user_id,message_id", ignoreDuplicates: true },
          )
    : () =>
        (supabase as any)
          .from("message_bookmarks")
          .delete()
          .eq("user_id", userId)
          .eq("message_id", messageId);

  const { error } = await run();
  if (error) {
    if (deps.bookmarksMissingTable(error)) return { status: "unavailable" };
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
export async function getBookmarkedMessageIdsForGroup(
  supabase: DataClient,
  deps: Pick<BoardActionDeps, "bookmarksMissingTable">,
  groupId: string,
  userId: string,
): Promise<{ messageIds: string[]; serverBacked: boolean }> {
  if (!groupId || !userId) return { messageIds: [], serverBacked: true };
  // One query, joined through the FK rather than listing every message id in
  // the group first: a board can hold thousands of posts and the viewer
  // typically has a handful of bookmarks.
  const { data, error } = await (supabase as any)
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
    if (deps.bookmarksMissingTable(error)) {
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
export async function listBookmarkedPosts(
  supabase: DataClient,
  deps: Pick<
    BoardActionDeps,
    | "bookmarksMissingTable"
    | "readBoardPostRows"
    | "readBoardContextForGroups"
    | "countRepostsFor"
    | "repostedByMeAmong"
    | "favoritedAmong"
    | "toBoardPostShape"
  >,
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

  let saved = (supabase as any)
    .from("message_bookmarks")
    .select("message_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (options.before) saved = saved.lt("created_at", options.before);

  const { data: savedRows, error: savedError } = await saved;
  if (savedError) {
    if (deps.bookmarksMissingTable(savedError)) {
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

  const posts = await deps.readBoardPostRows(ids);
  if (posts.length === 0) return { entries: [], nextCursor, serverBacked: true };

  const groupIds = [
    ...new Set(posts.map((p: any) => String(p.group_id || "")).filter(Boolean)),
  ];

  // MANDATORY: bookmarks outlive membership.
  const { data: memberships, error: memberError } = await supabase
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

  const boards = await deps.readBoardContextForGroups([
    ...new Set(visible.map((p: any) => String(p.group_id))),
  ]);
  const visibleIds = visible.map((p: any) => String(p.id));
  const [repostCounts, myReposts, myFavorites] = await Promise.all([
    deps.countRepostsFor(visibleIds),
    deps.repostedByMeAmong(visibleIds, userId),
    deps.favoritedAmong(visibleIds, userId),
  ]);

  const entries: BoardBookmarkEntry[] = visible.map((row: any) => {
    const groupId = String(row.group_id || "");
    const board = boards.get(groupId);
    return {
      post: deps.toBoardPostShape(row, {
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
export async function importMessageBookmarks(
  supabase: DataClient,
  deps: Pick<BoardActionDeps, "bookmarksMissingTable">,
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

  const { data: rows, error } = await supabase
    .from("messages")
    .select("id, group_id, thread_root_id, removed_at")
    .in("id", ids);
  if (error) throw error;

  const candidates = (rows || []).filter(
    (r: any) => !r.removed_at && !r.thread_root_id && r.group_id,
  );
  if (candidates.length === 0) return { imported: 0, serverBacked: true };

  const { data: memberships, error: memberError } = await supabase
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

  const { error: upsertError } = await (supabase as any)
    .from("message_bookmarks")
    .upsert(importable, {
      onConflict: "user_id,message_id",
      ignoreDuplicates: true,
    });
  if (upsertError) {
    if (deps.bookmarksMissingTable(upsertError)) {
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
export async function createBoardRepost(
  supabase: DataClient,
  deps: Pick<BoardActionDeps, "resolveBoardContext" | "reviveRemovedRepost">,
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

  const board = await deps.resolveBoardContext(groupId);
  if (!board.isBoard) return { status: "not_board" };
  // A repost is a write into the community too.
  await assertNotMutedInCommunity(supabase, userId, board.communityId);

  const { data: original, error: originalError } = await supabase
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
  const { count, error: countError } = await (supabase as any)
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
  const { data, error } = await (supabase as any)
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
      const revived = await deps.reviveRemovedRepost(
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
/** @internal — no caller outside `createBoardRepost`. */
export async function reviveRemovedRepost(
  supabase: DataClient,
  groupId: string,
  userId: string,
  clientMessageId: string,
  text: string | null,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await (supabase as any)
    .from("messages")
    .select("id, removed_at")
    .eq("group_id", groupId)
    .eq("sender_id", userId)
    .eq("client_message_id", clientMessageId)
    .maybeSingle();
  if (error && (error as any).code !== "PGRST116") return null;
  if (!data || !(data as any).removed_at) return null;

  const { data: revived, error: reviveError } = await (supabase as any)
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
export async function undoBoardRepost(
  supabase: DataClient,
  originalId: string,
  userId: string,
): Promise<BoardRepostUndoResult> {
  if (!originalId || !userId) return { status: "not_found" };
  const clientMessageId = boardRepostClientId(originalId);

  const { data, error } = await (supabase as any)
    .from("messages")
    .select("id, group_id, removed_at")
    .eq("sender_id", userId)
    .eq("client_message_id", clientMessageId)
    .is("removed_at", null)
    .limit(1);
  if (error) throw error;
  const row = (data || [])[0] as { id: string; group_id: string } | undefined;
  if (!row) return { status: "not_found" };

  const repostId = String(row.id);
  const groupId = String(row.group_id);

  // A repost row is not a comment target on any surface, but the API cannot
  // assume a client obeyed that. If anything hangs off it, soft-remove so
  // the thread keeps its shape.
  const { data: children, error: childError } = await supabase
    .from("messages")
    .select("id")
    .eq("thread_root_id", repostId)
    .limit(1);
  if (childError) throw childError;

  if ((children || []).length > 0) {
    const removedAt = new Date().toISOString();
    const { error: removeError } = await (supabase as any)
      .from("messages")
      .update({ removed_at: removedAt, removed_by: userId, text: null })
      .eq("id", repostId)
      .eq("sender_id", userId);
    if (removeError) throw removeError;
    // remove_chat_message would have written this; going around it for the
    // window bypass must not also lose the audit trail.
    await (supabase as any)
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
    const { error: deleteError } = await (supabase as any)
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
/** @internal — the board page hydrator; called from the chat reads. */
export async function attachBoardRepostContext(
  supabase: DataClient,
  deps: Pick<
    BoardActionDeps,
    "toQuotedPost" | "countRepostsFor" | "orphanedRepostEmbed"
  >,
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
    const { data, error } = await (supabase as any)
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
          deps.toQuotedPost(row),
        ]),
      );
    }
  }

  const counts = await deps.countRepostsFor(rows.map((r) => String(r.id)));

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
        : deps.orphanedRepostEmbed(row),
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
/** @internal */
export function orphanedRepostEmbed(row: any): BoardQuotedPost | null {
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
/** @internal */
export function toQuotedPost(row: any): BoardQuotedPost {
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
/** @internal */
export async function countRepostsFor(
  supabase: DataClient,
  messageIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (!ids.length) return counts;
  const { data, error } = await (supabase as any)
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
/** @internal */
export async function repostedByMeAmong(
  supabase: DataClient,
  messageIds: string[],
  userId: string,
): Promise<Set<string>> {
  const mine = new Set<string>();
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (!ids.length || !userId) return mine;
  const { data, error } = await (supabase as any)
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
/** @internal */
export async function favoritedAmong(
  supabase: DataClient,
  deps: Pick<BoardActionDeps, "reactionsMissingTable">,
  messageIds: string[],
  userId: string,
): Promise<Set<string>> {
  const mine = new Set<string>();
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (!ids.length || !userId) return mine;
  const { data, error } = await (supabase as any)
    .from("message_reactions")
    .select("group_message_id")
    .eq("user_id", userId)
    .eq("emoji", BOARD_FAVORITE_EMOJI)
    .in("group_message_id", ids);
  if (error) {
    if (!deps.reactionsMissingTable(error)) throw error;
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
/** @internal */
export async function enrichBoardViewerState(
  deps: Pick<BoardActionDeps, "repostedByMeAmong" | "bookmarkedAmong">,
  messages: Message[],
  viewerUserId: string,
): Promise<Message[]> {
  if (!messages.length || !viewerUserId) return messages;
  const ids = messages.map((m) => String(m.id));
  const [mine, bookmarked] = await Promise.all([
    deps.repostedByMeAmong(ids, viewerUserId),
    deps.bookmarkedAmong(ids, viewerUserId),
  ]);
  return messages.map((message) => ({
    ...message,
    repostedByMe: mine.has(String(message.id)),
    bookmarked: bookmarked.has(String(message.id)),
  }));
}

/** Which of these posts the viewer saved. `{}` — never a throw — pre-migration. */
/** @internal */
export async function bookmarkedAmong(
  supabase: DataClient,
  deps: Pick<BoardActionDeps, "bookmarksMissingTable">,
  messageIds: string[],
  userId: string,
): Promise<Set<string>> {
  const saved = new Set<string>();
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (!ids.length || !userId) return saved;
  const { data, error } = await (supabase as any)
    .from("message_bookmarks")
    .select("message_id")
    .eq("user_id", userId)
    .in("message_id", ids);
  if (error) {
    if (deps.bookmarksMissingTable(error)) {
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
/** @internal */
export async function readBoardPostRows(
  supabase: DataClient,
  ids: string[],
): Promise<any[]> {
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
    (supabase as any).from("messages").select(select).in("id", ids);

  let { data, error } = await run(
    await reactionColumns(supabase, await messageColumns(supabase, base)),
  );
  if (error && isMissingColumnError(error)) {
    markMessageReactionsColumnMissing();
    ({ data, error } = await run(await messageColumns(supabase, base)));
  }
  if (error && isMissingColumnError(error)) {
    markMessageBoardColumnsMissing();
    ({ data, error } = await run(base));
  }
  if (error) throw error;
  return (data || []) as any[];
}

/** Board name plus community slug/name for a set of groups, for saved rows. */
/** @internal */
export async function readBoardContextForGroups(
  supabase: DataClient,
  groupIds: string[],
): Promise<
  Map<string, { name: string; communitySlug: string | null; communityName: string | null }>
> {
  const out = new Map<
    string,
    { name: string; communitySlug: string | null; communityName: string | null }
  >();
  if (!groupIds.length) return out;
  const { data: groups, error } = await supabase
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
    const { data: rows } = await supabase
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
/** @internal */
export function toBoardPostShape(
  deps: Pick<BoardActionDeps, "normalizeStorageUrl">,
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
      ? deps.normalizeStorageUrl(String(row.image_url))
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
/** @internal */
export async function communityMemberRole(
  supabase: DataClient,
  communityId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("community_members")
    .select("role")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .is("opted_out_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as { role?: string | null } | null)?.role ?? null;
}
