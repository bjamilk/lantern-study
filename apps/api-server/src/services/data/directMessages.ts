/**
 * data/directMessages.ts — `dm_threads` / `dm_messages`, the message-request
 * lifecycle, `user_blocks`, and the cross-thread message search.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1d, step 14):
 * the whole DIRECT MESSAGES, MESSAGE REQUESTS AND BLOCKS section, 10 methods.
 * Second module of the chat cluster; it reads the state `data/readState.ts`
 * writes (the per-user `history_cleared_at` cutoff) and never the reverse.
 *
 * ## What it touches
 *
 * Tables: `dm_threads`, `dm_messages`, `user_blocks`, `profiles`, and —
 * through `searchMessages` — `messages` and `group_members`. No storage
 * buckets, no RPCs.
 *
 * ## The gotchas
 *
 * 1. BLOCKS ARE CHECKED IN BOTH DIRECTIONS. `usersAreBlocked` /
 *    `isDmBlockedBetween` are the symmetric form and are what `sendDirectMessage`
 *    and `acceptDmMessageRequest` use; `didUserBlock` is one-directional and is
 *    NOT sufficient on its own. The block check in `sendDirectMessage` runs
 *    before the privacy check and applies even on the `bypassPrivacy`
 *    (marketplace) path — that ordering is observable, because a blocked
 *    marketplace sender must see "You cannot message this user" rather than
 *    a privacy refusal.
 *
 * 2. DELETE-FOR-ME IS A CUTOFF. Every read here applies the caller's own
 *    `history_cleared_at` (`readDmHistoryClearedAt` → `.gt("timestamp", …)`),
 *    and `sendDirectMessage` clears only the SENDER's cutoff
 *    (`clearDmHistoryClearedAtForUser`) so their first message after a
 *    delete-for-me is visible to them while the recipient's cutoff survives.
 *    A read that forgets the cutoff resurrects a conversation the user cleared.
 *
 * 3. THE REACTIONS CAPABILITY LADDER. `dm_messages.reactions` lands in the
 *    same migration as `messages.reactions` (20260830120000), so one
 *    capability answers for both: `getDirectMessages` asks `reactionColumns`,
 *    and on a missing-column error marks the capability and re-runs the page
 *    with the base select. Removing the ladder makes every DM read `{}` until
 *    a realtime UPDATE arrives on an unmigrated database.
 *
 * 4. THE ACCEPT PATH RECORDS A NORTH-STAR EVENT WITH A NULL objectType, on
 *    purpose — see the comment on the call. It is fire-and-forget through
 *    `record()`, which swallows, so a CHECK-constraint violation there would
 *    be silent.
 *
 * ## Why the cross-method calls go back through `deps`
 *
 * Nine call sites reach chat internals that are still in the monolith
 * (`attachReplyPreview`, `attachReplyPreviewsBatch`, `attachThreadReplyCounts`,
 * `enrichDmMessageReceipts`, `resolveThreadRootForReply`, `createNotification`,
 * `normalizeMessageRecord`), plus the sibling `isDmBlockedBetween` and the
 * `learningConnections` recorder, which needs the `SupabaseService` instance.
 * `supabase.messageReactions.test.ts` drives `getDirectMessages` through
 * `SupabaseService.prototype.getDirectMessages.call(self, …)` on a bare
 * `{ supabase, attachReplyPreviewsBatch, attachThreadReplyCounts,
 * enrichDmMessageReceipts }` stand-in that never ran a constructor — so the
 * facade builds the `deps` literal INLINE at each call site, as arrows that
 * read `this.<method>` at CALL time. An instance field would read `undefined`
 * there.
 */
import type { ConnectionInput as LearningConnectionInput } from "../learningConnections";
import { logger } from "../../utils/logger";
import { normalizeReactions } from "@lantern/shared/chat";
import {
  clearDmHistoryClearedAtForUser,
  readDmHistoryClearedAt,
} from "@lantern/shared/utils/dmHistoryCutoff";

import {
  isMissingColumnError,
  markMessageReactionsColumnMissing,
  reactionColumns,
} from "../schemaCapabilities";
import { Message } from "../../types";

import type { DataClient } from "./client";
import { mapProfileSender, resolveNestedProfile } from "./mappers";

/**
 * Everything a moved body used to reach through `this`.
 *
 * Build this literal INLINE at each delegating call site, with arrows that
 * read `this.<method>` at CALL time. Hoisting it to an instance field compiles
 * and passes the surface freeze, but breaks every suite that invokes these
 * methods on a bare `{ supabase }` stand-in that never ran a constructor, and
 * bypasses every `jest.spyOn` on the class.
 */
export type DirectMessageDeps = {
  /** Chat internals, still in the monolith (lane M1d step 17 moves them). */
  attachReplyPreview: (
    row: any,
    table: "messages" | "dm_messages",
  ) => Promise<any>;
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
  enrichDmMessageReceipts: (
    messages: Message[],
    threadId: string,
    userId: string,
    otherUserId: string,
  ) => Promise<Message[]>;
  resolveThreadRootForReply: (
    table: "messages" | "dm_messages",
    replyToMessageId: string,
    scope: { groupId?: string; threadId?: string },
  ) => Promise<string>;
  normalizeMessageRecord: (
    row: any,
  ) => Partial<Message> & { type: "TEXT" | "QUESTION" };
  createNotification: (
    userId: string,
    notification: {
      message: string;
      link?: string;
      type?: string;
      data?: Record<string, unknown>;
    },
  ) => Promise<unknown>;
  /** The symmetric block predicate — the sibling below, dispatched dynamically. */
  isDmBlockedBetween: (userIdA: string, userIdB: string) => Promise<boolean>;
  /**
   * `getLearningConnectionsService(this).record(...)`. Injected because it
   * wants the `SupabaseService` instance, which this module must not import.
   */
  /**
   * TYPED (M3 Phase B): this used to be a hand-written shape with
   * `kind: string`, and the bridge that supplied it passed `input as never` to
   * get past the mismatch — so a `kind` outside `CONNECTION_KINDS`, which
   * `record()` silently DROPS at runtime, compiled fine. It is the service's
   * own input type now, and the cast is gone.
   */
  recordLearningConnection: (input: LearningConnectionInput) => Promise<void>;
};

export async function getDirectMessages(
  supabase: DataClient,
  deps: Pick<
    DirectMessageDeps,
    | "attachReplyPreviewsBatch"
    | "attachThreadReplyCounts"
    | "enrichDmMessageReceipts"
  >,
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
    const { data: threadMeta } = await supabase
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
      let query = supabase
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

    const dmSelect = await reactionColumns(supabase, baseDmSelect);
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

    const withReplies = await deps.attachReplyPreviewsBatch(
      data || [],
      "dm_messages",
    );
    const withCounts = await deps.attachThreadReplyCounts(
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

    return deps.enrichDmMessageReceipts(mapped, threadId, userId, otherUserId);
  } catch (error) {
    logger.error("Exception fetching DM messages", {
      error,
      userId,
      otherUserId,
    });
    return [];
  }
}

export async function sendDirectMessage(
  supabase: DataClient,
  deps: Pick<
    DirectMessageDeps,
    | "attachReplyPreview"
    | "resolveThreadRootForReply"
    | "createNotification"
  >,
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

  const { usersAreBlocked, resolveDirectMessageAccess } = await import(
    "../../utils/userSettingsPolicy"
  );
  // Blocks always apply — even marketplace / bypassPrivacy paths.
  if (await usersAreBlocked(supabase, senderId, recipientId)) {
    throw new Error("You cannot message this user");
  }

  if (!options?.bypassPrivacy) {
    const { data: recipientProfile, error: recipientError } = await supabase
      .from("profiles")
      .select("settings")
      .eq("id", recipientId)
      .single();

    if (recipientError || !recipientProfile) {
      throw new Error("Recipient not found");
    }

    const access = await resolveDirectMessageAccess(
      supabase,
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
    const { data: existingThread } = await supabase
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

    const { error: threadError } = await supabase.from("dm_threads").upsert(
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
      insertPayload.thread_root_id = await deps.resolveThreadRootForReply(
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

    const { data, error } = await supabase
      .from("dm_messages")
      .insert(insertPayload)
      .select(dmSelect)
      .single();

    if (error) {
      if (error.code === "23505" && options?.clientMessageId) {
        const { data: existing } = await supabase
          .from("dm_messages")
          .select(dmSelect)
          .eq("thread_id", threadId)
          .eq("sender_id", senderId)
          .eq("client_message_id", options.clientMessageId)
          .maybeSingle();
        if (existing) {
          const withReply = await deps.attachReplyPreview(
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

    await supabase
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
    const preview = content.length > 80 ? `${content.slice(0, 80)}…` : content;
    const isRequestNotify = nextStatus === "pending";

    void deps
      .createNotification(recipientId, {
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
      })
      .catch((err) => {
        logger.error("Failed to create DM notification", {
          error: err,
          recipientId,
          threadId,
        });
      });

    const withReply = await deps.attachReplyPreview(data, "dm_messages");
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

export async function blockUser(
  supabase: DataClient,
  blockerId: string,
  blockedId: string,
): Promise<void> {
  if (!blockerId || !blockedId || blockerId === blockedId) {
    throw new Error("Invalid block request");
  }
  const { error } = await supabase
    .from("user_blocks")
    .upsert(
      { blocker_id: blockerId, blocked_id: blockedId },
      { onConflict: "blocker_id,blocked_id" },
    );
  if (error) throw error;
}

export async function unblockUser(
  supabase: DataClient,
  blockerId: string,
  blockedId: string,
): Promise<void> {
  const { error } = await supabase
    .from("user_blocks")
    .delete()
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId);
  if (error) throw error;
}

export async function listBlockedUserIds(
  supabase: DataClient,
  blockerId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocked_id")
    .eq("blocker_id", blockerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || [])
    .map((row: { blocked_id?: string }) => row.blocked_id)
    .filter((id: string | undefined): id is string => typeof id === "string");
}

export async function isDmBlockedBetween(
  supabase: DataClient,
  userIdA: string,
  userIdB: string,
): Promise<boolean> {
  const { usersAreBlocked } = await import("../../utils/userSettingsPolicy");
  return usersAreBlocked(supabase, userIdA, userIdB);
}

export async function didUserBlock(
  supabase: DataClient,
  blockerId: string,
  blockedId: string,
): Promise<boolean> {
  if (!blockerId || !blockedId || blockerId === blockedId) return false;
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocker_id")
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  return !!data?.blocker_id;
}

export async function acceptDmMessageRequest(
  supabase: DataClient,
  deps: Pick<
    DirectMessageDeps,
    "isDmBlockedBetween" | "recordLearningConnection" | "createNotification"
  >,
  threadId: string,
  userId: string,
): Promise<{
  id: string;
  status: "open";
  requestedBy: null;
}> {
  const { data: thread, error } = await supabase
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
  if (otherId && (await deps.isDmBlockedBetween(userId, otherId))) {
    throw new Error("You cannot message this user");
  }

  const { error: updateError } = await supabase
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
    await deps.recordLearningConnection({
      actorId: userId,
      beneficiaryId: thread.requested_by as string,
      kind: "dm_accepted",
      objectId: threadId,
    });
  }

  if (typeof thread.requested_by === "string") {
    void deps
      .createNotification(thread.requested_by, {
        message: "Your message request was accepted",
        link: `dm:${threadId}:${userId}`,
        type: "dm_message",
        data: { threadId, senderId: userId, status: "open" },
      })
      .catch((err) => {
        logger.warn("Failed to notify requester of accepted DM request", {
          err,
          threadId,
        });
      });
  }

  return { id: threadId, status: "open", requestedBy: null };
}

export async function declineDmMessageRequest(
  supabase: DataClient,
  threadId: string,
  userId: string,
): Promise<{
  id: string;
  status: "declined";
  requestedBy: string | null;
}> {
  const { data: thread, error } = await supabase
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

  const { error: updateError } = await supabase
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

export async function searchMessages(
  supabase: DataClient,
  deps: Pick<DirectMessageDeps, "normalizeMessageRecord">,
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
  let searchQuery = supabase
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
    const { data: memberGroups, error: memberError } = await supabase
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
    ...deps.normalizeMessageRecord(msg),
  }));
}
