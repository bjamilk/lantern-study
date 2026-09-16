// ===========================================
// Lantern Study Mobile - Group store: types
// ===========================================
//
// Purpose: the shapes every layer under `stores/group/` agrees on — the chat
// model (`Group`, `GroupMember`, `Message`, `CreateGroupInput`), the zustand
// contract `state.ts` implements (`GroupState`), and the `DMThread` /
// `DirectMessage` aliases that the chat screens import from the store rather
// than from @lantern/shared.
//
// Touches: nothing at runtime. Types only, so importing this can never pull in
// the API client, AsyncStorage or zustand — which is what lets `mapping.ts`
// and `transport.ts` share a vocabulary without a cycle.
//
// Gotcha: `Message` is BOTH the server row and the optimistic row. Fields that
// exist only locally (`deliveryState`) or only on a board (`subject`,
// `postKind`, `repostOf`) are optional for that reason, and several screens
// branch on PRESENCE rather than truthiness — see `answeredMessageId`.
//
// Moved verbatim out of `stores/groupStore.ts` (lane M2). No shape changed.

import type { DMThread as SharedDMThread, DirectMessage as SharedDirectMessage } from '@lantern/shared/types';
import type { BoardPostKind, BoardQuotedPost } from '@lantern/shared/network';
import type { SendOutcome } from '../sendOutcome';

export type DMThread = SharedDMThread;
export type DirectMessage = SharedDirectMessage;

export interface GroupMember {
  id: string;
  userId: string;
  name: string;
  username?: string;
  avatarUrl?: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
}

export interface GroupPermissions {
  canSendMessages: boolean;
  canAddMembers: boolean;
  canEditSettings: boolean;
  canApproveMembers: boolean;
}

export interface CreateGroupInput {
  name: string;
  description?: string;
  ownerId: string;
  ownerName: string;
  avatarUrl?: string;
  permissions?: GroupPermissions;
  parentId?: string;
  /** Academic archive: the course this group studies. */
  courseId?: string | null;
  visibility?: 'private' | 'community' | 'public';
  communityId?: string | null;
  /** 'board' (default in a community) or 'study_group' (lives in Chat). */
  communitySurface?: 'board' | 'study_group';
  memberIds?: string[];
  memberDetails?: Array<{
    id: string;
    name: string;
    avatarUrl?: string;
  }>;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  ownerId: string;
  parentId?: string;
  /** Academic archive: groups.course_id. */
  courseId?: string | null;
  visibility?: 'private' | 'community' | 'public';
  communityId?: string | null;
  /**
   * Which surface a community group renders as (Phase 1 boards). NULL/absent
   * means "board" for any group that has a communityId — the community lounge
   * is the one derived exception (`isCommunityBoardGroup`).
   */
  communitySurface?: 'board' | 'study_group' | null;
  adminIds?: string[];
  /**
   * Server-side invite token. Distinct from `id` — invite links must carry this,
   * not the group id, or `joinGroupByInvite` has nothing to look up.
   */
  inviteId?: string;
  permissions?: GroupPermissions;
  members: GroupMember[];
  memberCount: number;
  unreadCount?: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessage?: Message;
}

export interface Message {
  /** Emoji reaction counts, e.g. { "👍": 3 }. Server-owned. */
  reactions?: Record<string, number>;
  id: string;
  groupId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  text: string;
  type: 'text' | 'question' | 'system';
  createdAt: string;
  isArchived?: boolean;
  editedAt?: string;
  removedAt?: string;
  isRemoved?: boolean;
  /** Board post title (messages.subject). Absent before the boards migration. */
  subject?: string | null;
  /**
   * What a BOARD post is — discussion / question / announcement / event
   * (`messages.post_kind`, migration 20260908120000). Absent on a chat row and
   * on every row written before that migration; `normalizeBoardPostKind` reads
   * an absent value as a discussion, which is what those legacy rows are.
   */
  postKind?: string | null;
  /** Why a moderator took this post down (`messages.removed_reason`). */
  removedReason?: string | null;
  /** Server-side board pin — one per board, everyone sees it. */
  pinnedAt?: string | null;
  pinnedBy?: string | null;
  upvotes?: number;
  downvotes?: number;
  /**
   * Distinct upvotes from members OTHER than the author — the only count that
   * can grant VERIFIED (@lantern/shared/utils questionVerification). Undefined,
   * never 0, on API builds that do not report it.
   */
  peerUpvotes?: number;
  flaggedAsSimilarUserIds?: string[];
  questionStem?: string;
  questionStatus?: string;
  questionType?: string;
  options?: string[];
  optionItems?: Array<{ id: string; text: string }>;
  tags?: string[];
  correctAnswerIds?: string[];
  acceptableAnswers?: string[];
  matchingPromptItems?: Array<{ id: string; text: string }>;
  matchingAnswerItems?: Array<{ id: string; text: string }>;
  correctMatches?: Array<{ promptItemId: string; answerItemId: string }>;
  diagramLabels?: Array<{ id: string; text: string; x?: number; y?: number; label?: string }>;
  imageUrl?: string;
  explanation?: string;
  replyToMessageId?: string;
  mentionedUserIds?: string[];
  replyTo?: {
    id: string;
    senderId?: string;
    senderName?: string;
    type?: string;
    text?: string;
    questionStem?: string;
    isRemoved?: boolean;
  } | null;
  threadRootId?: string;
  replyCount?: number;
  /**
   * `messages.client_message_id`. A repost row carries `repost:<originalId>`
   * and the shipped optimistic-send path matches its own pending row on it,
   * so the board can tell a repost from a comment without a second query
   * (`isBoardRepostRow`).
   */
  clientMessageId?: string;
  /** How many people reposted this post. Board pages only; absent in chat. */
  repostCount?: number;
  /** Set on a REPOST row: the original it points at, text only, never a URL. */
  repostOf?: BoardQuotedPost | null;
  /** Viewer-specific, attached per request — never inside the shared page cache. */
  repostedByMe?: boolean;
  /** Viewer-specific. Absent (not false) when `message_bookmarks` is missing. */
  bookmarked?: boolean;
  /**
   * Accepted-answer id for a board QUESTION (`messages.answered_message_id`).
   * Mapped conditionally on PRESENCE by `boardActionFields`: the key is set
   * (to a string, or to `null` for a cleared answer) only when the row carries
   * it, and omitted otherwise, so a realtime patch that does not include it
   * leaves a known answer untouched. `CommunityBoardScreen`'s `readPostAnswerId`
   * and its `'answeredMessageId' in post` seed guard both depend on this.
   */
  answeredMessageId?: string | null;
  receiptStatus?: 'sent' | 'read';
  /**
   * Local-only outbox state. Deliberately separate from receiptStatus, which
   * ReceiptTicks / computeDmReceiptStatus / web all branch on as 'sent' | 'read'.
   */
  deliveryState?: 'pending' | 'failed';
  seenByCount?: number;
  seenByTotal?: number;
}

/** @internal — the store's own pagination bookkeeping; no screen reads it. */
export interface MessagePagination {
  page: number;
  hasMore: boolean;
}

/** @internal — the zustand contract, implemented by `state.ts` only. */
export interface GroupState {
  groups: Group[];
  currentGroup: Group | null;
  /** Group id for the chat screen currently open (may differ from currentGroup when group list is still loading). */
  activeGroupId: string | null;
  messages: Message[];
  /**
   * Every message this process has loaded, keyed by group id. It is the source
   * the open thread renders from and the thing `saveToStorage` serialises.
   */
  // FIXED (F8): bounded. `boundMessagesCache` keeps the 30 most recently used
  // conversations and the newest 200 messages in each (plus anything still
  // undelivered, and whatever is on screen) and runs on every load and save,
  // so neither the cache nor the `lantern_messages` blob written from it can
  // grow for the lifetime of the process. It is also registered in
  // stores/userScopedState, so a sign-out drops every chat it holds.
  messagesCache: Record<string, Message[]>;
  messagePagination: Record<string, MessagePagination>;
  dmThreads: DMThread[];
  /** Currently open DM thread (for foreground resync). */
  activeDmThreadId: string | null;
  directMessages: Record<string, DirectMessage[]>;
  /** Local delete-for-me cutoffs keyed by thread id (survives inbox removal). */
  dmHistoryClearedAtByThread: Record<string, string>;
  dmUnreadCounts: Record<string, number>;
  groupUnreadCounts: Record<string, number>;
  userVotes: Record<string, 'up' | 'down' | undefined>;
  isLoading: boolean;
  isLoadingMore: boolean;
  isLoadingMessages: boolean;
  error: string | null;
  /**
   * Failure of the *list* fetches (groups / DM threads) only.
   *
   * Deliberately separate from `error`, which six mutation paths write: a
   * failed "leave group" must not make the chat list render as broken.
   */
  listError: string | null;

  loadFromStorage: () => Promise<void>;
  saveToStorage: () => Promise<void>;
  fetchGroups: (userId: string) => Promise<void>;
  fetchGroupMembers: (groupId: string) => Promise<GroupMember[]>;
  fetchGroupUnreadCounts: (userId: string) => Promise<void>;
  markGroupAsRead: (groupId: string, userId: string) => Promise<string | null>;
  selectGroup: (groupId: string) => void;
  /**
   * Load a group the store has never seen. Needed whenever a screen is reached
   * without going through the chat list — an invite join, an accepted invite,
   * a notification deep link — because `selectGroup` otherwise has nothing to
   * show and falls back to a placeholder.
   */
  hydrateGroup: (groupId: string) => Promise<void>;
  /**
   * `rootsOnly` is the board's page (spec §3.3): thread roots only, so the
   * comments folded under each post never enter the board list.
   */
  fetchMessages: (
    groupId: string,
    options?: { page?: number; refresh?: boolean; limit?: number; rootsOnly?: boolean }
  ) => Promise<void>;
  loadMoreMessages: (groupId: string, options?: { limit?: number; rootsOnly?: boolean }) => Promise<number>;
  sendMessage: (
    groupId: string,
    text: string,
    senderId: string,
    senderName?: string,
    options?: {
      replyToMessageId?: string;
      mentionedUserIds?: string[];
      /** Board post title (§3.4). Validate with `validateBoardSubject` first. */
      subject?: string | null;
      /**
       * Board posts are never questions: the JSON question branch is skipped
       * so a body that happens to start with `{` posts as plain text, exactly
       * as the API does for a board group (§3.4).
       */
      plainText?: boolean;
      /**
       * A board post's photo, carried on `messages.image_url` so a title, a
       * body and a photo are ONE row (§5.2). The server writes it only on a
       * board group and only when the path is `note-files/{me}/chat/{group}/`,
       * so this is a request, not a guarantee. Do NOT use it for chat: a chat
       * photo is still `![image](url)` markdown, and a third encoding is
       * exactly what trap 6 forbids.
       */
      imageUrl?: string | null;
      /**
       * A board post's KIND (`messages.post_kind`). Ignored on a group chat,
       * dropped rather than rejected pre-20260908120000, and 403 when the
       * sender may not post it — decide with `canPostOnBoard` from
       * `@lantern/shared/network` first, so the control is hidden rather than
       * the request refused.
       */
      postKind?: BoardPostKind;
    }
    /**
     * Resolves with the outcome instead of throwing for offline sends: a send
     * that could not reach the server but IS in the outbox resolves 'queued',
     * so the caller can clear the composer and say so honestly. Only errors the
     * user must act on (server rejection, auth) still throw.
     */
  ) => Promise<SendOutcome<Message>>;
  editGroupMessage: (groupId: string, messageId: string, content: string) => Promise<void>;
  removeGroupMessage: (groupId: string, messageId: string) => Promise<void>;
  createGroup: (input: CreateGroupInput | string, description?: string, ownerId?: string, ownerName?: string, parentId?: string) => Promise<Group>;
  leaveGroup: (groupId: string, userId: string) => Promise<void>;

  setActiveDmThreadId: (threadId: string | null) => void;
  fetchDmThreads: (userId: string) => Promise<void>;
  fetchDMUnreadCounts: (userId: string) => Promise<void>;
  /**
   * Resolves `true` on success, `false` when the fetch failed. It deliberately
   * does not throw — several callers fire it without awaiting — but it must
   * still report failure, or a screen cannot tell "no messages" from "could not
   * load them" and renders an empty state over an error.
   */
  fetchDirectMessagesForThread: (userId: string, otherUserId: string, threadId: string) => Promise<boolean>;
  sendDirectMessageTo: (
    senderId: string,
    recipientId: string,
    text: string,
    threadId: string,
    options?: { replyToMessageId?: string }
    /** Same contract as `sendMessage`: 'queued' resolves, it does not throw. */
  ) => Promise<SendOutcome<DirectMessage>>;
  editDirectMessage: (threadId: string, messageId: string, content: string) => Promise<void>;
  /** Patch one DM in place (used for optimistic reaction counts). */
  patchDirectMessageInState: (
    threadId: string,
    messageId: string,
    updates: Partial<DirectMessage>
  ) => void;
  removeDirectMessage: (threadId: string, messageId: string) => Promise<void>;
  markDMAsRead: (threadId: string, userId: string) => Promise<string | null>;
  archiveDmThread: (threadId: string, userId: string) => Promise<void>;
  unarchiveDmThread: (threadId: string, userId: string) => Promise<void>;
  deleteDmThread: (threadId: string, userId: string) => Promise<void>;
  removeDmThread: (threadId: string) => void;
  addDirectMessage: (threadId: string, message: DirectMessage) => void;
  mergeDirectMessage: (threadId: string, rawMessage: unknown) => void;
  appendGroupMessage: (groupId: string, rawMessage: unknown) => void;
  mergeGroupMessage: (groupId: string, rawMessage: unknown) => void;
  fetchThread: (
    rootId: string,
    context: { groupId: string } | { threadId: string }
  ) => Promise<Message[] | DirectMessage[]>;
  applyPeerChatRead: (payload: { chatId: string; userId: string; lastReadAt: string }) => void;

  updateGroupDetails: (
    groupId: string,
    name: string,
    description: string,
    discovery?: { visibility?: 'private' | 'community' | 'public'; communityId?: string | null }
  ) => Promise<void>;
  promoteToAdmin: (groupId: string, userId: string) => Promise<void>;
  demoteAdmin: (groupId: string, userId: string) => Promise<void>;
  promoteGroupAdmin: (groupId: string, userId: string) => Promise<void>;
  demoteGroupAdmin: (groupId: string, userId: string) => Promise<void>;
  removeMember: (groupId: string, userId: string) => Promise<void>;
  retryFailedMessage: (groupId: string, messageId: string, senderId: string) => Promise<void>;
  retryFailedDirectMessage: (threadId: string, messageId: string, senderId: string) => Promise<void>;
  archiveGroup: (groupId: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  submitQuestion: (groupId: string, question: any) => Promise<void>;
  flagMessageAsSimilar: (messageId: string, groupId: string, userId: string) => Promise<void>;
  /** Patch one message wherever it is held (live list + per-group cache). */
  patchMessageInState: (messageId: string, updates: Partial<Message>) => void;
  fetchUserVotesForGroup: (groupId: string, userId: string) => Promise<void>;
  voteOnMessage: (groupId: string, messageId: string, userId: string, voteType: 'up' | 'down') => Promise<void>;

  getSubgroups: (parentId: string) => Group[];
  getSubgroupsWithLevel: (parentId: string) => Array<{ group: Group; level: number }>;
  getMessagesForGroups: (groupIds: string[]) => Promise<Message[]>;
  getParentGroup: (groupId: string) => Group | null;
  getBreadcrumbs: (groupId: string) => Group[];
  getTopLevelGroups: () => Group[];
  getActiveDmThreads: () => DMThread[];
}
