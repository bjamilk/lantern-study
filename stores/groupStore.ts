/**
 * Web Group Store
 * Manages groups, messages, and chat state
 * 
 * Note: This store provides a simplified interface for group management.
 * The actual API calls are made through the supabase service functions.
 * This store should be gradually integrated into App.tsx to replace useState hooks.
 *
 * Exports: `useGroupStore` and the `ChatItem` type. State: `groups`,
 * `messages` (keyed by group id), `dmThreads`, `directMessages` (keyed by
 * thread id), `dmHistoryClearedAtByThread`, `selectedChat`, `userVotes`,
 * `notifications`, and the two unread-count maps. Actions are setters/updaters
 * for each of those, the chat-selection trio (`selectChat`, `selectGroup`,
 * `selectDmThread`), `markDmHistoryCleared` / `archiveDmThread` /
 * `unarchiveDmThread` / `removeDmThread`, and `reset`.
 *
 * Touches: nothing persistent — entirely in-memory, fed by the chat services
 * and realtime subscriptions in App.tsx / the chat hooks. It imports `supabase`
 * but makes no calls of its own.
 *
 * Gotchas:
 *  - Delete-for-me is enforced HERE, not by the server: every write path into
 *    `directMessages` (set / setAll / update / add) runs
 *    `filterMessagesAfterDmHistoryCutoff` against
 *    `dmHistoryClearedAtByThread[threadId]`. A new write path that skips that
 *    filter resurrects messages the user cleared.
 *  - `setGroups` / `updateGroups` / `setDmThreads` / `updateDmThreads` coerce a
 *    non-array to `[]` on purpose: a bad payload reaching a consumer that maps
 *    over it took the whole sidebar down with "k.map is not a function".
 *  - Nothing is persisted, but nothing is cleared automatically either —
 *    sign-out must call `reset()` or the previous account's threads stay on
 *    screen for the rest of the page's life.
 */
import { create } from 'zustand';
import { Group, Message, DMThread, DirectMessage, AppNotification, User } from '../types';
import { filterMessagesAfterDmHistoryCutoff } from '@lantern/shared/utils';
import { supabase } from '../services/supabase';

// Chat item can be a group or DM thread
export interface ChatItem {
  type: 'group' | 'dm';
  id: string;
  group?: Group;
  dmThread?: DMThread;
}

interface GroupState {
  // State
  groups: Group[];
  messages: Record<string, Message[]>;
  selectedChat: ChatItem | null;
  dmThreads: DMThread[];
  directMessages: Record<string, DirectMessage[]>;
  /** Local delete-for-me cutoffs keyed by thread id (survives inbox removal). */
  dmHistoryClearedAtByThread: Record<string, string>;
  userVotes: Record<string, 'up' | 'down' | undefined>;
  notifications: AppNotification[];
  groupUnreadCounts: Record<string, number>;
  dmUnreadCounts: Record<string, number>;
  isLoading: boolean;
  error: string | null;
  
  // Actions - State Management
  setGroups: (groups: Group[]) => void;
  updateGroups: (updater: (prev: Group[]) => Group[]) => void;
  addGroup: (group: Group) => void;
  updateGroupInState: (groupId: string, updates: Partial<Group>) => void;
  removeGroup: (groupId: string) => void;
  
  setMessages: (groupId: string, messages: Message[]) => void;
  setAllMessages: (messages: Record<string, Message[]>) => void;
  updateMessages: (updater: (prev: Record<string, Message[]>) => Record<string, Message[]>) => void;
  addMessage: (groupId: string, message: Message) => void;
  updateMessageInState: (messageId: string, updates: Partial<Message>) => void;
  
  setDmThreads: (threads: DMThread[]) => void;
  updateDmThreads: (updater: (prev: DMThread[]) => DMThread[]) => void;
  removeDmThread: (threadId: string) => void;
  markDmHistoryCleared: (threadId: string, clearedAtIso?: string) => void;
  archiveDmThread: (threadId: string) => void;
  unarchiveDmThread: (threadId: string) => void;
  setDirectMessages: (threadId: string, messages: DirectMessage[]) => void;
  setAllDirectMessages: (messages: Record<string, DirectMessage[]>) => void;
  updateDirectMessages: (updater: (prev: Record<string, DirectMessage[]>) => Record<string, DirectMessage[]>) => void;
  addDirectMessage: (threadId: string, message: DirectMessage) => void;
  
  setUserVotes: (votes: Record<string, 'up' | 'down' | undefined>) => void;
  updateUserVotes: (updater: (prev: Record<string, 'up' | 'down' | undefined>) => Record<string, 'up' | 'down' | undefined>) => void;
  setVote: (messageId: string, vote: 'up' | 'down' | undefined) => void;
  
  setNotifications: (notifications: AppNotification[]) => void;
  updateNotifications: (updater: (prev: AppNotification[]) => AppNotification[]) => void;
  addNotification: (notification: AppNotification) => void;
  markNotificationRead: (notificationId: string) => void;
  
  setUnreadCounts: (groupCounts: Record<string, number>, dmCounts: Record<string, number>) => void;
  
  // Actions - Chat Selection
  selectChat: (chat: ChatItem | null) => void;
  selectGroup: (group: Group) => void;
  selectDmThread: (thread: DMThread) => void;
  
  // Utility
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  reset: () => void;
}

export const useGroupStore = create<GroupState>()((set, get) => ({
  // Initial State
  groups: [],
  messages: {},
  selectedChat: null,
  dmThreads: [],
  directMessages: {},
  dmHistoryClearedAtByThread: {},
  userVotes: {},
  notifications: [],
  groupUnreadCounts: {},
  dmUnreadCounts: {},
  isLoading: false,
  error: null,
  
  // State Management
  // Coerced like setDmThreads/updateDmThreads below. Without it a non-array
  // reaching this store propagates to every consumer that maps over groups —
  // the sidebar crashed with "k.map is not a function", taking the whole chat
  // list down rather than showing one empty section.
  setGroups: (groups) => set({ groups: Array.isArray(groups) ? groups : [] }),

  updateGroups: (updater) => set((state) => {
    const prev = Array.isArray(state.groups) ? state.groups : [];
    const next = updater(prev);
    return { groups: Array.isArray(next) ? next : prev };
  }),
  
  addGroup: (group) => set((state) => ({
    groups: [...state.groups, group],
  })),
  
  updateGroupInState: (groupId, updates) => set((state) => ({
    groups: state.groups.map(g => g.id === groupId ? { ...g, ...updates } : g),
  })),
  
  removeGroup: (groupId) => set((state) => ({
    groups: state.groups.filter(g => g.id !== groupId),
    selectedChat: state.selectedChat?.id === groupId ? null : state.selectedChat,
  })),
  
  setMessages: (groupId, messages) => set((state) => ({
    messages: { ...state.messages, [groupId]: messages },
  })),
  
  setAllMessages: (messages) => set({ messages }),
  
  updateMessages: (updater) => set((state) => ({
    messages: updater(state.messages),
  })),
  
  addMessage: (groupId, message) => set((state) => ({
    messages: {
      ...state.messages,
      [groupId]: [...(state.messages[groupId] || []), message],
    },
  })),
  
  updateMessageInState: (messageId, updates) => set((state) => {
    const newMessages = { ...state.messages };
    for (const groupId in newMessages) {
      newMessages[groupId] = newMessages[groupId].map(m =>
        m.id === messageId ? { ...m, ...updates } : m
      );
    }
    return { messages: newMessages };
  }),
  
  setDmThreads: (threads) => set((state) => {
    const list = Array.isArray(threads) ? threads : [];
    const nextCutoffs = { ...state.dmHistoryClearedAtByThread };
    const nextDirectMessages = { ...state.directMessages };
    for (const thread of list) {
      if (thread.historyClearedAt) {
        nextCutoffs[thread.id] = thread.historyClearedAt;
      }
      const cutoff = nextCutoffs[thread.id] || thread.historyClearedAt || null;
      if (cutoff && nextDirectMessages[thread.id]) {
        nextDirectMessages[thread.id] = filterMessagesAfterDmHistoryCutoff(
          nextDirectMessages[thread.id],
          cutoff,
        );
      }
    }
    return {
      dmThreads: list,
      dmHistoryClearedAtByThread: nextCutoffs,
      directMessages: nextDirectMessages,
    };
  }),
  
  updateDmThreads: (updater) => set((state) => {
    const prev = Array.isArray(state.dmThreads) ? state.dmThreads : [];
    const next = updater(prev);
    const list = Array.isArray(next) ? next : prev;
    const nextCutoffs = { ...state.dmHistoryClearedAtByThread };
    const nextDirectMessages = { ...state.directMessages };
    for (const thread of list) {
      if (thread.historyClearedAt) {
        nextCutoffs[thread.id] = thread.historyClearedAt;
      }
      const cutoff = nextCutoffs[thread.id] || thread.historyClearedAt || null;
      if (cutoff && nextDirectMessages[thread.id]) {
        nextDirectMessages[thread.id] = filterMessagesAfterDmHistoryCutoff(
          nextDirectMessages[thread.id],
          cutoff,
        );
      }
    }
    return {
      dmThreads: list,
      dmHistoryClearedAtByThread: nextCutoffs,
      directMessages: nextDirectMessages,
    };
  }),

  removeDmThread: (threadId) => set((state) => {
    const { [threadId]: _, ...remainingMessages } = state.directMessages;
    const { [threadId]: __, ...remainingUnread } = state.dmUnreadCounts;
    return {
      dmThreads: state.dmThreads.filter(t => t.id !== threadId),
      directMessages: remainingMessages,
      dmUnreadCounts: remainingUnread,
      selectedChat: state.selectedChat?.id === threadId ? null : state.selectedChat,
    };
  }),

  markDmHistoryCleared: (threadId, clearedAtIso) => set((state) => ({
    dmHistoryClearedAtByThread: {
      ...state.dmHistoryClearedAtByThread,
      [threadId]: clearedAtIso || new Date().toISOString(),
    },
  })),

  archiveDmThread: (threadId) => set((state) => ({
    dmThreads: state.dmThreads.map(t => t.id === threadId ? { ...t, isArchived: true } : t),
    selectedChat: state.selectedChat?.id === threadId ? null : state.selectedChat,
  })),

  unarchiveDmThread: (threadId) => set((state) => ({
    dmThreads: state.dmThreads.map(t => t.id === threadId ? { ...t, isArchived: false } : t),
  })),
  
  setDirectMessages: (threadId, messages) => set((state) => {
    const cutoff =
      state.dmHistoryClearedAtByThread[threadId] ||
      state.dmThreads.find((t) => t.id === threadId)?.historyClearedAt ||
      null;
    return {
      directMessages: {
        ...state.directMessages,
        [threadId]: filterMessagesAfterDmHistoryCutoff(messages, cutoff),
      },
    };
  }),
  
  setAllDirectMessages: (messages) => set((state) => {
    const next: Record<string, DirectMessage[]> = {};
    for (const [threadId, list] of Object.entries(messages || {})) {
      const cutoff =
        state.dmHistoryClearedAtByThread[threadId] ||
        state.dmThreads.find((t) => t.id === threadId)?.historyClearedAt ||
        null;
      next[threadId] = filterMessagesAfterDmHistoryCutoff(list, cutoff);
    }
    return { directMessages: next };
  }),
  
  updateDirectMessages: (updater) => set((state) => {
    const updated = updater(state.directMessages);
    const next: Record<string, DirectMessage[]> = {};
    for (const [threadId, list] of Object.entries(updated || {})) {
      const cutoff =
        state.dmHistoryClearedAtByThread[threadId] ||
        state.dmThreads.find((t) => t.id === threadId)?.historyClearedAt ||
        null;
      next[threadId] = filterMessagesAfterDmHistoryCutoff(list, cutoff);
    }
    return { directMessages: next };
  }),
  
  addDirectMessage: (threadId, message) => set((state) => {
    const cutoff =
      state.dmHistoryClearedAtByThread[threadId] ||
      state.dmThreads.find((t) => t.id === threadId)?.historyClearedAt ||
      null;
    if (filterMessagesAfterDmHistoryCutoff([message], cutoff).length === 0) {
      return state;
    }
    const existing = filterMessagesAfterDmHistoryCutoff(
      state.directMessages[threadId] || [],
      cutoff,
    );
    return {
      directMessages: {
        ...state.directMessages,
        [threadId]: [...existing, message],
      },
    };
  }),
  
  setUserVotes: (votes) => set({ userVotes: votes }),
  
  updateUserVotes: (updater) => set((state) => ({
    userVotes: updater(state.userVotes),
  })),
  
  setVote: (messageId, vote) => set((state) => ({
    userVotes: { ...state.userVotes, [messageId]: vote },
  })),
  
  setNotifications: (notifications) => set({ notifications }),
  
  updateNotifications: (updater) => set((state) => ({
    notifications: updater(state.notifications),
  })),
  
  addNotification: (notification) => set((state) => ({
    notifications: [notification, ...state.notifications],
  })),
  
  markNotificationRead: (notificationId) => set((state) => ({
    notifications: state.notifications.map(n =>
      n.id === notificationId ? { ...n, read: true } : n
    ),
  })),
  
  setUnreadCounts: (groupCounts, dmCounts) => set({
    groupUnreadCounts: groupCounts,
    dmUnreadCounts: dmCounts,
  }),
  
  // Chat Selection
  selectChat: (chat) => set({ selectedChat: chat }),
  
  selectGroup: (group) => set({ 
    selectedChat: { type: 'group', id: group.id, group } 
  }),
  
  selectDmThread: (thread) => set({ 
    selectedChat: { type: 'dm', id: thread.id, dmThread: thread } 
  }),
  
  // Utility
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  
  reset: () => set({
    groups: [],
    messages: {},
    selectedChat: null,
    dmThreads: [],
    directMessages: {},
    dmHistoryClearedAtByThread: {},
    userVotes: {},
    notifications: [],
    groupUnreadCounts: {},
    dmUnreadCounts: {},
    isLoading: false,
    error: null,
  }),
}));
