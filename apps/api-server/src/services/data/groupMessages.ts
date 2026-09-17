/**
 * data/groupMessages.ts — the `messages` table: paged reads, edit/remove,
 * peer votes and emoji reactions.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1e, step 16):
 * the GROUP MESSAGES section, 24 methods, together with the two page-size
 * constants it was the only user of and the `ChatMessageMutationResult` types
 * `routes/messages.ts` consumes. `services/supabase.ts` re-exports those types,
 * so no importer moves.
 *
 * ## What it touches
 *
 * Tables: `messages`, `dm_messages`, `dm_threads`, `groups`, `group_members`,
 * `message_reactions`, `question_votes`, `notifications`. RPCs:
 * `edit_chat_message`, `remove_chat_message`. No storage buckets.
 *
 * ## The gotchas
 *
 * 1. ONE TABLE, THREE PRODUCTS. `messages` serves group chat, the community
 *    board and the peer question bank at once, and a row's `type` /
 *    `questionType` is the only thing that says which. A change here lands on
 *    all three.
 *
 * 2. AUTHORIZATION IS THE CALLER'S JOB on every write in this module: these
 *    functions take ids and write. Route handlers must have gone through
 *    `getAuthorizedGroupMessage` / `getAuthorizedDmMessage` first, and for a
 *    write on content the caller did not author, the author-or-group-admin
 *    rule.
 *
 * 3. ENRICHMENT RUNS AFTER THE ROW QUERY, NOT AS AN EMBED — reply previews,
 *    thread counts, repost context, peer upvotes and receipts are each their
 *    own follow-up read, so a table missing on this database degrades ONE
 *    field instead of failing the whole page.
 *
 * 4. VIEWER STATE MUST NOT ENTER THE PAGE CACHE. `attachPeerUpvotes` and
 *    `attachBoardRepostContext` ride INSIDE `cacheService.cached(...)` because
 *    their answers are the same for every member; `enrichGroupMessageReceipts`
 *    and `enrichBoardViewerState` run AFTER it returns, because theirs are
 *    not. Moving either across that line shows one student another student's
 *    state.
 *
 * 5. VERIFIED IS EVIDENCE, NOT A TALLY. `syncQuestionStatusAfterVote` re-checks
 *    `countPeerUpvotesForMessage` before it will write VERIFIED, because the
 *    denormalised `upvotes` includes the author's own vote and the 20% share
 *    threshold is 1 in any group of five or fewer — without that clause an
 *    author could auto-verify their own question.
 *
 * 6. THE `onConflict` TARGET MUST NAME A PLAIN UNIQUE INDEX. PostgREST cannot
 *    use a PARTIAL unique index as a conflict target and the upsert then 500s
 *    at runtime with no compile-time or test signal — that is how every
 *    reaction and every favorite broke silently for several releases. See the
 *    note on `addMessageReaction`.
 *
 * 7. `getGroupMessages`' `runPage(selectClause)` is the one select in this
 *    module the embed scanner cannot resolve through its parameter; its ledger
 *    row moved here from `services/supabase.ts::selectClause` with the code
 *    (`services/postgrestEmbedDisambiguation.test.ts`). Both branches of the
 *    ternary embed `profiles!sender_id (...)`, the named form.
 *
 * ## Why the cross-method calls go back through `deps`
 *
 * Every sibling and every reach into another section goes through `deps`, with
 * no exceptions: `supabase.messageReactions.test.ts`,
 * `supabase.boardPaging.test.ts`, `supabase.boardMessages.test.ts`,
 * `supabase.boardMedia.test.ts` and `supabase.peerUpvotes.test.ts` all build a
 * bare `self = { supabase, reactionsMissingTable: proto.x, attachPeerUpvotes:
 * proto.y, … }` and drive the entry point through
 * `SupabaseService.prototype.<m>.call(self, …)`. A local sibling call would
 * step around exactly the stubs those harnesses install. The facade builds the
 * `deps` literal INLINE at each call site, as arrows that read `this.<method>`
 * at CALL time.
 */
import { logger } from "../../utils/logger";
import { QuestionStatus } from "@lantern/shared/types";
import {
  canVerifyQuestion,
  countPeerUpvotes,
} from "@lantern/shared/utils/questionVerification";
import { resolveQuestionStatusAfterVote } from "@lantern/shared/utils/testHelpers";

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
import {
  mapChatMessageRow,
  mapProfileSender,
  resolveNestedProfile,
} from "./mappers";

/**
 * Page sizes for `getGroupMessages`. Private statics on `SupabaseService`
 * until lane M1e; this is their only reader, and they are not on the prototype
 * so the surface freeze does not see them move.
 */
const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const MAX_MESSAGE_PAGE_SIZE = 100;

/**
 * Why an edit or a removal did or did not happen. The route maps each status
 * to its own code, so the client can say the true thing rather than "something
 * went wrong".
 */
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
 * Everything a moved body used to reach through `this`.
 *
 * Build this literal INLINE at each delegating call site, with arrows that
 * read `this.<method>` at CALL time. Hoisting it to an instance field compiles
 * and passes the surface freeze, but breaks every suite that invokes these
 * methods on a bare `{ supabase }` stand-in that never ran a constructor, and
 * bypasses every `jest.spyOn` on the class.
 */
export type GroupMessageDeps = {
  /** Siblings in this module — dispatched dynamically, see the banner. */
  attachPeerUpvotes: (messages: any[]) => Promise<any[]>;
  clearPinOnRemovedMessage: (message: Record<string, any>) => Promise<void>;
  countPeerUpvotesForMessage: (
    messageId: string,
    authorId: string | null | undefined,
  ) => Promise<number>;
  invalidateChatMessageMutation: (
    kind: "group" | "dm",
    row: Record<string, any>,
  ) => Promise<void>;
  mapChatMutationRow: (
    kind: "group" | "dm",
    row: Record<string, any>,
  ) => Record<string, unknown>;
  reactionsMissingTable: (error: any) => boolean;
  readMessageReactions: (
    messageId: string,
    scope?: "group" | "dm",
  ) => Promise<{ reactions: Record<string, number> }>;
  refreshChatMessageNotifications: (
    kind: "group" | "dm",
    messageId: string,
    action: "edited" | "removed",
    preview?: string,
  ) => Promise<void>;
  refreshChatPreview: (
    kind: "group" | "dm",
    row: Record<string, any>,
  ) => Promise<void>;
  syncQuestionStatusAfterVote: (messageId: string) => Promise<{
    upvotes: number;
    downvotes: number;
    groupId: string | null;
    questionStatus?: string;
  }>;

  /** Still in the monolith or in another repository. */
  attachBoardRepostContext: (
    messages: any[],
    groupId: string,
  ) => Promise<any[]>;
  attachReplyPreviewsBatch: (
    rows: any[],
    table: "messages" | "dm_messages",
  ) => Promise<any[]>;
  attachThreadReplyCounts: (
    rows: any[],
    table: "messages" | "dm_messages",
    scopeColumn: "group_id" | "thread_id",
    scopeId: string,
  ) => Promise<any[]>;
  enrichBoardViewerState: (
    messages: Message[],
    userId: string,
  ) => Promise<Message[]>;
  enrichGroupMessageReceipts: (
    messages: Message[],
    groupId: string,
    viewerUserId: string,
  ) => Promise<Message[]>;
  getResponseProfile: (value?: string) => "compact" | "full";
  normalizeMessageRecord: (
    row: any,
  ) => Partial<Message> & { type: "TEXT" | "QUESTION" };
};

export async function getGroupMessages(
  db: DataClient,
  deps: Pick<
    GroupMessageDeps,
    | "getResponseProfile"
    | "attachReplyPreviewsBatch"
    | "attachThreadReplyCounts"
    | "attachBoardRepostContext"
    | "attachPeerUpvotes"
    | "normalizeMessageRecord"
    | "enrichGroupMessageReceipts"
    | "enrichBoardViewerState"
  >,
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
    limit = DEFAULT_MESSAGE_PAGE_SIZE,
    before,
    after,
    responseProfile = "full",
    viewerUserId,
    rootsOnly = false,
  } = options;
  const profile = deps.getResponseProfile(responseProfile);
  const safeLimit = Math.min(
    MAX_MESSAGE_PAGE_SIZE,
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
        let query = (db as any)
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
          db,
          await messageColumns(db, baseSelectClause),
        ),
      );
      if (error && isMissingColumnError(error)) {
        markMessageReactionsColumnMissing();
        ({ data, error } = await runPage(
          await messageColumns(db, baseSelectClause),
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

      const withReplies = await deps.attachReplyPreviewsBatch(
        data || [],
        "messages",
      );
      const withCounts = await deps.attachThreadReplyCounts(
        withReplies,
        "messages",
        "group_id",
        groupId,
      );
      // Board only. `repostOf` and `repostCount` are the same for every
      // member, so they belong INSIDE the 120s page cache; `repostedByMe`
      // and `bookmarked` are viewer-specific and are attached after it.
      const withReposts = rootsOnly
        ? await deps.attachBoardRepostContext(withCounts, groupId)
        : withCounts;
      // Verification progress ("1 of 2 peer votes") is the same for every
      // member, so it belongs inside the 120s page cache alongside the repost
      // context. Both response profiles get it: `compact` drops
      // `question_data`, but the count is computed, not selected.
      const withPeerUpvotes = await deps.attachPeerUpvotes(withReposts);

      return withPeerUpvotes
        .reverse()
        .map((msg: any) =>
          mapChatMessageRow(msg, deps.normalizeMessageRecord(msg)),
        );
    },
    { ttl: 120 },
  ); // Cache for 2 minutes

  if (viewerUserId) {
    const withReceipts = await deps.enrichGroupMessageReceipts(
      messages,
      groupId,
      viewerUserId,
    );
    return rootsOnly
      ? deps.enrichBoardViewerState(withReceipts, viewerUserId)
      : withReceipts;
  }
  return messages;
}

export async function getMessageById(
  db: DataClient,
  deps: Pick<GroupMessageDeps, "attachPeerUpvotes" | "normalizeMessageRecord">,
  messageId: string,
  userId?: string,
): Promise<Message | null> {
  const rawCacheKey = `message:raw:${messageId}`;

  const data = await cacheService.cached(
    rawCacheKey,
    async () => {
      const { data: row, error } = await db
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
    const { data: membership, error: memberError } = await db
      .from("group_members")
      .select("user_id, pending")
      .eq("group_id", data.group_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (memberError && memberError.code !== "PGRST116") throw memberError;
    if (!membership || membership.pending === true) return null;
  }

  // Outside the raw-row cache on purpose: votes move faster than its 600s TTL.
  const [row] = await deps.attachPeerUpvotes([data]);

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
    ...deps.normalizeMessageRecord(row),
  };
}

export function mapChatMutationRow(
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

export async function refreshChatPreview(
  db: DataClient,
  kind: "group" | "dm",
  row: Record<string, any>,
): Promise<void> {
  if (kind === "group") {
    const groupId = row.group_id as string;
    const { data: latest, error: latestError } = await db
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
    let updateQuery = db
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
  const { data: latest, error: latestError } = await db
    .from("dm_messages")
    .select("text, timestamp")
    .eq("thread_id", threadId)
    .is("removed_at", null)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) throw latestError;
  const previewCutoff = latest?.timestamp || row.timestamp;
  let updateQuery = db
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

export async function invalidateChatMessageMutation(
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

export async function refreshChatMessageNotifications(
  db: DataClient,
  kind: "group" | "dm",
  messageId: string,
  action: "edited" | "removed",
  preview?: string,
): Promise<void> {
  const { data: notifications, error } = await db
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
      const { error: updateError } = await db
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

export async function editChatMessage(
  db: DataClient,
  deps: Pick<
    GroupMessageDeps,
    | "invalidateChatMessageMutation"
    | "refreshChatPreview"
    | "refreshChatMessageNotifications"
    | "mapChatMutationRow"
  >,
  kind: "group" | "dm",
  messageId: string,
  actorId: string,
  content: string,
): Promise<ChatMessageMutationResult> {
  const { data, error } = await db.rpc("edit_chat_message", {
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

  await deps.invalidateChatMessageMutation(kind, result.message);
  try {
    await deps.refreshChatPreview(kind, result.message);
  } catch (previewError) {
    logger.warn("Failed to refresh chat preview after message edit", {
      kind,
      messageId,
      previewError,
    });
  }
  try {
    await deps.refreshChatMessageNotifications(
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
    message: deps.mapChatMutationRow(kind, result.message),
  };
}

export async function removeChatMessage(
  db: DataClient,
  deps: Pick<
    GroupMessageDeps,
    | "clearPinOnRemovedMessage"
    | "invalidateChatMessageMutation"
    | "refreshChatPreview"
    | "refreshChatMessageNotifications"
    | "mapChatMutationRow"
  >,
  kind: "group" | "dm",
  messageId: string,
  actorId: string,
): Promise<ChatMessageMutationResult> {
  const { data, error } = await db.rpc("remove_chat_message", {
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
    await deps.clearPinOnRemovedMessage(result.message);
  }

  await deps.invalidateChatMessageMutation(kind, result.message);
  try {
    await deps.refreshChatPreview(kind, result.message);
  } catch (previewError) {
    logger.warn("Failed to refresh chat preview after message removal", {
      kind,
      messageId,
      previewError,
    });
  }
  try {
    await deps.refreshChatMessageNotifications(
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
    message: deps.mapChatMutationRow(kind, result.message),
  };
}

/**
 * Drop the server pin from a just-removed group message. Best-effort: a
 * pre-migration database has no `pinned_at`, and a failure here must not
 * turn a successful deletion into an error.
 */
export async function clearPinOnRemovedMessage(
  db: DataClient,
  message: Record<string, any>,
): Promise<void> {
  if (!message?.id || !message.pinned_at) return;
  try {
    const { error } = await (db as any)
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
export async function syncQuestionStatusAfterVote(
  db: DataClient,
  deps: Pick<GroupMessageDeps, "countPeerUpvotesForMessage">,
  messageId: string,
): Promise<{
  upvotes: number;
  downvotes: number;
  groupId: string | null;
  questionStatus?: string;
}> {
  const { data: msg, error } = await db
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
    const { count, error: countError } = await db
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
      const peerUpvotes = await deps.countPeerUpvotesForMessage(
        messageId,
        msg.sender_id ?? null,
      );
      if (!canVerifyQuestion(peerUpvotes)) resolved = QuestionStatus.PENDING;
    }
    if (resolved !== questionStatus) {
      const { error: updateError } = await db
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

export async function voteQuestion(
  db: DataClient,
  deps: Pick<GroupMessageDeps, "syncQuestionStatusAfterVote">,
  messageId: string,
  userId: string,
  voteType: "up" | "down",
): Promise<any> {
  const { data: existingVote, error: checkError } = await db
    .from("question_votes")
    .select("vote_type")
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .maybeSingle();

  if (checkError) throw checkError;

  if (existingVote?.vote_type === voteType) {
    const synced = await deps.syncQuestionStatusAfterVote(messageId);
    return {
      success: true,
      voteType,
      upvotes: synced.upvotes,
      downvotes: synced.downvotes,
      questionStatus: synced.questionStatus,
    };
  }

  const { error } = await db.from("question_votes").upsert(
    {
      message_id: messageId,
      user_id: userId,
      vote_type: voteType,
    },
    { onConflict: "message_id,user_id" },
  );

  if (error) throw error;

  const synced = await deps.syncQuestionStatusAfterVote(messageId);
  return {
    success: true,
    voteType,
    upvotes: synced.upvotes,
    downvotes: synced.downvotes,
    questionStatus: synced.questionStatus,
  };
}

export async function removeVote(
  db: DataClient,
  deps: Pick<GroupMessageDeps, "syncQuestionStatusAfterVote">,
  messageId: string,
  userId: string,
): Promise<any> {
  const { error } = await db
    .from("question_votes")
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", userId);

  if (error) throw error;

  const synced = await deps.syncQuestionStatusAfterVote(messageId);
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
export function reactionsMissingTable(error: any): boolean {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "42703"
  );
}

export async function addMessageReaction(
  db: DataClient,
  deps: Pick<GroupMessageDeps, "reactionsMissingTable" | "readMessageReactions">,
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
  const { error } = await db
    .from("message_reactions")
    .upsert(
      { [column]: messageId, user_id: userId, emoji },
      { onConflict: `${column},user_id,emoji`, ignoreDuplicates: true },
    );
  if (error) {
    if (deps.reactionsMissingTable(error)) {
      const err: any = new Error("Reactions are not available yet");
      err.statusCode = 503;
      throw err;
    }
    throw error;
  }
  return deps.readMessageReactions(messageId, scope);
}

export async function removeMessageReaction(
  db: DataClient,
  deps: Pick<GroupMessageDeps, "reactionsMissingTable" | "readMessageReactions">,
  messageId: string,
  userId: string,
  emoji: string,
  scope: "group" | "dm" = "group",
): Promise<{ reactions: Record<string, number> }> {
  const column = scope === "dm" ? "dm_message_id" : "group_message_id";
  const { error } = await db
    .from("message_reactions")
    .delete()
    .eq(column, messageId)
    .eq("user_id", userId)
    .eq("emoji", emoji);
  if (error) {
    if (deps.reactionsMissingTable(error)) {
      const err: any = new Error("Reactions are not available yet");
      err.statusCode = 503;
      throw err;
    }
    throw error;
  }
  return deps.readMessageReactions(messageId, scope);
}

/** Authoritative counts straight after a write (the trigger has already run). */
export async function readMessageReactions(
  db: DataClient,
  deps: Pick<GroupMessageDeps, "reactionsMissingTable">,
  messageId: string,
  scope: "group" | "dm" = "group",
): Promise<{ reactions: Record<string, number> }> {
  const table = scope === "dm" ? "dm_messages" : "messages";
  const { data, error } = await db
    .from(table)
    .select("reactions")
    .eq("id", messageId)
    .maybeSingle();
  if (error) {
    if (deps.reactionsMissingTable(error)) return { reactions: {} };
    throw error;
  }
  const raw = (data as any)?.reactions;
  return { reactions: raw && typeof raw === "object" ? raw : {} };
}

/** How many DISTINCT emoji a message already carries (API-side cap). */
export async function countDistinctReactionEmoji(
  deps: Pick<GroupMessageDeps, "readMessageReactions">,
  messageId: string,
  scope: "group" | "dm" = "group",
): Promise<number> {
  const { reactions } = await deps.readMessageReactions(messageId, scope);
  return Object.keys(reactions).length;
}

/** The viewer's own reactions across a group: { messageId: ["👍", "🔥"] }. */
export async function getUserReactionsForGroup(
  db: DataClient,
  deps: Pick<GroupMessageDeps, "reactionsMissingTable">,
  groupId: string,
  userId: string,
): Promise<Record<string, string[]>> {
  const { data: messages, error: msgError } = await db
    .from("messages")
    .select("id")
    .eq("group_id", groupId);
  if (msgError) throw msgError;
  if (!messages || messages.length === 0) return {};

  const { data, error } = await db
    .from("message_reactions")
    .select("group_message_id, emoji")
    .eq("user_id", userId)
    .in(
      "group_message_id",
      messages.map((m: any) => m.id),
    );
  if (error) {
    if (deps.reactionsMissingTable(error)) return {};
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
export async function getUserReactionsForThread(
  db: DataClient,
  deps: Pick<GroupMessageDeps, "reactionsMissingTable">,
  threadId: string,
  userId: string,
): Promise<Record<string, string[]>> {
  const { data: messages, error: msgError } = await db
    .from("dm_messages")
    .select("id")
    .eq("thread_id", threadId);
  if (msgError) throw msgError;
  if (!messages || messages.length === 0) return {};

  const { data, error } = await db
    .from("message_reactions")
    .select("dm_message_id, emoji")
    .eq("user_id", userId)
    .in(
      "dm_message_id",
      messages.map((m: any) => m.id),
    );
  if (error) {
    if (deps.reactionsMissingTable(error)) return {};
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
export async function countPeerUpvotesForMessage(
  db: DataClient,
  messageId: string,
  authorId: string | null | undefined,
): Promise<number> {
  const { data, error } = await db
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
export async function attachPeerUpvotes(
  db: DataClient,
  messages: any[],
): Promise<any[]> {
  const questionIds = messages
    .filter((m) => String(m?.type || "").toUpperCase() === "QUESTION" && m?.id)
    .map((m) => m.id as string);
  if (!questionIds.length) return messages;

  const { data, error } = await db
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

export async function getUserVotesForGroup(
  db: DataClient,
  groupId: string,
  userId: string,
): Promise<Record<string, "up" | "down">> {
  // Get all message IDs in the group
  const { data: messages, error: msgError } = await db
    .from("messages")
    .select("id")
    .eq("group_id", groupId);

  if (msgError) throw msgError;
  if (!messages || messages.length === 0) return {};

  const messageIds = messages.map((m) => m.id);

  // Get user's votes for those messages
  const { data: votes, error: votesError } = await db
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

export async function updateQuestionStatus(
  db: DataClient,
  messageId: string,
  questionStatus: string,
): Promise<any> {
  // First get the current message to get the question_data
  const { data: currentMessage, error: fetchError } = await db
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

  const { data, error } = await db
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

export async function updateMessageFlagged(
  db: DataClient,
  messageId: string,
  flaggedUserIds: string[],
): Promise<Message | null> {
  const { data, error } = await db
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


// ============================================================================
// THE UNPAGED WHOLE-GROUP MESSAGE READ
// ----------------------------------------------------------------------------
// Moved verbatim out of `services/supabase.ts` (monolith lane M1h) — the last
// group-message read left in that file. It sat under the BOARD ACTIONS banner
// only by where it was pasted.
//
// Gotcha: like `getGroupMessages` above, the viewer-state pass
// (`attachPeerUpvotes`) runs INSIDE `cacheService.cached(...)`, and the cache
// key is per-GROUP, not per-viewer. That is pre-existing behaviour and moves
// unchanged; see gotcha 4 in this module's banner.
// ============================================================================

export async function fetchMessages(
  db: DataClient,
  deps: Pick<GroupMessageDeps, "attachPeerUpvotes" | "normalizeMessageRecord">,
  groupId: string,
): Promise<Message[]> {
  const cacheKey = `group:${groupId}:messages`;

  return cacheService.cached(
    cacheKey,
    async () => {
      const { data, error } = await db
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
      const withPeerUpvotes = await deps.attachPeerUpvotes(data as any[]);

      return withPeerUpvotes.map((msg: any) =>
        mapChatMessageRow(msg, deps.normalizeMessageRecord(msg)),
      );
    },
    { ttl: 30 },
  ); // Cache for 30 seconds
}
