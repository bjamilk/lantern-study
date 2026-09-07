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

/**
 * A study group listed on a community page but living in Chat. It is a
 * `groups` row with `community_surface = 'study_group'`: the full study
 * surface (questions, tests, games, offline bundles, sub-groups) stays intact,
 * and it never renders as a board.
 */
export interface CommunityStudyGroup {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  memberCount: number;
  questionCount: number;
  isMember: boolean;
  visibility: 'community' | 'public';
  lastMessageTime: string | null;
}

export interface CommunityChannels {
  communityId: string;
  viewer: { isMember: boolean; source: 'auto' | 'joined' | null; role: CommunityRole | null };
  /**
   * The community's ONE live chat, rendered as `General` (founder decision 1:
   * the lounge stays a chat, it is not a board). null until minted, or when
   * the viewer is not a member.
   */
  lounge: CommunityChannel | null;
  /** Pointer even when `lounge` is null for non-members. */
  loungeGroupId: string | null;
  /**
   * `community_surface IS NULL OR 'board'`, top-level (parent_id IS NULL),
   * sorted by sortCommunityChannels. The lounge is never in this array.
   */
  boards: CommunityChannel[];
  /** @deprecated One release only — the identical array to `boards`. */
  channels: CommunityChannel[];
  /** `community_surface = 'study_group'`. Listed here, opened in Chat. [] for non-members. */
  studyGroups: CommunityStudyGroup[];
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
  /**
   * `community_members.muted_until` — the raw instant, or null when this
   * member is not muted. Ask `isCommunityMemberMuted` rather than reading it:
   * an expired mute is still a timestamp.
   *
   * PRESENT ONLY FOR MODERATORS. The API attaches it when the caller may
   * moderate this community (owner/admin/moderator/platform admin) and omits
   * it otherwise, so the roster does not publish who is muted to everyone in
   * the room. It is also absent on a database where the mute migration has
   * not been hand-applied yet — `undefined` means "not told", which is why
   * this is optional and not `string | null`.
   */
  mutedUntil?: string | null;
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
/**
 * The community's one live chat, rendered as `General` and WITHOUT the `#`
 * glyph the boards use, so the chat room reads differently from the boards at
 * a glance (founder decision 4, 2026-09-02).
 */
export const COMMUNITY_LOUNGE_CHANNEL_NAME = 'General';

const EMPTY_BOARDS_MEMBER =
  'No boards yet. Create the first one — a topic, a past-questions drive, exam week.';
const EMPTY_BOARDS_GUEST = 'Join the community to see its boards.';
const SECTION_BOARDS = 'BOARDS';
const CREATE_BOARD = 'New board';
const newBoardTitle = (name: string): string => `New board in ${name}`;

export const COMMUNITY_COPY = {
  loungeSubtitle: 'Everyone in this community',
  sectionBoards: SECTION_BOARDS,
  sectionStudyGroups: 'STUDY GROUPS',
  sectionRooms: 'STUDY ROOMS',
  sectionMembers: 'MEMBERS',
  createBoard: CREATE_BOARD,
  startStudyGroup: 'Start a study group',
  startRoom: 'Start a room',
  invite: 'Copy invite link',
  inviteCopied: 'Link copied',
  tapToJoin: 'Tap to join',
  joinToOpen: 'Join the community to open',
  emptyBoardsMember: EMPTY_BOARDS_MEMBER,
  emptyBoardsGuest: EMPTY_BOARDS_GUEST,
  emptyStudyGroups:
    'No study groups yet. Start one — it opens in Chat with questions, tests and games.',
  emptyRooms: 'No open rooms. Start one — it closes 24 hours after it opens.',
  joinToSeeMembers: 'Join to see who is here.',
  online: (n: number) => `Online — ${n}`,
  offline: (n: number) => `Offline — ${n}`,
  inCommunity: (name: string) => `in ${name}`,
  newBoardTitle,
  newStudyGroupTitle: (name: string) => `Start a study group in ${name}`,
  /**
   * The no-silent-disappearance contract in copy: the only place a member is
   * told where the study apparatus went. `{community}` is substituted by the
   * client with the community's name.
   */
  studyGroupsLiveInChat:
    'Study groups live in Chat. Questions, tests, games and challenges happen there. This one stays listed in {community} so members can find and join it.',
  createdInChat: (name: string) => `${name} is in your Chat · listed in this community`,
  opensInChat: 'Opens in Chat',
  listedIn: (name: string) => `Listed in ${name} · members can find and join it`,
  startRoomIn: (name: string) => `In ${name}`,
  loungeUnavailable: 'Community chat is not available yet',
  membersOnly: 'Members only',

  // -------------------------------------------------------------------------
  // Deprecated keys — one release only, so no call site breaks mid-refactor.
  // They carry the NEW board vocabulary, not the old channel wording.
  // -------------------------------------------------------------------------
  /** @deprecated Use `sectionBoards`. */
  sectionText: SECTION_BOARDS,
  /** @deprecated Use `createBoard`. */
  createChannel: CREATE_BOARD,
  /** @deprecated Use `emptyBoardsMember`. */
  emptyChannelsMember: EMPTY_BOARDS_MEMBER,
  /** @deprecated Use `emptyBoardsGuest`. */
  emptyChannelsGuest: EMPTY_BOARDS_GUEST,
  /** @deprecated Use `newBoardTitle`. */
  newChannelTitle: newBoardTitle,
} as const;

/** Substitute `{community}` in `studyGroupsLiveInChat`. */
export function studyGroupsLiveInChatCopy(communityName: string): string {
  return COMMUNITY_COPY.studyGroupsLiveInChat.replace('{community}', communityName);
}

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

export type CommunityChannelSectionAction = 'create-board' | 'start-study-group' | 'start-room';

export type CommunityChannelRow =
  | { kind: 'lounge'; channel: CommunityChannel | null; unread: number }
  | { kind: 'section'; title: string; action?: CommunityChannelSectionAction }
  | { kind: 'channel'; channel: CommunityChannel; unread: number }
  | { kind: 'study-group'; group: CommunityStudyGroup }
  | { kind: 'room'; room: StudyRoomListItem }
  | { kind: 'empty'; text: string }
  | { kind: 'members'; count: number };

/**
 * The row model both clients render, in the one shared order (§8 parity rule
 * 2 — neither client sorts, filters or inserts rows of its own):
 *
 *   lounge                              (rendered as the "General" chat)
 *   section BOARDS        create-board
 *   boards | empty(emptyBoardsMember)
 *   section STUDY GROUPS  start-study-group
 *   study-group rows | empty(emptyStudyGroups)
 *   section STUDY ROOMS   start-room
 *   rooms | empty(emptyRooms)
 *   members
 *
 * Guest of a public community: `section BOARDS` with no action, then the
 * public boards (or the guest empty copy). No study groups, no rooms, no
 * roster, no previews.
 *
 * `payload.boards` falls back to the deprecated `payload.channels` so a client
 * shipped ahead of the API still renders.
 */
export function buildCommunityChannelRows(
  payload: CommunityChannels,
  groups: Group[],
  now: number
): CommunityChannelRow[] {
  const rows: CommunityChannelRow[] = [];
  const source = payload.boards ?? payload.channels ?? [];
  const boards = sortCommunityChannels(decorateChannels(source, groups));

  if (!payload.viewer.isMember) {
    rows.push({ kind: 'section', title: COMMUNITY_COPY.sectionBoards });
    const visible = boards.filter((b) => b.visibility === 'public');
    if (visible.length === 0) {
      rows.push({ kind: 'empty', text: COMMUNITY_COPY.emptyBoardsGuest });
    } else {
      for (const b of visible) rows.push({ kind: 'channel', channel: b, unread: 0 });
    }
    return rows;
  }

  const lounge = payload.lounge
    ? (decorateChannels([payload.lounge], groups)[0] ?? null)
    : null;
  rows.push({ kind: 'lounge', channel: lounge, unread: lounge?.unreadCount ?? 0 });

  rows.push({ kind: 'section', title: COMMUNITY_COPY.sectionBoards, action: 'create-board' });
  if (boards.length === 0) {
    rows.push({ kind: 'empty', text: COMMUNITY_COPY.emptyBoardsMember });
  } else {
    for (const b of boards) {
      rows.push({ kind: 'channel', channel: b, unread: b.isMember ? b.unreadCount : 0 });
    }
  }

  rows.push({
    kind: 'section',
    title: COMMUNITY_COPY.sectionStudyGroups,
    action: 'start-study-group',
  });
  const studyGroups = sortCommunityStudyGroups(payload.studyGroups ?? []);
  if (studyGroups.length === 0) {
    rows.push({ kind: 'empty', text: COMMUNITY_COPY.emptyStudyGroups });
  } else {
    for (const group of studyGroups) rows.push({ kind: 'study-group', group });
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

/**
 * Joined study groups first (most recently active, nulls last, then name),
 * then unjoined by member count desc then name — the same shape as
 * `sortCommunityChannels`, so the two sections read consistently.
 */
export function sortCommunityStudyGroups(groups: CommunityStudyGroup[]): CommunityStudyGroup[] {
  return [...groups].sort((a, b) => {
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
