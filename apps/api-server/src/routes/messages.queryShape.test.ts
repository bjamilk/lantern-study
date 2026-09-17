/**
 * Query shapes AND responses for the direct database escapes in
 * `routes/messages.ts` (lane R2, PR 2b).
 *
 * Three `dataLayer.getClient()` sites, but SIX chains: one of them is a single
 * `const client` spanning the whole of `GET /search`. `messages.search.test.ts`
 * exists but only covers the two guards that answer BEFORE any query (it throws
 * from `getClient` on purpose), so every chain below was unexercised. Lane R2
 * moves them into `services/data/messageSearch.ts` and
 * `services/data/directMessages.ts`.
 *
 * Written and committed against the UNTOUCHED routes.
 *
 * ## Search is an authorization problem, not a text problem
 *
 * The service role BYPASSES RLS, so a search over `messages` and `dm_messages`
 * with no scope would return every private conversation on the platform. What
 * prevents that is the order these chains run in: FIRST resolve which groups the
 * caller belongs to and which threads they participate in, THEN search only
 * within those id lists. Every one of those predicates is asserted literally
 * below, including:
 *
 *   - the membership read for a caller-supplied `groupId`, which is what turns
 *     "search this group" into "search it only if you are in it";
 *   - `contains("participant_ids", '["<uuid>"]')` — a JSON STRING, not a JS
 *     array. PostgREST renders an array as Postgres `{uuid}` and fails 22P02, so
 *     the string form is load-bearing, not a style choice;
 *   - `is("removed_at", null)` on both stores, so a deleted message cannot be
 *     recovered through search;
 *   - `limit(limit)` and the 300-row scope caps.
 *
 * `GET /dm/threads` is the same shape: `contains` on the caller's id, then a
 * second pass in the handler that drops threads they hid. Both are frozen.
 */
jest.mock('../middleware/auth', () => ({
  ...jest.requireActual('../middleware/auth'),
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import router, { initializeMessageRoutes } from './messages';
import { createQueryRecorder, runRouteHandler, type QueryResult, type ResolveResult } from '../testSupport/queryRecorder';

const USER = 'user-1';
const OTHER = 'user-2';

function initWith(resolve?: ResolveResult) {
  const rec = createQueryRecorder(resolve);
  initializeMessageRoutes(
    {
      getClient: () => rec.client,
      groups: {},
      users: {},
      notifications: {},
      readState: {},
      mappers: {},
      directMessages: {},
      groupMessages: {},
      uploads: {},
    } as any,
    { get: jest.fn(async () => null), set: jest.fn(async () => {}), delete: jest.fn(async () => {}) } as any,
  );
  return rec;
}

const ok = (data: unknown): QueryResult => ({ data, error: null });

describe('GET /search — scope resolution', () => {
  it('checks membership for a caller-supplied groupId before searching it', async () => {
    const rec = initWith((table) =>
      table === 'group_members' ? ok({ group_id: 'g1' }) : ok([]),
    );

    const res = await runRouteHandler(router, 'get', '/search', {
      user: { id: USER },
      query: { q: 'mitosis', groupId: 'g1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ results: [] });

    // The membership read comes FIRST, and is scoped to BOTH the group and the
    // caller: it is the whole of "you may search this group".
    expect(rec.trace.slice(0, 5)).toEqual([
      'from("group_members")',
      'select("group_id")',
      'eq("group_id", "g1")',
      `eq("user_id", "${USER}")`,
      'maybeSingle()',
    ]);
  });

  it('searches NOTHING when the caller is not in the group they asked for', async () => {
    const rec = initWith((table) => (table === 'group_members' ? ok(null) : ok([])));

    const res = await runRouteHandler(router, 'get', '/search', {
      user: { id: USER },
      query: { q: 'mitosis', groupId: 'g1' },
    });

    expect(res.body).toEqual({ results: [] });
    // Membership missed, so `messages` is never reached. A thread pass still
    // runs, because a groupId scope does not exclude DMs the caller is in.
    expect(rec.tables()).not.toContain('from("messages")');
  });

  it('resolves every group the caller belongs to when no scope is given, capped at 300', async () => {
    const rec = initWith(ok([]));

    await runRouteHandler(router, 'get', '/search', {
      user: { id: USER },
      query: { q: 'mitosis' },
    });

    expect(rec.trace.slice(0, 4)).toEqual([
      'from("group_members")',
      'select("group_id")',
      `eq("user_id", "${USER}")`,
      'limit(300)',
    ]);
  });

  it('resolves DM threads with a JSON STRING contains, not a JS array', async () => {
    const rec = initWith(ok([]));

    await runRouteHandler(router, 'get', '/search', {
      user: { id: USER },
      query: { q: 'mitosis' },
    });

    const threadChain = rec.trace.indexOf('from("dm_threads")');
    expect(threadChain).toBeGreaterThan(-1);
    expect(rec.trace.slice(threadChain, threadChain + 4)).toEqual([
      'from("dm_threads")',
      'select("id, participant_ids, participants, hidden_by")',
      // A JS array becomes Postgres {uuid} and fails 22P02.
      `contains("participant_ids", "[\\"${USER}\\"]")`,
      'limit(300)',
    ]);
  });
});

describe('GET /search — the searches themselves', () => {
  const groupMessage = {
    id: 'm1',
    group_id: 'g1',
    sender_id: OTHER,
    text: 'mitosis notes',
    question_stem: null,
    timestamp: '2026-09-01T00:00:00.000Z',
  };

  it('searches group messages only within resolved groups, excluding removed rows', async () => {
    const rec = initWith((table) => {
      if (table === 'group_members') return ok([{ group_id: 'g1' }]);
      if (table === 'dm_threads') return ok([]);
      if (table === 'messages') return ok([groupMessage]);
      if (table === 'groups') return ok([{ id: 'g1', name: 'Bio', avatar_url: null }]);
      return ok([]);
    });

    const res = await runRouteHandler(router, 'get', '/search', {
      user: { id: USER },
      query: { q: 'mitosis', limit: '5' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.results).toEqual([
      {
        id: 'm1',
        chatType: 'group',
        chatId: 'g1',
        chatName: 'Bio',
        chatAvatarUrl: null,
        otherUserId: null,
        text: 'mitosis notes',
        senderId: OTHER,
        timestamp: '2026-09-01T00:00:00.000Z',
      },
    ]);

    const at = rec.trace.indexOf('from("messages")');
    expect(rec.trace.slice(at, at + 7)).toEqual([
      'from("messages")',
      'select("id, group_id, sender_id, text, question_stem, timestamp")',
      'in("group_id", ["g1"])',
      // A deleted message must not come back through search.
      'is("removed_at", null)',
      'or("text.ilike.%mitosis%,question_stem.ilike.%mitosis%")',
      'order("timestamp", {"ascending":false})',
      'limit(5)',
    ]);
  });

  it('strips the characters that would break the PostgREST or() expression', async () => {
    const rec = initWith((table) =>
      table === 'group_members' ? ok([{ group_id: 'g1' }]) : ok([]),
    );

    await runRouteHandler(router, 'get', '/search', {
      user: { id: USER },
      query: { q: 'a,b(c)%d_e' },
    });

    const at = rec.trace.indexOf('from("messages")');
    expect(rec.trace[at + 4]).toBe('or("text.ilike.%a b c  d e%,question_stem.ilike.%a b c  d e%")');
  });

  it('answers empty without a single query for a one-character term', async () => {
    const rec = initWith();

    const res = await runRouteHandler(router, 'get', '/search', {
      user: { id: USER },
      query: { q: 'a' },
    });

    expect(res.body).toEqual({ results: [] });
    expect(rec.tables()).toEqual([]);
  });
});

describe('GET /dm/threads', () => {
  const thread = (over: Record<string, unknown> = {}) => ({
    id: 't1',
    participant_ids: [USER, OTHER],
    participants: {},
    last_message: 'hi',
    last_message_time: '2026-09-01T00:00:00.000Z',
    archived_by: [],
    hidden_by: [],
    history_cleared_at: null,
    status: 'active',
    requested_by: null,
    ...over,
  });

  it('reads the caller threads newest first, then their counterpart profiles', async () => {
    const rec = initWith((table) =>
      table === 'dm_threads' ? ok([thread()]) : ok([{ id: OTHER, name: 'Ada', avatar_url: null }]),
    );

    const res = await runRouteHandler(router, 'get', '/dm/threads', { user: { id: USER } });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    expect(rec.trace).toEqual([
      'from("dm_threads")',
      'select("id, participant_ids, participants, last_message, last_message_time, archived_by, hidden_by, history_cleared_at, status, requested_by")',
      `contains("participant_ids", "[\\"${USER}\\"]")`,
      'order("last_message_time", {"ascending":false,"nullsFirst":false})',
      'from("profiles")',
      'select("id, name, avatar_url")',
      `in("id", ["${OTHER}"])`,
    ]);
  });

  it('skips the profile read entirely when the caller has no threads', async () => {
    const rec = initWith(ok([]));

    const res = await runRouteHandler(router, 'get', '/dm/threads', { user: { id: USER } });

    expect(res.statusCode).toBe(200);
    expect(rec.tables()).toEqual(['from("dm_threads")']);
  });

  it('drops a thread the caller hid, and so reads no profile for it', async () => {
    const rec = initWith(ok([thread({ hidden_by: [USER] })]));

    await runRouteHandler(router, 'get', '/dm/threads', { user: { id: USER } });

    expect(rec.tables()).toEqual(['from("dm_threads")']);
  });

  it('answers 500 when the thread read fails', async () => {
    initWith({ data: null, error: { code: '22P02', message: 'invalid json' } });

    const res = await runRouteHandler(router, 'get', '/dm/threads', { user: { id: USER } });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to fetch DM threads' });
  });
});
