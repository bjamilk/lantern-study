/**
 * Community "server" view — the Discord-shaped vocabulary for a community.
 *
 * A community is a server: its lounge is the `# lounge` text channel, every
 * group with `community_id` is a text channel, every open study room with
 * `community_id` (or the community's course) is a study-room channel, and
 * `community_members.role` + `communities.created_by` are the server roles.
 *
 * Everything here is pure. Both clients (web + mobile) and the API render a
 * community from these types and helpers so they cannot describe the same row
 * two different ways. Mobile imports via the `@lantern/shared/network`
 * subpath.
 */

import type { OnlineStatus } from '../settings/privacyPolicy';
import type { StudyRoomListItem } from './studyRooms';
import { studyRoomTimeLeftLabel } from './studyRooms';
import type { Group } from '../types';
import { communityKindLabel, memberCountLabel } from './communityLabels';

export type CommunityRole = 'owner' | 'admin' | 'moderator' | 'member';

export interface CommunityChannel {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  memberCount: number;
  questionCount: number;
  visibility: 'community' | 'public';
  courseId: string | null;
  isLounge: boolean;
  /** Viewer is a non-pending group member. */
  isMember: boolean;
  /** 0 when !isMember. */
  unreadCount: number;
  /** null when !isMember (never leak previews of unjoined channels). */
  lastMessage: string | null;
  lastMessageTime: string | null;
}

export interface CommunityChannels {
  communityId: string;
  viewer: { isMember: boolean; source: 'auto' | 'joined' | null; role: CommunityRole | null };
  /** null until minted (or viewer is not a member). */
  lounge: CommunityChannel | null;
  /** Pointer even when `lounge` is null for non-members. */
  loungeGroupId: string | null;
  /** Top-level (parent_id IS NULL), sorted by sortCommunityChannels. */
  channels: CommunityChannel[];
  /** [] for non-members. */
  rooms: StudyRoomListItem[];
  memberCount: number;
  /** 0 for non-members. */
  onlineCount: number;
}

export interface CommunityMember {
  id: string;
  name: string;
  avatarUrl: string | null;
  programme: string | null;
  role: CommunityRole;
  source: 'auto' | 'joined';
  joinedAt: string;
  onlineStatus: OnlineStatus;
}

export interface CommunityMembersPage {
  members: CommunityMember[];
  nextCursor: string | null;
}

export interface CommunityPresencePayload {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export const COMMUNITY_PRESENCE_CHANNEL_PREFIX = 'community:';
/** Presence sync fans out to every subscriber; above this the API count is enough. */
export const COMMUNITY_PRESENCE_MAX_MEMBERS = 1500;
export const COMMUNITY_MEMBERS_PAGE = 30;
/** Rendered "# lounge". */
export const COMMUNITY_LOUNGE_CHANNEL_NAME = 'lounge';

export const COMMUNITY_COPY = {
  loungeSubtitle: 'Everyone in this community',
  sectionText: 'TEXT CHANNELS',
  sectionRooms: 'STUDY ROOMS',
  sectionMembers: 'MEMBERS',
  createChannel: 'New channel',
  startRoom: 'Start a room',
  invite: 'Copy invite link',
  inviteCopied: 'Link copied',
  tapToJoin: 'Tap to join',
  joinToOpen: 'Join the community to open',
  emptyChannelsMember:
    'No channels yet. Create the first one — a topic, a past-questions drive, exam week.',
  emptyChannelsGuest: 'Join the community to see its channels.',
  emptyRooms: 'No open rooms. Start one — it closes 24 hours after it opens.',
  joinToSeeMembers: 'Join to see who is here.',
  online: (n: number) => `Online — ${n}`,
  offline: (n: number) => `Offline — ${n}`,
  inCommunity: (name: string) => `in ${name}`,
  newChannelTitle: (name: string) => `New channel in ${name}`,
  listedIn: (name: string) => `Listed in ${name} · members can find and join it`,
  startRoomIn: (name: string) => `In ${name}`,
  loungeUnavailable: 'Community chat is not available yet',
  membersOnly: 'Members only',
} as const;

/** `community:${id}` — one Supabase Presence topic per open community. */
export function communityPresenceChannel(communityId: string): string {
  return `${COMMUNITY_PRESENCE_CHANNEL_PREFIX}${communityId}`;
}

/** The public slug URL; the invite link for public communities. */
export function communityShareUrl(slug: string, origin = 'https://lanternstudy.com'): string {
  return `${origin}/discover/c/${slug}`;
}

/**
 * createdBy === userId → 'owner'; 'admin' | 'moderator' pass through; else
 * 'member'. Roles are display-only in phase 1.
 */
export function resolveCommunityRole(
  memberRole: string | null | undefined,
  userId: string,
  createdBy: string | null | undefined
): CommunityRole {
  if (createdBy && userId && createdBy === userId) return 'owner';
  if (memberRole === 'admin' || memberRole === 'moderator') return memberRole;
  return 'member';
}

/** Badge text for a role; plain members get no badge. */
export function communityRoleLabel(role: CommunityRole): 'Owner' | 'Admin' | 'Moderator' | null {
  switch (role) {
    case 'owner':
      return 'Owner';
    case 'admin':
      return 'Admin';
    case 'moderator':
      return 'Moderator';
    default:
      return null;
  }
}

/** "Course · 1,204 members · 12 online" — the online part is omitted at 0. */
export function communityHeaderLine(kind: string, memberCount: number, onlineCount: number): string {
  const base = `${communityKindLabel(kind)} · ${memberCountLabel(memberCount)}`;
  const online =
    Number.isFinite(onlineCount) && onlineCount > 0
      ? ` · ${Math.floor(onlineCount).toLocaleString()} online`
      : '';
  return `${base}${online}`;
}

/** '# lounge' | `# ${name}` */
export function channelDisplayName(ch: Pick<CommunityChannel, 'isLounge' | 'name'>): string {
  return ch.isLounge ? `# ${COMMUNITY_LOUNGE_CHANNEL_NAME}` : `# ${ch.name}`;
}

/**
 * lounge → loungeSubtitle; joined → last message (or member count);
 * unjoined → member count + "Tap to join".
 */
export function channelSubtitle(ch: CommunityChannel): string {
  if (ch.isLounge) return COMMUNITY_COPY.loungeSubtitle;
  if (ch.isMember) return ch.lastMessage ?? memberCountLabel(ch.memberCount);
  return `${memberCountLabel(ch.memberCount)} · ${COMMUNITY_COPY.tapToJoin}`;
}

/** "3 in room · Closes in 23h · You are in" */
export function roomSubtitle(room: StudyRoomListItem, now: number): string {
  const base = `${room.participantCount} in room · ${studyRoomTimeLeftLabel(room.startedAt, now)}`;
  return room.joined ? `${base} · You are in` : base;
}

const timeDesc = (a: string | null, b: string | null): number => {
  // Nulls last.
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  const va = Number.isFinite(ta) ? ta : -Infinity;
  const vb = Number.isFinite(tb) ? tb : -Infinity;
  return vb - va;
};

/**
 * Joined first (by lastMessageTime desc, nulls last, then name), then
 * unjoined by memberCount desc then name. The lounge is never in this array.
 */
export function sortCommunityChannels(channels: CommunityChannel[]): CommunityChannel[] {
  return [...channels].sort((a, b) => {
    if (a.isMember !== b.isMember) return a.isMember ? -1 : 1;
    if (a.isMember) {
      const byTime = timeDesc(a.lastMessageTime, b.lastMessageTime);
      if (byTime !== 0) return byTime;
      return a.name.localeCompare(b.name);
    }
    if (a.memberCount !== b.memberCount) return b.memberCount - a.memberCount;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Overlay unreadCount / lastMessage / lastMessageTime / isMember from the
 * client's group store when the group is present, so realtime badge bumps
 * show between refetches. Channels absent from the store are returned as-is.
 */
export function decorateChannels(channels: CommunityChannel[], groups: Group[]): CommunityChannel[] {
  if (!groups.length) return channels;
  const byId = new Map<string, Group>();
  for (const g of groups) byId.set(g.id, g);
  return channels.map((ch) => {
    const g = byId.get(ch.id);
    if (!g) return ch;
    return {
      ...ch,
      isMember: true,
      unreadCount: Math.max(0, Math.floor(g.unreadCount ?? 0)),
      lastMessage: g.lastMessage ?? ch.lastMessage,
      lastMessageTime: g.lastMessageTime ?? ch.lastMessageTime,
    };
  });
}

export type CommunityChannelRow =
  | { kind: 'lounge'; channel: CommunityChannel | null; unread: number }
  | { kind: 'section'; title: string; action?: 'create-channel' | 'start-room' }
  | { kind: 'channel'; channel: CommunityChannel; unread: number }
  | { kind: 'room'; room: StudyRoomListItem }
  | { kind: 'empty'; text: string }
  | { kind: 'members'; count: number };

/**
 * The row model both clients render, in the one shared order:
 * lounge → TEXT CHANNELS → STUDY ROOMS → MEMBERS.
 *
 * Non-member: [section TEXT CHANNELS (no action)] + public channels (or the
 * guest empty copy). Member: lounge row, TEXT CHANNELS (create-channel),
 * channels | empty, STUDY ROOMS (start-room), rooms | empty, members row.
 */
export function buildCommunityChannelRows(
  payload: CommunityChannels,
  groups: Group[],
  now: number
): CommunityChannelRow[] {
  const rows: CommunityChannelRow[] = [];
  const channels = sortCommunityChannels(decorateChannels(payload.channels, groups));

  if (!payload.viewer.isMember) {
    rows.push({ kind: 'section', title: COMMUNITY_COPY.sectionText });
    const visible = channels.filter((ch) => ch.visibility === 'public');
    if (visible.length === 0) {
      rows.push({ kind: 'empty', text: COMMUNITY_COPY.emptyChannelsGuest });
    } else {
      for (const ch of visible) rows.push({ kind: 'channel', channel: ch, unread: 0 });
    }
    return rows;
  }

  const lounge = payload.lounge
    ? (decorateChannels([payload.lounge], groups)[0] ?? null)
    : null;
  rows.push({ kind: 'lounge', channel: lounge, unread: lounge?.unreadCount ?? 0 });

  rows.push({ kind: 'section', title: COMMUNITY_COPY.sectionText, action: 'create-channel' });
  if (channels.length === 0) {
    rows.push({ kind: 'empty', text: COMMUNITY_COPY.emptyChannelsMember });
  } else {
    for (const ch of channels) {
      rows.push({ kind: 'channel', channel: ch, unread: ch.isMember ? ch.unreadCount : 0 });
    }
  }

  rows.push({ kind: 'section', title: COMMUNITY_COPY.sectionRooms, action: 'start-room' });
  const rooms = payload.rooms.filter((room) => studyRoomTimeLeftLabel(room.startedAt, now) !== 'Closed');
  if (rooms.length === 0) {
    rows.push({ kind: 'empty', text: COMMUNITY_COPY.emptyRooms });
  } else {
    for (const room of rooms) rows.push({ kind: 'room', room });
  }

  rows.push({ kind: 'members', count: payload.memberCount });
  return rows;
}

/** hidden → never online; else live presence OR the stored 5-minute window. */
export function isMemberOnline(
  member: Pick<CommunityMember, 'id' | 'onlineStatus'>,
  presenceIds: ReadonlySet<string>
): boolean {
  if (member.onlineStatus === 'hidden') return false;
  return presenceIds.has(member.id) || member.onlineStatus === 'online';
}

const byName = (a: CommunityMember, b: CommunityMember): number =>
  (a.name || '').localeCompare(b.name || '');

/**
 * Online / Offline halves, each sorted by name. 'hidden' members always land
 * in Offline (and render without a dot).
 */
export function splitMembers(
  members: CommunityMember[],
  presenceIds: ReadonlySet<string>
): { online: CommunityMember[]; offline: CommunityMember[] } {
  const online: CommunityMember[] = [];
  const offline: CommunityMember[] = [];
  for (const m of members) {
    (isMemberOnline(m, presenceIds) ? online : offline).push(m);
  }
  online.sort(byName);
  offline.sort(byName);
  return { online, offline };
}

/** Header count: the live set can only raise the stored count, never lower it. */
export function communityOnlineCount(
  apiCount: number,
  presenceIds: ReadonlySet<string>,
  connected: boolean
): number {
  const stored = Number.isFinite(apiCount) ? Math.max(0, Math.floor(apiCount)) : 0;
  return connected ? Math.max(stored, presenceIds.size) : stored;
}

/** Unread rollup for a hub card: joined, non-archived groups in the community. */
/**
 * The unread pill text on every community surface (§6 parity rule): two
 * digits, then `99+`. Chat-list badges keep their own platform formatters.
 */
export function formatCommunityUnread(unread: number): string {
  const n = Number.isFinite(unread) ? Math.max(0, Math.floor(unread)) : 0;
  return n > 99 ? '99+' : String(n);
}

export function communityUnreadTotal(
  groups: Array<Pick<Group, 'communityId' | 'unreadCount' | 'isArchived'>>,
  communityId: string
): number {
  let total = 0;
  for (const g of groups) {
    if (g.communityId !== communityId || g.isArchived) continue;
    const n = g.unreadCount ?? 0;
    if (Number.isFinite(n) && n > 0) total += Math.floor(n);
  }
  return total;
}

/** Members only, never in low-data mode, and not for institution-sized rooms. */
export function shouldSubscribeCommunityPresence(input: {
  isMember: boolean;
  lowDataMode: boolean;
  memberCount: number;
}): boolean {
  return input.isMember && !input.lowDataMode && input.memberCount <= COMMUNITY_PRESENCE_MAX_MEMBERS;
}
