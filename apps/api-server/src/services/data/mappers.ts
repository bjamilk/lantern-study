/**
 * data/mappers.ts — shared row→DTO mappers for the data layer.
 *
 * ## Purpose
 *
 * Extracted from `services/supabase.ts` (monolith lane M1, step 4). The
 * structural assessment found the chat-message row mapper written out THREE
 * times in the monolith — in the group-message page loader, the thread loader
 * and the question-pool loader — which is the only real duplication in the
 * 42k-line target set (`TEAM-S1-api-structure.md` §2). Three copies of a
 * serialiser is three places for a field to be added and two places for it to
 * be forgotten, and that is exactly what had already happened here: the
 * question-pool copy dropped `senderId` (#76, fixed in `mapChatMessageRow`).
 *
 * ## What it touches
 *
 * No tables and no client: these are pure functions over rows that a caller
 * has already read. `mapChatMessageRow` takes the output of
 * `normalizeMessageRecord` as a VALUE rather than calling it, which is how the
 * three copies it replaces were written.
 *
 * MOVED HERE (monolith lane M3, step 18): `normalizeMessageRecord` and its
 * private helper `parseMessageContent`, verbatim, from `SupabaseService`. They
 * were the last two chat bodies that never left the facade — they depended on
 * `this.normalizeStorageUrl`, which is now an injected `deps` arrow like every
 * other cross-module reach in `services/data/*`.
 *
 * ## The gotcha
 *
 * `mapProfileSender` is the one serialiser every board, DM and group message
 * sender passes through, and the `scrubEmailFromDisplayName` call in it is
 * load-bearing: a `profiles` row created from an email sign-up can hold the
 * address itself as the display name, so removing that scrub publishes user
 * email addresses in chat.
 *
 * The normalized record is spread LAST on purpose — it must win over the
 * envelope fields, as it did in all three original copies.
 */
import { normalizeReactions } from "@lantern/shared/chat";
import { scrubEmailFromDisplayName } from "@lantern/shared/utils/displayNames";

import { Message } from "../../types";

/**
 * What `normalizeMessageRecord` reaches outside this module. One arrow, for
 * the same reason every other `deps` literal exists here: the storage URL
 * rewriter is the storage ACL's, not the mapper's.
 */
export type MessageRecordDeps = {
  normalizeStorageUrl: (url: string) => string;
};

export type ProfileSenderRow = {
  id?: string;
  name?: string;
  username?: string;
  avatar_url?: string;
};

export function mapProfileSender(
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

export function resolveNestedProfile(
  profiles: unknown,
): ProfileSenderRow | null {
  if (Array.isArray(profiles)) return (profiles[0] as ProfileSenderRow) ?? null;
  return (profiles as ProfileSenderRow) ?? null;
}

/**
 * The chat-message envelope: everything a `messages` row contributes to a
 * `Message` DTO apart from the content itself, which arrives already parsed in
 * `normalized`.
 *
 * `senderId` is emitted for EVERY row (#76). The three copies this replaces
 * were not identical: the group-message page loader and the thread loader both
 * emitted it, while the question-pool loader omitted it, so the same message
 * answered with or without a top-level `senderId` depending on which endpoint
 * it arrived from — and every client check on it ("is this mine", author-only
 * edit/delete, mention resolution) branched on the endpoint rather than on the
 * message. Lane M1 kept that difference behind `options.includeSenderId`
 * because the extraction was behaviour-preserving; the client audit found
 * nothing that reads the ABSENCE of `senderId` as a marker (every use compares
 * it to the viewer's id), so the field is now always present.
 *
 * The `includeSenderId` option that carried that difference is GONE (monolith
 * lane M1e): its last call site, the question-pool loader in
 * `services/supabase.ts`, no longer passes it.
 */
export function mapChatMessageRow(
  row: any,
  normalized: Partial<Message> & { type: "TEXT" | "QUESTION" },
): Message {
  return {
    id: row.id,
    groupId: row.group_id,
    sender: mapProfileSender(
      resolveNestedProfile(row.profiles),
      row.sender_id,
    ),
    senderId: row.sender_id,
    timestamp: row.timestamp
      ? new Date(row.timestamp).toISOString()
      : new Date().toISOString(),
    flaggedAsSimilarUserIds: row.flagged_as_similar_user_ids || [],
    upvotes: row.upvotes || 0,
    downvotes: row.downvotes || 0,
    isArchived: row.is_archived || false,
    ...normalized,
  } as Message;
}

/**
 * The content half of a `messages` row: a TEXT row carries `text`, a QUESTION
 * row carries its `question_data` spread flat, and anything else contributes
 * nothing.
 *
 * MOVED (monolith lane M3) from `SupabaseService.parseMessageContent`,
 * verbatim. Its only caller is `normalizeMessageRecord` below, which is why it
 * was private there; it is exported here because the layer publishes what it
 * moves, and `services/challengeService.ts` reads it off the injected object.
 */
export function parseMessageContent(msg: any): Partial<Message> {
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

/**
 * A `messages` / `dm_messages` row → the message DTO's content and state
 * fields. Every chat, board and DM read path runs its rows through this.
 *
 * MOVED (monolith lane M3) from `SupabaseService.normalizeMessageRecord`,
 * verbatim, with `this.parseMessageContent` now the sibling above and
 * `this.normalizeStorageUrl` now `deps.normalizeStorageUrl`.
 *
 * A REMOVED row is presented as a tombstone — text, question data and image
 * stripped before parsing — and that stripping is the reason the whole body is
 * one function: every caller must get it, not just the ones that remember.
 */
export function normalizeMessageRecord(
  deps: MessageRecordDeps,
  msg: any,
): Partial<Message> & { type: "TEXT" | "QUESTION" } {
  const removedAt = msg.removed_at || msg.removedAt || null;
  const isRemoved = !!removedAt;
  const presentationRecord = isRemoved
    ? { ...msg, text: null, question_data: null, image_url: null }
    : msg;
  const parsed = parseMessageContent(presentationRecord);
  const imageUrl = presentationRecord.image_url || parsed.imageUrl;
  const type = (parsed.type || msg.type || "TEXT") as "TEXT" | "QUESTION";
  return {
    ...parsed,
    type,
    ...(imageUrl ? { imageUrl: deps.normalizeStorageUrl(imageUrl) } : {}),
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
