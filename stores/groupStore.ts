/**
 * Web Group Store
 * Manages groups, messages, and chat state
 * 
 * Note: This store provides a simplified interface for group management.
 * The actual API calls are made through the supabase service functions.
 * This store should be gradually integrated into App.tsx to replace useState hooks.
 */
import { create } from 'zustand';
import { Group, Message, DMThread, DirectMessage, AppNotification, User } from '../types';
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
  userVotes: {},
  notifications: [],
  groupUnreadCounts: {},
  dmUnreadCounts: {},
  isLoading: false,
  error: null,
  
  // State Management
  setGroups: (groups) => set({ groups }),
  
  updateGroups: (updater) => set((state) => ({
    groups: updater(state.groups),
  })),
  
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
  
  setDmThreads: (threads) => set({ dmThreads: threads }),
  
  updateDmThreads: (updater) => set((state) => ({
    dmThreads: updater(state.dmThreads),
  })),

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

  archiveDmThread: (threadId) => set((state) => ({
    dmThreads: state.dmThreads.map(t => t.id === threadId ? { ...t, isArchived: true } : t),
    selectedChat: state.selectedChat?.id === threadId ? null : state.selectedChat,
  })),

  unarchiveDmThread: (threadId) => set((state) => ({
    dmThreads: state.dmThreads.map(t => t.id === threadId ? { ...t, isArchived: false } : t),
  })),
  
  setDirectMessages: (threadId, messages) => set((state) => ({
    directMessages: { ...state.directMessages, [threadId]: messages },
  })),
  
  setAllDirectMessages: (messages) => set({ directMessages: messages }),
  
  updateDirectMessages: (updater) => set((state) => ({
    directMessages: updater(state.directMessages),
  })),
  
  addDirectMessage: (threadId, message) => set((state) => ({
    directMessages: {
      ...state.directMessages,
      [threadId]: [...(state.directMessages[threadId] || []), message],
    },
  })),
  
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
    userVotes: {},
    notifications: [],
    groupUnreadCounts: {},
    dmUnreadCounts: {},
    isLoading: false,
    error: null,
  }),
}));;
