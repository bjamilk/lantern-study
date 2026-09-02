import {
  buildCommunityChannelRows,
  channelDisplayName,
  channelSubtitle,
  communityHeaderLine,
  communityOnlineCount,
  communityPresenceChannel,
  communityRoleLabel,
  communityShareUrl,
  communityUnreadTotal,
  formatCommunityUnread,
  COMMUNITY_COPY,
  COMMUNITY_PRESENCE_MAX_MEMBERS,
  decorateChannels,
  isMemberOnline,
  resolveCommunityRole,
  roomSubtitle,
  shouldSubscribeCommunityPresence,
  sortCommunityChannels,
  splitMembers,
} from './communityServer';
import type {
  CommunityChannel,
  CommunityChannels,
  CommunityMember,
} from './communityServer';
import type { StudyRoomListItem } from './studyRooms';
import type { Group } from '../types';

const channel = (over: Partial<CommunityChannel> & { id: string; name: string }): CommunityChannel => ({
  description: null,
  avatarUrl: null,
  memberCount: 1,
  questionCount: 0,
  visibility: 'community',
  courseId: null,
  isLounge: false,
  isMember: false,
  unreadCount: 0,
  lastMessage: null,
  lastMessageTime: null,
  ...over,
});

const room = (over: Partial<StudyRoomListItem> & { id: string }): StudyRoomListItem => ({
  title: 'Room',
  courseId: null,
  communityId: 'c1',
  topicId: null,
  topic: null,
  kind: 'room',
  createdBy: null,
  startedAt: '2026-09-02T10:00:00.000Z',
  isActive: true,
  participantCount: 1,
  presenceChannel: `study-room:${over.id}`,
  joined: false,
  ...over,
});

const member = (over: Partial<CommunityMember> & { id: string; name: string }): CommunityMember => ({
  avatarUrl: null,
  programme: null,
  role: 'member',
  source: 'joined',
  joinedAt: '2026-09-01T00:00:00.000Z',
  onlineStatus: 'offline',
  ...over,
});

const payload = (over: Partial<CommunityChannels> = {}): CommunityChannels => ({
  communityId: 'c1',
  viewer: { isMember: true, source: 'joined', role: 'member' },
  lounge: null,
  loungeGroupId: null,
  channels: [],
  rooms: [],
  memberCount: 12,
  onlineCount: 0,
  ...over,
});

const NOW = Date.parse('2026-09-02T12:00:00.000Z');

describe('resolveCommunityRole', () => {
  it('the creator is the owner whatever the membership row says', () => {
    expect(resolveCommunityRole('member', 'u1', 'u1')).toBe('owner');
    expect(resolveCommunityRole('admin', 'u1', 'u1')).toBe('owner');
  });

  it('admin and moderator pass through', () => {
    expect(resolveCommunityRole('admin', 'u2', 'u1')).toBe('admin');
    expect(resolveCommunityRole('moderator', 'u2', 'u1')).toBe('moderator');
  });

  it('everything else is a member', () => {
    expect(resolveCommunityRole('member', 'u2', 'u1')).toBe('member');
    expect(resolveCommunityRole(null, 'u2', null)).toBe('member');
    expect(resolveCommunityRole(undefined, 'u2', undefined)).toBe('member');
    expect(resolveCommunityRole('owner', 'u2', 'u1')).toBe('member');
  });

  it('a null creator never makes anyone the owner', () => {
    expect(resolveCommunityRole('member', '', null)).toBe('member');
  });
});

describe('communityRoleLabel', () => {
  it('labels every role except member', () => {
    expect(communityRoleLabel('owner')).toBe('Owner');
    expect(communityRoleLabel('admin')).toBe('Admin');
    expect(communityRoleLabel('moderator')).toBe('Moderator');
    expect(communityRoleLabel('member')).toBeNull();
  });
});

describe('communityHeaderLine', () => {
  it('omits the online part at zero', () => {
    expect(communityHeaderLine('course', 1204, 0)).toBe('Course · 1,204 members');
  });

  it('appends the online count when there is one', () => {
    expect(communityHeaderLine('topic', 1, 3)).toBe('Interest · 1 member · 3 online');
  });

  it('falls back to Community for an unknown kind', () => {
    expect(communityHeaderLine('weird', 2, 0)).toBe('Community · 2 members');
  });
});

describe('channelDisplayName / channelSubtitle', () => {
  it('renders the lounge as # lounge whatever the group is called', () => {
    expect(channelDisplayName({ isLounge: true, name: 'Biology lounge' })).toBe('# lounge');
    expect(channelDisplayName({ isLounge: false, name: 'exam-week' })).toBe('# exam-week');
  });

  it('lounge subtitle is the shared copy', () => {
    expect(channelSubtitle(channel({ id: 'l', name: 'x', isLounge: true, isMember: true }))).toBe(
      COMMUNITY_COPY.loungeSubtitle
    );
  });

  it('members see the last message, falling back to the member count', () => {
    expect(
      channelSubtitle(channel({ id: 'a', name: 'a', isMember: true, lastMessage: 'hi', memberCount: 4 }))
    ).toBe('hi');
    expect(channelSubtitle(channel({ id: 'a', name: 'a', isMember: true, memberCount: 4 }))).toBe(
      '4 members'
    );
  });

  it('non-members get the count and the join hint, never a preview', () => {
    expect(
      channelSubtitle(channel({ id: 'a', name: 'a', isMember: false, lastMessage: 'leak', memberCount: 1 }))
    ).toBe('1 member · Tap to join');
  });
});

describe('roomSubtitle', () => {
  it('shows count, time left and whether you are in', () => {
    const r = room({ id: 'r1', participantCount: 3, startedAt: '2026-09-02T10:00:00.000Z' });
    expect(roomSubtitle(r, NOW)).toBe('3 in room · Closes in 22h');
    expect(roomSubtitle({ ...r, joined: true }, NOW)).toBe('3 in room · Closes in 22h · You are in');
  });
});

describe('sortCommunityChannels', () => {
  it('joined first by latest message (nulls last, then name), then unjoined by size then name', () => {
    const input = [
      channel({ id: 'u-small', name: 'zeta', isMember: false, memberCount: 2 }),
      channel({ id: 'j-old', name: 'old', isMember: true, lastMessageTime: '2026-09-01T00:00:00.000Z' }),
      channel({ id: 'u-big', name: 'alpha', isMember: false, memberCount: 50 }),
      channel({ id: 'j-none-b', name: 'b', isMember: true }),
      channel({ id: 'j-new', name: 'new', isMember: true, lastMessageTime: '2026-09-02T00:00:00.000Z' }),
      channel({ id: 'j-none-a', name: 'a', isMember: true }),
      channel({ id: 'u-small-2', name: 'beta', isMember: false, memberCount: 2 }),
    ];
    expect(sortCommunityChannels(input).map((c) => c.id)).toEqual([
      'j-new',
      'j-old',
      'j-none-a',
      'j-none-b',
      'u-big',
      'u-small-2',
      'u-small',
    ]);
  });

  it('does not mutate the input', () => {
    const input = [
      channel({ id: 'b', name: 'b', isMember: false, memberCount: 1 }),
      channel({ id: 'a', name: 'a', isMember: false, memberCount: 9 }),
    ];
    const copy = [...input];
    sortCommunityChannels(input);
    expect(input).toEqual(copy);
  });
});

describe('decorateChannels', () => {
  it('overlays the live group store fields when the group is present', () => {
    const groups = [
      { id: 'a', name: 'a', members: [], adminIds: [], unreadCount: 7, lastMessage: 'live', lastMessageTime: '2026-09-02T11:00:00.000Z' },
    ] as unknown as Group[];
    const [a, b] = decorateChannels(
      [channel({ id: 'a', name: 'a' }), channel({ id: 'b', name: 'b', unreadCount: 2, isMember: true })],
      groups
    );
    expect(a).toMatchObject({ isMember: true, unreadCount: 7, lastMessage: 'live' });
    expect(b).toMatchObject({ isMember: true, unreadCount: 2 });
  });

  it('returns the same array when the store is empty', () => {
    const input = [channel({ id: 'a', name: 'a' })];
    expect(decorateChannels(input, [])).toBe(input);
  });
});

describe('buildCommunityChannelRows', () => {
  it('member: lounge → TEXT CHANNELS(+) → channels → STUDY ROOMS(+) → rooms → members', () => {
    const rows = buildCommunityChannelRows(
      payload({
        lounge: channel({ id: 'lounge', name: 'Lounge', isLounge: true, isMember: true, unreadCount: 3 }),
        loungeGroupId: 'lounge',
        channels: [channel({ id: 'ch', name: 'ch', isMember: true, unreadCount: 2 })],
        rooms: [room({ id: 'r1' })],
        memberCount: 12,
      }),
      [],
      NOW
    );
    expect(rows.map((r) => r.kind)).toEqual(['lounge', 'section', 'channel', 'section', 'room', 'members']);
    expect(rows[0]).toMatchObject({ kind: 'lounge', unread: 3 });
    expect(rows[1]).toEqual({ kind: 'section', title: 'TEXT CHANNELS', action: 'create-channel' });
    expect(rows[2]).toMatchObject({ kind: 'channel', unread: 2 });
    expect(rows[3]).toEqual({ kind: 'section', title: 'STUDY ROOMS', action: 'start-room' });
    expect(rows[5]).toEqual({ kind: 'members', count: 12 });
  });

  it('member with nothing yet: lounge null row, empty copy for channels and rooms', () => {
    const rows = buildCommunityChannelRows(payload(), [], NOW);
    expect(rows).toEqual([
      { kind: 'lounge', channel: null, unread: 0 },
      { kind: 'section', title: 'TEXT CHANNELS', action: 'create-channel' },
      { kind: 'empty', text: COMMUNITY_COPY.emptyChannelsMember },
      { kind: 'section', title: 'STUDY ROOMS', action: 'start-room' },
      { kind: 'empty', text: COMMUNITY_COPY.emptyRooms },
      { kind: 'members', count: 12 },
    ]);
  });

  it('guest: only a TEXT CHANNELS section without an action plus public channels', () => {
    const rows = buildCommunityChannelRows(
      payload({
        viewer: { isMember: false, source: null, role: null },
        loungeGroupId: 'lounge',
        channels: [
          channel({ id: 'pub', name: 'pub', visibility: 'public', memberCount: 3 }),
          channel({ id: 'priv', name: 'priv', visibility: 'community', memberCount: 9 }),
        ],
        rooms: [room({ id: 'r1' })],
      }),
      [],
      NOW
    );
    expect(rows).toEqual([
      { kind: 'section', title: 'TEXT CHANNELS' },
      { kind: 'channel', channel: expect.objectContaining({ id: 'pub' }), unread: 0 },
    ]);
    expect(rows.find((r) => r.kind === 'lounge')).toBeUndefined();
    expect(rows.find((r) => r.kind === 'members')).toBeUndefined();
  });

  it('guest with no public channels sees the guest empty copy', () => {
    const rows = buildCommunityChannelRows(
      payload({ viewer: { isMember: false, source: null, role: null } }),
      [],
      NOW
    );
    expect(rows).toEqual([
      { kind: 'section', title: 'TEXT CHANNELS' },
      { kind: 'empty', text: COMMUNITY_COPY.emptyChannelsGuest },
    ]);
  });

  it('overlays unread from the group store, lounge included', () => {
    const groups = [
      { id: 'lounge', name: 'Lounge', members: [], adminIds: [], unreadCount: 5 },
      { id: 'ch', name: 'ch', members: [], adminIds: [], unreadCount: 1 },
    ] as unknown as Group[];
    const rows = buildCommunityChannelRows(
      payload({
        lounge: channel({ id: 'lounge', name: 'Lounge', isLounge: true, isMember: true }),
        channels: [channel({ id: 'ch', name: 'ch' })],
      }),
      groups,
      NOW
    );
    expect(rows[0]).toMatchObject({ kind: 'lounge', unread: 5 });
    expect(rows[2]).toMatchObject({ kind: 'channel', unread: 1 });
  });

  it('drops rooms that have already closed', () => {
    const rows = buildCommunityChannelRows(
      payload({ rooms: [room({ id: 'old', startedAt: '2026-08-30T00:00:00.000Z' })] }),
      [],
      NOW
    );
    expect(rows.find((r) => r.kind === 'room')).toBeUndefined();
    expect(rows.find((r) => r.kind === 'empty' && r.text === COMMUNITY_COPY.emptyRooms)).toBeDefined();
  });
});

describe('isMemberOnline / splitMembers', () => {
  it('hidden is never online, even when present on the live channel', () => {
    expect(isMemberOnline({ id: 'h', onlineStatus: 'hidden' }, new Set(['h']))).toBe(false);
  });

  it('live presence or the stored window makes someone online', () => {
    expect(isMemberOnline({ id: 'a', onlineStatus: 'offline' }, new Set(['a']))).toBe(true);
    expect(isMemberOnline({ id: 'b', onlineStatus: 'online' }, new Set())).toBe(true);
    expect(isMemberOnline({ id: 'c', onlineStatus: 'offline' }, new Set())).toBe(false);
  });

  it('splits into name-sorted halves with hidden members offline', () => {
    const { online, offline } = splitMembers(
      [
        member({ id: 'z', name: 'Zed', onlineStatus: 'online' }),
        member({ id: 'h', name: 'Hidden', onlineStatus: 'hidden' }),
        member({ id: 'a', name: 'Ann', onlineStatus: 'offline' }),
        member({ id: 'b', name: 'Bob', onlineStatus: 'offline' }),
      ],
      new Set(['b', 'h'])
    );
    expect(online.map((m) => m.name)).toEqual(['Bob', 'Zed']);
    expect(offline.map((m) => m.name)).toEqual(['Ann', 'Hidden']);
  });
});

describe('communityOnlineCount', () => {
  it('uses the larger of the stored and live counts while connected', () => {
    expect(communityOnlineCount(2, new Set(['a', 'b', 'c']), true)).toBe(3);
    expect(communityOnlineCount(5, new Set(['a']), true)).toBe(5);
  });

  it('falls back to the stored count when the socket is down', () => {
    expect(communityOnlineCount(2, new Set(['a', 'b', 'c']), false)).toBe(2);
  });
});

describe('formatCommunityUnread', () => {
  it('caps at 99+ and never renders negatives or fractions', () => {
    expect(formatCommunityUnread(0)).toBe('0');
    expect(formatCommunityUnread(7)).toBe('7');
    expect(formatCommunityUnread(99)).toBe('99');
    expect(formatCommunityUnread(100)).toBe('99+');
    expect(formatCommunityUnread(2.7)).toBe('2');
    expect(formatCommunityUnread(-3)).toBe('0');
    expect(formatCommunityUnread(Number.NaN)).toBe('0');
  });
});

describe('communityUnreadTotal', () => {
  it('sums joined, non-archived groups in the community only', () => {
    const groups = [
      { communityId: 'c1', unreadCount: 3, isArchived: false },
      { communityId: 'c1', unreadCount: 4, isArchived: true },
      { communityId: 'c2', unreadCount: 9 },
      { communityId: 'c1', unreadCount: undefined },
      { communityId: null, unreadCount: 2 },
      { communityId: 'c1', unreadCount: 1 },
    ];
    expect(communityUnreadTotal(groups, 'c1')).toBe(4);
    expect(communityUnreadTotal(groups, 'c3')).toBe(0);
  });
});

describe('shouldSubscribeCommunityPresence', () => {
  it('members only, never in low-data mode, capped by size', () => {
    expect(shouldSubscribeCommunityPresence({ isMember: true, lowDataMode: false, memberCount: 10 })).toBe(true);
    expect(shouldSubscribeCommunityPresence({ isMember: false, lowDataMode: false, memberCount: 10 })).toBe(false);
    expect(shouldSubscribeCommunityPresence({ isMember: true, lowDataMode: true, memberCount: 10 })).toBe(false);
    expect(
      shouldSubscribeCommunityPresence({ isMember: true, lowDataMode: false, memberCount: COMMUNITY_PRESENCE_MAX_MEMBERS })
    ).toBe(true);
    expect(
      shouldSubscribeCommunityPresence({ isMember: true, lowDataMode: false, memberCount: COMMUNITY_PRESENCE_MAX_MEMBERS + 1 })
    ).toBe(false);
  });
});

describe('communityShareUrl / communityPresenceChannel', () => {
  it('builds the public slug URL with the production origin by default', () => {
    expect(communityShareUrl('ug-biology-101')).toBe('https://lanternstudy.com/discover/c/ug-biology-101');
    expect(communityShareUrl('x', 'http://localhost:5173')).toBe('http://localhost:5173/discover/c/x');
  });

  it('names the presence topic community:{id}', () => {
    expect(communityPresenceChannel('abc')).toBe('community:abc');
  });
});
