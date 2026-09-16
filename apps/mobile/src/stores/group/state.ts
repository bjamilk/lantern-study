// ===========================================
// Lantern Study Mobile - Group store: state
// ===========================================
//
// Purpose: the zustand store itself — the group list, the per-group message
// cache, DM threads and their messages, unread counts, votes and the UI flags
// every chat surface on mobile reads. It composes the layers around it
// (`types`, `mapping`, `persistence`, `transport`, `outbox`) and owns the one
// thing they do not: what the state is, and when it changes.
//
// Main export: `useGroupStore`. The public surface every screen imports is
// `group/index.ts`, reached through the `stores/groupStore.ts` shim and pinned
// by `stores/groupStore.surface.test.ts`.
//
// It also wires the two module-scope registrations that must happen exactly
// once: the syncService `'message'` outbox handler (defined in `outbox.ts`)
// and the F8 `registerUserScoped('groupStore', ...)` sign-out sweep.
//
// Touches: every sibling layer, plus `authStore` for the viewer's identity,
// `userScopedState` for the sign-out sweep and expo-crypto for client ids.
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
import { registerUserScoped } from '../userScopedState';
import type { BoardPostKind } from '@lantern/shared/network';
import {
  chatMessagePreview,
  resolveQuestionStatusAfterVote,
  resolveThreadRootId,
  computeDmReceiptStatus,
  mergeChatMessagesById,
  mergeServerRefresh,
  mergeDmThreadLists,
  filterMessagesAfterDmHistoryCutoff,
  createOptimisticClientMessageId,
  isUncertainDeliveryError,
  reconcileDeliveredItem,
} from '@lantern/shared/utils';
import * as transport from './transport';
import { syncService } from '../../services/syncService';
import * as Crypto from 'expo-crypto';
import { useAuthStore } from '../authStore';
import {
  isQueueableSendError,
  queuedOutcome,
  sentOutcome,
  toSendError,
  type SendOutcome,
} from '../sendOutcome';
import { lastDeliveredMessage, previewFromServerAndCache } from '../chatListPreview';

import type {
  CreateGroupInput,
  DirectMessage,
  DMThread,
  Group,
  GroupMember,
  GroupPermissions,
  GroupState,
  Message,
} from './types';

const MESSAGES_PAGE_SIZE = 50;

const messagesFetchSeqByGroup: Record<string, number> = {};
const dmFetchSeqByThread: Record<string, number> = {};
// The per-conversation send slots, `acquireSendSlot` and the delivery-intent
// registry moved to `group/outbox.ts` (lane M2). They are shared with the DM
// send below, so they are imported back rather than duplicated — two
// registries would let one retry post twice.
import {
  acquireSendSlot,
  createSendMessage,
  deliveryIntents,
  registerMessageOutboxHandler,
  sendChainByDmThread,
} from './outbox';

// `mapApiMessage` is the ONE message mapper; the board store reaches it through
// the barrel. A second mapper is how the same row renders two different ways.
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
} from './mapping';

import {
  boundMessagesCache,
  clearMessagesCacheRecency,
  readChatBlobs,
  touchMessagesCache,
  writeChatBlobs,
} from './persistence';

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

  // The optimistic group/board send moved verbatim to `group/outbox.ts`
  // (lane M2), where it sits next to the outbox handler that flushes what it
  // queues. Its banner comment went with it.
  sendMessage: createSendMessage(set, get),

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

// The syncService('message') handler lives in `outbox.ts`; it is registered
// from here, because syncService must not import stores.
registerMessageOutboxHandler(useGroupStore);

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
