// ===========================================
// Lantern Study Mobile - Groups Store
// ===========================================
//
// Purpose: every chat surface on mobile — study groups, community boards and
// direct messages. Holds the group list, the per-group message cache, DM
// threads and their messages, unread counts, votes, and the optimistic
// send/outbox machinery shared by all of them.
//
// Main exports: `useGroupStore` (zustand), `mapApiMessage` (the ONE message
// mapper, also used by the board store), and the types `Group`, `GroupMember`,
// `Message`, `CreateGroupInput`, plus the `DMThread`/`DirectMessage`
// re-exports from @lantern/shared.
//
// It also registers the syncService `'message'` handler at the bottom of the
// file — the outbox that flushes queued group and DM sends.
//
// Touches:
// - AsyncStorage: `lantern_groups`, `lantern_messages` (the whole
//   `messagesCache` is serialised on every save).
// - services/api (groups, members, messages, threads, DMs, votes, unread
//   counts, avatars), services/syncService, expo-crypto for client ids.
// - authStore, for the viewer's own identity when a roster has not loaded.
// - @lantern/shared/utils for the merge/receipt/delivery-intent helpers.
//
// Gotchas:
// - Server rows must win on a REFRESH (`mergeServerRefresh`) and only the
//   local outbox rows survive; merging the cache in as the incoming side made
//   every stale cached field beat the fresh server row.
// - Sends are serialised per conversation and de-duplicated by
//   `deliveryIntents`, so a retry of an uncertain delivery reuses the same
//   `clientMessageId` instead of posting twice.
// - A queued send is NOT a failure: `sendMessage`/`sendDirectMessageTo`
//   resolve `'queued'` rather than throwing, and only server rejections throw.
// - Rosters come from their own endpoint; the group payload carries no
//   `members`, so nothing here may overwrite a loaded roster with an empty
//   one, and `memberCount` is never shrunk to one page of members.
// - A board post is stored as TEXT even when its body starts with `{`.
//   Re-deriving "question" from the body is what turned board posts into
//   read-only question cards on mobile.

import { create } from 'zustand';
import { registerUserScoped } from './userScopedState';
import { isBoardPostKind, type BoardPostKind } from '@lantern/shared/network';
import {
  chatMessagePreview,
  resolveQuestionStatusAfterVote,
  formatChatSenderLabel,
  resolveThreadRootId,
  computeDmReceiptStatus,
  mergeChatMessagesById,
  mergeServerRefresh,
  mergeDmThreadLists,
  filterMessagesAfterDmHistoryCutoff,
  createOptimisticClientMessageId,
  DeliveryIntentRegistry,
  isUncertainDeliveryError,
  reconcileDeliveredItem,
} from '@lantern/shared/utils';
import * as transport from './group/transport';
import { isTransientSyncError } from '@lantern/shared';
import { syncService } from '../services/syncService';
import * as Crypto from 'expo-crypto';
import { useAuthStore } from './authStore';
import { firstNonEmailValue } from '../utils/senderIdentity';
import {
  isQueueableSendError,
  queuedOutcome,
  sentOutcome,
  toSendError,
  type SendOutcome,
} from './sendOutcome';
import { lastDeliveredMessage, previewFromServerAndCache } from './chatListPreview';

// Moved to `group/types.ts` (lane M2) and re-exported here so every existing
// `from '../stores/groupStore'` type import keeps resolving.
export type {
  CreateGroupInput,
  DirectMessage,
  DMThread,
  Group,
  GroupMember,
  GroupPermissions,
  Message,
} from './group/types';
import type {
  CreateGroupInput,
  DirectMessage,
  DMThread,
  Group,
  GroupMember,
  GroupPermissions,
  GroupState,
  Message,
} from './group/types';

const MESSAGES_PAGE_SIZE = 50;

const messagesFetchSeqByGroup: Record<string, number> = {};
const dmFetchSeqByThread: Record<string, number> = {};
// Sends are serialized per conversation rather than rejected. The old Set-based
// locks threw a user-facing Alert (groups) or returned silently (DMs, after the
// composer had already been cleared) — both cost the user their message.
// deliveryIntents still guards genuine duplicate taps.
const sendChainByGroup = new Map<string, Promise<void>>();
const sendChainByDmThread = new Map<string, Promise<void>>();

async function acquireSendSlot(
  chains: Map<string, Promise<void>>,
  key: string
): Promise<() => void> {
  const prior = chains.get(key);
  if (prior) await prior.catch(() => undefined);
  let release: () => void = () => undefined;
  const slot = new Promise<void>((resolve) => {
    release = resolve;
  });
  chains.set(key, slot);
  return () => {
    release();
    if (chains.get(key) === slot) chains.delete(key);
  };
}
const deliveryIntents = new DeliveryIntentRegistry();

// Row -> model mapping and the pure list rules moved to `group/mapping.ts`
// (lane M2). `mapApiMessage` stays re-exported from here: the board store
// imports it from this path and it must remain the ONE message mapper.
export { mapApiMessage } from './group/mapping';
import {
  applyDirectMessageMutation,
  applyGroupMessageMutation,
  mapApiGroup,
  mapApiMember,
  mapApiMessage,
  mapDirectMessage,
  mapDmThread,
  mergeGroupMessageIntoList,
  replaceOptimisticWithServer,
  resolveDmHistoryClearedAt,
  stripOptimisticDuplicates,
} from './group/mapping';

// The two AsyncStorage blobs and the F8 cache bound moved to
// `group/persistence.ts` (lane M2). The eviction helpers stay re-exported
// from here: `messagesCacheBound.test.ts` and several screens import them
// from this path.
export {
  boundMessagesCache,
  clearMessagesCacheRecency,
  touchMessagesCache,
  MESSAGES_CACHE_MAX_CONVERSATIONS,
  MESSAGES_CACHE_MAX_PER_CONVERSATION,
} from './group/persistence';
import {
  boundMessagesCache,
  clearMessagesCacheRecency,
  readChatBlobs,
  touchMessagesCache,
  writeChatBlobs,
} from './group/persistence';

export const useGroupStore = create<GroupState>((set, get) => ({
  groups: [],
  currentGroup: null,
  activeGroupId: null,
  messages: [],
  messagesCache: {},
  messagePagination: {},
  dmThreads: [],
  activeDmThreadId: null,
  directMessages: {},
  dmHistoryClearedAtByThread: {},
  dmUnreadCounts: {},
  groupUnreadCounts: {},
  userVotes: {},
  isLoading: false,
  isLoadingMore: false,
  isLoadingMessages: false,
  error: null,
  listError: null,

  // Load cached data from AsyncStorage
  loadFromStorage: async () => {
    try {
      const [groupsJson, messagesJson] = await readChatBlobs();
      
      if (groupsJson) {
        set({ groups: JSON.parse(groupsJson) });
      }
      if (messagesJson) {
        // MERGE, memory winning: `fetchGroups` calls this on every run while
        // a thread may be open underneath, and a wholesale replace wiped the
        // messages that thread had just fetched (the disk copy rarely holds
        // them) — the thread then rendered as "No messages yet".
        const stored = JSON.parse(messagesJson) as GroupState['messagesCache'];
        set(state => ({
          messagesCache: boundMessagesCache(
            { ...stored, ...state.messagesCache },
            [state.activeGroupId, state.currentGroup?.id, state.activeDmThreadId]
          ),
        }));
      }
    } catch (error) {
      console.error('[GroupStore] Failed to load from storage:', error);
    }
  },

  // Save current state to AsyncStorage
  saveToStorage: async () => {
    try {
      // Trim before serialising, and keep the trimmed copy: the blob and the
      // in-memory cache are the same data, so bounding only the write would
      // leave the process growing anyway.
      const state = get();
      const bounded = boundMessagesCache(state.messagesCache, [
        state.activeGroupId,
        state.currentGroup?.id,
        state.activeDmThreadId,
      ]);
      if (bounded !== state.messagesCache) set({ messagesCache: bounded });
      const groups = state.groups;
      await writeChatBlobs(groups, bounded);
    } catch (error) {
      console.error('[GroupStore] Failed to save to storage:', error);
    }
  },

  // Chat list load: cache first for an instant render, then the API over it.
  // Two things must survive the mapping — a roster already loaded for
  // @mentions, and a chat-list preview that is newer than the server's
  // (`last_message` lags the thread it summarises). Failure sets `listError`
  // rather than `error`, so an offline list says so instead of reading as an
  // empty account.
  fetchGroups: async (userId: string) => {
    set({ isLoading: true, error: null, listError: null });

    // Load from local storage first for instant UI
    await get().loadFromStorage();

    try {
      const [apiGroups, unreadCounts] = await Promise.all([
        transport.fetchGroups(userId, { limit: 50 }),
        transport.fetchGroupUnreadCounts(userId).catch(() => ({} as Record<string, number>)),
      ]);

      const prevById = new Map(get().groups.map((g) => [g.id, g]));
      const cacheById = get().messagesCache;
      const groups: Group[] = apiGroups.map((g: any) => {
        const mapped = mapApiGroup(g, unreadCounts);
        const existing = prevById.get(mapped.id);
        // The group-list endpoint's `last_message` can lag the thread it
        // summarises, so after a cold start the list previewed a 38-day-old
        // message until the thread was opened. Prefer whichever of the two is
        // actually newer; a queued row never wins (it is not delivered).
        const preview = previewFromServerAndCache(mapped.lastMessage, cacheById[mapped.id]);
        const withPreview: Group =
          preview === mapped.lastMessage
            ? mapped
            : {
                ...mapped,
                lastMessage: preview as Message,
                updatedAt: preview?.createdAt || mapped.updatedAt,
              };
        // API group list omits members — keep any roster already loaded for @mentions.
        if (existing?.members?.length && !withPreview.members.length) {
          return { ...withPreview, members: existing.members, memberCount: existing.members.length };
        }
        return withPreview;
      });

      const currentGroup = get().currentGroup;
      set({
        groups,
        groupUnreadCounts: unreadCounts,
        isLoading: false,
        currentGroup:
          currentGroup && currentGroup.members.length === 0
            ? groups.find((g) => g.id === currentGroup.id) || currentGroup
            : currentGroup,
      });
      await get().saveToStorage();
    } catch (error: any) {
      // Previously swallowed entirely, so an offline chat list was
      // indistinguishable from a new account with no groups.
      console.warn('[GroupStore] API fetch failed, using cached data:', error);
      set({
        isLoading: false,
        listError: error?.message || 'Could not load your chats.',
      });
    }
  },

  // The roster comes from its OWN endpoint — the group payload has no embedded
  // members — and roles are re-derived from the group's `adminIds`. Keep it
  // that way: a roster read as a PostgREST embed breaks outright once a second
  // foreign key exists between the two tables, which is how the members list
  // silently emptied before. On failure the already-loaded roster is returned
  // unchanged, never an empty list.
  fetchGroupMembers: async (groupId: string) => {
    const group = get().groups.find(g => g.id === groupId);
    const adminIds = group?.adminIds || [];

    try {
      const apiMembers = await transport.fetchGroupMembers(groupId);
      const members = (Array.isArray(apiMembers) ? apiMembers : []).map((m: any) =>
        mapApiMember(m, adminIds)
      );

      // The members endpoint is paginated (50 by default), so members.length is
      // a page size, not a roster size. Overwriting memberCount with it made a
      // 180-member group report 50, which feeds the header, seenByTotal for read
      // receipts and the flag-to-archive threshold. Only raise it — never shrink
      // a server-provided count to the size of one page.
      const applyMembers = (g: Group): Group =>
        g.id === groupId
          ? { ...g, members, memberCount: Math.max(g.memberCount ?? 0, members.length) }
          : g;

      set(state => ({
        groups: state.groups.map(applyMembers),
        currentGroup: state.currentGroup?.id === groupId
          ? applyMembers(state.currentGroup)
          : state.currentGroup,
      }));

      return members;
    } catch (error) {
      console.warn('[GroupStore] Failed to fetch group members:', error);
      return group?.members || [];
    }
  },

  fetchGroupUnreadCounts: async (userId: string) => {
    try {
      const counts = await transport.fetchGroupUnreadCounts(userId);
      set(state => ({
        groupUnreadCounts: counts,
        groups: state.groups.map(g => ({ ...g, unreadCount: counts[g.id] || 0 })),
      }));
    } catch (error) {
      console.warn('[GroupStore] Failed to fetch group unread counts:', error);
    }
  },

  markGroupAsRead: async (groupId: string, userId: string) => {
    try {
      const result = await transport.markGroupAsRead(groupId, userId);
      set(state => ({
        groupUnreadCounts: { ...state.groupUnreadCounts, [groupId]: 0 },
        groups: state.groups.map(g => g.id === groupId ? { ...g, unreadCount: 0 } : g),
      }));
      return result?.previousLastReadAt ?? result?.data?.previousLastReadAt ?? null;
    } catch (error) {
      console.warn('[GroupStore] Failed to mark group as read:', error);
      return null;
    }
  },

  selectGroup: (groupId: string) => {
    // The open thread is the most-recently-used conversation by definition;
    // the LRU bound must never evict it out from under the screen.
    touchMessagesCache(groupId);
    const group = get().groups.find(g => g.id === groupId) ?? null;
    const cached = get().messagesCache[groupId] || [];
    set({
      activeGroupId: groupId,
      currentGroup:
        group ??
        ({
          id: groupId,
          name: 'Group',
          adminIds: [],
          permissions: {},
          ownerId: '',
          members: [],
          memberCount: 0,
          isArchived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as unknown as Group),
      messages: cached,
    });
    void get().fetchGroupMembers(groupId);
    // The placeholder above exists only so the screen can render immediately.
    // Without this the header keeps showing "Group" with no owner or count for
    // the whole session, since nothing else refetches the list.
    if (!group) void get().hydrateGroup(groupId);
  },

  hydrateGroup: async (groupId: string) => {
    try {
      const apiGroup = await transport.fetchGroup(groupId);
      if (!(apiGroup as { id?: string })?.id) return;
      const mapped = mapApiGroup(apiGroup, get().groupUnreadCounts);
      set((state) => {
        // fetchGroupMembers may have already landed a roster on the placeholder;
        // the group endpoint omits members, so never overwrite one with nothing.
        const merge = (g: Group): Group => ({
          ...mapped,
          members: g.members?.length ? g.members : mapped.members,
          memberCount: Math.max(mapped.memberCount ?? 0, g.memberCount ?? 0),
        });
        const known = state.groups.some((g) => g.id === groupId);
        return {
          groups: known
            ? state.groups.map((g) => (g.id === groupId ? merge(g) : g))
            : [...state.groups, mapped],
          currentGroup:
            state.currentGroup?.id === groupId ? merge(state.currentGroup) : state.currentGroup,
        };
      });
    } catch (error) {
      console.warn('[GroupStore] Failed to hydrate group:', error);
    }
  },

  // Load one page of a group's messages into the cache (and into `messages`
  // when that group is the one on screen).
  //
  // Three rules hold this together: a per-group sequence number so a slow
  // fetch cannot apply after a newer one; `mergeServerRefresh` on a refresh so
  // fresh server rows win while local outbox rows survive, versus a plain
  // merge-by-id when paging; and the shared spinner belonging only to the
  // active group, so a board or a background prefetch cannot strand it.
  fetchMessages: async (
    groupId: string,
    options?: { page?: number; refresh?: boolean; limit?: number; rootsOnly?: boolean }
  ) => {
    touchMessagesCache(groupId);
    const page = options?.page ?? 1;
    const limit = options?.limit ?? MESSAGES_PAGE_SIZE;
    const refresh = options?.refresh ?? page === 1;
    const requestId = (messagesFetchSeqByGroup[groupId] = (messagesFetchSeqByGroup[groupId] || 0) + 1);

    if (page === 1) {
      // Only the active chat's fetch owns the shared spinner — it is cleared
      // below on the same condition, so setting it for anything else (a board,
      // a background prefetch) would leave it stuck true for the session.
      set({
        isLoadingMessages: get().activeGroupId === groupId ? true : get().isLoadingMessages,
        error: null,
      });
    } else {
      set({ isLoadingMore: true });
    }

    try {
      const result = await transport.fetchMessages(groupId, {
        page,
        limit,
        ...(options?.rootsOnly ? { rootsOnly: true } : {}),
      });
      const apiMessages = Array.isArray(result) ? result : (result as any)?.data || [];
      const pagination = Array.isArray(result) ? undefined : (result as any)?.pagination;
      const roster =
        get().groups.find((g) => g.id === groupId)?.members ||
        (get().currentGroup?.id === groupId ? get().currentGroup?.members : undefined);
      const mapped = apiMessages.map((m: any) => mapApiMessage(m, groupId, roster));

      const existing = get().messagesCache[groupId] || [];
      // Always merge by id so a late fetch cannot wipe realtime/optimistic rows.
      // A refresh MUST use mergeServerRefresh: the old code merged the cache in
      // as the *incoming* side to keep optimistic rows, which made every stale
      // cached field (reactions, edits, removals, votes, pins) win over the
      // fresh server row — so a reaction saved on the server vanished on the
      // first fetch after a cold start, when the cache is the AsyncStorage copy.
      const withLocalOptimistic = refresh
        ? mergeServerRefresh<Message>(mapped, existing)
        : mergeChatMessagesById<Message>(existing, mapped);

      const hasMore = pagination?.hasMore ?? mapped.length >= limit;

      if (requestId !== messagesFetchSeqByGroup[groupId]) return;

      const isActiveGroup = get().activeGroupId === groupId;
      set({
        messages: isActiveGroup ? withLocalOptimistic : get().messages,
        messagesCache: { ...get().messagesCache, [groupId]: withLocalOptimistic },
        messagePagination: {
          ...get().messagePagination,
          [groupId]: { page, hasMore },
        },
        // Only clear the shared spinner for the chat the user is viewing
        isLoadingMessages: isActiveGroup ? false : get().isLoadingMessages,
        isLoadingMore: false,
        error: isActiveGroup ? null : get().error,
      });
    } catch (error: any) {
      if (requestId !== messagesFetchSeqByGroup[groupId]) return;
      const isActiveGroup = get().activeGroupId === groupId;
      set({
        error: isActiveGroup ? (error.message || 'Failed to fetch messages') : get().error,
        isLoadingMessages: isActiveGroup ? false : get().isLoadingMessages,
        isLoadingMore: false,
      });
    }
  },

  loadMoreMessages: async (groupId: string, options?: { limit?: number; rootsOnly?: boolean }) => {
    const pagination = get().messagePagination[groupId];
    if (!pagination?.hasMore || get().isLoadingMore) return 0;

    const nextPage = pagination.page + 1;
    const beforeCount = get().messagesCache[groupId]?.length || 0;
    await get().fetchMessages(groupId, {
      page: nextPage,
      refresh: false,
      ...(options?.limit ? { limit: options.limit } : {}),
      ...(options?.rootsOnly ? { rootsOnly: true } : {}),
    });
    const afterCount = get().messagesCache[groupId]?.length || 0;
    return Math.max(0, afterCount - beforeCount);
  },

  // Send to a group or board, optimistically.
  //
  // Order: take the per-group send slot (sends are serialised, not rejected) →
  // resolve a `clientMessageId` from the delivery-intent registry so a retry
  // of the same content reuses it → render the optimistic row → POST →
  // replace the optimistic row with the server row.
  //
  // On failure it distinguishes two cases. Network-shaped errors queue the
  // send in the outbox, leave the row `'pending'` and resolve `'queued'` —
  // throwing here is what made screens alert "Send failed" and invite a
  // duplicate of a message already on its way. Anything the server rejected
  // marks the row `'failed'` and throws. Only the failed row is patched:
  // restoring a pre-await snapshot destroys realtime messages that landed
  // mid-send.
  sendMessage: async (
    groupId: string,
    text: string,
    senderId: string,
    _senderName?: string,
    options?: {
      replyToMessageId?: string;
      mentionedUserIds?: string[];
      subject?: string | null;
      plainText?: boolean;
      imageUrl?: string | null;
      postKind?: BoardPostKind;
    }
  ) => {
    const releaseSendSlot = await acquireSendSlot(sendChainByGroup, groupId);

    const group = get().groups.find((g) => g.id === groupId);
    // Prefer userId — member.id may be the membership row id, not the auth user id.
    const member = group?.members?.find((m) => m.userId === senderId || m.id === senderId);
    // The sender is whoever is signed in, so fall back to their own profile when
    // the group's member list has not loaded them (board posts hit this: the
    // board's roster is not fetched, so the author showed as "Member" until the
    // app was restarted and the server's copy arrived).
    const auth = useAuthStore.getState();
    const isMe = !!auth.user?.id && auth.user.id === senderId;
    const myUsername = isMe
      ? ((auth.user?.user_metadata as { username?: string | null } | undefined)?.username ?? null)
      : null;
    // Skip an email-shaped `profiles.name`/`profileName` so the stamped sender
    // name can never be an address reduced to its local part ('nimaj22@x.com' →
    // 'nimaj22'); resolution then falls to the @username or "Member".
    const senderName = formatChatSenderLabel({
      username: firstNonEmailValue(member?.username, myUsername),
      name: firstNonEmailValue(member?.name, isMe ? auth.profileName : null),
    });
    let parsed: any = {};
    if (!options?.plainText && text.trim().startsWith('{')) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = {};
      }
    }
    const isQuestion =
      parsed.type === 'QUESTION' ||
      parsed.type === 'question' ||
      !!parsed.questionStem ||
      !!parsed.question_stem;
    const questionStem = parsed.questionStem || parsed.question_stem;

    const deliveryScope = `group:${groupId}`;
    const deliveryFingerprint = JSON.stringify({
      text,
      subject: options?.subject ?? null,
      replyToMessageId: options?.replyToMessageId || null,
      mentionedUserIds: [...(options?.mentionedUserIds || [])].sort(),
      // Part of the identity of the send: two posts with the same words but
      // different photos are two posts, and the retry path must not fold them
      // into one delivery intent.
      imageUrl: options?.imageUrl ?? null,
    });
    const clientMessageId = deliveryIntents.resolve(
      deliveryScope,
      deliveryFingerprint,
      Crypto.randomUUID
    );
    const existing = get().messagesCache[groupId] || [];
    const parent = options?.replyToMessageId
      ? existing.find((m) => m.id === options.replyToMessageId)
      : undefined;
    // A reply whose parent is not in the cache (a board post older than the
    // loaded page, opened from the pinned strip or a deep link) still belongs
    // to a thread. `undefined` made the optimistic row look top-level, so a
    // comment flashed onto the board as its own post card until the server row
    // replaced it. The server resolves the true root either way.
    const threadRootId = parent
      ? resolveThreadRootId({ id: parent.id, threadRootId: parent.threadRootId })
      : (options?.replyToMessageId ?? undefined);
    const rootReplyCount = threadRootId
      ? (existing.find((m) => m.id === threadRootId)?.replyCount || 0) + 1
      : 0;
    const seenByTotal = Math.max(0, (group?.members?.length || group?.memberCount || 1) - 1);

    const newMessage: Message = {
      id: clientMessageId,
      groupId,
      senderId,
      senderName,
      senderAvatar: member?.avatarUrl,
      text: isQuestion ? questionStem || text : text,
      type: isQuestion ? 'question' : 'text',
      createdAt: new Date().toISOString(),
      subject: options?.subject ?? null,
      // The optimistic card must already read as an announcement, or a
      // moderator's post jumps from the middle of the list to the top a
      // second later.
      postKind: options?.postKind ?? null,
      questionStem,
      questionStatus: isQuestion ? 'PENDING' : undefined,
      questionType: parsed.questionType || parsed.question_type,
      options: (parsed.options || []).map((opt: any) =>
        typeof opt === 'string' ? opt : opt?.text || ''
      ).filter(Boolean),
      tags: parsed.tags,
      upvotes: 0,
      downvotes: 0,
      flaggedAsSimilarUserIds: [],
      replyToMessageId: options?.replyToMessageId,
      mentionedUserIds: options?.mentionedUserIds,
      threadRootId,
      replyCount: 0,
      // Shown on the optimistic card immediately: the photo was already
      // uploaded and signed by the composer, so there is nothing to wait for.
      ...(options?.imageUrl ? { imageUrl: options.imageUrl } : {}),
      receiptStatus: 'sent',
      seenByCount: 0,
      seenByTotal,
    };
    
    // Optimistic update for immediate feedback
    const previousMessages = get().messages;
    const previousGroups = get().groups;
    const previousCache = get().messagesCache[groupId] || [];
    const isActiveGroup = get().activeGroupId === groupId;
    const withOptimistic = [...previousCache, newMessage];
    // Bump the root only — matching on `threadRootId || id` also matched every
    // reply, so each reply showed its own "N replies" chip.
    const optimisticCache = threadRootId
      ? withOptimistic.map((m) =>
          m.id === threadRootId ? { ...m, replyCount: rootReplyCount } : m
        )
      : withOptimistic;
    const optimisticMessages = threadRootId
      ? (isActiveGroup ? [...previousMessages, newMessage] : previousMessages).map((m) =>
          m.id === threadRootId ? { ...m, replyCount: rootReplyCount } : m
        )
      : isActiveGroup
        ? [...previousMessages, newMessage]
        : previousMessages;
    set({
      messages: optimisticMessages,
      groups: previousGroups.map(g =>
        g.id === groupId
          ? { ...g, lastMessage: newMessage, updatedAt: new Date().toISOString() }
          : g
      ),
      messagesCache: { ...get().messagesCache, [groupId]: optimisticCache },
    });

    try {
      const serverPayload = await transport.sendGroupMessage(groupId, senderId, {
        content: text,
        clientMessageId,
        replyToMessageId: options?.replyToMessageId,
        mentionedUserIds: options?.mentionedUserIds,
        ...(options?.subject ? { subject: options.subject } : {}),
        ...(options?.imageUrl ? { imageUrl: options.imageUrl } : {}),
        ...(options?.postKind ? { postKind: options.postKind } : {}),
      });
      const serverMessage = mapApiMessage(serverPayload, groupId);
      set((state) => {
        const cache = state.messagesCache[groupId] || [];
        const updatedCache = replaceOptimisticWithServer(cache, newMessage.id, serverMessage);
        const updatedMessages =
          state.activeGroupId === groupId
            ? replaceOptimisticWithServer(state.messages, newMessage.id, serverMessage)
            : state.messages;
        const updatedGroups = state.groups.map((group) => {
          if (group.id !== groupId) return group;
          return {
            ...group,
            lastMessage: serverMessage,
            updatedAt: serverMessage.createdAt,
          };
        });
        return {
          groups: updatedGroups,
          messages: updatedMessages,
          messagesCache: { ...state.messagesCache, [groupId]: updatedCache },
        };
      });
      deliveryIntents.clear(deliveryScope, deliveryFingerprint, clientMessageId);
      return sentOutcome(serverMessage);
    } catch (error: any) {
      if (isUncertainDeliveryError(error)) {
        deliveryIntents.markUncertain(deliveryScope, deliveryFingerprint, clientMessageId);
      } else {
        deliveryIntents.clear(deliveryScope, deliveryFingerprint, clientMessageId);
      }
      // Network-shaped failures go to the outbox and stay 'pending'; anything the
      // server actively rejected is 'failed' and needs the user's attention.
      const queueable = isQueueableSendError(error);
      if (queueable) {
        void syncService
          .queueOperation('message', newMessage.id, 'create', {
            kind: 'group',
            groupId,
            text,
            clientMessageId,
            replyToMessageId: options?.replyToMessageId,
            mentionedUserIds: options?.mentionedUserIds,
            // Carried so an airplane-mode board post keeps its title when the
            // queue flushes — the user never sees this send, so a dropped
            // title would be silent work loss. The photo is carried for the
            // same reason: it is ALREADY uploaded (the composer signs it
            // before Post is enabled), so dropping the reference here would
            // strand an object in storage that no row points at.
            subject: options?.subject ?? null,
            imageUrl: options?.imageUrl ?? null,
            // Carried for the same reason as the title: a queued announcement
            // that flushes as a discussion is silent work loss, and the
            // student never sees the send that dropped it.
            postKind: options?.postKind ?? null,
          }, senderId)
          .catch(() => undefined);
      }
      // Mark just the failed row. Restoring the pre-await snapshots destroyed any
      // realtime message that landed while the send was in flight, and reverting the
      // whole `groups` array also threw away unread counts and other groups' previews.
      set((state) => {
        const markFailed = (list: Message[]) =>
          list.map((m) =>
            m.id === newMessage.id
              ? { ...m, deliveryState: (queueable ? 'pending' : 'failed') as 'pending' | 'failed' }
              : m
          );
        const updatedCache = markFailed(state.messagesCache[groupId] || []);
        const latest = lastDeliveredMessage(updatedCache);
        return {
          messages: state.activeGroupId === groupId ? markFailed(state.messages) : state.messages,
          messagesCache: { ...state.messagesCache, [groupId]: updatedCache },
          groups: state.groups.map((g) =>
            g.id === groupId ? { ...g, lastMessage: latest ?? undefined } : g
          ),
        };
      });
      void get().saveToStorage();
      // Queued is NOT a failure: the row is in the outbox and stays 'pending'
      // on screen. Throwing here made every screen alert "Send failed" and put
      // the text back in the composer, inviting a duplicate of a message that
      // was already on its way.
      if (queueable) {
        const queued =
          (get().messagesCache[groupId] || []).find((m) => m.id === newMessage.id)
          || { ...newMessage, deliveryState: 'pending' as const };
        return queuedOutcome(queued);
      }
      throw toSendError(error);
    } finally {
      releaseSendSlot();
    }
  },

  editGroupMessage: async (groupId: string, messageId: string, content: string) => {
    const payload = await transport.editGroupMessage(messageId, content);
    set((state) => {
      const updated = applyGroupMessageMutation(state.messagesCache[groupId] || [], payload);
      const latest = [...updated].reverse().find(
        (message) => !message.isRemoved && !message.removedAt && !message.isArchived
      );
      return {
        messagesCache: { ...state.messagesCache, [groupId]: updated },
        messages: state.activeGroupId === groupId ? updated : state.messages,
        groups: state.groups.map((group) =>
          group.id === groupId
            ? { ...group, lastMessage: latest, updatedAt: latest?.createdAt || group.updatedAt }
            : group
        ),
      };
    });
  },

  removeGroupMessage: async (groupId: string, messageId: string) => {
    const payload = await transport.removeGroupMessage(messageId);
    set((state) => {
      const updated = applyGroupMessageMutation(state.messagesCache[groupId] || [], payload);
      const latest = [...updated].reverse().find(
        (message) => !message.isRemoved && !message.removedAt && !message.isArchived
      );
      return {
        messagesCache: { ...state.messagesCache, [groupId]: updated },
        messages: state.activeGroupId === groupId ? updated : state.messages,
        groups: state.groups.map((group) =>
          group.id === groupId
            ? { ...group, lastMessage: latest, updatedAt: latest?.createdAt || group.updatedAt }
            : group
        ),
      };
    });
  },

  // Create a group (or a community board/study group). The avatar is a two-step
  // when it arrives as a data URL — create first, then upload — and a failed
  // upload keeps the created group rather than failing the creation. Only the
  // creator is an active member; invited ids stay pending until accepted. If
  // the API call fails entirely the locally built group is kept and saved, so
  // the caller always gets a group back.
  createGroup: async (input: CreateGroupInput | string, description?: string, ownerId?: string, ownerName?: string, parentId?: string) => {
    const groupInput: CreateGroupInput = typeof input === 'string'
      ? {
          name: input,
          description,
          ownerId: ownerId || '',
          ownerName: ownerName || 'User',
          parentId,
        }
      : input;

    const selectedMembers = groupInput.memberDetails || [];
    const selectedMemberIds = groupInput.memberIds || selectedMembers.map(member => member.id);
    const allMembers: GroupMember[] = [
      {
        id: `member-owner-${Date.now()}`,
        userId: groupInput.ownerId,
        name: groupInput.ownerName,
        role: 'owner',
        joinedAt: new Date().toISOString(),
      },
      ...selectedMembers.map((member, index) => ({
        id: `member-selected-${Date.now()}-${index}`,
        userId: member.id,
        name: member.name,
        avatarUrl: member.avatarUrl,
        role: 'member' as const,
        joinedAt: new Date().toISOString(),
      })),
    ];

    const newGroup: Group = {
      id: `group-${Date.now()}`,
      name: groupInput.name,
      description: groupInput.description,
      avatarUrl: groupInput.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(groupInput.name)}&background=191919&color=fff`,
      ownerId: groupInput.ownerId,
      parentId: groupInput.parentId, // Set parent if creating a subgroup
      courseId: groupInput.courseId ?? null,
      permissions: groupInput.permissions,
      members: allMembers,
      memberCount: allMembers.length,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    try {
      const pendingAvatarDataUrl =
        groupInput.avatarUrl && groupInput.avatarUrl.startsWith('data:')
          ? groupInput.avatarUrl
          : null;
      const createAvatarUrl =
        groupInput.avatarUrl && !groupInput.avatarUrl.startsWith('data:')
          ? groupInput.avatarUrl
          : undefined;

      const apiGroup = await transport.createGroup({
        name: groupInput.name,
        description: groupInput.description,
        avatar_url: createAvatarUrl,
        permissions: groupInput.permissions,
        invite_id: `invite-${Date.now()}`,
        parent_id: groupInput.parentId,
        userId: groupInput.ownerId,
        memberIds: selectedMemberIds,
        ...(groupInput.courseId ? { courseId: groupInput.courseId } : {}),
        ...(groupInput.visibility ? { visibility: groupInput.visibility } : {}),
        ...(groupInput.communityId !== undefined ? { communityId: groupInput.communityId } : {}),
        ...(groupInput.communitySurface ? { communitySurface: groupInput.communitySurface } : {}),
      });

      let persistedAvatarUrl = apiGroup.avatar_url || (apiGroup as any).avatarUrl || createAvatarUrl;
      if (pendingAvatarDataUrl) {
        try {
          const base64Data = pendingAvatarDataUrl.includes(',')
            ? pendingAvatarDataUrl.split(',')[1]!
            : pendingAvatarDataUrl;
          const mimeMatch = pendingAvatarDataUrl.match(/^data:([^;]+);/);
          const contentType = mimeMatch?.[1] || 'image/jpeg';
          const uploaded = await transport.uploadGroupAvatar(apiGroup.id, {
            fileName: contentType === 'image/png' ? 'avatar.png' : 'avatar.jpg',
            base64Data,
            contentType,
          });
          persistedAvatarUrl = uploaded.avatarUrl;
        } catch (avatarError) {
          console.warn('[GroupStore] Group created but avatar upload failed:', avatarError);
        }
      }

      // Creator is active immediately; invited members stay pending until they accept.
      const activeMembers = allMembers.filter((m) => m.userId === groupInput.ownerId);
      
      const createdGroup: Group = {
        ...mapApiGroup(apiGroup, {}),
        avatarUrl: persistedAvatarUrl || newGroup.avatarUrl,
        ownerId: groupInput.ownerId,
        parentId: (apiGroup as any).parent_id || (apiGroup as any).parentId || groupInput.parentId,
        courseId: apiGroup.course_id ?? apiGroup.courseId ?? groupInput.courseId ?? null,
        // The API echoes it only once the boards migration is applied; the
        // requested surface is the honest fallback, and the caller branches on
        // it to decide whether to land in Chat or on the board.
        communityId: groupInput.communityId ?? null,
        communitySurface:
          apiGroup.community_surface ?? apiGroup.communitySurface ?? groupInput.communitySurface ?? null,
        permissions: ((apiGroup as any).permissions as GroupPermissions | undefined) || groupInput.permissions,
        members: activeMembers,
        memberCount: activeMembers.length,
      };
      
      const groups = [...get().groups, createdGroup];
      set({ groups });
      await get().saveToStorage(); // Persist to storage
      return createdGroup;
    } catch (error: any) {
      // If API fails, still save locally so user can see their group
      const groups = [...get().groups, newGroup];
      set({ groups });
      await get().saveToStorage();
      console.warn('[GroupStore] API failed, saved group locally:', error);
      return newGroup;
    }
  },

  leaveGroup: async (groupId: string, userId: string) => {
    try {
      await transport.leaveGroup(groupId, userId);
      const groups = get().groups.filter(g => g.id !== groupId);
      set(state => ({
        groups,
        currentGroup: state.currentGroup?.id === groupId ? null : state.currentGroup,
        activeGroupId: state.activeGroupId === groupId ? null : state.activeGroupId,
        messages: state.activeGroupId === groupId ? [] : state.messages,
        error: null,
      }));
      await get().saveToStorage();
    } catch (error: any) {
      const message = error.message || 'Failed to leave group';
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  // Admin actions
  updateGroupDetails: async (
    groupId: string,
    name: string,
    description: string,
    discovery?: { visibility?: 'private' | 'community' | 'public'; communityId?: string | null }
  ) => {
    try {
      await transport.updateGroup(groupId, {
        name,
        description,
        ...(discovery?.visibility ? { visibility: discovery.visibility } : {}),
        ...(discovery && 'communityId' in discovery ? { communityId: discovery.communityId ?? null } : {}),
      });
      const groups = get().groups.map(g =>
        g.id === groupId
          ? {
              ...g,
              name,
              description,
              updatedAt: new Date().toISOString(),
              ...(discovery?.visibility ? { visibility: discovery.visibility } : {}),
              ...(discovery && 'communityId' in discovery ? { communityId: discovery.communityId ?? null } : {}),
            }
          : g
      );
      const currentGroup = get().currentGroup;
      set({ 
        groups,
        currentGroup: currentGroup?.id === groupId 
          ? {
              ...currentGroup,
              name,
              description,
              updatedAt: new Date().toISOString(),
              ...(discovery?.visibility ? { visibility: discovery.visibility } : {}),
              ...(discovery && 'communityId' in discovery ? { communityId: discovery.communityId ?? null } : {}),
            }
          : currentGroup
      });
    } catch (error: any) {
      set({ error: error.message || 'Failed to update group' });
    }
  },

  promoteGroupAdmin: async (groupId: string, userId: string) => {
    const applyAdminUpdate = (adminIds: string[]) => {
      const groups = get().groups.map(g => {
        if (g.id !== groupId) return g;
        return {
          ...g,
          adminIds,
          members: g.members.map(m =>
            m.userId === userId ? { ...m, role: 'admin' as const } : m
          ),
        };
      });
      const currentGroup = get().currentGroup;
      set({
        groups,
        currentGroup: currentGroup?.id === groupId ? groups.find(g => g.id === groupId) || currentGroup : currentGroup,
      });
    };

    try {
      const result = await transport.promoteGroupAdmin(groupId, userId) as any;
      const adminIds = result?.adminIds || result?.admin_ids || [];
      applyAdminUpdate(adminIds.length ? adminIds : [...(get().groups.find(g => g.id === groupId)?.adminIds || []), userId]);
    } catch (error: any) {
      set({ error: error.message || 'Failed to promote admin' });
    }
  },

  demoteGroupAdmin: async (groupId: string, userId: string) => {
    const applyAdminUpdate = (adminIds: string[]) => {
      const groups = get().groups.map(g => {
        if (g.id !== groupId) return g;
        return {
          ...g,
          adminIds,
          members: g.members.map(m =>
            m.userId === userId ? { ...m, role: 'member' as const } : m
          ),
        };
      });
      const currentGroup = get().currentGroup;
      set({
        groups,
        currentGroup: currentGroup?.id === groupId ? groups.find(g => g.id === groupId) || currentGroup : currentGroup,
      });
    };

    try {
      const result = await transport.demoteGroupAdmin(groupId, userId) as any;
      const adminIds = result?.adminIds || result?.admin_ids
        || (get().groups.find(g => g.id === groupId)?.adminIds || []).filter(id => id !== userId);
      applyAdminUpdate(adminIds);
    } catch (error: any) {
      set({ error: error.message || 'Failed to demote admin' });
    }
  },

  promoteToAdmin: async (groupId: string, userId: string) => {
    return get().promoteGroupAdmin(groupId, userId);
  },

  demoteAdmin: async (groupId: string, userId: string) => {
    return get().demoteGroupAdmin(groupId, userId);
  },

  removeMember: async (groupId: string, userId: string) => {
    try {
      await transport.removeGroupMember(groupId, userId);
      const groups = get().groups.map(g => {
        if (g.id !== groupId) return g;
        const updatedMembers = g.members.filter(m => m.userId !== userId);
        return { ...g, members: updatedMembers, memberCount: updatedMembers.length };
      });
      const currentGroup = get().currentGroup;
      set({
        groups,
        currentGroup: currentGroup?.id === groupId
          ? groups.find(g => g.id === groupId) || currentGroup
          : currentGroup,
      });
    } catch (error: any) {
      set({ error: error.message || 'Failed to remove member' });
    }
  },

  /**
   * Re-send a message left in the outbox. The failed row is dropped first so the
   * new optimistic row takes its place; deliveryIntents still guards the case
   * where the original actually landed and only the response was lost.
   */
  retryFailedMessage: async (groupId: string, messageId: string, senderId: string) => {
    const failed = (get().messagesCache[groupId] || []).find(m => m.id === messageId);
    if (!failed || failed.deliveryState !== 'failed') return;
    set(state => ({
      messagesCache: {
        ...state.messagesCache,
        [groupId]: (state.messagesCache[groupId] || []).filter(m => m.id !== messageId),
      },
      messages:
        state.activeGroupId === groupId
          ? state.messages.filter(m => m.id !== messageId)
          : state.messages,
    }));
    await get().sendMessage(groupId, failed.text, senderId, undefined, {
      replyToMessageId: failed.replyToMessageId,
      mentionedUserIds: failed.mentionedUserIds,
      // The failed row is deleted above, so anything not forwarded here is
      // gone for good. A board post's title used to be dropped silently, and
      // `plainText` used to be re-asserted as false, so a JSON-shaped body
      // came back as a read-only question card on a board.
      subject: failed.subject ?? null,
      plainText: failed.type !== 'question',
    });
  },

  retryFailedDirectMessage: async (threadId: string, messageId: string, senderId: string) => {
    const list = get().directMessages[threadId] || [];
    const failed = list.find(m => m.id === messageId);
    if (!failed || failed.deliveryState !== 'failed') return;
    const thread = get().dmThreads.find(t => t.id === threadId);
    const recipientId = thread?.participantIds.find(id => id !== senderId);
    if (!recipientId) return;
    set(state => ({
      directMessages: {
        ...state.directMessages,
        [threadId]: (state.directMessages[threadId] || []).filter(m => m.id !== messageId),
      },
    }));
    await get().sendDirectMessageTo(senderId, recipientId, failed.text, threadId, {
      replyToMessageId: failed.replyToMessageId,
    });
  },

  archiveGroup: async (groupId: string) => {
    try {
      const group = get().groups.find(g => g.id === groupId);
      await transport.updateGroup(groupId, { isArchived: !group?.isArchived });
      const groups = get().groups.map(g =>
        g.id === groupId ? { ...g, isArchived: !g.isArchived } : g
      );
      // Keep the open group loaded so the chat screen can show its archived
      // state (and unarchive again) instead of losing its header.
      const current = get().currentGroup;
      set({
        groups,
        currentGroup:
          current?.id === groupId
            ? { ...current, isArchived: !current.isArchived }
            : current,
      });
    } catch (error: any) {
      set({ error: error.message || 'Failed to archive group' });
      throw error;
    }
  },

  deleteGroup: async (groupId: string) => {
    try {
      await transport.deleteGroup(groupId);
      const groups = get().groups.filter(g => g.id !== groupId && g.parentId !== groupId);
      set({ groups, currentGroup: null });
    } catch (error: any) {
      set({ error: error.message || 'Failed to delete group' });
    }
  },

  submitQuestion: async (groupId: string, question: any) => {
    const user = question.senderId ? { id: question.senderId, name: question.senderName || 'You' } : null;

    const payload = {
      type: 'QUESTION',
      groupId,
      questionStem: question.stem || question.questionStem,
      explanation: question.explanation,
      questionType: question.questionType,
      options: question.options,
      correctAnswerIds: question.correctAnswerIds,
      imageUrl: question.imageUrl,
      tags: question.tags,
      // AI-authored difficulty (easy|medium|hard) travels with the question so
      // learning analytics can use it; undefined for hand-written questions.
      authored_difficulty: question.authoredDifficulty,
      questionStatus: 'PENDING',
      acceptableAnswers: question.acceptableAnswers,
      matchingPromptItems: question.matchingPromptItems,
      matchingAnswerItems: question.matchingAnswerItems,
      correctMatches: question.correctMatches,
      diagramLabels: question.diagramLabels,
    };

    const senderId = user?.id || question.senderId;
    const senderName = user?.name || question.senderName || 'You';
    if (!senderId) throw new Error('Missing sender for question submission');

    await get().sendMessage(groupId, JSON.stringify(payload), senderId, senderName);
  },

  // Subgroup helper functions
  getSubgroups: (parentId: string) => {
    return get().groups.filter(g => g.parentId === parentId && !g.isArchived);
  },

  getSubgroupsWithLevel: (parentId: string) => {
    const walk = (pid: string, level = 0): Array<{ group: Group; level: number }> => {
      const direct = get().groups.filter(g => g.parentId === pid && !g.isArchived);
      return direct.flatMap(g => [{ group: g, level }, ...walk(g.id, level + 1)]);
    };
    return walk(parentId);
  },

  getMessagesForGroups: async (groupIds: string[]) => {
    const uniqueIds = [...new Set(groupIds.filter(Boolean))];
    const allMessages: Message[] = [];
    const seen = new Set<string>();

    for (const gid of uniqueIds) {
      touchMessagesCache(gid);
      let cached = get().messagesCache[gid];
      if (!cached?.length) {
        try {
          const result = await transport.fetchMessages(gid, { page: 1, limit: 500 });
          const apiMessages = Array.isArray(result) ? result : (result as any)?.data || [];
          cached = apiMessages.map((m: any) => mapApiMessage(m, gid));
          set(state => ({
            messagesCache: { ...state.messagesCache, [gid]: cached! },
          }));
        } catch (error) {
          console.warn(`Failed to fetch messages for group ${gid}:`, error);
          cached = [];
        }
      }

      for (const msg of cached || []) {
        if (!seen.has(msg.id)) {
          seen.add(msg.id);
          allMessages.push(msg);
        }
      }
    }

    return allMessages;
  },

  getParentGroup: (groupId: string) => {
    const group = get().groups.find(g => g.id === groupId);
    if (!group?.parentId) return null;
    return get().groups.find(g => g.id === group.parentId) || null;
  },

  getBreadcrumbs: (groupId: string) => {
    const breadcrumbs: Group[] = [];
    let currentGroup = get().groups.find(g => g.id === groupId);
    
    while (currentGroup) {
      breadcrumbs.unshift(currentGroup);
      if (currentGroup.parentId) {
        currentGroup = get().groups.find(g => g.id === currentGroup!.parentId);
      } else {
        break;
      }
    }
    
    return breadcrumbs;
  },

  getTopLevelGroups: () => {
    return get().groups.filter(g => !g.parentId && !g.isArchived);
  },

  getActiveDmThreads: () => {
    return get().dmThreads.filter(t => !t.isArchived);
  },

  setActiveDmThreadId: (threadId) => {
    touchMessagesCache(threadId);
    set({ activeDmThreadId: threadId });
  },

  fetchDmThreads: async (userId: string) => {
    try {
      const [threads, unreadCounts] = await Promise.all([
        transport.fetchDMThreads(userId),
        transport.fetchDMUnreadCounts(userId).catch(() => ({} as Record<string, number>)),
      ]);
      const mapped = (Array.isArray(threads) ? threads : []).map((t) =>
        mapDmThread(t, unreadCounts)
      );
      set((state) => {
        const nextCutoffs = { ...state.dmHistoryClearedAtByThread };
        for (const thread of mapped) {
          if (thread.historyClearedAt) {
            nextCutoffs[thread.id] = thread.historyClearedAt;
          }
        }
        const nextDirectMessages = { ...state.directMessages };
        for (const [threadId, messages] of Object.entries(nextDirectMessages)) {
          const cutoff = resolveDmHistoryClearedAt(threadId, mapped, nextCutoffs);
          if (cutoff) {
            nextDirectMessages[threadId] = filterMessagesAfterDmHistoryCutoff(messages, cutoff);
          }
        }
        return {
          // Server-authoritative merge keeps optimistic locals; never blank the inbox
          // when the network returns a transient empty/error (errors are caught below).
          dmThreads: mergeDmThreadLists(state.dmThreads, mapped, 'server'),
          dmHistoryClearedAtByThread: nextCutoffs,
          directMessages: nextDirectMessages,
          dmUnreadCounts: unreadCounts,
        };
      });
    } catch (error) {
      console.warn('[GroupStore] Failed to fetch DM threads:', error);
      set({
        listError:
          error instanceof Error ? error.message : 'Could not load your conversations.',
      });
    }
  },

  fetchDMUnreadCounts: async (userId: string) => {
    try {
      const counts = await transport.fetchDMUnreadCounts(userId);
      set(state => ({
        dmUnreadCounts: counts,
        dmThreads: state.dmThreads.map(t => ({ ...t, unreadCount: counts[t.id] || 0 })),
      }));
    } catch (error) {
      console.warn('[GroupStore] Failed to fetch DM unread counts:', error);
    }
  },

  fetchDirectMessagesForThread: async (userId: string, otherUserId: string, threadId: string) => {
    const requestId = (dmFetchSeqByThread[threadId] = (dmFetchSeqByThread[threadId] || 0) + 1);
    try {
      const result = await transport.fetchDirectMessages(userId, otherUserId);
      if (requestId !== dmFetchSeqByThread[threadId]) return true;
      const apiMessages = Array.isArray(result) ? result : (result as any)?.data || [];
      const mapped: DirectMessage[] = apiMessages.map((m: any) => mapDirectMessage(m, threadId));
      set(state => {
        const historyClearedAt = resolveDmHistoryClearedAt(
          threadId,
          state.dmThreads,
          state.dmHistoryClearedAtByThread,
        );
        const existing = filterMessagesAfterDmHistoryCutoff(
          state.directMessages[threadId] || [],
          historyClearedAt,
        );
        const incoming = filterMessagesAfterDmHistoryCutoff(mapped, historyClearedAt);
        // Empty fetch must not wipe last-known / optimistic messages — unless this
        // user deleted the chat (cutoff set), in which case empty is authoritative.
        if (!incoming.length && existing.length && !historyClearedAt) {
          return state;
        }
        // Server-authoritative, same rule as the group refresh above: the fetch
        // is the whole (post-cutoff) history, so a cached row the server no
        // longer returns was deleted and must not be resurrected — while
        // pending/failed outbox rows and anything newer than the newest server
        // row (a realtime insert that landed mid-fetch) are kept.
        const merged = filterMessagesAfterDmHistoryCutoff(
          mergeServerRefresh<DirectMessage>(incoming, existing),
          historyClearedAt,
        );
        return {
          directMessages: { ...state.directMessages, [threadId]: merged },
        };
      });
      return true;
    } catch (error) {
      // A superseded request must not report failure — a newer one owns the outcome.
      if (requestId !== dmFetchSeqByThread[threadId]) return true;
      console.warn('[GroupStore] Failed to fetch direct messages:', error);
      return false;
    }
  },

  // The DM twin of `sendMessage`, with the same slot/intent/queue contract.
  // Two DM-only rules: sending CLEARS this thread's delete-for-me cutoff (the
  // conversation is alive again), and the thread preview is reverted on a
  // queued or failed send so the inbox never advertises a message that never
  // left.
  sendDirectMessageTo: async (
    senderId: string,
    recipientId: string,
    text: string,
    threadId: string,
    options?: { replyToMessageId?: string }
  ) => {
    const releaseDmSendSlot = await acquireSendSlot(sendChainByDmThread, threadId);
    const deliveryScope = `dm:${threadId}`;
    const deliveryFingerprint = JSON.stringify({
      text,
      replyToMessageId: options?.replyToMessageId || null,
    });
    const clientMessageId = deliveryIntents.resolve(
      deliveryScope,
      deliveryFingerprint,
      () => createOptimisticClientMessageId(() => Crypto.randomUUID())
    );
    const existing = get().directMessages[threadId] || [];
    const parent = options?.replyToMessageId
      ? existing.find((m) => m.id === options.replyToMessageId)
      : undefined;
    const threadRootId = parent
      ? resolveThreadRootId({ id: parent.id, threadRootId: parent.threadRootId })
      : undefined;
    const rootReplyCount = threadRootId
      ? (existing.find((m) => m.id === threadRootId)?.replyCount || 0) + 1
      : 0;

    const optimistic: DirectMessage = {
      id: clientMessageId,
      threadId,
      senderId,
      text,
      timestamp: new Date().toISOString(),
      replyToMessageId: options?.replyToMessageId,
      threadRootId,
      replyCount: 0,
      receiptStatus: 'sent',
      clientMessageId,
    };

    const withOptimistic = [...existing, optimistic];
    const updatedList = threadRootId
      ? withOptimistic.map((m) =>
          m.id === threadRootId ? { ...m, replyCount: rootReplyCount } : m
        )
      : withOptimistic;

    set(state => {
      const { [threadId]: _cleared, ...restCutoffs } = state.dmHistoryClearedAtByThread;
      return {
        directMessages: {
          ...state.directMessages,
          [threadId]: updatedList,
        },
        dmHistoryClearedAtByThread: restCutoffs,
        dmThreads: state.dmThreads.map(t =>
          t.id === threadId
            ? {
                ...t,
                lastMessage: chatMessagePreview(text, ''),
                lastMessageTimestamp: new Date().toISOString(),
                ...(t.clientPending ? { clientPending: true } : {}),
                historyClearedAt: null,
              }
            : t
        ),
      };
    });

    try {
      const sent = await transport.sendDirectMessage(senderId, recipientId, text, clientMessageId, {
        replyToMessageId: options?.replyToMessageId,
      });
      const confirmed = {
        ...mapDirectMessage(sent, threadId),
        clientMessageId:
          (sent as { clientMessageId?: string; client_message_id?: string }).clientMessageId
          || (sent as { client_message_id?: string }).client_message_id
          || clientMessageId,
      };
      set(state => ({
        directMessages: {
          ...state.directMessages,
          [threadId]: reconcileDeliveredItem(
            state.directMessages[threadId] || [],
            confirmed,
            [optimistic.id]
          ),
        },
      }));
      deliveryIntents.clear(deliveryScope, deliveryFingerprint, clientMessageId);
      // Refresh thread + messages so the first bubble survives empty open-fetch races.
      void get().fetchDmThreads(senderId).catch(() => undefined);
      void get().fetchDirectMessagesForThread(senderId, recipientId, threadId).catch(() => undefined);
      return sentOutcome(confirmed);
    } catch (error) {
      if (isUncertainDeliveryError(error)) {
        deliveryIntents.markUncertain(deliveryScope, deliveryFingerprint, clientMessageId);
      } else {
        deliveryIntents.clear(deliveryScope, deliveryFingerprint, clientMessageId);
      }
      const dmQueueable = isQueueableSendError(error);
      if (dmQueueable) {
        void syncService
          .queueOperation('message', optimistic.id, 'create', {
            kind: 'dm',
            threadId,
            recipientId,
            text,
            clientMessageId,
            replyToMessageId: options?.replyToMessageId,
          }, senderId)
          .catch(() => undefined);
      }
      // Keep the bubble and mark it, so the message is recoverable rather than gone.
      // Also revert the chat-list preview, which previously kept advertising a
      // message that was never sent.
      set(state => {
        const marked = (state.directMessages[threadId] || []).map(m =>
          m.id === optimistic.id
            ? { ...m, deliveryState: (dmQueueable ? 'pending' : 'failed') as 'pending' | 'failed' }
            : m
        );
        const latest = lastDeliveredMessage(marked);
        return {
          directMessages: { ...state.directMessages, [threadId]: marked },
          dmThreads: state.dmThreads.map(t =>
            t.id === threadId
              ? {
                  ...t,
                  lastMessage: latest ? chatMessagePreview(latest.text, '') : undefined,
                  lastMessageTimestamp: latest?.timestamp,
                }
              : t
          ),
        };
      });
      if (dmQueueable) {
        const queued =
          (get().directMessages[threadId] || []).find((m) => m.id === optimistic.id)
          || { ...optimistic, deliveryState: 'pending' as const };
        return queuedOutcome(queued);
      }
      throw toSendError(error);
    } finally {
      releaseDmSendSlot();
    }
  },

  patchDirectMessageInState: (threadId, messageId, updates) => {
    set((state) => ({
      directMessages: {
        ...state.directMessages,
        [threadId]: (state.directMessages[threadId] || []).map((m) =>
          m.id === messageId ? { ...m, ...updates } : m
        ),
      },
    }));
  },

  editDirectMessage: async (threadId: string, messageId: string, content: string) => {
    const payload = await transport.editDirectMessage(messageId, content);
    const incoming = mapDirectMessage(payload, threadId);
    set((state) => {
      const updated = applyDirectMessageMutation(
        state.directMessages[threadId] || [],
        incoming
      );
      const latest = [...updated].reverse().find(
        (message) => !message.isRemoved && !message.removedAt
      );
      return {
        directMessages: { ...state.directMessages, [threadId]: updated },
        dmThreads: state.dmThreads.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                lastMessage: latest?.text,
                lastMessageTimestamp: latest?.timestamp,
              }
            : thread
        ),
      };
    });
  },

  removeDirectMessage: async (threadId: string, messageId: string) => {
    const payload = await transport.removeDirectMessage(messageId);
    const incoming = mapDirectMessage(payload, threadId);
    set((state) => {
      const updated = applyDirectMessageMutation(
        state.directMessages[threadId] || [],
        incoming
      );
      const latest = [...updated].reverse().find(
        (message) => !message.isRemoved && !message.removedAt
      );
      return {
        directMessages: { ...state.directMessages, [threadId]: updated },
        dmThreads: state.dmThreads.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                lastMessage: latest?.text,
                lastMessageTimestamp: latest?.timestamp,
              }
            : thread
        ),
      };
    });
  },

  markDMAsRead: async (threadId: string, userId: string) => {
    try {
      const result = await transport.markDMAsRead(threadId, userId);
      set(state => ({
        dmUnreadCounts: { ...state.dmUnreadCounts, [threadId]: 0 },
        dmThreads: state.dmThreads.map(t => t.id === threadId ? { ...t, unreadCount: 0 } : t),
      }));
      return result?.previousLastReadAt ?? null;
    } catch (error) {
      console.warn('[GroupStore] Failed to mark DM as read:', error);
      return null;
    }
  },

  archiveDmThread: async (threadId: string, userId: string) => {
    set(state => ({
      dmThreads: state.dmThreads.map(t => t.id === threadId ? { ...t, isArchived: true } : t),
    }));
    try {
      await transport.archiveDmThread(threadId, userId);
    } catch (error) {
      console.warn('[GroupStore] Failed to archive DM thread:', error);
      // Rethrow so the screen can surface it and refetch; swallowing left
      // the optimistic state in place with no feedback.
      throw error;
    }
  },

  unarchiveDmThread: async (threadId: string, userId: string) => {
    set(state => ({
      dmThreads: state.dmThreads.map(t => t.id === threadId ? { ...t, isArchived: false } : t),
    }));
    try {
      await transport.unarchiveDmThread(threadId, userId);
    } catch (error) {
      console.warn('[GroupStore] Failed to unarchive DM thread:', error);
      // Rethrow so the screen can surface it and refetch; swallowing left
      // the optimistic state in place with no feedback.
      throw error;
    }
  },

  deleteDmThread: async (threadId: string, userId: string) => {
    const clearedAt = new Date().toISOString();
    set((state) => ({
      dmHistoryClearedAtByThread: {
        ...state.dmHistoryClearedAtByThread,
        [threadId]: clearedAt,
      },
    }));
    get().removeDmThread(threadId);
    try {
      await transport.deleteDmThread(threadId, userId);
    } catch (error) {
      console.warn('[GroupStore] Failed to delete DM thread:', error);
      // Rethrow so the screen can surface it and refetch; swallowing left
      // the optimistic state in place with no feedback.
      throw error;
    }
  },

  removeDmThread: (threadId: string) => {
    set(state => {
      const { [threadId]: _msgs, ...directMessages } = state.directMessages;
      const { [threadId]: _unread, ...dmUnreadCounts } = state.dmUnreadCounts;
      return {
        dmThreads: state.dmThreads.filter(t => t.id !== threadId),
        directMessages,
        dmUnreadCounts,
      };
    });
  },

  addDirectMessage: (threadId: string, message: DirectMessage) => {
    set(state => {
      const historyClearedAt = resolveDmHistoryClearedAt(
        threadId,
        state.dmThreads,
        state.dmHistoryClearedAtByThread,
      );
      if (
        filterMessagesAfterDmHistoryCutoff([message], historyClearedAt).length === 0
      ) {
        return state;
      }
      const existing = filterMessagesAfterDmHistoryCutoff(
        state.directMessages[threadId] || [],
        historyClearedAt,
      );
      if (existing.some(m => m.id === message.id)) return state;
      return {
        directMessages: { ...state.directMessages, [threadId]: [...existing, message] },
        dmThreads: state.dmThreads.map(t =>
          t.id === threadId
            ? {
                ...t,
                lastMessage: message.text,
                lastMessageTimestamp: message.timestamp,
                unreadCount: (t.unreadCount || 0) + 1,
              }
            : t
        ),
      };
    });
  },

  mergeDirectMessage: (threadId: string, rawMessage: unknown) => {
    const incoming = mapDirectMessage(rawMessage, threadId);
    const clientMessageId =
      incoming.clientMessageId ||
      (rawMessage as { client_message_id?: string; clientMessageId?: string }).client_message_id ||
      (rawMessage as { clientMessageId?: string }).clientMessageId;
    set((state) => {
      const existing = state.directMessages[threadId] || [];
      let idx = existing.findIndex((message) => message.id === incoming.id);
      if (idx === -1 && clientMessageId) {
        idx = existing.findIndex((message) => message.id === clientMessageId);
      }
      if (idx === -1) return state;
      const updated = [...existing];
      const prev = updated[idx];
      updated[idx] = {
        ...prev,
        ...incoming,
        id: incoming.id,
        replyCount: incoming.replyCount ?? prev.replyCount,
        replyTo: incoming.replyTo ?? prev.replyTo,
      };
      const normalized =
        clientMessageId && clientMessageId !== incoming.id
          ? updated.map((message) =>
              message.replyTo?.id === clientMessageId
                ? { ...message, replyTo: { ...message.replyTo, id: incoming.id } }
                : message
            )
          : updated;
      const latest = [...normalized].reverse().find(
        (message) => !message.isRemoved && !message.removedAt
      );
      return {
        directMessages: { ...state.directMessages, [threadId]: normalized },
        dmThreads: state.dmThreads.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                lastMessage: latest?.text,
                lastMessageTimestamp: latest?.timestamp,
              }
            : thread
        ),
      };
    });
  },

  // Realtime INSERT. Ignores a row already in the cache and strips the
  // optimistic twin (same sender, same text, within a minute) so the viewer's
  // own message does not appear twice when the broadcast beats the response.
  appendGroupMessage: (groupId: string, rawMessage: unknown) => {
    const roster = get().groups.find(g => g.id === groupId)?.members;
    const message = mapApiMessage(rawMessage, groupId, roster);
    set(state => {
      const cached = state.messagesCache[groupId] || [];
      if (cached.some(m => m.id === message.id)) return state;
      const withoutOptimisticDup = stripOptimisticDuplicates(cached, message);
      const updated = [...withoutOptimisticDup, message];
      return {
        messagesCache: { ...state.messagesCache, [groupId]: updated },
        messages: state.activeGroupId === groupId ? updated : state.messages,
      };
    });
  },

  // Realtime UPDATE. Patches a row already held — matched by id, or by
  // `clientMessageId` when the update is the server's version of a still
  // optimistic row — and does nothing when the row is unknown.
  //
  // A realtime payload is PARTIAL: question fields and a concrete author label
  // are kept from the previous copy when the incoming row carries none, so an
  // edit broadcast cannot blank a question's options or reduce its author to
  // "Member". Reply previews pointing at this message are refreshed at the
  // same time.
  mergeGroupMessage: (groupId: string, rawMessage: unknown) => {
    const roster = get().groups.find(g => g.id === groupId)?.members;
    const message = mapApiMessage(rawMessage, groupId, roster);
    const clientMessageId =
      (rawMessage as { client_message_id?: string; clientMessageId?: string }).client_message_id
      || (rawMessage as { clientMessageId?: string }).clientMessageId;
    set(state => {
      const withUpdatedPreviews = mergeGroupMessageIntoList(
        state.messagesCache[groupId] || [],
        message,
        clientMessageId
      );
      // Unknown row: a realtime UPDATE for a message this process never loaded
      // is not new content, so nothing changes.
      if (!withUpdatedPreviews) return state;
      const latest = [...withUpdatedPreviews].reverse().find(
        (item) => !item.isRemoved && !item.removedAt && !item.isArchived
      );
      return {
        messagesCache: { ...state.messagesCache, [groupId]: withUpdatedPreviews },
        messages: state.activeGroupId === groupId ? withUpdatedPreviews : state.messages,
        groups: state.groups.map((group) =>
          group.id === groupId ? { ...group, lastMessage: latest } : group
        ),
      };
    });
  },

  fetchThread: async (rootId, context) => {
    if ('groupId' in context) {
      const raw = await transport.fetchGroupThread(context.groupId, rootId);
      const roster = get().groups.find(g => g.id === context.groupId)?.members;
      const apiMessages = Array.isArray(raw) ? raw : [];
      return apiMessages.map((m: any) => mapApiMessage(m, context.groupId, roster));
    }
    const raw = await transport.fetchDmThread(context.threadId, rootId);
    const apiMessages = Array.isArray(raw) ? raw : [];
    return apiMessages.map((m: any) => mapDirectMessage(m, context.threadId));
  },

  // Someone else read a chat: advance the read receipts on the viewer's OWN
  // messages only. A DM flips to 'read' on the timestamp comparison; a group
  // counts seen-by up to `seenByTotal` (members minus the viewer) and only
  // reads as 'read' once everyone has. Messages older than `lastReadAt` are
  // untouched, and a peer event for the viewer's own id is ignored.
  applyPeerChatRead: ({ chatId, userId, lastReadAt }) => {
    const currentUserId = useAuthStore.getState().user?.id;
    if (!currentUserId || !userId || !lastReadAt || userId === currentUserId) return;

    const isDmThread = Boolean(get().directMessages[chatId]?.length)
      || get().dmThreads.some(t => t.id === chatId);

    if (isDmThread) {
      set(state => {
        const list = state.directMessages[chatId] || [];
        if (!list.length) return state;
        return {
          directMessages: {
            ...state.directMessages,
            [chatId]: list.map(m => {
              if (m.senderId !== currentUserId) return m;
              return {
                ...m,
                receiptStatus: computeDmReceiptStatus(m.timestamp, lastReadAt),
              };
            }),
          },
        };
      });
      return;
    }

    set(state => {
      const list = state.messagesCache[chatId] || [];
      if (!list.length) return state;
      const group = state.groups.find(g => g.id === chatId);
      const defaultTotal = Math.max(0, (group?.members?.length || group?.memberCount || 1) - 1);
      const updated = list.map(m => {
        if (m.senderId !== currentUserId) return m;
        const msgMs = new Date(m.createdAt).getTime();
        const readMs = new Date(lastReadAt).getTime();
        if (!Number.isFinite(msgMs) || !Number.isFinite(readMs) || readMs < msgMs) {
          return m;
        }
        const total = typeof m.seenByTotal === 'number' ? m.seenByTotal : defaultTotal;
        const prevCount = m.seenByCount || 0;
        const seenByCount =
          m.receiptStatus === 'read'
            ? total
            : Math.max(prevCount, Math.min(total, prevCount + 1));
        const receiptStatus: 'sent' | 'read' =
          seenByCount >= total && total > 0 ? 'read' : 'sent';
        return {
          ...m,
          seenByCount,
          seenByTotal: total,
          receiptStatus,
        };
      });
      return {
        messagesCache: { ...state.messagesCache, [chatId]: updated },
        messages: state.activeGroupId === chatId ? updated : state.messages,
      };
    });
  },

  patchMessageInState: (messageId: string, updates: Partial<Message>) => {
    const apply = (msgs: Message[]) =>
      msgs.map((m) => (m.id === messageId ? { ...m, ...updates } : m));
    set((state) => ({
      messages: apply(state.messages),
      messagesCache: Object.fromEntries(
        Object.entries(state.messagesCache).map(([key, list]) => [key, apply(list)])
      ),
    }));
  },

  flagMessageAsSimilar: async (messageId: string, groupId: string, userId: string) => {
    const groupMessages = get().messagesCache[groupId] || get().messages;
    const message = groupMessages.find(m => m.id === messageId);
    if (!message) return;

    const group = get().groups.find(g => g.id === groupId);
    const currentFlags = message.flaggedAsSimilarUserIds || [];
    const userHasFlagged = currentFlags.includes(userId);
    const newFlags = userHasFlagged
      ? currentFlags.filter(id => id !== userId)
      : [...currentFlags, userId];

    const updateMessagesInState = (msgs: Message[]) =>
      msgs.map(m => {
        if (m.id !== messageId) return m;
        const updated = { ...m, flaggedAsSimilarUserIds: newFlags };
        const archiveThreshold = group ? Math.ceil(group.memberCount * 0.05) : 1;
        if (newFlags.length >= archiveThreshold) {
          updated.isArchived = true;
        }
        return updated;
      });

    set(state => ({
      messages: updateMessagesInState(state.messages),
      messagesCache: {
        ...state.messagesCache,
        [groupId]: updateMessagesInState(state.messagesCache[groupId] || state.messages),
      },
    }));

    try {
      await transport.updateMessage(messageId, { flagged_as_similar_user_ids: newFlags });
    } catch (error) {
      console.warn('[GroupStore] Failed to flag message:', error);
    }
  },

  fetchUserVotesForGroup: async (groupId: string, userId: string) => {
    try {
      const votes = await transport.fetchUserVotesForGroup(groupId, userId);
      set({ userVotes: { ...get().userVotes, ...votes } });
    } catch (error) {
      console.warn('[GroupStore] Failed to fetch user votes:', error);
    }
  },

  // Vote, or un-vote when the same direction is tapped again.
  //
  // Server-first, unlike the other mutations here: nothing is written to state
  // until the call returns, and the server's own counts are preferred over the
  // locally adjusted ones. A question's VERIFIED status is likewise the
  // server's if it reports one; the local `resolveQuestionStatusAfterVote` is
  // only the fallback for API builds that do not.
  voteOnMessage: async (groupId: string, messageId: string, userId: string, voteType: 'up' | 'down') => {
    const groupMessages = get().messagesCache[groupId] || get().messages;
    const message = groupMessages.find(m => m.id === messageId);
    if (!message) return;

    const currentVote = get().userVotes[messageId];
    let newUpvotes = message.upvotes ?? 0;
    let newDownvotes = message.downvotes ?? 0;
    let newUserVote: 'up' | 'down' | undefined;
    let newQuestionStatus = message.questionStatus;

    let serverQuestionStatus: string | undefined;
    try {
      if (currentVote === voteType) {
        const removeResult = await transport.removeVote(messageId, userId) as any;
        if (removeResult?.upvotes !== undefined) {
          newUpvotes = removeResult.upvotes;
          newDownvotes = removeResult.downvotes;
        } else if (voteType === 'up') {
          newUpvotes--;
        } else {
          newDownvotes--;
        }
        serverQuestionStatus = removeResult?.questionStatus;
        newUserVote = undefined;
      } else {
        const result = await transport.voteOnMessage(messageId, userId, voteType) as any;
        if (result?.upvotes !== undefined) {
          newUpvotes = result.upvotes;
          newDownvotes = result.downvotes;
        } else {
          if (currentVote === 'up') newUpvotes--;
          if (currentVote === 'down') newDownvotes--;
          if (voteType === 'up') newUpvotes++;
          else newDownvotes++;
        }
        serverQuestionStatus = result?.questionStatus;
        newUserVote = voteType;
      }
    } catch (error) {
      console.warn('[GroupStore] Failed to vote:', error);
      return;
    }

    if (message.type === 'question') {
      const group = get().groups.find(g => g.id === groupId);
      const memberCount = group?.memberCount || group?.members?.length || 0;
      // Server persists verification on vote for any member; prefer that status.
      const resolvedStatus =
        serverQuestionStatus ||
        resolveQuestionStatusAfterVote({
          upvotes: newUpvotes,
          downvotes: newDownvotes,
          memberCount,
        });
      if (resolvedStatus !== newQuestionStatus) {
        newQuestionStatus = resolvedStatus;
        if (!serverQuestionStatus) {
          try {
            await transport.updateQuestionStatus(messageId, resolvedStatus);
          } catch (error) {
            console.warn('[GroupStore] Failed to update question status:', error);
          }
        }
      }
    }

    const updateMessagesInState = (msgs: Message[]) =>
      msgs.map(m =>
        m.id === messageId
          ? {
              ...m,
              upvotes: newUpvotes,
              downvotes: newDownvotes,
              questionStatus: newQuestionStatus,
            }
          : m
      );

    set(state => ({
      messages: updateMessagesInState(state.messages),
      messagesCache: {
        ...state.messagesCache,
        [groupId]: updateMessagesInState(state.messagesCache[groupId] || state.messages),
      },
      userVotes: { ...state.userVotes, [messageId]: newUserVote },
    }));
  },
}));

/**
 * Outbox. Chat was the only major feature that never touched the sync queue, so
 * an offline send simply failed. Registered here rather than inside syncService
 * because that module must not import stores (groupStore -> syncService cycle).
 */
syncService.registerHandler('message', async (op: { entityId: string; userId: string; data: Record<string, unknown> }) => {
  const data = op.data as {
    kind: 'group' | 'dm';
    groupId?: string;
    threadId?: string;
    recipientId?: string;
    text: string;
    clientMessageId: string;
    replyToMessageId?: string;
    mentionedUserIds?: string[];
    subject?: string | null;
    imageUrl?: string | null;
    postKind?: string | null;
  };
  try {
    if (data.kind === 'group' && data.groupId) {
      const payload = await transport.sendGroupMessage(data.groupId, op.userId, {
        content: data.text,
        clientMessageId: data.clientMessageId,
        replyToMessageId: data.replyToMessageId,
        mentionedUserIds: data.mentionedUserIds,
        ...(data.subject ? { subject: data.subject } : {}),
        ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
        // A queued announcement flushes as an announcement. The value is
        // re-validated against the shared vocabulary because it has been
        // through AsyncStorage since it was chosen.
        ...(isBoardPostKind(data.postKind) ? { postKind: data.postKind } : {}),
      });
      const server = mapApiMessage(payload, data.groupId);
      useGroupStore.setState((state) => ({
        messagesCache: {
          ...state.messagesCache,
          [data.groupId!]: replaceOptimisticWithServer(
            state.messagesCache[data.groupId!] || [],
            op.entityId,
            server
          ),
        },
        messages:
          state.activeGroupId === data.groupId
            ? replaceOptimisticWithServer(state.messages, op.entityId, server)
            : state.messages,
        // The optimistic send reverted the list preview when it was queued
        // (a pending row is not delivered), so nothing put the flushed message
        // back on the Chat list — it kept previewing the previous message until
        // the next cold fetch. Advance it here, now that the server has it.
        groups: state.groups.map((group) =>
          group.id === data.groupId
            ? { ...group, lastMessage: server, updatedAt: server.createdAt }
            : group
        ),
      }));
    } else if (data.kind === 'dm' && data.threadId && data.recipientId) {
      const sent = await transport.sendDirectMessage(
        op.userId,
        data.recipientId,
        data.text,
        data.clientMessageId,
        { replyToMessageId: data.replyToMessageId }
      );
      const confirmed = mapDirectMessage(sent, data.threadId);
      useGroupStore.setState((state) => ({
        directMessages: {
          ...state.directMessages,
          [data.threadId!]: reconcileDeliveredItem(
            state.directMessages[data.threadId!] || [],
            { ...confirmed, clientMessageId: data.clientMessageId },
            [op.entityId]
          ),
        },
        // Same reason as the group case: the queued send reverted the inbox
        // preview, so the flush has to advance it.
        dmThreads: state.dmThreads.map((t) =>
          t.id === data.threadId
            ? {
                ...t,
                lastMessage: chatMessagePreview(confirmed.text, ''),
                lastMessageTimestamp: confirmed.timestamp,
              }
            : t
        ),
      }));
    }
    void useGroupStore.getState().saveToStorage();
    return true;
  } catch (error) {
    // Permanent rejections must not retry forever — mark the row and drop the op.
    if (!isQueueableSendError(error)) {
      useGroupStore.setState((state) => {
        const markFailed = <T extends { id: string }>(list: T[]) =>
          list.map((m) =>
            m.id === op.entityId ? { ...m, deliveryState: 'failed' as const } : m
          );
        const gid = data.groupId;
        const tid = data.threadId;
        return {
          messagesCache: gid
            ? { ...state.messagesCache, [gid]: markFailed(state.messagesCache[gid] || []) }
            : state.messagesCache,
          directMessages: tid
            ? { ...state.directMessages, [tid]: markFailed(state.directMessages[tid] || []) }
            : state.directMessages,
        };
      });
      return true;
    }
    // Dead connection: rethrow so the queue halts the run without burning one
    // of this message's retries (a false return counts as a server rejection).
    if (isTransientSyncError(error)) throw error;
    console.warn('[SyncHandler:message] send failed, will retry:', error);
    return false;
  }
});

/**
 * FIXED (F8): every chat this account can see is dropped on sign-out.
 *
 * The group list, the bounded message cache, DM threads and their messages are
 * hydrated state, not storage — `signOut` clearing `lantern_groups` and
 * `lantern_messages` left all of it mounted, so the next account's chat list
 * rendered the previous student's groups and unread badges until the first
 * fetch landed. The recency map goes with it: it names conversations that are
 * no longer cached.
 */
registerUserScoped('groupStore', () => {
  clearMessagesCacheRecency();
  useGroupStore.setState({
    groups: [],
    currentGroup: null,
    activeGroupId: null,
    messages: [],
    messagesCache: {},
    messagePagination: {},
    dmThreads: [],
    activeDmThreadId: null,
    directMessages: {},
    dmHistoryClearedAtByThread: {},
    dmUnreadCounts: {},
    groupUnreadCounts: {},
    userVotes: {},
    isLoading: false,
    isLoadingMore: false,
    isLoadingMessages: false,
    error: null,
    listError: null,
  });
});
