// ===========================================
// Lantern Study Mobile - Group store: mapping
// ===========================================
//
// Purpose: every API row → model translation the chat surfaces need, and the
// pure list rules that go with them — the optimistic-row reconciliation
// (`replaceOptimisticWithServer`), the realtime edit/remove patches, and the
// realtime UPDATE merge (`mergeGroupMessageIntoList`). This is the only place
// a snake_case server row becomes a `Message`, `Group`, `DMThread` or
// `DirectMessage`; a second mapper is how the same row ends up rendering two
// different ways.
//
// Touches: `@lantern/shared/groups` (`mapGroupRow` is the single group mapper,
// R2), `@lantern/shared/utils` (`normalizeStorageUrl`), `utils/senderIdentity`,
// `utils/boardMessageFields`, and — the one impurity, preserved from the
// original — `authStore`, which `mapApiMessage` reads for the viewer's own
// identity when a roster has not loaded. No AsyncStorage, no API calls, no
// group-store state.
//
// Gotchas:
// - An explicit server `type` wins over the JSON body. A board post is stored
//   as TEXT even when its body starts with `{`, and re-deriving "question"
//   from the body turned board posts into read-only question cards on mobile.
// - A realtime payload is PARTIAL: `mergeGroupMessageIntoList` keeps the
//   previous copy's question fields and a concrete author label when the
//   incoming row carries none, or an edit broadcast blanks a question's
//   options and reduces its author to "Member".
// - `mapApiGroup` synthesises `lastMessage` from the row's preview text; it is
//   not a real message row (its id is `preview-<groupId>`).
//
// Moved verbatim out of `stores/groupStore.ts` (lane M2), comments included.

import { mapGroupMemberRow, mapGroupRow } from '@lantern/shared/groups';
import { normalizeStorageUrl } from '@lantern/shared/utils';
import { boardActionFields } from '../../utils/boardMessageFields';
import { resolveSenderIdentity } from '../../utils/senderIdentity';
import { useAuthStore } from '../authStore';
import type { DirectMessage, DMThread, Group, GroupMember, Message } from './types';


// Role is DERIVED, not stored per member: `adminIds[0]` is the owner and the
// rest of the array are admins. Both API casings are accepted because the
// members endpoint, the realtime payload and the group row disagree. Both the
// derivation and the casing rules now live in `@lantern/shared/groups` — this
// is only the mobile-shaped projection of it.
/** @internal — used by `state.ts` when a roster page lands. */
export function mapApiMember(m: any, adminIds: string[]): GroupMember {
  const mapped = mapGroupMemberRow(m, adminIds);
  return {
    // Use auth user id as the stable member key so chat roster lookups match sender_id.
    id: mapped.id,
    userId: mapped.userId,
    name: mapped.name,
    username: mapped.username,
    avatarUrl: mapped.avatarUrl,
    role: mapped.role,
    joinedAt: mapped.joinedAt,
  };
}

// One API group row → the mobile `Group`. The canonical field resolution lives
// in `@lantern/shared/groups`; everything below is the mobile-only shape on top
// of it — `ownerId` (adminIds[0]), the required-string `createdAt`/`updatedAt`,
// a `memberCount` that is a number rather than "unknown", and a synthesised
// `lastMessage` Message.
//
// The list endpoint carries no members, so `members` is usually empty here and
// `memberCount` falls back to the server's own count; callers must merge rather
// than assign, or a loaded roster is lost. `lastMessage` is synthesised from the
// row's preview text and is not a real message row (its id is `preview-<groupId>`).
/** @internal — used by `state.ts`; not part of the store's public surface. */
export function mapApiGroup(g: any, unreadCounts: Record<string, number>): Group {
  const shared = mapGroupRow(g, { unreadCounts });
  const adminIds = shared.adminIds;
  // Mobile alone falls back to the row's update time for the preview stamp:
  // the chat list sorts on it and a group whose preview predates
  // `last_message_time` would otherwise sort to the bottom.
  const lastMessageTime =
    shared.lastMessageTime || g.updated_at || g.updatedAt || shared.updatedAt;

  return {
    id: shared.id,
    name: shared.name,
    description: shared.description,
    avatarUrl: shared.avatarUrl,
    ownerId: adminIds[0] || '',
    parentId: shared.parentId,
    courseId: shared.courseId,
    visibility: shared.visibility,
    communityId: shared.communityId,
    communitySurface: shared.communitySurface,
    adminIds,
    inviteId: shared.inviteId,
    members: shared.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.name,
      username: m.username,
      avatarUrl: m.avatarUrl,
      role: m.role,
      joinedAt: m.joinedAt,
    })),
    memberCount: shared.memberCount ?? 0,
    unreadCount: shared.unreadCount,
    isArchived: shared.isArchived ?? false,
    createdAt: shared.createdAt || '',
    updatedAt: shared.updatedAt || '',
    lastMessage: shared.lastMessage
      ? {
          id: `preview-${g.id}`,
          groupId: g.id,
          senderId: '',
          senderName: '',
          text: shared.lastMessage,
          type: 'text',
          createdAt: lastMessageTime || new Date().toISOString(),
        }
      : undefined,
  };
}


/** @internal */
export function isOptimisticMessageId(id: string): boolean {
  return id.startsWith('msg-');
}

/** @internal */
export function stripOptimisticDuplicates(messages: Message[], serverMessage: Message): Message[] {
  return messages.filter((message) => {
    if (!isOptimisticMessageId(message.id)) return true;
    if (message.senderId !== serverMessage.senderId) return true;
    if (message.text !== serverMessage.text) return true;
    const messageTime = new Date(message.createdAt).getTime();
    const serverTime = new Date(serverMessage.createdAt).getTime();
    return Math.abs(messageTime - serverTime) > 60_000;
  });
}

/** @internal */
export function replaceOptimisticWithServer(
  messages: Message[],
  optimisticId: string,
  serverMessage: Message
): Message[] {
  const withoutServerDup = messages.filter((message) => message.id !== serverMessage.id);
  const optimisticIndex = withoutServerDup.findIndex((message) => message.id === optimisticId);
  if (optimisticIndex >= 0) {
    const updated = [...withoutServerDup];
    updated[optimisticIndex] = serverMessage;
    return updated;
  }
  const stripped = stripOptimisticDuplicates(withoutServerDup, serverMessage);
  if (stripped.some((message) => message.id === serverMessage.id)) return stripped;
  return [...stripped, serverMessage];
}

/**
 * Exported for the board store, which maps the two board-only endpoints
 * (`/pinned`, `/pin`) with exactly the mapping the chat cache uses — a second
 * mapper is how the same row ends up rendering two different ways.
 */
export function mapApiMessage(m: any, groupId: string, roster?: GroupMember[]): Message {
  let parsed: any = {};
  const rawContent = m.content || m.text || '';
  // An explicit server `type` is the answer; the JSON body is only a fallback
  // for payload shapes that carry no type at all. A board post is stored as
  // TEXT even when its body happens to start with `{` (§3.4), and re-deriving
  // "question" from the body here turned such a post into a read-only legacy
  // question card on mobile while web rendered it as an ordinary post.
  const declaredType = typeof m.type === 'string' ? m.type.toUpperCase() : null;
  const declaredText = declaredType === 'TEXT';
  if (!declaredText && typeof rawContent === 'string' && rawContent.trim().startsWith('{')) {
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      parsed = {};
    }
  }

  // Realtime postgres payloads expose question fields on question_data JSONB.
  const questionData =
    m.question_data && typeof m.question_data === 'object'
      ? m.question_data
      : m.questionData && typeof m.questionData === 'object'
        ? m.questionData
        : {};

  const questionStem =
    m.questionStem ||
    m.question_stem ||
    questionData.questionStem ||
    questionData.question_stem ||
    parsed.questionStem ||
    parsed.question_stem;

  const isQuestion =
    declaredType === 'QUESTION' ||
    (!declaredText &&
      (parsed.type === 'QUESTION' || parsed.type === 'question' || !!questionStem));

  const sender = m.sender || {};
  const senderId = m.sender_id || m.senderId || sender.id || '';
  const rosterMember = roster?.find(
    (member) => member.userId === senderId || member.id === senderId
  );
  const auth = useAuthStore.getState();
  const ownMetadata = auth.user?.user_metadata as
    | { username?: string | null; avatar_url?: string | null }
    | undefined;
  const identity = resolveSenderIdentity({
    senderId,
    sender: {
      username: sender.username,
      name: sender.name,
      avatarUrl: sender.avatar_url || sender.avatarUrl,
    },
    rosterMember,
    viewer: {
      id: auth.user?.id ?? null,
      username: ownMetadata?.username ?? null,
      name: auth.profileName,
      avatarUrl: ownMetadata?.avatar_url ?? null,
    },
  });
  const timestamp = m.timestamp || m.created_at || m.createdAt || new Date().toISOString();
  const rawOptions = m.options || questionData.options || parsed.options || [];
  const optionItems = rawOptions
    .map((opt: any) => {
      if (typeof opt === 'string') {
        return { id: opt, text: opt };
      }
      if (opt?.id && opt?.text) {
        return { id: String(opt.id), text: String(opt.text) };
      }
      if (opt?.text) {
        return { id: String(opt.id || opt.text), text: String(opt.text) };
      }
      return null;
    })
    .filter(Boolean) as Array<{ id: string; text: string }>;
  const options = optionItems.map(opt => opt.text).filter(Boolean);

  const correctAnswerIds =
    m.correct_answer_ids ||
    m.correctAnswerIds ||
    questionData.correctAnswerIds ||
    questionData.correct_answer_ids ||
    parsed.correctAnswerIds ||
    parsed.correct_answer_ids;

  const removedAt = m.removed_at || m.removedAt;
  const isRemoved = m.isRemoved || !!removedAt;

  return {
    id: m.id,
    groupId: m.group_id || m.groupId || groupId,
    senderId,
    // A board's roster is not fetched, and the board endpoints do not embed a
    // `sender`, so for the viewer's own freshly posted row both sources are
    // empty and formatChatSenderLabel falls through to "Member" (with initials
    // for an avatar) until a restart re-reads the server copy. The signed-in
    // user's own profile is the authoritative fallback — same rule as the
    // optimistic send path below.
    senderName: identity.name,
    senderAvatar: identity.avatarUrl,
    text: isRemoved ? '' : isQuestion ? (questionStem || rawContent) : (m.text || rawContent),
    type: isQuestion ? 'question' : 'text',
    createdAt: typeof timestamp === 'string' ? timestamp : new Date(timestamp).toISOString(),
    isArchived: m.is_archived || m.isArchived,
    editedAt: m.edited_at || m.editedAt,
    removedAt,
    isRemoved,
    reactions: m.reactions && typeof m.reactions === 'object' ? m.reactions : {},
    subject: m.subject ?? null,
    postKind: m.post_kind ?? m.postKind ?? null,
    // The tombstone's reason. Kept even though `text` is blanked above: the
    // whole point of a SOFT removal is that a reader who saw the post is told
    // what happened instead of watching it vanish.
    removedReason: m.removed_reason ?? m.removedReason ?? null,
    pinnedAt: m.pinned_at ?? m.pinnedAt ?? null,
    pinnedBy: m.pinned_by ?? m.pinnedBy ?? null,
    upvotes: m.upvotes ?? 0,
    downvotes: m.downvotes ?? 0,
    peerUpvotes:
      typeof m.peer_upvotes === 'number'
        ? m.peer_upvotes
        : typeof m.peerUpvotes === 'number'
          ? m.peerUpvotes
          : undefined,
    flaggedAsSimilarUserIds:
      m.flagged_as_similar_user_ids ||
      m.flaggedAsSimilarUserIds ||
      m.flaggedUserIds ||
      [],
    questionStem,
    questionStatus:
      m.question_status ||
      m.questionStatus ||
      questionData.questionStatus ||
      parsed.questionStatus,
    questionType:
      m.question_type ||
      m.questionType ||
      questionData.questionType ||
      parsed.questionType,
    options: options.length > 0 ? options : undefined,
    optionItems: optionItems.length > 0 ? optionItems : undefined,
    tags: m.tags || questionData.tags || parsed.tags,
    correctAnswerIds: Array.isArray(correctAnswerIds) ? correctAnswerIds : undefined,
    acceptableAnswers:
      m.acceptable_answers ||
      m.acceptableAnswers ||
      questionData.acceptableAnswers ||
      parsed.acceptableAnswers,
    matchingPromptItems:
      m.matching_prompt_items ||
      m.matchingPromptItems ||
      questionData.matchingPromptItems ||
      parsed.matchingPromptItems,
    matchingAnswerItems:
      m.matching_answer_items ||
      m.matchingAnswerItems ||
      questionData.matchingAnswerItems ||
      parsed.matchingAnswerItems,
    correctMatches:
      m.correct_matches ||
      m.correctMatches ||
      questionData.correctMatches ||
      parsed.correctMatches,
    diagramLabels:
      m.diagram_labels ||
      m.diagramLabels ||
      questionData.diagramLabels ||
      parsed.diagramLabels,
    imageUrl: (() => {
      const raw =
        m.image_url || m.imageUrl || questionData.imageUrl || parsed.imageUrl;
      return raw ? normalizeStorageUrl(raw) : undefined;
    })(),
    explanation:
      m.explanation || questionData.explanation || parsed.explanation,
    replyToMessageId: m.reply_to_message_id || m.replyToMessageId,
    mentionedUserIds: m.mentioned_user_ids || m.mentionedUserIds,
    replyTo: m.replyTo || m.reply_to || null,
    threadRootId: m.threadRootId || m.thread_root_id || undefined,
    replyCount: typeof m.replyCount === 'number' ? m.replyCount : m.reply_count,
    ...boardActionFields(m),
    receiptStatus: m.receiptStatus || m.receipt_status || undefined,
    seenByCount: typeof m.seenByCount === 'number' ? m.seenByCount : m.seen_by_count,
    seenByTotal: typeof m.seenByTotal === 'number' ? m.seenByTotal : m.seen_by_total,
  };
}

/** @internal */
export function resolveDmHistoryClearedAt(
  threadId: string,
  dmThreads: DMThread[],
  dmHistoryClearedAtByThread: Record<string, string>,
): string | null {
  const fromMap = dmHistoryClearedAtByThread[threadId];
  if (typeof fromMap === 'string' && fromMap) return fromMap;
  const fromThread = dmThreads.find((t) => t.id === threadId)?.historyClearedAt;
  return typeof fromThread === 'string' && fromThread ? fromThread : null;
}

/** @internal */
export function mapDmThread(t: any, unreadCounts: Record<string, number>): DMThread {
  const participants: DMThread['participants'] = {};
  const rawParticipants = t.participants || {};
  for (const [userId, info] of Object.entries(rawParticipants)) {
    const p = info as { name?: string; avatar_url?: string; avatarUrl?: string };
    participants[userId] = {
      name: p.name || 'User',
      avatarUrl: p.avatar_url || p.avatarUrl,
    };
  }

  const status =
    t.status === 'pending' || t.status === 'declined' || t.status === 'open'
      ? t.status
      : 'open';
  return {
    id: t.id,
    participantIds: t.participant_ids || t.participantIds || [],
    participants,
    lastMessage: t.last_message || t.lastMessage,
    lastMessageTimestamp: t.last_message_timestamp || t.lastMessageTimestamp,
    unreadCount: unreadCounts[t.id] ?? t.unread_count ?? 0,
    isArchived: t.is_archived ?? t.isArchived ?? false,
    historyClearedAt: t.historyClearedAt ?? t.history_cleared_at ?? null,
    status,
    requestedBy: t.requested_by ?? t.requestedBy ?? null,
  };
}

/** @internal */
export function mapDirectMessage(m: any, threadId: string): DirectMessage {
  const removedAt = m.removed_at || m.removedAt;
  const isRemoved = m.isRemoved || !!removedAt;
  const sender = m.sender || m.profiles || null;
  const senderObj = Array.isArray(sender) ? sender[0] : sender;
  return {
    id: m.id,
    threadId: m.thread_id || threadId,
    senderId: m.sender_id || m.senderId || senderObj?.id,
    senderAvatar: senderObj?.avatarUrl || senderObj?.avatar_url || null,
    senderName: senderObj?.name || senderObj?.username || null,
    text: isRemoved ? '' : m.content || m.text || '',
    timestamp: m.created_at || m.timestamp || new Date().toISOString(),
    editedAt: m.edited_at || m.editedAt,
    removedAt,
    isRemoved,
    replyToMessageId: m.reply_to_message_id || m.replyToMessageId,
    replyTo: m.replyTo || m.reply_to || null,
    threadRootId: m.threadRootId || m.thread_root_id || undefined,
    replyCount: typeof m.replyCount === 'number' ? m.replyCount : m.reply_count,
    receiptStatus: m.receiptStatus || m.receipt_status || undefined,
    clientMessageId: m.client_message_id || m.clientMessageId || undefined,
    reactions: m.reactions && typeof m.reactions === 'object' ? m.reactions : {},
  };
}

/** @internal */
export function applyGroupMessageMutation(messages: Message[], payload: any): Message[] {
  const removedAt = payload.removedAt || payload.removed_at;
  const isRemoved = payload.isRemoved || !!removedAt;
  return messages.map((message) => {
    let replyTo = message.replyTo;
    if (replyTo?.id === payload.id) {
      replyTo = {
        ...replyTo,
        id: String(payload.id),
        text: isRemoved ? undefined : payload.text,
        isRemoved,
      };
    }
    if (message.id !== payload.id) return { ...message, replyTo };
    return {
      ...message,
      text: isRemoved ? '' : payload.text ?? message.text,
      editedAt: payload.editedAt || payload.edited_at,
      removedAt,
      isRemoved,
      replyTo,
    };
  });
}

/** @internal */
export function applyDirectMessageMutation(
  messages: DirectMessage[],
  incoming: DirectMessage
): DirectMessage[] {
  return messages.map((message) => {
    let replyTo = message.replyTo;
    if (replyTo?.id === incoming.id) {
      replyTo = {
        ...replyTo,
        id: incoming.id,
        text: incoming.isRemoved ? undefined : incoming.text,
        isRemoved: !!incoming.isRemoved,
      };
    }
    if (message.id !== incoming.id) return { ...message, replyTo };
    return {
      ...message,
      ...incoming,
      replyCount: incoming.replyCount ?? message.replyCount,
      replyTo,
    };
  });
}

/**
 * The pure half of the store's `mergeGroupMessage` action: apply one realtime
 * UPDATE to a cached conversation.
 *
 * Returns `null` when the row is unknown — the caller must then leave state
 * untouched rather than append, because a realtime UPDATE for a message this
 * process never loaded is not new content.
 *
 * Matched by id, or by `clientMessageId` when the update is the server's
 * version of a still-optimistic row. A realtime payload is PARTIAL, so the
 * previous copy's question fields and a concrete author label survive when the
 * incoming row carries none. Reply previews pointing at this message are
 * refreshed at the same time.
 */
export function mergeGroupMessageIntoList(
  cached: Message[],
  message: Message,
  clientMessageId?: string
): Message[] | null {
  let idx = cached.findIndex(m => m.id === message.id);
  if (idx === -1 && clientMessageId) {
    idx = cached.findIndex(m => m.id === clientMessageId);
  }
  if (idx === -1) return null;
  const updated = [...cached];
  const prev = updated[idx];
  const merged = { ...prev, ...message, id: message.id };
  // Keep a concrete author label when the incoming payload only has a generic fallback.
  if (
    prev.senderName &&
    prev.senderName !== 'Member' &&
    prev.senderName !== '@member' &&
    (!message.senderName ||
      message.senderName === 'Member' ||
      message.senderName === '@member')
  ) {
    merged.senderName = prev.senderName;
  }
  if ((!message.options || message.options.length === 0) && prev.options?.length) {
    merged.options = prev.options;
  }
  if (
    (!message.correctAnswerIds || message.correctAnswerIds.length === 0) &&
    prev.correctAnswerIds?.length
  ) {
    merged.correctAnswerIds = prev.correctAnswerIds;
  }
  if (!message.questionStem && prev.questionStem) merged.questionStem = prev.questionStem;
  if (!message.questionType && prev.questionType) merged.questionType = prev.questionType;
  if (!message.questionStatus && prev.questionStatus) {
    merged.questionStatus = prev.questionStatus;
  }
  if ((!message.optionItems || message.optionItems.length === 0) && prev.optionItems?.length) {
    merged.optionItems = prev.optionItems;
  }
  updated[idx] = merged;
  return updated.map((item) =>
    item.replyTo?.id === message.id
      ? {
          ...item,
          replyTo: {
            ...item.replyTo,
            text: message.isRemoved ? undefined : message.text,
            questionStem: message.isRemoved ? undefined : message.questionStem,
            isRemoved: !!message.isRemoved,
          },
        }
      : item
  );
}
