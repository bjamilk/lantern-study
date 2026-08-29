/**
 * Community lounges — the "a community you cannot talk in is just a
 * directory" fix (founder feedback 2026-08-29). Pins the four behaviours the
 * design rests on:
 *
 *   1. members only — the lounge inherits the community's membership boundary;
 *   2. pre-migration the endpoint fails SOFT (503 + copy), never a 500;
 *   3. the minted group is admin-less (nobody can hijack or delete an
 *      official scope community's chat) and community-gated;
 *   4. two concurrent first-openers converge on ONE lounge — the loser adopts
 *      the winner's group and deletes its own orphan.
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

import { CommunitiesService } from './communities';

const VIEWER = '11111111-1111-4111-8111-111111111111';
const COMMUNITY = '33333333-3333-4333-8333-333333333333';
const GROUP = '44444444-4444-4444-8444-444444444444';
const WINNER_GROUP = '55555555-5555-4555-8555-555555555555';

type StepResult = { data?: unknown; error?: unknown; count?: number | null };
type Step = { table: string; result: StepResult };

/**
 * Scripted PostgREST double: every terminal await (maybeSingle / single /
 * awaiting the chain itself) pops the next step, asserting the table matches
 * so a re-ordered query fails loudly instead of silently passing.
 */
function makeDb(script: Step[]) {
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
  const db = {
    from(table: string) {
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
        chain[m] = () => chain;
      }
      chain.insert = (payload: unknown) => {
        calls.push({ table, op: 'insert', payload });
        return chain;
      };
      chain.update = (payload: unknown) => {
        calls.push({ table, op: 'update', payload });
        return chain;
      };
      chain.delete = () => {
        calls.push({ table, op: 'delete' });
        return chain;
      };
      chain.upsert = (payload: unknown) => {
        calls.push({ table, op: 'upsert', payload });
        return chain;
      };
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
  } as never);
  return { service, calls, script };
}

const membershipRow: Step = {
  table: 'community_members',
  result: { data: { user_id: VIEWER } },
};

describe('openLounge', () => {
  it('refuses non-members with a 403', async () => {
    const { service } = makeDb([{ table: 'community_members', result: { data: null } }]);
    await expect(service.openLounge(VIEWER, COMMUNITY)).rejects.toMatchObject({
      message: 'Join this community first',
      statusCode: 403,
    });
  });

  it('fails soft (503) before the lounge migration is applied', async () => {
    const { service } = makeDb([
      membershipRow,
      { table: 'communities', result: { data: null, error: { code: '42703' } } },
    ]);
    await expect(service.openLounge(VIEWER, COMMUNITY)).rejects.toMatchObject({
      message: 'Community chat is not available yet',
      statusCode: 503,
    });
  });

  it('mints an admin-less community-gated group on first open and joins the caller', async () => {
    const { service, calls, script } = makeDb([
      membershipRow,
      {
        table: 'communities',
        result: { data: { id: COMMUNITY, name: 'UNILAG Medicine & Surgery', course_id: null, lounge_group_id: null } },
      },
      { table: 'groups', result: { data: { id: GROUP } } },
      { table: 'communities', result: { data: [{ id: COMMUNITY }] } }, // pointer claim won
      { table: 'group_members', result: {} },
    ]);

    const out = await service.openLounge(VIEWER, COMMUNITY);
    expect(out).toEqual({ groupId: GROUP, name: 'UNILAG Medicine & Surgery Lounge', created: true });
    expect(script).toHaveLength(0);

    const insert = calls.find((c) => c.op === 'insert' && c.table === 'groups');
    expect(insert?.payload).toMatchObject({
      admin_ids: [],
      visibility: 'community',
      community_id: COMMUNITY,
      is_archived: false,
    });
    const join = calls.find((c) => c.op === 'upsert' && c.table === 'group_members');
    expect(join?.payload).toMatchObject({ group_id: GROUP, user_id: VIEWER, pending: false });
  });

  it('reuses the existing lounge without minting anything', async () => {
    const { service, calls } = makeDb([
      membershipRow,
      {
        table: 'communities',
        result: { data: { id: COMMUNITY, name: 'UNILAG Medicine & Surgery', course_id: null, lounge_group_id: GROUP } },
      },
      { table: 'group_members', result: {} },
    ]);

    const out = await service.openLounge(VIEWER, COMMUNITY);
    expect(out).toEqual({ groupId: GROUP, name: 'UNILAG Medicine & Surgery Lounge', created: false });
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('race loser adopts the winner lounge and deletes its orphan group', async () => {
    const { service, calls } = makeDb([
      membershipRow,
      {
        table: 'communities',
        result: { data: { id: COMMUNITY, name: 'UNILAG Medicine & Surgery', course_id: null, lounge_group_id: null } },
      },
      { table: 'groups', result: { data: { id: GROUP } } },
      { table: 'communities', result: { data: [] } }, // claim lost — pointer already set
      { table: 'communities', result: { data: { lounge_group_id: WINNER_GROUP } } },
      { table: 'groups', result: {} }, // orphan delete
      { table: 'group_members', result: {} },
    ]);

    const out = await service.openLounge(VIEWER, COMMUNITY);
    expect(out.groupId).toBe(WINNER_GROUP);
    expect(out.created).toBe(false);
    expect(calls.some((c) => c.op === 'delete' && c.table === 'groups')).toBe(true);
    const join = calls.find((c) => c.op === 'upsert' && c.table === 'group_members');
    expect(join?.payload).toMatchObject({ group_id: WINNER_GROUP, user_id: VIEWER });
  });
});
