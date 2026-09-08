/**
 * Community moderation — the server half.
 *
 * Pins the rules a client must never be trusted with:
 *   - roles are OWNER-only (a platform admin substitutes for the missing
 *     owner of an auto-derived campus room);
 *   - a moderator cannot mute a peer, and an omitted duration UNMUTES rather
 *     than muting forever;
 *   - removing a post is a soft removal that also clears the pin, and a post
 *     in another community answers 404 rather than confirming it exists;
 *   - EVERY invite refusal answers the same string, so the endpoint is not an
 *     oracle for which codes are real;
 *   - the announcement cap unpins the OLDEST beyond three, per community;
 *   - pre-migration every one of these answers 503, never a 500.
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
const logAdminAction = jest.fn(async () => undefined);
jest.mock('./adminAudit', () => ({ logAdminAction: (...a: unknown[]) => logAdminAction(...(a as [])) }));

import { CommunityModerationService } from './communityModeration';
import { setSchemaCapabilities } from './schemaCapabilities';
import { INVITE_REFUSAL_COPY } from '@lantern/shared/network';

const OWNER = '11111111-1111-4111-8111-111111111111';
const MOD = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const COMMUNITY = '44444444-4444-4444-8444-444444444444';
const OTHER_COMMUNITY = '55555555-5555-4555-8555-555555555555';
const POST = '66666666-6666-4666-8666-666666666666';
const GROUP = '77777777-7777-4777-8777-777777777777';

type StepResult = { data?: unknown; error?: unknown; count?: number };
type Step = { table: string; result: StepResult };
type Query = { table: string; filters: Array<[string, ...unknown[]]> };

/** `Array.prototype.at` is not in this tsconfig's lib. */
const last = <T>(items: T[]): T => items[items.length - 1];
/** The argument a chained builder method was called with. */
const argOf = (query: Query, method: string): any =>
  (query.filters.find((f) => f[0] === method) as any)?.[1];

function makeDb(script: Step[], opts: { rpc?: StepResult; isPlatformAdmin?: boolean } = {}) {
  const queries: Query[] = [];
  const db: any = {
    from(table: string) {
      const query: Query = { table, filters: [] };
      queries.push(query);
      const pop = (): StepResult => {
        const next = script.shift();
        if (!next) throw new Error(`script exhausted (query on ${table})`);
        if (next.table !== table) throw new Error(`expected ${next.table}, got ${table}`);
        return { data: null, error: null, ...next.result };
      };
      const chain: any = {};
      for (const m of ['select', 'eq', 'is', 'in', 'or', 'order', 'limit', 'not', 'insert', 'update', 'upsert', 'delete']) {
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
    rpc: () => Promise.resolve(opts.rpc ?? { data: null, error: null }),
  };
  const service = new CommunityModerationService({
    getClient: () => db,
    isPlatformAdmin: async () => opts.isPlatformAdmin === true,
  } as never);
  return { service, queries, script, db };
}

/** communities read + community_members read, the two `resolveActor` makes. */
const actorScript = (role: string | null, extra: Record<string, unknown> = {}): Step[] => [
  { table: 'communities', result: { data: { id: COMMUNITY, created_by: OWNER, visibility: 'public' } } },
  { table: 'community_members', result: { data: role ? { role, source: 'joined', ...extra } : null } },
];

beforeEach(() => {
  logAdminAction.mockClear();
  setSchemaCapabilities({
    messagePostKind: true,
    communityMemberMute: true,
    communityEventFields: true,
    communityInvites: true,
  });
});

afterEach(() => {
  setSchemaCapabilities({
    messagePostKind: null,
    communityMemberMute: null,
    communityEventFields: null,
    communityInvites: null,
  });
});

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

describe('setMemberRole', () => {
  it('lets the owner promote a member, and audits it', async () => {
    const { service } = makeDb([
      ...actorScript('admin'), // created_by === OWNER, so resolveCommunityRole says 'owner'
      { table: 'community_members', result: { data: { role: 'member' } } },
      { table: 'community_members', result: {} },
    ]);
    await expect(service.setMemberRole(OWNER, COMMUNITY, MEMBER, 'moderator')).resolves.toEqual({
      userId: MEMBER,
      role: 'moderator',
    });
    expect(logAdminAction).toHaveBeenCalledTimes(1);
    expect((logAdminAction.mock.calls[0] as any[])[1]).toMatchObject({
      action: 'community_role_set',
      targetType: 'community_member',
    });
  });

  it('refuses an admin — an admin who mints admins is an owner by another name', async () => {
    const { service } = makeDb([
      ...actorScript('admin'),
      { table: 'community_members', result: { data: { role: 'member' } } },
    ]);
    await expect(service.setMemberRole(MOD, COMMUNITY, MEMBER, 'admin')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('refuses an unknown role before it touches the database', async () => {
    const { service, script } = makeDb([]);
    await expect(service.setMemberRole(OWNER, COMMUNITY, MEMBER, 'owner')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(script.length).toBe(0);
  });

  it('404s when the target is not in the community', async () => {
    const { service } = makeDb([
      ...actorScript('admin'),
      { table: 'community_members', result: { data: null } },
    ]);
    await expect(service.setMemberRole(OWNER, COMMUNITY, MEMBER, 'moderator')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('lets a platform admin moderate an auto-derived community that has no owner', async () => {
    const { service } = makeDb(
      [
        { table: 'communities', result: { data: { id: COMMUNITY, created_by: null, visibility: 'public' } } },
        { table: 'community_members', result: { data: null } },
        { table: 'community_members', result: { data: { role: 'member' } } },
        { table: 'community_members', result: {} },
      ],
      { isPlatformAdmin: true },
    );
    await expect(service.setMemberRole(MOD, COMMUNITY, MEMBER, 'moderator')).resolves.toEqual({
      userId: MEMBER,
      role: 'moderator',
    });
  });
});

// ---------------------------------------------------------------------------
// Mutes
// ---------------------------------------------------------------------------

describe('muteMember', () => {
  it('mutes a member for a fixed window and audits it', async () => {
    const { service, queries } = makeDb([
      ...actorScript('moderator'),
      { table: 'community_members', result: { data: { role: 'member' } } },
      { table: 'community_members', result: {} },
    ]);
    const result = await service.muteMember(MOD, COMMUNITY, MEMBER, {
      duration: '24h',
      reason: 'Spamming the board',
    });
    expect(result.userId).toBe(MEMBER);
    expect(Date.parse(result.mutedUntil as string)).toBeGreaterThan(Date.now());
    const update = queries.find((q) => q.filters.some((f) => f[0] === 'update'))!;
    expect(argOf(update, 'update')).toMatchObject({
      muted_by: MOD,
      muted_reason: 'Spamming the board',
    });
  });

  it('refuses a peer — a moderator cannot mute another moderator', async () => {
    const { service } = makeDb([
      ...actorScript('moderator'),
      { table: 'community_members', result: { data: { role: 'moderator' } } },
    ]);
    await expect(
      service.muteMember(MOD, COMMUNITY, MEMBER, { duration: '24h' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('an omitted or unrecognised duration UNMUTES rather than muting forever', async () => {
    for (const duration of [undefined, 'forever']) {
      const { service, queries } = makeDb([
        ...actorScript('moderator'),
        { table: 'community_members', result: { data: { role: 'member' } } },
        { table: 'community_members', result: {} },
      ]);
      const result = await service.muteMember(MOD, COMMUNITY, MEMBER, { duration });
      expect(result.mutedUntil).toBeNull();
      const update = queries.find((q) => q.filters.some((f) => f[0] === 'update'))!;
      expect(argOf(update, 'update')).toEqual({
        muted_until: null,
        muted_by: null,
        muted_reason: null,
      });
    }
  });

  it('answers 503, not 500, before the migration is applied', async () => {
    setSchemaCapabilities({ communityMemberMute: false });
    const { service, script } = makeDb([]);
    await expect(
      service.muteMember(MOD, COMMUNITY, MEMBER, { duration: '24h' }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(script.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Post removal
// ---------------------------------------------------------------------------

describe('removePost', () => {
  const postRow = (over: Record<string, unknown> = {}) => ({
    id: POST,
    sender_id: MEMBER,
    group_id: GROUP,
    removed_at: null,
    groups: { id: GROUP, community_id: COMMUNITY },
    ...over,
  });

  it('soft-removes with a reason AND clears the pin', async () => {
    const { service, queries } = makeDb([
      ...actorScript('moderator'),
      { table: 'messages', result: { data: postRow() } },
      { table: 'messages', result: {} },
    ]);
    const result = await service.removePost(MOD, COMMUNITY, POST, 'Off topic');
    expect(result.id).toBe(POST);
    const update = last(queries.filter((q) => q.table === 'messages'));
    expect(argOf(update, 'update')).toMatchObject({
      removed_by: MOD,
      removed_reason: 'Off topic',
      pinned_at: null,
      pinned_by: null,
    });
  });

  it('lets the author remove their own post', async () => {
    const { service } = makeDb([
      ...actorScript('member'),
      { table: 'messages', result: { data: postRow({ sender_id: MEMBER }) } },
      { table: 'messages', result: {} },
    ]);
    await expect(service.removePost(MEMBER, COMMUNITY, POST, null)).resolves.toMatchObject({
      id: POST,
    });
  });

  it('refuses a plain member removing someone else’s post', async () => {
    const { service } = makeDb([
      ...actorScript('member'),
      { table: 'messages', result: { data: postRow({ sender_id: OWNER }) } },
    ]);
    await expect(service.removePost(MEMBER, COMMUNITY, POST, null)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('answers 404 for a post in ANOTHER community, never "wrong community"', async () => {
    const { service } = makeDb([
      ...actorScript('owner'),
      {
        table: 'messages',
        result: { data: postRow({ groups: { id: GROUP, community_id: OTHER_COMMUNITY } }) },
      },
    ]);
    await expect(service.removePost(OWNER, COMMUNITY, POST, null)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Post not found',
    });
  });

  it('is idempotent on an already-removed post', async () => {
    const { service, script } = makeDb([
      ...actorScript('moderator'),
      { table: 'messages', result: { data: postRow({ removed_at: '2026-09-01T00:00:00Z' }) } },
    ]);
    await expect(service.removePost(MOD, COMMUNITY, POST, null)).resolves.toEqual({
      id: POST,
      removedAt: '2026-09-01T00:00:00Z',
    });
    expect(script.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Accepted answer
// ---------------------------------------------------------------------------

describe('markPostAnswered', () => {
  const REPLY = '88888888-8888-4888-8888-888888888888';
  const OTHER_REPLY = '99999999-9999-4999-8999-999999999999';

  /** A question post on this community's board, by MEMBER. */
  const questionRow = (over: Record<string, unknown> = {}) => ({
    id: POST,
    sender_id: MEMBER,
    group_id: GROUP,
    post_kind: 'question',
    removed_at: null,
    answered_message_id: null,
    groups: { id: GROUP, community_id: COMMUNITY },
    ...over,
  });

  /** A reply hanging under POST's thread. */
  const replyRow = (over: Record<string, unknown> = {}) => ({
    id: REPLY,
    thread_root_id: POST,
    removed_at: null,
    ...over,
  });

  it('lets a moderator mark a question answered and audits community_post_answer', async () => {
    const { service, queries } = makeDb([
      ...actorScript('moderator'),
      { table: 'messages', result: { data: questionRow() } },
      { table: 'messages', result: { data: replyRow() } },
      { table: 'messages', result: {} },
    ]);
    await expect(service.markPostAnswered(MOD, COMMUNITY, POST, REPLY)).resolves.toEqual({
      id: POST,
      answeredMessageId: REPLY,
      cleared: false,
    });
    const update = last(queries.filter((q) => q.filters.some((f) => f[0] === 'update')));
    expect(argOf(update, 'update')).toEqual({ answered_message_id: REPLY });
    expect((logAdminAction.mock.calls[0] as any[])[1]).toMatchObject({
      action: 'community_post_answer',
      targetType: 'community_post',
      targetId: POST,
    });
  });

  it('lets the question’s author mark it answered', async () => {
    const { service } = makeDb([
      ...actorScript('member'),
      { table: 'messages', result: { data: questionRow({ sender_id: MEMBER }) } },
      { table: 'messages', result: { data: replyRow() } },
      { table: 'messages', result: {} },
    ]);
    await expect(service.markPostAnswered(MEMBER, COMMUNITY, POST, REPLY)).resolves.toMatchObject({
      answeredMessageId: REPLY,
      cleared: false,
    });
  });

  it('refuses a plain member who is not the author (server is the gate)', async () => {
    const { service } = makeDb([
      ...actorScript('member'),
      { table: 'messages', result: { data: questionRow({ sender_id: OWNER }) } },
    ]);
    await expect(service.markPostAnswered(MEMBER, COMMUNITY, POST, REPLY)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('refuses a non-question post — only answerable kinds can be answered', async () => {
    const { service } = makeDb([
      ...actorScript('moderator'),
      { table: 'messages', result: { data: questionRow({ post_kind: 'discussion' }) } },
    ]);
    await expect(service.markPostAnswered(MOD, COMMUNITY, POST, REPLY)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('refuses a reply from another thread — the answer must belong to THIS question', async () => {
    const { service } = makeDb([
      ...actorScript('moderator'),
      { table: 'messages', result: { data: questionRow() } },
      { table: 'messages', result: { data: replyRow({ id: OTHER_REPLY, thread_root_id: OTHER_REPLY }) } },
    ]);
    await expect(service.markPostAnswered(MOD, COMMUNITY, POST, OTHER_REPLY)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('refuses pointing a question at itself — a root post is nobody’s answer', async () => {
    const { service } = makeDb([
      ...actorScript('moderator'),
      { table: 'messages', result: { data: questionRow() } },
      // The post read back as an "answer" carries the root's null thread_root_id.
      { table: 'messages', result: { data: { id: POST, thread_root_id: null, removed_at: null } } },
    ]);
    await expect(service.markPostAnswered(MOD, COMMUNITY, POST, POST)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('refuses a removed reply as the accepted answer', async () => {
    const { service } = makeDb([
      ...actorScript('moderator'),
      { table: 'messages', result: { data: questionRow() } },
      { table: 'messages', result: { data: replyRow({ removed_at: '2026-09-01T00:00:00Z' }) } },
    ]);
    await expect(service.markPostAnswered(MOD, COMMUNITY, POST, REPLY)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('404s for a question in ANOTHER community, never "wrong community"', async () => {
    const { service } = makeDb([
      ...actorScript('owner'),
      {
        table: 'messages',
        result: { data: questionRow({ groups: { id: GROUP, community_id: OTHER_COMMUNITY } }) },
      },
    ]);
    await expect(service.markPostAnswered(OWNER, COMMUNITY, POST, REPLY)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Post not found',
    });
  });

  it('un-answers when the answer id is null, and clearing is a distinct audited action', async () => {
    const { service, queries } = makeDb([
      ...actorScript('moderator'),
      { table: 'messages', result: { data: questionRow({ answered_message_id: REPLY }) } },
      { table: 'messages', result: {} },
    ]);
    await expect(service.markPostAnswered(MOD, COMMUNITY, POST, null)).resolves.toEqual({
      id: POST,
      answeredMessageId: null,
      cleared: true,
    });
    // No reply lookup on the clear path — only the post read and the update.
    expect(queries.filter((q) => q.table === 'messages').length).toBe(2);
    const update = last(queries.filter((q) => q.filters.some((f) => f[0] === 'update')));
    expect(argOf(update, 'update')).toEqual({ answered_message_id: null });
    expect((logAdminAction.mock.calls[0] as any[])[1]).toMatchObject({
      action: 'community_post_unanswer',
      metadata: expect.objectContaining({ previousAnsweredMessageId: REPLY }),
    });
  });

  it('answers 503, not 500, before the migration is applied', async () => {
    setSchemaCapabilities({ messagePostKind: false });
    const { service, script } = makeDb([]);
    await expect(service.markPostAnswered(MOD, COMMUNITY, POST, REPLY)).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(script.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Announcement cap
// ---------------------------------------------------------------------------

describe('enforceAnnouncementCap', () => {
  it('unpins everything beyond the newest three, across the whole community', async () => {
    const pinned = (id: string, at: string) => ({ id, pinned_at: at });
    const { service, queries } = makeDb([
      { table: 'groups', result: { data: [{ id: GROUP }, { id: 'g2' }] } },
      {
        table: 'messages',
        result: {
          data: [
            pinned('a', '2026-09-05T00:00:00Z'),
            pinned('b', '2026-09-04T00:00:00Z'),
            pinned('c', '2026-09-03T00:00:00Z'),
            pinned('d', '2026-09-02T00:00:00Z'),
            pinned('e', '2026-09-01T00:00:00Z'),
          ],
        },
      },
      { table: 'messages', result: {} },
    ]);
    await expect(service.enforceAnnouncementCap(COMMUNITY)).resolves.toEqual(['d', 'e']);
    const update = last(queries.filter((q) => q.table === 'messages'));
    expect(update.filters).toContainEqual(['in', 'id', ['d', 'e']]);
  });

  it('does nothing at or under the cap', async () => {
    const { service } = makeDb([
      { table: 'groups', result: { data: [{ id: GROUP }] } },
      { table: 'messages', result: { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } },
    ]);
    await expect(service.enforceAnnouncementCap(COMMUNITY)).resolves.toEqual([]);
  });

  it('fails soft — a cap it cannot enforce never fails the post that was just written', async () => {
    const { service } = makeDb([
      { table: 'groups', result: { error: { code: '42501', message: 'nope' } } },
    ]);
    await expect(service.enforceAnnouncementCap(COMMUNITY)).resolves.toEqual([]);
  });

  it('is a no-op before the migration', async () => {
    setSchemaCapabilities({ messagePostKind: false });
    const { service, script } = makeDb([]);
    await expect(service.enforceAnnouncementCap(COMMUNITY)).resolves.toEqual([]);
    expect(script.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

describe('invites', () => {
  it('mints a code a moderator can read aloud, and caps live invites', async () => {
    const { service } = makeDb([
      ...actorScript('moderator'),
      { table: 'community_invites', result: { count: 1 } },
      { table: 'community_invites', result: {} },
    ]);
    const invite = await service.createInvite(MOD, COMMUNITY, {});
    expect(invite.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(invite.uses).toBe(0);
    expect(Date.parse(invite.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('refuses a sixth live invite with 409', async () => {
    const { service } = makeDb([
      ...actorScript('owner'),
      { table: 'community_invites', result: { count: 5 } },
    ]);
    await expect(service.createInvite(OWNER, COMMUNITY, {})).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('refuses a plain member', async () => {
    const { service } = makeDb([...actorScript('member')]);
    await expect(service.createInvite(MEMBER, COMMUNITY, {})).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('clamps a greedy expiry and use count', async () => {
    const { service, queries } = makeDb([
      ...actorScript('owner'),
      { table: 'community_invites', result: { count: 0 } },
      { table: 'community_invites', result: {} },
    ]);
    const invite = await service.createInvite(OWNER, COMMUNITY, {
      expiresInMs: 365 * 24 * 60 * 60 * 1000,
      maxUses: 1_000_000,
    });
    expect(invite.maxUses).toBe(500);
    expect(Date.parse(invite.expiresAt) - Date.now()).toBeLessThanOrEqual(
      30 * 24 * 60 * 60 * 1000 + 1000,
    );
    const insert = last(queries.filter((q) => q.table === 'community_invites'));
    expect(argOf(insert, 'insert')).toMatchObject({
      community_id: COMMUNITY,
      max_uses: 500,
    });
  });

  it('answers 503 before the table exists', async () => {
    setSchemaCapabilities({ communityInvites: false });
    const { service, script } = makeDb([]);
    await expect(service.createInvite(OWNER, COMMUNITY, {})).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(script.length).toBe(0);
  });
});

describe('joinByCode', () => {
  it('joins as a "joined" member when the code redeems', async () => {
    const { service, queries } = makeDb(
      [
        { table: 'communities', result: { data: { id: COMMUNITY, slug: 'club-law', name: 'Law Society' } } },
        { table: 'community_members', result: {} },
      ],
      { rpc: { data: [{ community_id: COMMUNITY }] } },
    );
    await expect(service.joinByCode(MEMBER, 'abcd-2345')).resolves.toEqual({
      joined: true,
      communityId: COMMUNITY,
      slug: 'club-law',
      name: 'Law Society',
    });
    const upsert = queries.find((q) => q.table === 'community_members')!;
    expect(argOf(upsert, 'upsert')).toMatchObject({
      source: 'joined',
      opted_out_at: null,
    });
  });

  it('answers the SAME string for a malformed code and a code that did not redeem', async () => {
    const malformed = makeDb([]);
    await expect(malformed.service.joinByCode(MEMBER, 'nope')).rejects.toMatchObject({
      statusCode: 404,
      message: INVITE_REFUSAL_COPY,
    });
    // No database query at all for a code that could never exist.
    expect(malformed.queries.length).toBe(0);

    const spent = makeDb([], { rpc: { data: [] } });
    await expect(spent.service.joinByCode(MEMBER, 'ABCD2345')).rejects.toMatchObject({
      statusCode: 404,
      message: INVITE_REFUSAL_COPY,
    });
  });

  it('answers 503 before the table exists', async () => {
    setSchemaCapabilities({ communityInvites: false });
    const { service } = makeDb([]);
    await expect(service.joinByCode(MEMBER, 'ABCD2345')).rejects.toMatchObject({
      statusCode: 503,
    });
  });
});

// ---------------------------------------------------------------------------
// assertCanPost
// ---------------------------------------------------------------------------

describe('assertCanPost', () => {
  it('refuses a non-member and a muted member with 403', async () => {
    const guest = makeDb([...actorScript(null)]);
    await expect(guest.service.assertCanPost(MEMBER, COMMUNITY)).rejects.toMatchObject({
      statusCode: 403,
    });

    const future = new Date(Date.now() + 60_000).toISOString();
    const muted = makeDb([...actorScript('member', { muted_until: future })]);
    await expect(muted.service.assertCanPost(MEMBER, COMMUNITY)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('lets a member with an EXPIRED mute post', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { service } = makeDb([...actorScript('member', { muted_until: past })]);
    await expect(service.assertCanPost(MEMBER, COMMUNITY)).resolves.toMatchObject({
      isMember: true,
    });
  });
});
