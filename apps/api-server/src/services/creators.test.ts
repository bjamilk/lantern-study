/**
 * Creators (Phase 2 · J): follow gating against blocks, the public profile's
 * SEC-08 shape (never earnings; followingCount owner-only), and bio limits.
 */
import { CreatorsService, BIO_MAX_LENGTH } from './creators';
import { PublicError } from '../utils/safeError';

type TableResult = { data: unknown; error?: unknown };

function makeDb(tables: Record<string, TableResult | TableResult[]>) {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  const queues = new Map<string, TableResult[]>();
  const nextResult = (table: string): TableResult => {
    const configured = tables[table];
    if (configured === undefined) return { data: null, error: null };
    if (!Array.isArray(configured)) return configured;
    if (!queues.has(table)) queues.set(table, [...configured]);
    const q = queues.get(table)!;
    return q.length > 1 ? q.shift()! : q[0];
  };
  const from = (table: string) => {
    const result = nextResult(table);
    const api: any = {};
    const self = () => api;
    api.select = self;
    api.eq = self;
    api.in = self;
    api.gt = self;
    api.or = self;
    api.limit = self;
    api.order = self;
    api.range = self;
    api.delete = () => {
      writes.push({ table, op: 'delete', payload: null });
      return api;
    };
    api.insert = (payload: unknown) => {
      writes.push({ table, op: 'insert', payload });
      return api;
    };
    api.update = (payload: unknown) => {
      writes.push({ table, op: 'update', payload });
      return api;
    };
    api.upsert = (payload: unknown) => {
      writes.push({ table, op: 'upsert', payload });
      return api;
    };
    api.single = async () => result;
    api.maybeSingle = async () => result;
    api.then = (resolve: (v: TableResult) => unknown) => Promise.resolve(result).then(resolve);
    return api;
  };
  const rpc = jest.fn(async () => ({ data: null, error: null }));
  return { db: { from, rpc }, writes, rpc };
}

const A = '0b6f3a3e-2c8e-4c3f-9d1a-7f2e5b1c9a10';
const B = '1c7f4b4f-3d9f-4d40-8e2b-8a3f6c2d0b21';

function makeService(tables: Record<string, TableResult | TableResult[]> = {}) {
  const { db, writes, rpc } = makeDb(tables);
  const supabaseService: any = { getClient: () => db };
  return { service: new CreatorsService(supabaseService), writes, rpc };
}

describe('follow', () => {
  it('refuses self-follow', async () => {
    const { service } = makeService();
    await expect(service.follow(A, A)).rejects.toThrow('cannot follow yourself');
  });

  it('refuses when either side has blocked the other', async () => {
    const { service } = makeService({ user_blocks: { data: [{ blocker_id: B }], error: null } });
    await expect(service.follow(A, B)).rejects.toBeInstanceOf(PublicError);
  });

  it('upserts the follow and refreshes both creators stats', async () => {
    const { service, writes, rpc } = makeService({ user_blocks: { data: [], error: null } });
    await expect(service.follow(A, B)).resolves.toEqual({ following: true });
    const upsert = writes.find((w) => w.table === 'profile_follows' && w.op === 'upsert');
    expect(upsert?.payload).toMatchObject({ follower_id: A, followee_id: B });
    expect(rpc).toHaveBeenCalledWith('refresh_creator_stats', expect.objectContaining({ p_user_id: B }));
  });
});

describe('getCreatorProfile', () => {
  const tables = {
    profiles: {
      data: {
        id: B,
        name: 'Ada',
        username: 'ada',
        avatar_url: null,
        bio: 'I make bio packs',
        institution_id: null,
        programme: 'Biochemistry',
        study_level: 200,
        verification_level: 2,
      },
      error: null,
    },
    creator_stats: {
      data: {
        active_packs: 3,
        learners_helped: 42,
        avg_rating: 4.5,
        review_count: 8,
        follower_count: 12,
        following_count: 5,
        trust_score: 80,
        trust_level: 'verified',
      },
      error: null,
    },
    user_blocks: { data: [], error: null },
    profile_follows: { data: null, error: null },
    marketplace_listings: { data: [{ id: 'l1', title: 'Pack', price: 500, listing_kind: 'study_pack' }], error: null },
  };

  it('returns the public shape and never exposes earnings', async () => {
    const { service } = makeService(tables);
    const profile: any = await service.getCreatorProfile(B, A);
    expect(profile).toMatchObject({
      id: B,
      name: 'Ada',
      programme: 'Biochemistry',
      isVerified: true,
      trustLevel: 'verified',
    });
    expect(profile.stats).toMatchObject({ activePacks: 3, learnersHelped: 42, followerCount: 12 });
    // SEC-08: no earnings anywhere in the payload
    expect(JSON.stringify(profile)).not.toMatch(/earning|payout|revenue/i);
    // followingCount is owner-only
    expect(profile.stats.followingCount).toBeUndefined();
  });

  it('includes followingCount for the owner', async () => {
    const { service } = makeService(tables);
    const profile: any = await service.getCreatorProfile(B, B);
    expect(profile.stats.followingCount).toBe(5);
  });
});

describe('normalizeBio', () => {
  it('trims, nulls empties, and rejects overlong bios', () => {
    const { service } = makeService();
    expect(service.normalizeBio('  hi  ')).toBe('hi');
    expect(service.normalizeBio('   ')).toBeNull();
    expect(service.normalizeBio(null)).toBeNull();
    expect(() => service.normalizeBio('x'.repeat(BIO_MAX_LENGTH + 1))).toThrow(PublicError);
  });
});
