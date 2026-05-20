// ===========================================
// Lantern Study Mobile - Groups Store
// ===========================================

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../services/api';
import { syncService } from '../services/syncService';

// Demo mode - use mock data without API
const DEMO_MODE = false;

// Storage keys
const GROUPS_STORAGE_KEY = 'lantern_groups';
const MESSAGES_STORAGE_KEY = 'lantern_messages';

export interface GroupMember {
  id: string;
  userId: string;
  name: string;
  avatarUrl?: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  ownerId: string;
  parentId?: string; // ID of parent group if this is a subgroup
  members: GroupMember[];
  memberCount: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessage?: Message;
}

export interface Message {
  id: string;
  groupId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  text: string;
  type: 'text' | 'question' | 'system';
  createdAt: string;
  isArchived?: boolean;
}

interface GroupState {
  groups: Group[];
  currentGroup: Group | null;
  messages: Message[];
  messagesCache: Record<string, Message[]>; // Cache messages by groupId
  isLoading: boolean;
  error: string | null;
  
  // Actions
  loadFromStorage: () => Promise<void>;
  saveToStorage: () => Promise<void>;
  fetchGroups: (userId: string) => Promise<void>;
  selectGroup: (groupId: string) => void;
  fetchMessages: (groupId: string, options?: { page?: number; refresh?: boolean }) => Promise<void>;
  sendMessage: (groupId: string, text: string, senderId: string, senderName: string) => Promise<void>;
  createGroup: (name: string, description: string, ownerId: string, ownerName: string, parentId?: string) => Promise<Group>;
  leaveGroup: (groupId: string, userId: string) => Promise<void>;
  
  // Admin actions
  updateGroupDetails: (groupId: string, name: string, description: string, userId: string) => Promise<void>;
  promoteToAdmin: (groupId: string, userId: string) => Promise<void>;
  demoteAdmin: (groupId: string, userId: string) => Promise<void>;
  removeMember: (groupId: string, userId: string) => Promise<void>;
  archiveGroup: (groupId: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  inviteByEmail: (groupId: string, emails: string[]) => Promise<void>;
  submitQuestion: (groupId: string, question: any) => Promise<void>;
  
  // Subgroup helpers
  getSubgroups: (parentId: string) => Group[];
  getParentGroup: (groupId: string) => Group | null;
  getBreadcrumbs: (groupId: string) => Group[];
  getTopLevelGroups: () => Group[];
}

// Mock data
const mockMembers: GroupMember[] = [
  { id: '1', userId: 'demo-user', name: 'Demo User', role: 'owner', joinedAt: new Date().toISOString() },
  { id: '2', userId: '2', name: 'Alice Johnson', avatarUrl: 'https://ui-avatars.com/api/?name=Alice+Johnson&background=6366f1&color=fff', role: 'admin', joinedAt: new Date().toISOString() },
  { id: '3', userId: '3', name: 'Bob Smith', avatarUrl: 'https://ui-avatars.com/api/?name=Bob+Smith&background=10b981&color=fff', role: 'member', joinedAt: new Date().toISOString() },
  { id: '4', userId: '4', name: 'Carol Davis', avatarUrl: 'https://ui-avatars.com/api/?name=Carol+Davis&background=f97316&color=fff', role: 'member', joinedAt: new Date().toISOString() },
];

const mockGroups: Group[] = [
  {
    id: 'group-1',
    name: 'Biology 101 Study Group',
    description: 'Study group for intro biology course',
    avatarUrl: 'https://ui-avatars.com/api/?name=Biology+101&background=10b981&color=fff',
    ownerId: 'demo-user',
    members: mockMembers.slice(0, 3),
    memberCount: 3,
    isArchived: false,
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
    lastMessage: {
      id: 'msg-1',
      groupId: 'group-1',
      senderId: '2',
      senderName: 'Alice Johnson',
      text: 'Who wants to study chapter 5 together?',
      type: 'text',
      createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    }
  },
  // Subgroups of Biology 101
  {
    id: 'group-1-sub-1',
    name: 'Cell Biology',
    description: 'Focus on cell structures and functions',
    avatarUrl: 'https://ui-avatars.com/api/?name=Cell+Bio&background=34d399&color=fff',
    ownerId: 'demo-user',
    parentId: 'group-1', // Subgroup of Biology 101
    members: mockMembers.slice(0, 2),
    memberCount: 2,
    isArchived: false,
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'group-1-sub-2',
    name: 'Genetics',
    description: 'DNA, RNA, and heredity',
    avatarUrl: 'https://ui-avatars.com/api/?name=Genetics&background=22c55e&color=fff',
    ownerId: '2',
    parentId: 'group-1', // Subgroup of Biology 101
    members: mockMembers.slice(0, 3),
    memberCount: 3,
    isArchived: false,
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    lastMessage: {
      id: 'msg-sub-1',
      groupId: 'group-1-sub-2',
      senderId: '2',
      senderName: 'Alice Johnson',
      text: 'Let\'s review Punnett squares',
      type: 'text',
      createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    }
  },
  {
    id: 'group-2',
    name: 'Med School Prep',
    description: 'MCAT preparation and study sessions',
    avatarUrl: 'https://ui-avatars.com/api/?name=Med+School&background=6366f1&color=fff',
    ownerId: '2',
    members: mockMembers,
    memberCount: 4,
    isArchived: false,
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    lastMessage: {
      id: 'msg-2',
      groupId: 'group-2',
      senderId: '3',
      senderName: 'Bob Smith',
      text: 'Just finished the practice test! 🎉',
      type: 'text',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    }
  },
  // Subgroups of Med School Prep
  {
    id: 'group-2-sub-1',
    name: 'MCAT Biology',
    description: 'Biology section prep',
    avatarUrl: 'https://ui-avatars.com/api/?name=MCAT+Bio&background=818cf8&color=fff',
    ownerId: '2',
    parentId: 'group-2',
    members: mockMembers.slice(0, 3),
    memberCount: 3,
    isArchived: false,
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'group-2-sub-2',
    name: 'MCAT Chemistry',
    description: 'Chemistry section prep',
    avatarUrl: 'https://ui-avatars.com/api/?name=MCAT+Chem&background=a78bfa&color=fff',
    ownerId: '2',
    parentId: 'group-2',
    members: mockMembers,
    memberCount: 4,
    isArchived: false,
    createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'group-3',
    name: 'Chemistry Champions',
    description: 'Organic chemistry study group',
    avatarUrl: 'https://ui-avatars.com/api/?name=Chemistry&background=f97316&color=fff',
    ownerId: 'demo-user',
    members: mockMembers.slice(0, 2),
    memberCount: 2,
    isArchived: false,
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    lastMessage: {
      id: 'msg-3',
      groupId: 'group-3',
      senderId: 'demo-user',
      senderName: 'Demo User',
      text: 'Let\'s review the naming conventions',
      type: 'text',
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    }
  },
];

const mockMessages: Record<string, Message[]> = {
  'group-1': [
    { id: 'm1', groupId: 'group-1', senderId: '2', senderName: 'Alice Johnson', text: 'Hey everyone! Ready for the exam?', type: 'text', createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    { id: 'm2', groupId: 'group-1', senderId: '3', senderName: 'Bob Smith', text: 'Still reviewing chapter 4', type: 'text', createdAt: new Date(Date.now() - 90 * 60 * 1000).toISOString() },
    { id: 'm3', groupId: 'group-1', senderId: 'demo-user', senderName: 'Demo User', text: 'I can help with chapter 4!', type: 'text', createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    { id: 'm4', groupId: 'group-1', senderId: '2', senderName: 'Alice Johnson', text: 'Who wants to study chapter 5 together?', type: 'text', createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() },
  ],
  'group-2': [
    { id: 'm5', groupId: 'group-2', senderId: '4', senderName: 'Carol Davis', text: 'Just shared some new flashcards', type: 'text', createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() },
    { id: 'm6', groupId: 'group-2', senderId: 'demo-user', senderName: 'Demo User', text: 'Thanks! These look great', type: 'text', createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() },
    { id: 'm7', groupId: 'group-2', senderId: '3', senderName: 'Bob Smith', text: 'Just finished the practice test! 🎉', type: 'text', createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
  ],
  'group-3': [
    { id: 'm8', groupId: 'group-3', senderId: '2', senderName: 'Alice Johnson', text: 'Organic chem is tough!', type: 'text', createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() },
    { id: 'm9', groupId: 'group-3', senderId: 'demo-user', senderName: 'Demo User', text: 'Let\'s review the naming conventions', type: 'text', createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
  ],
};

export const useGroupStore = create<GroupState>((set, get) => ({
  groups: [],
  currentGroup: null,
  messages: [],
  messagesCache: {},
  isLoading: false,
  error: null,

  // Load cached data from AsyncStorage
  loadFromStorage: async () => {
    try {
      const [groupsJson, messagesJson] = await Promise.all([
        AsyncStorage.getItem(GROUPS_STORAGE_KEY),
        AsyncStorage.getItem(MESSAGES_STORAGE_KEY),
      ]);
      
      if (groupsJson) {
        set({ groups: JSON.parse(groupsJson) });
      }
      if (messagesJson) {
        set({ messagesCache: JSON.parse(messagesJson) });
      }
    } catch (error) {
      console.error('[GroupStore] Failed to load from storage:', error);
    }
  },

  // Save current state to AsyncStorage
  saveToStorage: async () => {
    try {
      const { groups, messagesCache } = get();
      await Promise.all([
        AsyncStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(groups)),
        AsyncStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(messagesCache)),
      ]);
    } catch (error) {
      console.error('[GroupStore] Failed to save to storage:', error);
    }
  },

  fetchGroups: async (userId: string) => {
    set({ isLoading: true, error: null });
    
    // Load from local storage first for instant UI
    await get().loadFromStorage();
    
    if (DEMO_MODE) {
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 500));
      set({ groups: mockGroups, isLoading: false });
      return;
    }
    
    try {
      const apiGroups = await api.fetchGroups(userId);
      // Map API response to store format
      const groups: Group[] = apiGroups.map((g: any) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        avatarUrl: g.avatar_url,
        ownerId: g.admin_ids?.[0] || '',
        parentId: g.parent_id,
        members: (g.members || []).map((m: any) => ({
          id: m.id,
          userId: m.user_id || m.id,
          name: m.name,
          avatarUrl: m.avatar_url,
          role: g.admin_ids?.includes(m.id) ? 'admin' : 'member',
          joinedAt: m.joined_at || new Date().toISOString(),
        })),
        memberCount: g.member_count || g.members?.length || 0,
        isArchived: g.is_archived || false,
        createdAt: g.created_at,
        updatedAt: g.updated_at,
      }));
      set({ groups, isLoading: false });
      await get().saveToStorage();
    } catch (error: any) {
      console.warn('[GroupStore] API fetch failed, using cached data:', error);
      set({ isLoading: false });
    }
  },

  selectGroup: (groupId: string) => {
    const group = get().groups.find(g => g.id === groupId) || null;
    set({ currentGroup: group });
  },

  fetchMessages: async (groupId: string) => {
    set({ isLoading: true });
    
    if (DEMO_MODE) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const messages = mockMessages[groupId] || [];
      set({ messages, isLoading: false });
      return;
    }
    
    try {
      const apiMessages = await api.fetchMessages(groupId);
      // Map API response to store format
      const messages: Message[] = apiMessages.map((m: any) => ({
        id: m.id,
        groupId: m.group_id || groupId,
        senderId: m.sender_id || m.sender?.id,
        senderName: m.sender?.name || 'Unknown',
        senderAvatar: m.sender?.avatar_url,
        text: m.content || m.text || '',
        type: m.type === 'QUESTION' ? 'question' : 'text',
        createdAt: m.created_at,
        isArchived: m.is_archived,
      }));
      set({ messages, isLoading: false });
    } catch (error: any) {
      set({ error: error.message || 'Failed to fetch messages', isLoading: false });
    }
  },

  sendMessage: async (groupId: string, text: string, senderId: string, senderName: string) => {
    const newMessage: Message = {
      id: `msg-${Date.now()}`,
      groupId,
      senderId,
      senderName,
      text,
      type: 'text',
      createdAt: new Date().toISOString(),
    };
    
    if (DEMO_MODE) {
      // Add message locally
      const currentMessages = get().messages;
      set({ messages: [...currentMessages, newMessage] });
      
      // Update group's last message
      const groups = get().groups.map(g => {
        if (g.id === groupId) {
          return { ...g, lastMessage: newMessage, updatedAt: new Date().toISOString() };
        }
        return g;
      });
      set({ groups });
      
      // Also update mock data for persistence within session
      if (mockMessages[groupId]) {
        mockMessages[groupId].push(newMessage);
      }
      return;
    }
    
    try {
      await api.sendMessage(groupId, { content: text, userId: senderId });
      // Add message locally for immediate feedback
      const currentMessages = get().messages;
      set({ messages: [...currentMessages, newMessage] });
      
      // Update group's last message
      const groups = get().groups.map(g => {
        if (g.id === groupId) {
          return { ...g, lastMessage: newMessage, updatedAt: new Date().toISOString() };
        }
        return g;
      });
      set({ groups });
    } catch (error: any) {
      set({ error: error.message || 'Failed to send message' });
    }
  },

  createGroup: async (name: string, description: string, ownerId: string, ownerName: string, parentId?: string) => {
    const newGroup: Group = {
      id: `group-${Date.now()}`,
      name,
      description,
      avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff`,
      ownerId,
      parentId, // Set parent if creating a subgroup
      members: [{
        id: `member-${Date.now()}`,
        userId: ownerId,
        name: ownerName,
        role: 'owner',
        joinedAt: new Date().toISOString(),
      }],
      memberCount: 1,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    if (DEMO_MODE) {
      const groups = [...get().groups, newGroup];
      set({ groups });
      mockGroups.push(newGroup);
      mockMessages[newGroup.id] = [];
      await get().saveToStorage(); // Persist to storage
      return newGroup;
    }
    
    try {
      const apiGroup = await api.createGroup({
        name,
        description,
        invite_id: `invite-${Date.now()}`,
        userId: ownerId,
        memberIds: [],
      });
      
      const createdGroup: Group = {
        id: apiGroup.id,
        name: apiGroup.name,
        description: apiGroup.description,
        avatarUrl: apiGroup.avatar_url || newGroup.avatarUrl,
        ownerId,
        parentId,
        members: [{
          id: `member-${Date.now()}`,
          userId: ownerId,
          name: ownerName,
          role: 'owner',
          joinedAt: new Date().toISOString(),
        }],
        memberCount: 1,
        isArchived: false,
        createdAt: apiGroup.created_at,
        updatedAt: apiGroup.updated_at,
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
    if (DEMO_MODE) {
      const groups = get().groups.filter(g => g.id !== groupId);
      set({ groups, currentGroup: null });
      return;
    }
    
    try {
      await api.leaveGroup(groupId, userId);
      const groups = get().groups.filter(g => g.id !== groupId);
      set({ groups, currentGroup: null });
    } catch (error: any) {
      set({ error: error.message || 'Failed to leave group' });
    }
  },

  // Admin actions
  updateGroupDetails: async (groupId: string, name: string, description: string) => {
    if (DEMO_MODE) {
      const groups = get().groups.map(g => 
        g.id === groupId ? { ...g, name, description, updatedAt: new Date().toISOString() } : g
      );
      const currentGroup = get().currentGroup;
      set({ 
        groups,
        currentGroup: currentGroup?.id === groupId 
          ? { ...currentGroup, name, description, updatedAt: new Date().toISOString() }
          : currentGroup
      });
      return;
    }
    
    try {
      await api.updateGroup(groupId, { name, description });
      const groups = get().groups.map(g => 
        g.id === groupId ? { ...g, name, description, updatedAt: new Date().toISOString() } : g
      );
      const currentGroup = get().currentGroup;
      set({ 
        groups,
        currentGroup: currentGroup?.id === groupId 
          ? { ...currentGroup, name, description, updatedAt: new Date().toISOString() }
          : currentGroup
      });
    } catch (error: any) {
      set({ error: error.message || 'Failed to update group' });
    }
  },

  promoteToAdmin: async (groupId: string, userId: string) => {
    if (DEMO_MODE) {
      const groups = get().groups.map(g => {
        if (g.id === groupId) {
          return {
            ...g,
            members: g.members.map(m => 
              m.userId === userId ? { ...m, role: 'admin' as const } : m
            ),
          };
        }
        return g;
      });
      const currentGroup = get().currentGroup;
      set({ 
        groups,
        currentGroup: currentGroup?.id === groupId 
          ? groups.find(g => g.id === groupId) || currentGroup
          : currentGroup
      });
      return;
    }
    // TODO: Implement real API call
  },

  demoteAdmin: async (groupId: string, userId: string) => {
    if (DEMO_MODE) {
      const groups = get().groups.map(g => {
        if (g.id === groupId) {
          return {
            ...g,
            members: g.members.map(m => 
              m.userId === userId ? { ...m, role: 'member' as const } : m
            ),
          };
        }
        return g;
      });
      const currentGroup = get().currentGroup;
      set({ 
        groups,
        currentGroup: currentGroup?.id === groupId 
          ? groups.find(g => g.id === groupId) || currentGroup
          : currentGroup
      });
      return;
    }
    // TODO: Implement real API call
  },

  removeMember: async (groupId: string, userId: string) => {
    if (DEMO_MODE) {
      const groups = get().groups.map(g => {
        if (g.id === groupId) {
          const updatedMembers = g.members.filter(m => m.userId !== userId);
          return {
            ...g,
            members: updatedMembers,
            memberCount: updatedMembers.length,
          };
        }
        return g;
      });
      const currentGroup = get().currentGroup;
      set({ 
        groups,
        currentGroup: currentGroup?.id === groupId 
          ? groups.find(g => g.id === groupId) || currentGroup
          : currentGroup
      });
      return;
    }
    // TODO: Implement real API call
  },

  archiveGroup: async (groupId: string) => {
    if (DEMO_MODE) {
      const groups = get().groups.map(g => 
        g.id === groupId ? { ...g, isArchived: !g.isArchived } : g
      );
      set({ groups, currentGroup: null });
      return;
    }
    
    try {
      const group = get().groups.find(g => g.id === groupId);
      await api.updateGroup(groupId, { isArchived: !group?.isArchived });
      const groups = get().groups.map(g => 
        g.id === groupId ? { ...g, isArchived: !g.isArchived } : g
      );
      set({ groups, currentGroup: null });
    } catch (error: any) {
      set({ error: error.message || 'Failed to archive group' });
    }
  },

  deleteGroup: async (groupId: string) => {
    if (DEMO_MODE) {
      // Also delete subgroups
      const groups = get().groups.filter(g => g.id !== groupId && g.parentId !== groupId);
      set({ groups, currentGroup: null });
      return;
    }
    
    try {
      await api.deleteGroup(groupId);
      const groups = get().groups.filter(g => g.id !== groupId && g.parentId !== groupId);
      set({ groups, currentGroup: null });
    } catch (error: any) {
      set({ error: error.message || 'Failed to delete group' });
    }
  },

  inviteByEmail: async (groupId: string, emails: string[]) => {
    if (DEMO_MODE) {
      // In demo mode, just log the invitations
      console.log(`Invitations sent to ${emails.join(', ')} for group ${groupId}`);
      return;
    }
    // TODO: Implement real API call
  },

  submitQuestion: async (groupId: string, question: any) => {
    if (DEMO_MODE) {
      // Add question as a message
      const newMessage: Message = {
        id: `msg-q-${Date.now()}`,
        groupId,
        senderId: 'demo-user',
        senderName: 'Demo User',
        text: `📝 New Question: ${question.stem}`,
        type: 'question',
        createdAt: new Date().toISOString(),
      };
      
      const currentMessages = get().messages;
      set({ messages: [...currentMessages, newMessage] });
      
      if (mockMessages[groupId]) {
        mockMessages[groupId].push(newMessage);
      }
      return;
    }
    // TODO: Implement real API call
  },

  // Subgroup helper functions
  getSubgroups: (parentId: string) => {
    return get().groups.filter(g => g.parentId === parentId && !g.isArchived);
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
}));
