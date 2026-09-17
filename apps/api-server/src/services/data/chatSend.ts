/**
 * data/chatSend.ts — the chat internals and the send path.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1f, step 17),
 * the CHAT INTERNALS AND SEND PATH section: the private machinery behind group
 * and DM messaging — thread reads, mentions, reply previews, read receipts and
 * the notification fan-out — ending in `sendMessage`, the widest method in the
 * file and, per `TEAM-S1-api-structure.md` ("Risk (high)"), the single
 * highest-risk move in the programme.
 *
 * ## What it touches
 *
 * Tables: `messages`, `dm_messages`, `dm_threads`, `dm_read_status`,
 * `group_members`, `groups`, `profiles`, `communities`, `community_members`.
 * One realtime channel (`chat-read:<chatId>`). No storage buckets: the board's
 * photo arrives as an already-signed URL and only its PATH is re-checked here.
 *
 * ## The gotchas
 *
 * 1. THE SEND PATH HAS NO TRANSACTION. One `sendMessage` call resolves the
 *    board, refuses a muted member, resolves mentions and the thread root,
 *    writes the row (retrying twice past unapplied migrations), bumps the
 *    group preview, fans out three kinds of notification and invalidates the
 *    page cache — with nothing to roll any of it back. The danger is never
 *    that a step disappears; it is that two awaits swap places, so a client
 *    that used to see "you are muted" now sees "not a moderator", or a row is
 *    written before a gate that used to refuse it. That ORDER is frozen,
 *    case by case, by `services/supabase.sendPath.contract.test.ts`. Read it
 *    before changing one line of `sendMessage`.
 *
 * 2. THE MUTE GUARD IS A STATIC IMPORT, deliberately. `assertNotMutedInCommunity`
 *    comes from `./communityMute` and is NOT a `deps` entry, exactly as in
 *    `data/boardActions.ts`. The chat harnesses drive these paths by calling
 *    `SupabaseService.prototype.<m>.call(self, …)` on a bare object, and a
 *    check a harness can forget to stub is a check that is silently missing
 *    from the test. `supabase.communityMute.test.ts` can only prove the guard
 *    runs because nothing can stub it.
 *
 * 3. TWO INSERT LADDERS, IN ORDER. A board post retries its insert without
 *    `post_kind` (20260908120000) and then without `subject` (20260903120000),
 *    so a pending migration drops the kind and then the title rather than
 *    500ing the post. `getGroupThread` and `getPinnedMessage` walk the same
 *    kind of ladder on the read side, dropping `reactions` (20260830120000)
 *    first and the board columns second.
 *
 * 4. THE TWO CACHE BRANCHES ARE MIRROR IMAGES. A QUESTION invalidates the
 *    group cache and awards the badge BEFORE it bumps the group preview; a
 *    TEXT message bumps the preview and notifies first and invalidates LAST.
 *    Both orders are pinned by the contract suite; neither is arbitrary to
 *    "tidy up".
 *
 * 5. ENRICHMENT RUNS AFTER THE ROW QUERY, NOT AS AN EMBED — reply previews,
 *    thread counts and receipts are each their own follow-up read, so a table
 *    missing on this database degrades ONE field instead of failing the whole
 *    thread. It is also where the PostgREST embed trap bites: a second FK
 *    between two tables makes a bare embed ambiguous and returns PGRST201 at
 *    RUNTIME, which is why the selects here name `profiles!sender_id` /
 *    `profiles:sender_id`. Bare embeds repo-wide are frozen by
 *    `services/postgrestEmbedDisambiguation.test.ts`.
 *
 * 6. NOTIFICATION FAN-OUT IS BEST-EFFORT AND CAPPED, and a board issues no
 *    per-post fan-out at all (§0a decision 3, §3.9): on a community-scale
 *    board that would be a campus-wide push per post. A notification failure
 *    must never fail the send.
 *
 * 7. `resolveBoardContext` DECIDES THE SURFACE FROM THE GROUP ROW, never from
 *    which screen mounted it (spec §0), with the lounge as the one derived
 *    exception (founder decision 1): it carries a community_id but stays a
 *    live chat.
 *
 * ## Why the cross-method calls go back through `deps`
 *
 * Every sibling in this module and every reach into another section goes
 * through `deps`, with the single exception in gotcha 2:
 * `supabase.sendPath.contract.test.ts`, `supabase.boardMessages.test.ts`,
 * `supabase.boardMedia.test.ts`, `supabase.boardRepost.test.ts`,
 * `supabase.messagePin.test.ts`, `supabase.messageReactions.test.ts` and
 * `supabase.boardPaging.test.ts` all build a bare
 * `self = { supabase, resolveBoardContext: …, notifyMentionedUsers: …, … }`
 * and drive the entry point through
 * `SupabaseService.prototype.<m>.call(self, …)`. A local sibling call would
 * step around exactly the stubs those harnesses install. The facade builds the
 * `deps` literal INLINE at each call site, as arrows that read `this.<method>`
 * at CALL time — an instance field holding the deps reads as `undefined`
 * there, and would bypass every `jest.spyOn` on the class.
 */
import { logger } from "../../utils/logger";
import {
  BOARD_COMMENT_NOTIFY_MAX,
  BOARD_POST_KIND_DEFAULT,
  BOARD_POST_SUBJECT_MAX,
  BOARD_REPOST_CLIENT_ID_PREFIX,
  COMMUNITY_MODERATION_COPY,
  boardPostDeepLinkPath,
  canPinOnBoard,
  canPostBoardKind,
  isBoardImageUrlAllowed,
  isCommunityBoard,
  normalizeBoardPostKind,
  resolveCommunityRole,
  type BoardPostKind,
  type CommunityRole,
} from "@lantern/shared/network";
import {
  computeDmReceiptStatus,
  computeGroupReceipt,
  resolveThreadRootId,
} from "@lantern/shared/utils/chatMedia";
import {
  filterMessagesAfterDmHistoryCutoff,
  readDmHistoryClearedAt,
} from "@lantern/shared/utils/dmHistoryCutoff";
import { parseStorageObjectUrl } from "@lantern/shared/utils/storageUrl";

import { cacheService } from "../cache";
import {
  hasMessageBoardColumns,
  hasMessagePostKind,
  isMissingColumnError,
  markMessageBoardColumnsMissing,
  markMessagePostKindMissing,
  markMessageReactionsColumnMissing,
  messageColumns,
  reactionColumns,
} from "../schemaCapabilities";
import { Group, Message, User } from "../../types";

import type { DataClient } from "./client";
import { assertNotMutedInCommunity } from "./communityMute";
import {
  mapChatMessageRow,
  mapProfileSender,
  resolveNestedProfile,
} from "./mappers";

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
 * `@all` and `@username` mentions, lower-cased and de-duplicated. Module scope
 * in `services/supabase.ts` until lane M1f; the chat section was its only
 * caller, so it moved with the section.
 *
 * @internal
 */
export function extractMentionUsernames(text?: string | null): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(/@([a-zA-Z0-9_]{2,32})\b/g)) {
    const username = match[1];
    if (username) found.add(username.toLowerCase());
  }
  return [...found];
}

/**
 * Everything a moved body used to reach through `this`.
 *
 * Build this literal INLINE at each delegating call site, with arrows that
 * read `this.<method>` at CALL time. Hoisting it to an instance field compiles
 * and passes the surface freeze, but breaks every suite that invokes these
 * methods on a bare `{ supabase }` stand-in that never ran a constructor, and
 * bypasses every `jest.spyOn` on the class.
 *
 * `assertNotMutedInCommunity` is deliberately NOT here — see gotcha 2.
 */
export type ChatSendDeps = {
  /** Siblings in this module — dispatched dynamically, see the banner. */
  attachReplyPreview: (message: any, table?: "messages" | "dm_messages") => Promise<any>;
  attachReplyPreviewsBatch: (
    messages: any[],
    table: "messages" | "dm_messages",
  ) => Promise<any[]>;
  attachThreadReplyCounts: (
    messages: any[],
    table: "messages" | "dm_messages",
    scopeColumn: "group_id" | "thread_id",
    scopeId: string,
  ) => Promise<any[]>;
  buildReplyToFromParent: (
    parent: any,
    table: "messages" | "dm_messages",
  ) => Record<string, unknown>;
  enrichDmMessageReceipts: (
    messages: Message[],
    threadId: string,
    viewerUserId: string,
    peerUserId: string,
  ) => Promise<Message[]>;
  enrichGroupMessageReceipts: (
    messages: Message[],
    groupId: string,
    viewerUserId: string,
  ) => Promise<Message[]>;
  fetchGroupMembers: (groupId: string) => Promise<User[]>;
  findGroupMessageByClientId: (
    groupId: string,
    userId: string,
    clientMessageId: string,
  ) => Promise<any | null>;
  notifyBoardCommentRecipients: (params: {
    groupId: string;
    senderId: string;
    messageId: string;
    threadRootId: string;
    preview: string;
    skipUserIds?: string[];
    communitySlug: string | null;
  }) => Promise<void>;
  notifyMentionedUsers: (params: {
    groupId: string;
    senderId: string;
    messageId: string;
    mentionedUserIds: string[];
    preview: string;
    mentionedEveryone?: boolean;
    link?: string;
  }) => Promise<void>;
  notifyReplyRecipient: (params: {
    groupId: string;
    senderId: string;
    messageId: string;
    replyToMessageId: string;
    preview: string;
    skipUserIds?: string[];
  }) => Promise<void>;
  resolveBoardContext: (groupId: string) => Promise<{
    isBoard: boolean;
    communityId: string | null;
    communitySlug: string | null;
    communityCreatedBy: string | null;
    loungeGroupId: string | null;
    adminIds: string[];
  }>;
  resolveCommunityRoleFor: (
    userId: string,
    communityId: string | null,
    createdBy: string | null,
  ) => Promise<CommunityRole | null>;
  resolveGroupMentionUserIds: (
    groupId: string,
    senderId: string,
    content: string,
    explicitIds?: string[],
  ) => Promise<string[]>;
  resolveThreadRootForReply: (
    table: "messages" | "dm_messages",
    replyToMessageId: string,
    scope: { groupId?: string; threadId?: string },
  ) => Promise<string>;

  /** Still in the monolith or in another repository. */
  communityMemberRole: (
    communityId: string,
    userId: string,
  ) => Promise<string | null>;
  createNotification: (
    userId: string,
    notification: Record<string, any>,
  ) => Promise<any>;
  getGroupById: (groupId: string, userId?: string) => Promise<Group | null>;
  getUserById: (userId: string) => Promise<User | null>;
  incrementUserStatsAndAwardBadges: (
    userId: string,
    increments: Record<string, number>,
  ) => Promise<any>;
  isGroupAdmin: (groupId: string, userId: string) => Promise<boolean>;
  normalizeMessageRecord: (
    row: any,
  ) => Partial<Message> & { type: "TEXT" | "QUESTION" };
  notifyGroupMessageRecipients: (params: {
    groupId: string;
    senderId: string;
    content: string;
    messageId: string;
    excludeUserIds?: string[];
  }) => Promise<void>;
};

// Group Functions
export async function fetchGroups(
  db: DataClient,
  userId: string,
): Promise<Group[]> {
  const cacheKey = `user:${userId}:groups`;

  return cacheService.cached(
    cacheKey,
    async () => {
      const { data, error } = await db
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

export async function fetchGroupMembers(
  db: DataClient,
  groupId: string,
): Promise<User[]> {
  const cacheKey = `group:${groupId}:members`;

  return cacheService.cached(
    cacheKey,
    async () => {
      const { data, error } = await db
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
export async function findGroupMessageByClientId(
  db: DataClient,
  groupId: string,
  userId: string,
  clientMessageId: string,
): Promise<any | null> {
  const { data, error } = await db
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

export async function resolveGroupMentionUserIds(
  deps: Pick<ChatSendDeps, "fetchGroupMembers" | "isGroupAdmin">,
  groupId: string,
  senderId: string,
  content: string,
  explicitIds?: string[],
): Promise<string[]> {
  const usernames = extractMentionUsernames(content);
  const members = await deps.fetchGroupMembers(groupId);
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
    (await deps.isGroupAdmin(groupId, senderId))
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

export function buildReplyToFromParent(
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

export async function attachReplyPreview(
  db: DataClient,
  deps: Pick<ChatSendDeps, "buildReplyToFromParent">,
  message: any,
  table: "messages" | "dm_messages" = "messages",
): Promise<any> {
  const replyId = message?.reply_to_message_id || message?.replyToMessageId;
  if (!replyId) return message;
  const select =
    table === "dm_messages"
      ? "id, sender_id, text, removed_at, profiles:sender_id(id, name, username)"
      : "id, sender_id, type, text, question_data, removed_at, profiles:sender_id(id, name, username)";
  const { data: parent } = await db
    .from(table)
    .select(select)
    .eq("id", replyId)
    .maybeSingle();
  if (!parent) return { ...message, replyTo: null };
  return { ...message, replyTo: deps.buildReplyToFromParent(parent, table) };
}

export async function attachReplyPreviewsBatch(
  db: DataClient,
  deps: Pick<ChatSendDeps, "buildReplyToFromParent">,
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
  const { data: parents } = await db
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
      replyTo: deps.buildReplyToFromParent(parent, table),
    };
  });
}

/** Count replies per thread_root_id for messages in a conversation scope. */
export async function attachThreadReplyCounts(
  db: DataClient,
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

  const { data, error } = await db
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

export async function enrichGroupMessageReceipts(
  db: DataClient,
  messages: Message[],
  groupId: string,
  viewerUserId: string,
): Promise<Message[]> {
  const hasOwn = messages.some(
    (m) =>
      (m as any).senderId === viewerUserId || m.sender?.id === viewerUserId,
  );
  if (!hasOwn) return messages;

  const { data: members, error } = await db
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

export async function enrichDmMessageReceipts(
  db: DataClient,
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

  const { data: readStatus, error } = await db
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
export async function resolveThreadRootForReply(
  db: DataClient,
  table: "messages" | "dm_messages",
  replyToMessageId: string,
  scope: { groupId?: string; threadId?: string },
): Promise<string> {
  const select =
    table === "messages"
      ? "id, group_id, thread_root_id, removed_at"
      : "id, thread_id, thread_root_id, removed_at";
  const { data: parent, error } = await db
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
export async function broadcastChatRead(
  db: DataClient,
  chatId: string,
  payload: { userId: string; lastReadAt: string },
): Promise<void> {
  try {
    const channel = db.channel(`chat-read:${chatId}`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        void db.removeChannel(channel);
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
          void db.removeChannel(channel);
        }
      });
    });
  } catch (err) {
    logger.warn("broadcastChatRead failed", { chatId, err });
  }
}

export async function getGroupThread(
  db: DataClient,
  deps: Pick<ChatSendDeps, "attachReplyPreviewsBatch" | "attachThreadReplyCounts" | "normalizeMessageRecord" | "enrichGroupMessageReceipts">,
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
    db,
    await messageColumns(db, baseThreadSelect),
  );

  const runThread = (columns: string) =>
    Promise.all([
      db
        .from("messages")
        .select(columns)
        .eq("id", rootId)
        .eq("group_id", groupId)
        .maybeSingle(),
      db
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
      await runThread(await messageColumns(db, baseThreadSelect));
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
  const withReplies = await deps.attachReplyPreviewsBatch(
    combined,
    "messages",
  );
  const withCounts = await deps.attachThreadReplyCounts(
    withReplies,
    "messages",
    "group_id",
    groupId,
  );

  const mapped = withCounts.map((msg: any) =>
    mapChatMessageRow(msg, deps.normalizeMessageRecord(msg)),
  ) as Message[];

  if (viewerUserId) {
    return deps.enrichGroupMessageReceipts(mapped, groupId, viewerUserId);
  }
  return mapped;
}

export async function getDmThread(
  db: DataClient,
  deps: Pick<ChatSendDeps, "attachReplyPreviewsBatch" | "attachThreadReplyCounts" | "enrichDmMessageReceipts">,
  threadId: string,
  rootId: string,
  viewerUserId: string,
): Promise<Message[]> {
  const { data: thread, error: threadError } = await db
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
    db
      .from("dm_messages")
      .select(selectClause)
      .eq("id", rootId)
      .eq("thread_id", threadId)
      .maybeSingle(),
    db
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
  const withReplies = await deps.attachReplyPreviewsBatch(
    combined,
    "dm_messages",
  );
  const withCounts = await deps.attachThreadReplyCounts(
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

  return deps.enrichDmMessageReceipts(
    mapped,
    threadId,
    viewerUserId,
    peerUserId,
  );
}

/**
 * Notify active members after a group message is persisted
 * (message-before-notification ordering).
 *
 * Moved verbatim out of `services/supabase.ts` (monolith lane M1h): it is a
 * send-path fan-out and `sendMessage` right below is its only caller, through
 * `deps` — `supabase.sendPath.contract.test.ts` stubs the dep by name and
 * asserts the step order, and `supabase.boardMessages.test.ts` drives THIS
 * function through the prototype to prove a board post issues zero per-post
 * fan-out. Both pass unchanged.
 */
export async function notifyGroupMessageRecipients(
  db: DataClient,
  deps: Pick<
    ChatSendDeps,
    "getGroupById" | "getUserById" | "createNotification"
  >,
  params: {
    groupId: string;
    senderId: string;
    content: string;
    messageId: string;
    excludeUserIds?: string[];
  },
): Promise<void> {
  const { groupId, senderId, content, messageId, excludeUserIds } = params;
  const [{ data: members, error: membersError }, groupMeta, sender] =
    await Promise.all([
      db
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId)
        .eq("pending", false),
      deps.getGroupById(groupId),
      deps.getUserById(senderId),
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
      deps.createNotification(recipientId, {
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


export async function notifyMentionedUsers(
  deps: Pick<ChatSendDeps, "getGroupById" | "getUserById" | "createNotification">,
  params: {
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
    deps.getGroupById(groupId),
    deps.getUserById(senderId),
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
      deps.createNotification(recipientId, {
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

export async function notifyReplyRecipient(
  db: DataClient,
  deps: Pick<ChatSendDeps, "getGroupById" | "getUserById" | "createNotification">,
  params: {
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
  const { data: parent, error } = await db
    .from("messages")
    .select("id, sender_id")
    .eq("id", replyToMessageId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (error || !parent?.sender_id || parent.sender_id === senderId) return;
  if (skipUserIds?.includes(parent.sender_id)) return;

  const [groupMeta, sender] = await Promise.all([
    deps.getGroupById(groupId),
    deps.getUserById(senderId),
  ]);
  const groupName = (groupMeta as any)?.name || "a group";
  const actor =
    sender?.name || (sender?.username ? `@${sender.username}` : "Someone");
  await deps.createNotification(parent.sender_id, {
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
export async function resolveCommunityRoleFor(
  db: DataClient,
  userId: string,
  communityId: string | null,
  createdBy: string | null,
): Promise<CommunityRole | null> {
  if (!communityId) return null;
  try {
    const { data } = await (db as any)
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

export async function resolveBoardContext(
  db: DataClient,
  deps: Pick<ChatSendDeps, "getGroupById">,
  groupId: string,
): Promise<{
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

  const group = await deps.getGroupById(groupId);
  if (!group?.communityId) return empty;

  const readCommunity = (columns: string) =>
    (db as any)
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
export async function notifyBoardCommentRecipients(
  db: DataClient,
  deps: Pick<ChatSendDeps, "getGroupById" | "getUserById" | "createNotification">,
  params: {
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
    db
      .from("messages")
      .select("id, sender_id")
      .eq("id", threadRootId)
      .maybeSingle(),
    db
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
    deps.getGroupById(groupId),
    deps.getUserById(senderId),
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
      deps.createNotification(recipient.id, {
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

export async function sendMessage(
  db: DataClient,
  deps: Pick<ChatSendDeps, "resolveBoardContext" | "resolveGroupMentionUserIds" | "resolveThreadRootForReply" | "findGroupMessageByClientId" | "resolveCommunityRoleFor" | "incrementUserStatsAndAwardBadges" | "notifyGroupMessageRecipients" | "notifyMentionedUsers" | "notifyReplyRecipient" | "notifyBoardCommentRecipients" | "attachReplyPreview">,
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

  const board = await deps.resolveBoardContext(groupId);
  // A muted member reads everything and writes nothing — on the board, in
  // the lounge and in every channel. Checked before any parsing so a mute
  // cannot be sidestepped by the shape of the payload.
  await assertNotMutedInCommunity(db, userId, board.communityId);

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
  const mentionedUserIds = await deps.resolveGroupMentionUserIds(
    groupId,
    userId,
    mentionSource,
    options?.mentionedUserIds,
  );

  let threadRootId: string | undefined;
  if (replyToMessageId) {
    threadRootId = await deps.resolveThreadRootForReply(
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

    const { data, error } = await db
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
        const existing = await deps.findGroupMessageByClientId(
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

    await deps.incrementUserStatsAndAwardBadges(userId, {
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
    void db
      .from("groups")
      .update({
        last_message: questionPreview,
        last_message_time: data.timestamp || new Date().toISOString(),
      })
      .eq("id", groupId);
    const mentionedEveryone =
      extractMentionUsernames(mentionSource).includes("all");
    void deps.notifyGroupMessageRecipients({
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
    void deps.notifyMentionedUsers({
      groupId,
      senderId: userId,
      messageId: data.id,
      mentionedUserIds,
      preview: questionPreview,
      mentionedEveryone,
    });
    if (replyToMessageId) {
      void deps.notifyReplyRecipient({
        groupId,
        senderId: userId,
        messageId: data.id,
        replyToMessageId,
        preview: questionPreview,
        skipUserIds: mentionedUserIds,
      });
    }

    const withReply = await deps.attachReplyPreview(data);
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
    const withSubject = !!subject && (await hasMessageBoardColumns(db));

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
      const role = await deps.resolveCommunityRoleFor(
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
      (await hasMessagePostKind(db));
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
      (db as any)
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
        const existing = await deps.findGroupMessageByClientId(
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
    void db
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
      void deps.notifyGroupMessageRecipients({
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
    void deps.notifyMentionedUsers({
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
        void deps.notifyBoardCommentRecipients({
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
      void deps.notifyReplyRecipient({
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

    const withReply = await deps.attachReplyPreview(data);
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
export async function getPinnedMessage(
  db: DataClient,
  deps: Pick<ChatSendDeps, "normalizeMessageRecord">,
  groupId: string,
): Promise<Message | null> {
  if (!groupId) return null;
  if (!(await hasMessageBoardColumns(db))) return null;

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
  const select = await reactionColumns(db, baseSelect);
  const runPinned = (columns: string) =>
    (db as any)
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
    ...deps.normalizeMessageRecord(msg),
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
export async function setMessagePin(
  db: DataClient,
  deps: Pick<ChatSendDeps, "getGroupById" | "resolveBoardContext" | "communityMemberRole">,
  messageId: string,
  userId: string,
  pinned: boolean,
): Promise<MessagePinResult> {
  if (!(await hasMessageBoardColumns(db))) {
    return { status: "unavailable" };
  }

  const { data: row, error: readError } = await db
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
  const group = await deps.getGroupById(groupId, userId);
  if (!group) return { status: "not_found" };

  const board = await deps.resolveBoardContext(groupId);
  if (!board.isBoard) return { status: "not_board" };

  const role = board.communityId
    ? resolveCommunityRole(
        await deps.communityMemberRole(board.communityId, userId),
        userId,
        board.communityCreatedBy,
      )
    : null;
  if (!canPinOnBoard({ role, adminIds: group.adminIds || [], userId })) {
    return { status: "forbidden" };
  }

  const clearPins = () =>
    (db as any)
      .from("messages")
      .update({ pinned_at: null, pinned_by: null })
      .eq("group_id", groupId)
      .not("pinned_at", "is", null);

  const applyPin = () =>
    (db as any)
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
