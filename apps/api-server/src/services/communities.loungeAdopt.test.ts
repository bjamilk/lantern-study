/**
 * A community must never end up with a second, empty lounge.
 *
 * `communities.lounge_group_id` is ON DELETE SET NULL, so anything that removes
 * or re-points the lounge row leaves the pointer null while the community may
 * still have a lounge sitting there. Minting a fresh one at that point strands
 * the original: members open "General", find it empty, and their history looks
 * deleted. That happened on 2026-09-03. openLounge now adopts the existing
 * lounge and re-points the community at it, and only mints when there is none.
 */
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../services/cache', () => ({
  cacheService: {
    get: jest.fn(), set: jest.fn(), delete: jest.fn(),
    deletePattern: jest.fn().mockResolvedValue(undefined),
    cached: jest.fn(async (_k: string, fn: () => unknown) => fn()),
  },
  CacheKeys: {},
}));

type Step = { table: string; result: { data?: unknown; error?: unknown } };

function makeDb(script: Step[]) {
  const writes: Array<{ table: string; op: string; payload?: unknown }> = [];
  const db = {
    from(table: string) {
      const pop = () => {
        const next = script.shift();
        if (!next) throw new Error(`script exhausted (query on ${table})`);
        if (next.table !== table) throw new Error(`expected ${next.table}, got ${table}`);
        return { data: null, error: null, ...next.result };
      };
      const chain: any = {};
      for (const m of ['select', 'eq', 'is', 'in', 'or', 'order', 'limit', 'neq', 'gt', 'lt']) chain[m] = () => chain;
      chain.insert = (payload: unknown) => { writes.push({ table, op: 'insert', payload }); return chain; };
      chain.update = (payload: unknown) => { writes.push({ table, op: 'update', payload }); return chain; };
      chain.upsert = (payload: unknown) => { writes.push({ table, op: 'upsert', payload }); return chain; };
      chain.delete = () => { writes.push({ table, op: 'delete' }); return chain; };
      chain.maybeSingle = async () => pop();
      chain.single = async () => pop();
      chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve(pop()).then(resolve, reject);
      return chain;
    },
  };
  return { db, writes };
}

const USER = '11111111-1111-4111-8111-111111111111';
const COMMUNITY = '22222222-2222-4222-8222-222222222222';
const EXISTING_LOUNGE = '33333333-3333-4333-8333-333333333333';

describe('openLounge adopts an existing lounge when the pointer is null', () => {
  it('re-points the community instead of minting a second lounge', async () => {
    const { db, writes } = makeDb([
      { table: 'community_members', result: { data: { user_id: USER } } },
      // The pointer was lost, but the lounge itself is still there.
      { table: 'communities', result: { data: { id: COMMUNITY, name: 'PHARM 212', course_id: null, lounge_group_id: null } } },
      { table: 'groups', result: { data: [{ id: EXISTING_LOUNGE, created_at: '2026-08-29T00:00:00Z' }] } },
      { table: 'communities', result: { data: [{ id: COMMUNITY }] } }, // re-point
      { table: 'group_members', result: { data: null } },
    ]);

    const { CommunitiesService } = await import('./communities');
    const svc = new CommunitiesService({ getClient: () => db } as never);
    const out = await svc.openLounge(USER, COMMUNITY);

    expect(out.groupId).toBe(EXISTING_LOUNGE);
    expect(out.created).toBe(false);
    // The decisive assertion: no new lounge row was written.
    expect(writes.filter((w) => w.table === 'groups' && w.op === 'insert')).toHaveLength(0);
    // And the community was pointed back at the lounge it already had.
    const repoint = writes.find((w) => w.table === 'communities' && w.op === 'update');
    expect((repoint?.payload as { lounge_group_id?: string })?.lounge_group_id).toBe(EXISTING_LOUNGE);
  });

  it('still mints when the community genuinely has no lounge', async () => {
    const MINTED = '44444444-4444-4444-8444-444444444444';
    const { db, writes } = makeDb([
      { table: 'community_members', result: { data: { user_id: USER } } },
      { table: 'communities', result: { data: { id: COMMUNITY, name: 'PHARM 212', course_id: null, lounge_group_id: null } } },
      { table: 'groups', result: { data: [] } },           // nothing to adopt
      { table: 'groups', result: { data: { id: MINTED } } }, // insert
      { table: 'communities', result: { data: [{ id: COMMUNITY }] } }, // claim
      { table: 'group_members', result: { data: null } },
    ]);

    const { CommunitiesService } = await import('./communities');
    const svc = new CommunitiesService({ getClient: () => db } as never);
    const out = await svc.openLounge(USER, COMMUNITY);

    expect(out.groupId).toBe(MINTED);
    expect(out.created).toBe(true);
    expect(writes.filter((w) => w.table === 'groups' && w.op === 'insert')).toHaveLength(1);
  });
});
