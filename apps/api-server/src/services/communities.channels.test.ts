/**
 * Community server view — the service half (Phase 1 · §2.1–2.4).
 *
 * Pins the membership boundary the payloads rest on:
 *   - a guest of a public community sees public channels only, no lounge,
 *     no rooms, no online count, and never an unjoined channel's preview;
 *   - a member gets unread/lastMessage ONLY on channels they are in, joined
 *     channels first, the lounge as its own row, the community's rooms;
 *   - pre-migration (no lounge_group_id column) the detail still answers 200
 *     with a null pointer instead of a 500;
 *   - the roster pages by (joined_at, user_id) with the cursor taken from the
 *     last RAW row, applies it as a keyset filter, and reports the creator
 *     as owner and a hidden-status member as 'hidden'.
 */
jest.mock('./cache', () => ({
  cacheService: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deletePattern: jest.fn(async () => undefined),
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
const listRooms = jest.fn(async () => [{ id: 'room-1', joined: true }]);
jest.mock('./studyRooms', () => ({
  getStudyRoomsService: () => ({ list: listRooms }),
}));

import { CommunitiesService, encodeMembersCursor } from './communities';

const VIEWER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const COMMUNITY = '33333333-3333-4333-8333-333333333333';
const LOUNGE = '44444444-4444-4444-8444-444444444444';
const COURSE = '55555555-5555-4555-8555-555555555555';
const CH_A = '66666666-6666-4666-8666-666666666666';
const CH_B = '77777777-7777-4777-8777-777777777777';

type StepResult = { data?: unknown; error?: unknown };
type Step = { table: string; result: StepResult };
type Query = { table: string; filters: Array<[string, ...unknown[]]> };

function makeDb(script: Step[], unread: Record<string, number> = {}) {
  const queries: Query[] = [];
  const db = {
    from(table: string) {
      const query: Query = { table, filters: [] };
      queries.push(query);
      const pop = (): StepResult => {
        const next = script.shift();
        if (!next) throw new Error(`script exhausted (query on ${table})`);
        if (next.table !== table) {
          throw new Error(`expected query on ${next.table}, got ${table}`);
        }
        return { data: null, error: null, ...next.result };
      };
      const chain: any = {};
      for (const m of ['select', 'eq', 'is', 'in', 'or', 'order', 'limit', 'lt', 'gt', 'neq']) {
        chain[m] = (...args: unknown[]) => {
          query.filters.push([m, ...args]);
          return chain;
        };
      }
      chain.maybeSingle = () => Promise.resolve(pop());
      chain.single = () => Promise.resolve(pop());
      chain.then = (resolve: any, reject: any) => Promise.resolve(pop()).then(resolve, reject);
      return chain;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  const service = new CommunitiesService({
    getClient: () => db,
    listBlockedUserIds: async () => [],
    getAllGroupUnreadCounts: async () => unread,
  } as never);
  return { service, queries, script };
}

const communityRow = (extra: Record<string, unknown> = {}) => ({
  id: COMMUNITY,
  kind: 'course',
  slug: 'course-pharm-101',
  name: 'PHARM 101',
  visibility: 'public',
  course_id: COURSE,
  member_count: 12,
  lounge_group_id: LOUNGE,
  created_by: OTHER,
  ...extra,
});

const groupRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Channel ${id.slice(0, 2)}`,
  description: null,
  avatar_url: null,
  member_count: 5,
  question_count: 0,
  visibility: 'community',
  course_id: null,
  parent_id: null,
  last_message: `last in ${id.slice(0, 2)}`,
  last_message_time: '2026-09-01T10:00:00+00:00',
  ...extra,
});

const onlineProfile = (showOnlineStatus: boolean) => ({
  profiles: { settings: { privacy: { showOnlineStatus } }, last_seen_at: new Date().toISOString() },
});

beforeEach(() => listRooms.mockClear());

describe('listChannels', () => {
  it('member: lounge row, unread/preview only on joined channels, joined first, rooms and online count', async () => {
    const { service, queries } = makeDb(
      [
        { table: 'communities', result: { data: communityRow() } },
        { table: 'community_members', result: { data: { user_id: VIEWER, source: 'joined', role: 'member' } } },
        {
          table: 'groups',
          result: {
            data: [
              // B has more members and comes first from the DB, but the viewer is not in it.
              groupRow(CH_B, { member_count: 9, visibility: 'public', last_message: 'secret' }),
              groupRow(CH_A, { member_count: 5 }),
            ],
          },
        },
        { table: 'groups', result: { data: groupRow(LOUNGE, { name: 'PHARM 101 Lounge' }) } },
        { table: 'group_members', result: { data: [{ group_id: CH_A }, { group_id: LOUNGE }] } },
        { table: 'community_members', result: { data: [onlineProfile(true), onlineProfile(false)] } },
      ],
      { [CH_A]: 3, [CH_B]: 7, [LOUNGE]: 1 },
    );

    const payload = await service.listChannels(VIEWER, COMMUNITY);

    expect(payload.viewer).toEqual({ isMember: true, source: 'joined', role: 'member' });
    expect(payload.memberCount).toBe(12);
    expect(payload.loungeGroupId).toBe(LOUNGE);
    expect(payload.lounge).toMatchObject({ id: LOUNGE, isLounge: true, isMember: true, unreadCount: 1 });

    expect(payload.channels.map((c) => c.id)).toEqual([CH_A, CH_B]);
    const [a, b] = payload.channels;
    expect(a).toMatchObject({ isMember: true, unreadCount: 3, lastMessage: 'last in 66', visibility: 'community' });
    // Unjoined: no count, no preview, ever.
    expect(b).toMatchObject({ isMember: false, unreadCount: 0, lastMessage: null, lastMessageTime: null, visibility: 'public' });

    expect(listRooms).toHaveBeenCalledWith(VIEWER, { communityId: COMMUNITY, courseId: COURSE });
    expect(payload.rooms).toEqual([{ id: 'room-1', joined: true }]);
    // One member shares their status, one hides it.
    expect(payload.onlineCount).toBe(1);

    // The channel query excludes the lounge pointer and only top-level groups.
    const channelQuery = queries.filter((q) => q.table === 'groups')[0];
    expect(channelQuery.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'community_id', COMMUNITY],
        ['is', 'parent_id', null],
        ['neq', 'id', LOUNGE],
        ['in', 'visibility', ['public', 'community']],
      ]),
    );
  });

  it('guest of a public community: public channels only, no lounge, no rooms, no online count', async () => {
    const { service, queries } = makeDb([
      { table: 'communities', result: { data: communityRow() } },
      { table: 'community_members', result: { data: null } },
      { table: 'groups', result: { data: [groupRow(CH_B, { visibility: 'public', last_message: 'secret' })] } },
      { table: 'group_members', result: { data: [] } },
    ]);

    const payload = await service.listChannels(VIEWER, COMMUNITY);

    expect(payload.viewer).toEqual({ isMember: false, source: null, role: null });
    expect(payload.lounge).toBeNull();
    expect(payload.loungeGroupId).toBe(LOUNGE);
    expect(payload.rooms).toEqual([]);
    expect(listRooms).not.toHaveBeenCalled();
    expect(payload.onlineCount).toBe(0);
    expect(payload.channels).toHaveLength(1);
    expect(payload.channels[0]).toMatchObject({ isMember: false, unreadCount: 0, lastMessage: null });
    const channelQuery = queries.filter((q) => q.table === 'groups')[0];
    expect(channelQuery.filters).toEqual(expect.arrayContaining([['in', 'visibility', ['public']]]));
  });

  it('guest of a private community: 404, before any channel read', async () => {
    const { service, script } = makeDb([
      { table: 'communities', result: { data: communityRow({ visibility: 'private' }) } },
      { table: 'community_members', result: { data: null } },
    ]);
    await expect(service.listChannels(VIEWER, COMMUNITY)).rejects.toMatchObject({
      message: 'Community not found',
      statusCode: 404,
    });
    expect(script).toHaveLength(0);
  });
});

describe('getBySlug', () => {
  it('pre-migration (42703 on lounge_group_id) still answers with a null pointer', async () => {
    const { service } = makeDb([
      { table: 'communities', result: { error: { code: '42703', message: 'column communities.lounge_group_id does not exist' } } },
      { table: 'communities', result: { data: communityRow({ lounge_group_id: undefined }) } },
      { table: 'community_members', result: { data: { user_id: VIEWER, source: 'auto', role: 'admin' } } },
      { table: 'community_members', result: { data: [] } },
    ]);
    const detail = await service.getBySlug(VIEWER, 'course-pharm-101');
    expect(detail).toMatchObject({
      id: COMMUNITY,
      lounge_group_id: null,
      created_by: OTHER,
      isMember: true,
      source: 'auto',
      viewerRole: 'admin',
      onlineCount: 0,
    });
  });

  it('the creator is the owner; a guest has no role and no online count', async () => {
    const owner = makeDb([
      { table: 'communities', result: { data: communityRow({ created_by: VIEWER }) } },
      { table: 'community_members', result: { data: { user_id: VIEWER, source: 'joined', role: 'admin' } } },
      { table: 'community_members', result: { data: [onlineProfile(true)] } },
    ]);
    await expect(owner.service.getBySlug(VIEWER, 'course-pharm-101')).resolves.toMatchObject({
      viewerRole: 'owner',
      onlineCount: 1,
    });

    const guest = makeDb([
      { table: 'communities', result: { data: communityRow() } },
      { table: 'community_members', result: { data: null } },
    ]);
    await expect(guest.service.getBySlug(VIEWER, 'course-pharm-101')).resolves.toMatchObject({
      isMember: false,
      viewerRole: null,
      onlineCount: 0,
      lounge_group_id: LOUNGE,
    });
  });
});

describe('listMembers paging', () => {
  const memberRow = (id: string, joinedAt: string, extra: Record<string, unknown> = {}) => ({
    user_id: id,
    source: 'joined',
    role: 'member',
    joined_at: joinedAt,
    profiles: {
      id,
      name: `User ${id.slice(0, 2)}`,
      avatar_url: null,
      programme: 'Pharmacy',
      settings: {},
      last_seen_at: null,
      ...extra,
    },
  });

  it('a full page yields a cursor from the last raw row; the next page applies it as a keyset filter', async () => {
    const t1 = '2026-08-24T12:00:00.000001+00:00';
    const t2 = '2026-08-24T12:00:00.000002+00:00';
    const first = makeDb([
      { table: 'community_members', result: { data: { user_id: VIEWER, source: 'joined' } } },
      { table: 'communities', result: { data: { id: COMMUNITY, created_by: OTHER } } },
      {
        table: 'community_members',
        result: {
          data: [
            memberRow(OTHER, t1),
            // Hidden from the viewer, but still the last RAW row — the cursor must come from it.
            memberRow(VIEWER.replace('1111', '9999'), t2, { settings: { privacy: { profileVisibility: 'private' } } }),
          ],
        },
      },
    ]);
    const page = await first.service.listMembers(VIEWER, COMMUNITY, { limit: 2 });
    expect(page.members.map((m) => m.id)).toEqual([OTHER]);
    expect(page.members[0]).toMatchObject({ role: 'owner', source: 'joined', joinedAt: t1, onlineStatus: 'offline' });
    expect(page.nextCursor).toBe(encodeMembersCursor(t2, VIEWER.replace('1111', '9999')));
    const roster = first.queries.filter((q) => q.table === 'community_members')[1];
    expect(roster.filters.some(([m]) => m === 'or')).toBe(false);
    expect(roster.filters).toEqual(expect.arrayContaining([['limit', 2]]));

    const second = makeDb([
      { table: 'community_members', result: { data: { user_id: VIEWER, source: 'joined' } } },
      { table: 'communities', result: { data: { id: COMMUNITY, created_by: OTHER } } },
      { table: 'community_members', result: { data: [memberRow(VIEWER, '2026-08-25T00:00:00+00:00', { settings: { privacy: { showOnlineStatus: false } } })] } },
    ]);
    const next = await second.service.listMembers(VIEWER, COMMUNITY, { limit: 2, cursor: page.nextCursor! });
    const uid = VIEWER.replace('1111', '9999');
    const roster2 = second.queries.filter((q) => q.table === 'community_members')[1];
    expect(roster2.filters).toEqual(
      expect.arrayContaining([['or', `joined_at.gt.${t2},and(joined_at.eq.${t2},user_id.gt.${uid})`]]),
    );
    // A short page ends the walk; a member hiding their status reads 'hidden'.
    expect(next.nextCursor).toBeNull();
    expect(next.members[0]).toMatchObject({ id: VIEWER, onlineStatus: 'hidden', role: 'member' });
  });

  it('a garbage cursor is a 400-class PublicError, not a broken query', async () => {
    const { service, script } = makeDb([
      { table: 'community_members', result: { data: { user_id: VIEWER, source: 'joined' } } },
    ]);
    await expect(service.listMembers(VIEWER, COMMUNITY, { cursor: 'garbage' })).rejects.toThrow('Invalid cursor');
    expect(script).toHaveLength(0);
  });

  it('clamps the page size to 1..50 (default 30)', async () => {
    const limits: number[] = [];
    for (const raw of [undefined, 0, 500, 7]) {
      const { service, queries } = makeDb([
        { table: 'community_members', result: { data: { user_id: VIEWER, source: 'joined' } } },
        { table: 'communities', result: { data: { id: COMMUNITY, created_by: null } } },
        { table: 'community_members', result: { data: [] } },
      ]);
      await service.listMembers(VIEWER, COMMUNITY, { limit: raw });
      const roster = queries.filter((q) => q.table === 'community_members')[1];
      limits.push(roster.filters.find(([m]) => m === 'limit')![1] as number);
    }
    expect(limits).toEqual([30, 30, 50, 7]);
  });
});
