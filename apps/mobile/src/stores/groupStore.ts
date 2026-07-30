// ===========================================
// Lantern Study Mobile - Groups Store
// ===========================================

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DMThread as SharedDMThread, DirectMessage as SharedDirectMessage } from '@lantern/shared/types';
import {
  resolveQuestionStatusAfterVote,
  normalizeStorageUrl,
  formatChatSenderLabel,
  resolveThreadRootId,
  computeDmReceiptStatus,
  mergeChatMessagesById,
  DeliveryIntentRegistry,
  isUncertainDeliveryError,
  reconcileDeliveredItem,
} from '@lantern/shared/utils';
import * as api from '../services/api';
import * as Crypto from 'expo-crypto';
import { useAuthStore } from './authStore';

export type DMThread = SharedDMThread;
export type DirectMessage = SharedDirectMessage;

const MESSAGES_PAGE_SIZE = 50;

const messagesFetchSeqByGroup: Record<string, number> = {};
const dmFetchSeqByThread: Record<string, number> = {};
const sendingGroupIds = new Set<string>();
const sendingDmThreadIds = new Set<string>();
const deliveryIntents = new DeliveryIntentRegistry();

// Storage keys
const GROUPS_STORAGE_KEY = 'lantern_groups';
const MESSAGES_STORAGE_KEY = 'lantern_messages';

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
  memberIds?: string[];
  memberDetails?: Array<{
    id: string;
    name: string;
    avatarUrl?: string;
  }>;
}

export interface PendingMember {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  ownerId: string;
  parentId?: string;
  adminIds?: string[];
  permissions?: GroupPermissions;
  members: GroupMember[];
  pendingMembers?: PendingMember[];
  memberCount: number;
  unreadCount?: number;
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
  editedAt?: string;
  removedAt?: string;
  isRemoved?: boolean;
  upvotes?: number;
  downvotes?: number;
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
  receiptStatus?: 'sent' | 'read';
  seenByCount?: number;
  seenByTotal?: number;
}

function mapApiMember(m: any, adminIds: string[]): GroupMember {
  const userId = m.user_id || m.userId || m.id;
  const isOwner = userId === adminIds[0];
  const isAdmin = adminIds.includes(userId);

  return {
    // Use auth user id as the stable member key so chat roster lookups match sender_id.
    id: userId,
    userId,
    name: m.name || 'Unknown',
    username: m.username,
    avatarUrl: m.avatar_url || m.avatarUrl,
    role: isOwner ? 'owner' : isAdmin ? 'admin' : 'member',
    joinedAt: m.joined_at || m.joinedAt || new Date().toISOString(),
  };
}

function mapApiGroup(g: any, unreadCounts: Record<string, number>): Group {
  const adminIds = g.admin_ids || g.adminIds || [];
  const lastMessageText = g.last_message || g.lastMessage;
  const lastMessageTime = g.last_message_time || g.lastMessageTime || g.updated_at || g.updatedAt;
  const mappedMembers = (g.members || []).map((m: any) => mapApiMember(m, adminIds));

  return {
    id: g.id,
    name: g.name,
    description: g.description,
    avatarUrl: g.avatar_url || g.avatarUrl,
    ownerId: adminIds[0] || '',
    parentId: g.parent_id || g.parentId,
    adminIds,
    members: mappedMembers,
    pendingMembers: (g.pending_members || g.pendingMembers || []).map((m: any) => ({
      id: m.id || m.user_id || m.userId,
      name: m.name,
      avatarUrl: m.avatar_url || m.avatarUrl,
    })),
    memberCount: g.member_count ?? g.memberCount ?? (mappedMembers.length > 0 ? mappedMembers.length : 0),
    unreadCount: unreadCounts[g.id] || 0,
    isArchived: g.is_archived || g.isArchived || false,
    createdAt: g.created_at || g.createdAt || '',
    updatedAt: g.updated_at || g.updatedAt || '',
    lastMessage: lastMessageText
      ? {
          id: `preview-${g.id}`,
          groupId: g.id,
          senderId: '',
          senderName: '',
          text: lastMessageText,
          type: 'text',
          createdAt: lastMessageTime || new Date().toISOString(),
        }
      : undefined,
  };
}

interface MessagePagination {
  page: number;
  hasMore: boolean;
}

interface GroupState {
  groups: Group[];
  currentGroup: Group | null;
  /** Group id for the chat screen currently open (may differ from currentGroup when group list is still loading). */
  activeGroupId: string | null;
  messages: Message[];
  messagesCache: Record<string, Message[]>;
  messagePagination: Record<string, MessagePagination>;
  dmThreads: DMThread[];
  directMessages: Record<string, DirectMessage[]>;
  dmUnreadCounts: Record<string, number>;
  groupUnreadCounts: Record<string, number>;
  userVotes: Record<string, 'up' | 'down' | undefined>;
  isLoading: boolean;
  isLoadingMore: boolean;
  isLoadingMessages: boolean;
  error: string | null;

  loadFromStorage: () => Promise<void>;
  saveToStorage: () => Promise<void>;
  fetchGroups: (userId: string) => Promise<void>;
  fetchGroupMembers: (groupId: string) => Promise<GroupMember[]>;
  fetchGroupUnreadCounts: (userId: string) => Promise<void>;
  markGroupAsRead: (groupId: string, userId: string) => Promise<string | null>;
  selectGroup: (groupId: string) => void;
  fetchMessages: (groupId: string, options?: { page?: number; refresh?: boolean; limit?: number }) => Promise<void>;
  loadMoreMessages: (groupId: string) => Promise<number>;
  sendMessage: (
    groupId: string,
    text: string,
    senderId: string,
    senderName?: string,
    options?: { replyToMessageId?: string; mentionedUserIds?: string[] }
  ) => Promise<void>;
  editGroupMessage: (groupId: string, messageId: string, content: string) => Promise<void>;
  removeGroupMessage: (groupId: string, messageId: string) => Promise<void>;
  createGroup: (input: CreateGroupInput | string, description?: string, ownerId?: string, ownerName?: string, parentId?: string) => Promise<Group>;
  leaveGroup: (groupId: string, userId: string) => Promise<void>;

  fetchDmThreads: (userId: string) => Promise<void>;
  fetchDMUnreadCounts: (userId: string) => Promise<void>;
  fetchDirectMessagesForThread: (userId: string, otherUserId: string, threadId: string) => Promise<void>;
  sendDirectMessageTo: (
    senderId: string,
    recipientId: string,
    text: string,
    threadId: string,
    options?: { replyToMessageId?: string }
  ) => Promise<void>;
  editDirectMessage: (threadId: string, messageId: string, content: string) => Promise<void>;
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

  updateGroupDetails: (groupId: string, name: string, description: string) => Promise<void>;
  promoteToAdmin: (groupId: string, userId: string) => Promise<void>;
  demoteAdmin: (groupId: string, userId: string) => Promise<void>;
  promoteGroupAdmin: (groupId: string, userId: string) => Promise<void>;
  demoteGroupAdmin: (groupId: string, userId: string) => Promise<void>;
  removeMember: (groupId: string, userId: string) => Promise<void>;
  archiveGroup: (groupId: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  inviteByEmail: (groupId: string, emails: string[]) => Promise<void>;
  submitQuestion: (groupId: string, question: any) => Promise<void>;
  flagMessageAsSimilar: (messageId: string, groupId: string, userId: string) => Promise<void>;
  approvePendingMember: (groupId: string, userId: string) => Promise<void>;
  rejectPendingMember: (groupId: string, userId: string) => Promise<void>;
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

function isOptimisticMessageId(id: string): boolean {
  return id.startsWith('msg-');
}

function stripOptimisticDuplicates(messages: Message[], serverMessage: Message): Message[] {
  return messages.filter((message) => {
    if (!isOptimisticMessageId(message.id)) return true;
    if (message.senderId !== serverMessage.senderId) return true;
    if (message.text !== serverMessage.text) return true;
    const messageTime = new Date(message.createdAt).getTime();
    const serverTime = new Date(serverMessage.createdAt).getTime();
    return Math.abs(messageTime - serverTime) > 60_000;
  });
}

function replaceOptimisticWithServer(
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

function mapApiMessage(m: any, groupId: string, roster?: GroupMember[]): Message {
  let parsed: any = {};
  const rawContent = m.content || m.text || '';
  if (typeof rawContent === 'string' && rawContent.trim().startsWith('{')) {
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
    m.type === 'QUESTION' ||
    m.type === 'question' ||
    parsed.type === 'QUESTION' ||
    parsed.type === 'question' ||
    !!questionStem;

  const sender = m.sender || {};
  const senderId = m.sender_id || m.senderId || sender.id || '';
  const rosterMember = roster?.find(
    (member) => member.userId === senderId || member.id === senderId
  );
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
    senderName: formatChatSenderLabel({
      username: sender.username || rosterMember?.username,
      name: sender.name || rosterMember?.name,
    }),
    senderAvatar:
      sender.avatar_url || sender.avatarUrl || rosterMember?.avatarUrl,
    text: isRemoved ? '' : isQuestion ? (questionStem || rawContent) : (m.text || rawContent),
    type: isQuestion ? 'question' : 'text',
    createdAt: typeof timestamp === 'string' ? timestamp : new Date(timestamp).toISOString(),
    isArchived: m.is_archived || m.isArchived,
    editedAt: m.edited_at || m.editedAt,
    removedAt,
    isRemoved,
    upvotes: m.upvotes ?? 0,
    downvotes: m.downvotes ?? 0,
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
    receiptStatus: m.receiptStatus || m.receipt_status || undefined,
    seenByCount: typeof m.seenByCount === 'number' ? m.seenByCount : m.seen_by_count,
    seenByTotal: typeof m.seenByTotal === 'number' ? m.seenByTotal : m.seen_by_total,
  };
}

function mapDmThread(t: any, unreadCounts: Record<string, number>): DMThread {
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
    status,
    requestedBy: t.requested_by ?? t.requestedBy ?? null,
  };
}

function mapDirectMessage(m: any, threadId: string): DirectMessage {
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
  };
}

function applyGroupMessageMutation(messages: Message[], payload: any): Message[] {
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

function applyDirectMessageMutation(
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

export const useGroupStore = create<GroupState>((set, get) => ({
  groups: [],
  currentGroup: null,
  activeGroupId: null,
  messages: [],
  messagesCache: {},
  messagePagination: {},
  dmThreads: [],
  directMessages: {},
  dmUnreadCounts: {},
  groupUnreadCounts: {},
  userVotes: {},
  isLoading: false,
  isLoadingMore: false,
  isLoadingMessages: false,
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

    try {
      const [apiGroups, unreadCounts] = await Promise.all([
        api.fetchGroups(userId, { limit: 50 }),
        api.fetchGroupUnreadCounts(userId).catch(() => ({} as Record<string, number>)),
      ]);

      const prevById = new Map(get().groups.map((g) => [g.id, g]));
      const groups: Group[] = apiGroups.map((g: any) => {
        const mapped = mapApiGroup(g, unreadCounts);
        const existing = prevById.get(mapped.id);
        // API group list omits members — keep any roster already loaded for @mentions.
        if (existing?.members?.length && !mapped.members.length) {
          return { ...mapped, members: existing.members, memberCount: existing.members.length };
        }
        return mapped;
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
      console.warn('[GroupStore] API fetch failed, using cached data:', error);
      set({ isLoading: false });
    }
  },

  fetchGroupMembers: async (groupId: string) => {
    const group = get().groups.find(g => g.id === groupId);
    const adminIds = group?.adminIds || [];

    try {
      const apiMembers = await api.fetchGroupMembers(groupId);
      const members = (Array.isArray(apiMembers) ? apiMembers : []).map((m: any) =>
        mapApiMember(m, adminIds)
      );

      const applyMembers = (g: Group): Group =>
        g.id === groupId ? { ...g, members, memberCount: members.length } : g;

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
      const counts = await api.fetchGroupUnreadCounts(userId);
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
      const result = await api.markGroupAsRead(groupId, userId);
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
  },

  fetchMessages: async (groupId: string, options?: { page?: number; refresh?: boolean; limit?: number }) => {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? MESSAGES_PAGE_SIZE;
    const refresh = options?.refresh ?? page === 1;
    const requestId = (messagesFetchSeqByGroup[groupId] = (messagesFetchSeqByGroup[groupId] || 0) + 1);

    if (page === 1) {
      set({ isLoadingMessages: true, error: null });
    } else {
      set({ isLoadingMore: true });
    }

    try {
      const result = await api.fetchMessages(groupId, { page, limit });
      const apiMessages = Array.isArray(result) ? result : (result as any)?.data || [];
      const pagination = Array.isArray(result) ? undefined : (result as any)?.pagination;
      const roster =
        get().groups.find((g) => g.id === groupId)?.members ||
        (get().currentGroup?.id === groupId ? get().currentGroup?.members : undefined);
      const mapped = apiMessages.map((m: any) => mapApiMessage(m, groupId, roster));

      const existing = get().messagesCache[groupId] || [];
      // Always merge by id so a late fetch cannot wipe realtime/optimistic rows.
      const merged = mergeChatMessagesById(
        refresh ? [] : existing,
        mapped as any
      ) as Message[];
      const withLocalOptimistic = refresh
        ? mergeChatMessagesById(merged as any, existing as any) as Message[]
        : merged;

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

  loadMoreMessages: async (groupId: string) => {
    const pagination = get().messagePagination[groupId];
    if (!pagination?.hasMore || get().isLoadingMore) return 0;

    const nextPage = pagination.page + 1;
    const beforeCount = get().messagesCache[groupId]?.length || 0;
    await get().fetchMessages(groupId, { page: nextPage, refresh: false });
    const afterCount = get().messagesCache[groupId]?.length || 0;
    return Math.max(0, afterCount - beforeCount);
  },

  sendMessage: async (
    groupId: string,
    text: string,
    senderId: string,
    _senderName?: string,
    options?: { replyToMessageId?: string; mentionedUserIds?: string[] }
  ) => {
    if (sendingGroupIds.has(groupId)) {
      throw new Error('Another message is still sending. Please wait a moment and try again.');
    }
    sendingGroupIds.add(groupId);

    const group = get().groups.find((g) => g.id === groupId);
    // Prefer userId — member.id may be the membership row id, not the auth user id.
    const member = group?.members?.find((m) => m.userId === senderId || m.id === senderId);
    const senderName = formatChatSenderLabel({
      username: member?.username,
      name: member?.name,
    });
    let parsed: any = {};
    if (text.trim().startsWith('{')) {
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
      replyToMessageId: options?.replyToMessageId || null,
      mentionedUserIds: [...(options?.mentionedUserIds || [])].sort(),
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
    const threadRootId = parent
      ? resolveThreadRootId({ id: parent.id, threadRootId: parent.threadRootId })
      : undefined;
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
    const optimisticCache = threadRootId
      ? withOptimistic.map((m) => {
          const rootKey = m.threadRootId || m.id;
          if (rootKey !== threadRootId) return m;
          return { ...m, replyCount: rootReplyCount };
        })
      : withOptimistic;
    const optimisticMessages = threadRootId
      ? (isActiveGroup ? [...previousMessages, newMessage] : previousMessages).map((m) => {
          const rootKey = m.threadRootId || m.id;
          if (rootKey !== threadRootId) return m;
          return { ...m, replyCount: rootReplyCount };
        })
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
      const serverPayload = await api.sendMessage(groupId, senderId, {
        content: text,
        clientMessageId,
        replyToMessageId: options?.replyToMessageId,
        mentionedUserIds: options?.mentionedUserIds,
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
    } catch (error: any) {
      if (isUncertainDeliveryError(error)) {
        deliveryIntents.markUncertain(deliveryScope, deliveryFingerprint, clientMessageId);
      } else {
        deliveryIntents.clear(deliveryScope, deliveryFingerprint, clientMessageId);
      }
      set({
        error: error.message || 'Failed to send message',
        messages: get().activeGroupId === groupId ? previousMessages : get().messages,
        groups: previousGroups,
        messagesCache: { ...get().messagesCache, [groupId]: previousCache },
      });
      throw error instanceof Error ? error : new Error(error?.message || 'Failed to send message');
    } finally {
      sendingGroupIds.delete(groupId);
    }
  },

  editGroupMessage: async (groupId: string, messageId: string, content: string) => {
    const payload = await api.editGroupMessage(messageId, content);
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
    const payload = await api.removeGroupMessage(messageId);
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
      avatarUrl: groupInput.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(groupInput.name)}&background=6366f1&color=fff`,
      ownerId: groupInput.ownerId,
      parentId: groupInput.parentId, // Set parent if creating a subgroup
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

      const apiGroup = await api.createGroup({
        name: groupInput.name,
        description: groupInput.description,
        avatar_url: createAvatarUrl,
        permissions: groupInput.permissions,
        invite_id: `invite-${Date.now()}`,
        parent_id: groupInput.parentId,
        userId: groupInput.ownerId,
        memberIds: selectedMemberIds,
      });

      let persistedAvatarUrl = apiGroup.avatar_url || (apiGroup as any).avatarUrl || createAvatarUrl;
      if (pendingAvatarDataUrl) {
        try {
          const base64Data = pendingAvatarDataUrl.includes(',')
            ? pendingAvatarDataUrl.split(',')[1]!
            : pendingAvatarDataUrl;
          const mimeMatch = pendingAvatarDataUrl.match(/^data:([^;]+);/);
          const contentType = mimeMatch?.[1] || 'image/jpeg';
          const uploaded = await api.uploadGroupAvatar(apiGroup.id, {
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
      await api.leaveGroup(groupId, userId);
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
  updateGroupDetails: async (groupId: string, name: string, description: string) => {
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
      const result = await api.promoteGroupAdmin(groupId, userId) as any;
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
      const result = await api.demoteGroupAdmin(groupId, userId) as any;
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
      await api.removeGroupMember(groupId, userId);
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

  archiveGroup: async (groupId: string) => {
    try {
      const group = get().groups.find(g => g.id === groupId);
      await api.updateGroup(groupId, { isArchived: !group?.isArchived });
      const groups = get().groups.map(g => 
        g.id === groupId ? { ...g, isArchived: !g.isArchived } : g
      );
      set({ groups, currentGroup: null });
    } catch (error: any) {
      set({ error: error.message || 'Failed to archive group' });
      throw error;
    }
  },

  deleteGroup: async (groupId: string) => {
    try {
      await api.deleteGroup(groupId);
      const groups = get().groups.filter(g => g.id !== groupId && g.parentId !== groupId);
      set({ groups, currentGroup: null });
    } catch (error: any) {
      set({ error: error.message || 'Failed to delete group' });
    }
  },

  inviteByEmail: async (groupId: string, emails: string[]) => {
    for (const email of emails) {
      const trimmed = email.trim();
      if (!trimmed) continue;
      try {
        const results = await api.searchUsers(trimmed, 5);
        const match = (results as any[]).find(
          u => (u.email || '').toLowerCase() === trimmed.toLowerCase()
        ) || (results as any[])[0];
        if (match?.id) {
          await api.addGroupMember(groupId, match.id);
        }
      } catch (error) {
        console.warn(`Failed to invite ${trimmed}:`, error);
      }
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
      let cached = get().messagesCache[gid];
      if (!cached?.length) {
        try {
          const result = await api.fetchMessages(gid, { page: 1, limit: 500 });
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

  fetchDmThreads: async (userId: string) => {
    try {
      const [threads, unreadCounts] = await Promise.all([
        api.fetchDMThreads(userId),
        api.fetchDMUnreadCounts(userId).catch(() => ({} as Record<string, number>)),
      ]);
      const dmThreads = threads.map(t => mapDmThread(t, unreadCounts));
      set({ dmThreads, dmUnreadCounts: unreadCounts });
    } catch (error) {
      console.warn('[GroupStore] Failed to fetch DM threads:', error);
    }
  },

  fetchDMUnreadCounts: async (userId: string) => {
    try {
      const counts = await api.fetchDMUnreadCounts(userId);
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
      const result = await api.fetchDirectMessages(userId, otherUserId);
      if (requestId !== dmFetchSeqByThread[threadId]) return;
      const apiMessages = Array.isArray(result) ? result : (result as any)?.data || [];
      const mapped = apiMessages.map((m: any) => mapDirectMessage(m, threadId));
      set(state => {
        const existing = state.directMessages[threadId] || [];
        const merged = mergeChatMessagesById(existing as any, mapped as any) as DirectMessage[];
        return {
          directMessages: { ...state.directMessages, [threadId]: merged },
        };
      });
    } catch (error) {
      if (requestId !== dmFetchSeqByThread[threadId]) return;
      console.warn('[GroupStore] Failed to fetch direct messages:', error);
    }
  },

  sendDirectMessageTo: async (
    senderId: string,
    recipientId: string,
    text: string,
    threadId: string,
    options?: { replyToMessageId?: string }
  ) => {
    if (sendingDmThreadIds.has(threadId)) return;
    sendingDmThreadIds.add(threadId);
    const deliveryScope = `dm:${threadId}`;
    const deliveryFingerprint = JSON.stringify({
      text,
      replyToMessageId: options?.replyToMessageId || null,
    });
    const clientMessageId = deliveryIntents.resolve(
      deliveryScope,
      deliveryFingerprint,
      Crypto.randomUUID
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
    };

    const withOptimistic = [...existing, optimistic];
    const updatedList = threadRootId
      ? withOptimistic.map((m) => {
          const rootKey = m.threadRootId || m.id;
          if (rootKey !== threadRootId) return m;
          return { ...m, replyCount: rootReplyCount };
        })
      : withOptimistic;

    set(state => ({
      directMessages: {
        ...state.directMessages,
        [threadId]: updatedList,
      },
      dmThreads: state.dmThreads.map(t =>
        t.id === threadId
          ? { ...t, lastMessage: text, lastMessageTimestamp: new Date().toISOString() }
          : t
      ),
    }));

    try {
      const sent = await api.sendDirectMessage(senderId, recipientId, text, clientMessageId, {
        replyToMessageId: options?.replyToMessageId,
      });
      const confirmed = mapDirectMessage(sent, threadId);
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
      // Refresh thread status in the background so send stays snappy.
      void get().fetchDmThreads(senderId).catch(() => undefined);
    } catch (error) {
      if (isUncertainDeliveryError(error)) {
        deliveryIntents.markUncertain(deliveryScope, deliveryFingerprint, clientMessageId);
      } else {
        deliveryIntents.clear(deliveryScope, deliveryFingerprint, clientMessageId);
      }
      set(state => ({
        directMessages: {
          ...state.directMessages,
          [threadId]: (state.directMessages[threadId] || []).filter(m => m.id !== optimistic.id),
        },
      }));
      throw error;
    } finally {
      sendingDmThreadIds.delete(threadId);
    }
  },

  editDirectMessage: async (threadId: string, messageId: string, content: string) => {
    const payload = await api.editDirectMessage(messageId, content);
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
    const payload = await api.removeDirectMessage(messageId);
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
      const result = await api.markDMAsRead(threadId, userId);
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
      await api.archiveDmThread(threadId, userId);
    } catch (error) {
      console.warn('[GroupStore] Failed to archive DM thread:', error);
    }
  },

  unarchiveDmThread: async (threadId: string, userId: string) => {
    set(state => ({
      dmThreads: state.dmThreads.map(t => t.id === threadId ? { ...t, isArchived: false } : t),
    }));
    try {
      await api.unarchiveDmThread(threadId, userId);
    } catch (error) {
      console.warn('[GroupStore] Failed to unarchive DM thread:', error);
    }
  },

  deleteDmThread: async (threadId: string, userId: string) => {
    get().removeDmThread(threadId);
    try {
      await api.deleteDmThread(threadId, userId);
    } catch (error) {
      console.warn('[GroupStore] Failed to delete DM thread:', error);
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
      const existing = state.directMessages[threadId] || [];
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

  mergeGroupMessage: (groupId: string, rawMessage: unknown) => {
    const roster = get().groups.find(g => g.id === groupId)?.members;
    const message = mapApiMessage(rawMessage, groupId, roster);
    const clientMessageId =
      (rawMessage as { client_message_id?: string; clientMessageId?: string }).client_message_id
      || (rawMessage as { clientMessageId?: string }).clientMessageId;
    set(state => {
      const cached = state.messagesCache[groupId] || [];
      let idx = cached.findIndex(m => m.id === message.id);
      if (idx === -1 && clientMessageId) {
        idx = cached.findIndex(m => m.id === clientMessageId);
      }
      if (idx === -1) return state;
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
      const withUpdatedPreviews = updated.map((item) =>
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
      const raw = await api.fetchGroupThread(context.groupId, rootId);
      const roster = get().groups.find(g => g.id === context.groupId)?.members;
      const apiMessages = Array.isArray(raw) ? raw : [];
      return apiMessages.map((m: any) => mapApiMessage(m, context.groupId, roster));
    }
    const raw = await api.fetchDmThread(context.threadId, rootId);
    const apiMessages = Array.isArray(raw) ? raw : [];
    return apiMessages.map((m: any) => mapDirectMessage(m, context.threadId));
  },

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
      await api.updateMessage(messageId, { flagged_as_similar_user_ids: newFlags });
    } catch (error) {
      console.warn('[GroupStore] Failed to flag message:', error);
    }
  },

  approvePendingMember: async (groupId: string, userId: string) => {
    const group = get().groups.find(g => g.id === groupId);
    const pending = group?.pendingMembers?.find(m => m.id === userId);
    if (!pending) return;

    try {
      await api.addGroupMember(groupId, userId);
    } catch (error) {
      console.warn('[GroupStore] addGroupMember failed, updating locally:', error);
    }

    set(state => ({
      groups: state.groups.map(g => {
        if (g.id !== groupId) return g;
        return {
          ...g,
          pendingMembers: (g.pendingMembers || []).filter(m => m.id !== userId),
          members: [
            ...g.members,
            {
              id: `member-${userId}`,
              userId,
              name: pending.name,
              avatarUrl: pending.avatarUrl,
              role: 'member' as const,
              joinedAt: new Date().toISOString(),
            },
          ],
          memberCount: g.memberCount + 1,
        };
      }),
    }));
  },

  rejectPendingMember: async (groupId: string, userId: string) => {
    set(state => ({
      groups: state.groups.map(g =>
        g.id === groupId
          ? { ...g, pendingMembers: (g.pendingMembers || []).filter(m => m.id !== userId) }
          : g
      ),
    }));
  },

  fetchUserVotesForGroup: async (groupId: string, userId: string) => {
    try {
      const votes = await api.fetchUserVotesForGroup(groupId, userId);
      set({ userVotes: { ...get().userVotes, ...votes } });
    } catch (error) {
      console.warn('[GroupStore] Failed to fetch user votes:', error);
    }
  },

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
        const removeResult = await api.removeVote(messageId, userId) as any;
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
        const result = await api.voteOnMessage(messageId, userId, voteType) as any;
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
            await api.updateQuestionStatus(messageId, resolvedStatus);
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
