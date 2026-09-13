/**
 * Chat destination home — the pane (web) and empty list (mobile) when the
 * inbox is the thing on screen, not a welcome card for the whole product.
 */

import { isCommunityBoard } from '../network/communityBoard';
import { chatMessagePreview } from '../utils/chatMedia';

export type ChatHomeMode = 'inbox' | 'firstRun';

export const CHAT_HOME_COPY = {
  inboxTitle: 'Lantern Chat',
  inboxBody: 'Messages with classmates, groups, and sellers.',
  inboxHint: 'Pick a conversation from the list, or start a new one.',
  firstRunTitle: 'Your messages live here',
  firstRunBody: 'Message a classmate, start a group, or open a campus lounge.',
  privacy: 'Only people you message can see the thread.',
  messageSomeone: 'Message someone',
  newGroup: 'New group',
  openLounge: 'Open a campus lounge',
  viewInquiries: 'View inquiries',
  emptyList: 'No conversations yet',
} as const;

export interface ChatHomeRecent {
  id: string;
  chatType: 'group' | 'dm';
  name: string;
  preview: string;
  avatarUrl?: string;
  lastAtMs: number;
}

export interface ChatHomeLounge {
  communityId: string;
  slug: string;
  name: string;
  loungeGroupId?: string | null;
}

export interface ChatHomeInquiry {
  id: string;
  threadId: string;
  title: string;
}

export interface ChatHomeModel {
  mode: ChatHomeMode;
  recents: ChatHomeRecent[];
  lounges: ChatHomeLounge[];
  inquiries: ChatHomeInquiry[];
  conversationCount: number;
}

export type ChatHomeGroupInput = {
  id: string;
  name: string;
  avatarUrl?: string;
  lastMessage?: string | null;
  lastMessageTime?: string | Date | number | null;
  isArchived?: boolean;
  parentId?: string | null;
  communityId?: string | null;
  communitySurface?: 'board' | 'study_group' | null;
};

export type ChatHomeDmInput = {
  id: string;
  participantIds?: string[];
  participants?: Record<string, { name?: string; avatarUrl?: string } | undefined>;
  lastMessage?: string | null;
  lastMessageTimestamp?: string | Date | number | null;
  isArchived?: boolean;
  status?: 'open' | 'pending' | 'declined' | string;
  requestedBy?: string | null;
};

export type ChatHomeCommunityInput = {
  id: string;
  slug: string;
  name: string;
  lounge_group_id?: string | null;
};

export type ChatHomeInquiryInput = {
  id: string;
  dm_thread_id?: string | null;
  status?: string | null;
  listing?: { title?: string | null } | null;
};

function timeMs(value: string | Date | number | null | undefined): number {
  if (value == null) return 0;
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function dmPeerName(
  thread: ChatHomeDmInput,
  currentUserId: string,
): { name: string; avatarUrl?: string } {
  const otherId = (thread.participantIds || []).find((id) => id && id !== currentUserId);
  const peer = otherId ? thread.participants?.[otherId] : undefined;
  return {
    name: peer?.name?.trim() || 'Direct message',
    avatarUrl: peer?.avatarUrl,
  };
}

export function buildChatHome(input: {
  currentUserId: string;
  groups?: ChatHomeGroupInput[];
  dmThreads?: ChatHomeDmInput[];
  communities?: ChatHomeCommunityInput[];
  inquiries?: ChatHomeInquiryInput[];
  recentLimit?: number;
  loungeLimit?: number;
  inquiryLimit?: number;
}): ChatHomeModel {
  const currentUserId = input.currentUserId;
  const recentLimit = input.recentLimit ?? 4;
  const loungeLimit = input.loungeLimit ?? 3;
  const inquiryLimit = input.inquiryLimit ?? 3;

  const activeGroups = (input.groups || []).filter((group) => {
    if (group.isArchived || group.parentId) return false;
    if (isCommunityBoard(group)) return false;
    return true;
  });

  const activeDms = (input.dmThreads || []).filter((thread) => {
    if (thread.isArchived) return false;
    if (
      thread.status === 'pending' &&
      typeof thread.requestedBy === 'string' &&
      thread.requestedBy !== currentUserId
    ) {
      return false;
    }
    return true;
  });

  const recents: ChatHomeRecent[] = [
    ...activeGroups.map((group) => ({
      id: group.id,
      chatType: 'group' as const,
      name: group.name,
      preview: chatMessagePreview(group.lastMessage, ''),
      avatarUrl: group.avatarUrl,
      lastAtMs: timeMs(group.lastMessageTime),
    })),
    ...activeDms.map((thread) => {
      const peer = dmPeerName(thread, currentUserId);
      return {
        id: thread.id,
        chatType: 'dm' as const,
        name: peer.name,
        preview: chatMessagePreview(thread.lastMessage, ''),
        avatarUrl: peer.avatarUrl,
        lastAtMs: timeMs(thread.lastMessageTimestamp),
      };
    }),
  ]
    .sort((a, b) => b.lastAtMs - a.lastAtMs)
    .slice(0, recentLimit);

  const lounges = (input.communities || [])
    .filter((community) => community.id && community.slug && community.name)
    .slice(0, loungeLimit)
    .map((community) => ({
      communityId: community.id,
      slug: community.slug,
      name: community.name,
      loungeGroupId: community.lounge_group_id ?? null,
    }));

  const inquiries = (input.inquiries || [])
    .filter((row) => {
      if (!row.id || !row.dm_thread_id) return false;
      const status = row.status || 'open';
      return status === 'open' || status === 'negotiating';
    })
    .slice(0, inquiryLimit)
    .map((row) => ({
      id: row.id,
      threadId: row.dm_thread_id as string,
      title: row.listing?.title?.trim() || 'Listing inquiry',
    }));

  const conversationCount = activeGroups.length + activeDms.length;
  return {
    mode: conversationCount === 0 ? 'firstRun' : 'inbox',
    recents,
    lounges,
    inquiries,
    conversationCount,
  };
}
