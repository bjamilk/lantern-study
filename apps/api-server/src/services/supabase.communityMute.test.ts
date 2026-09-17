/**
 * A community mute has to bite on EVERY write into the community — the
 * board, its comments, a repost, the lounge and every text channel — and it
 * has to cost nothing on a database where 20260908120000 is not applied.
 * `assertNotMutedInCommunity` is module-level inside supabase.ts, so the
 * only way to prove it runs is through the two writes that call it.
 */
/**
 * HARNESS (monolith lane M3, Phase B): this suite used to drive
 * `SupabaseService.prototype.<m>.call(self, …)`. It now calls the data module
 * that owns the body. Nothing else moved: the same stand-in is built the same
 * way, and it is passed as the `deps` literal, which is what the facade's
 * inline `deps` arrows read off `this` anyway. Every `it` title, every
 * `expect` and every fixture is byte-identical.
 */
jest.mock('./cache', () => ({
  cacheService: {
    cached: jest.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deletePattern: jest.fn(async () => undefined),
    invalidateGroupCache: jest.fn(async () => undefined),
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import * as boardActionsData from './data/boardActions';
import * as chatSendData from './data/chatSend';
import { setSchemaCapabilities } from './schemaCapabilities';
import { COMMUNITY_MODERATION_COPY } from '@lantern/shared/network';

const GROUP = '44444444-4444-4444-8444-444444444444';
const VIEWER = '11111111-1111-4111-8111-111111111111';
const COMMUNITY = '77777777-7777-4777-8777-777777777777';

type Q = { table: string; ops: string[]; select: string };

function makeDb(handler: (q: Q) => any) {
  const calls: Q[] = [];
  const from = (table: string) => {
    const q: any = { table, ops: [], select: '' };
    for (const fn of ['select', 'insert', 'eq', 'is', 'in', 'like', 'gte', 'order', 'limit', 'not']) {
      q[fn] = (...args: any[]) => {
        q.ops.push(fn);
        if (fn === 'select') q.select = String(args[0] ?? '');
        return q;
      };
    }
    q.single = () => q;
    q.maybeSingle = () => q;
    q.then = (resolve: any, reject: any) =>
      Promise.resolve().then(() => handler(q)).then(resolve, reject);
    calls.push(q);
    return q;
  };
  return { db: { from }, calls };
}


function harness(opts: { mutedUntil: string | null; isBoard: boolean }) {
  const { db, calls } = makeDb((q) => {
    if (q.table === 'community_members') {
      return { data: { muted_until: opts.mutedUntil }, error: null };
    }
    // Anything past the mute check answers "nothing here" so the write stops
    // at its first ordinary refusal instead of reaching an unstubbed method.
    return { data: null, error: null, count: 0 };
  });
  const self: any = {
    supabase: db,
    resolveBoardContext: jest.fn(async () => ({
      isBoard: opts.isBoard,
      communityId: COMMUNITY,
      communitySlug: 'unilag',
      communityCreatedBy: null,
      loungeGroupId: opts.isBoard ? null : GROUP,
      adminIds: [],
    })),
    reviveRemovedRepost: jest.fn(async () => null),
  };
  return { self, calls };
}

const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

describe('community mutes on the write paths', () => {
  it('refuses a muted member in the LOUNGE (a chat, not a board) with a 403', async () => {
    setSchemaCapabilities({ communityMemberMute: true });
    const { self } = harness({ mutedUntil: future(), isBoard: false });
    await expect(
      chatSendData.sendMessage((self as any).supabase, self as any, GROUP, VIEWER, 'hello', undefined, {}),
    ).rejects.toMatchObject({ statusCode: 403, message: COMMUNITY_MODERATION_COPY.mutedTitle });
  });

  it('refuses a muted member on the BOARD, and on a repost', async () => {
    setSchemaCapabilities({ communityMemberMute: true });
    const board = harness({ mutedUntil: future(), isBoard: true });
    await expect(
      chatSendData.sendMessage((board.self as any).supabase, board.self as any, GROUP, VIEWER, 'post', undefined, { subject: 'Hi' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const repost = harness({ mutedUntil: future(), isBoard: true });
    await expect(
      boardActionsData.createBoardRepost((repost.self as any).supabase, repost.self as any, GROUP, VIEWER, GROUP, ''),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('an expired mute is not a mute — the write proceeds to its ordinary checks', async () => {
    setSchemaCapabilities({ communityMemberMute: true });
    const { self, calls } = harness({ mutedUntil: past(), isBoard: true });
    const result = await boardActionsData.createBoardRepost((self as any).supabase, self as any, GROUP, VIEWER, GROUP, '');
    expect(result).toEqual({ status: 'not_found' });
    expect(calls.some((c) => c.table === 'community_members')).toBe(true);
  });

  it('asks the database nothing while the migration is unapplied', async () => {
    setSchemaCapabilities({ communityMemberMute: false });
    const { self, calls } = harness({ mutedUntil: future(), isBoard: true });
    const result = await boardActionsData.createBoardRepost((self as any).supabase, self as any, GROUP, VIEWER, GROUP, '');
    expect(result).toEqual({ status: 'not_found' });
    expect(calls.some((c) => c.table === 'community_members')).toBe(false);
  });
});
