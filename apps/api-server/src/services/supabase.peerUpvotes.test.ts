/**
 * Peer-upvote counting in the data layer.
 *
 * The rule itself is pure and tested in @lantern/shared; what only this test can
 * prove is that the service asks the database the right question and fails the
 * right way:
 *
 *  - the author's own row is excluded, so a self-upvote never advances the count;
 *  - a page of messages costs ONE query, not one per question, and a page with
 *    no questions costs none;
 *  - a read error yields 0 for a single message (refuse the verify) and leaves
 *    the listed rows without the field (the card falls back rather than showing
 *    a zero that would read as "nobody upvoted this").
 */
/**
 * HARNESS (monolith lane M3, Phase B): this suite used to drive
 * `SupabaseService.prototype.<m>.call(self, …)`. It now calls the data module
 * that owns the body. Nothing else moved: the same stand-in is built the same
 * way, and it is passed as the `deps` literal, which is what the facade's
 * inline `deps` arrows read off `this` anyway. Every `it` title, every
 * `expect` and every fixture is byte-identical.
 */
import * as groupMessagesData from './data/groupMessages';
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


const AUTHOR = 'author-1';
const QUESTION = 'q1';

type Result = { data: any[] | null; error: any };

function makeSelf(result: Result) {
  const calls: Array<{ table: string; select: string; filters: Array<[string, any]> }> = [];
  const supabase = {
    from(table: string) {
      const entry = { table, select: '', filters: [] as Array<[string, any]> };
      calls.push(entry);
      const chain: any = {
        select: (clause: string) => {
          entry.select = clause;
          return chain;
        },
        eq: (col: string, val: any) => {
          entry.filters.push([col, val]);
          return chain;
        },
        in: (col: string, val: any) => {
          entry.filters.push([col, val]);
          return Promise.resolve(result);
        },
      };
      // `eq`-terminated reads (the single-message count) resolve when awaited.
      chain.then = (resolve: any, reject: any) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
  };
  return {
    calls,
    countOne: (messageId: string, authorId: string | null) =>
      groupMessagesData.countPeerUpvotesForMessage(({ supabase } as any).supabase, messageId, authorId) as Promise<number>,
    attach: (rows: any[]) =>
      groupMessagesData.attachPeerUpvotes(({ supabase } as any).supabase, rows) as Promise<any[]>,
  };
}

describe('countPeerUpvotesForMessage', () => {
  it('drops the author’s own upvote and counts each peer once', async () => {
    const self = makeSelf({
      data: [
        { user_id: AUTHOR, vote_type: 'up' },
        { user_id: 'peer-1', vote_type: 'up' },
        { user_id: 'peer-2', vote_type: 'up' },
      ],
      error: null,
    });

    await expect(self.countOne(QUESTION, AUTHOR)).resolves.toBe(2);
    expect(self.calls[0].table).toBe('question_votes');
    expect(self.calls[0].filters).toEqual([
      ['message_id', QUESTION],
      ['vote_type', 'up'],
    ]);
  });

  it('returns 0 when the read fails — missing evidence refuses, never grants', async () => {
    const self = makeSelf({ data: null, error: { code: '42P01' } });
    await expect(self.countOne(QUESTION, AUTHOR)).resolves.toBe(0);
  });
});

describe('attachPeerUpvotes', () => {
  it('counts a page of questions in ONE query, per author', async () => {
    const self = makeSelf({
      data: [
        { message_id: 'q1', user_id: AUTHOR, vote_type: 'up' },
        { message_id: 'q1', user_id: 'peer-1', vote_type: 'up' },
        { message_id: 'q2', user_id: 'peer-1', vote_type: 'up' },
        { message_id: 'q2', user_id: 'peer-2', vote_type: 'up' },
      ],
      error: null,
    });

    const rows = await self.attach([
      { id: 'q1', type: 'QUESTION', sender_id: AUTHOR },
      { id: 'q2', type: 'QUESTION', sender_id: 'someone-else' },
      { id: 't1', type: 'TEXT', sender_id: AUTHOR },
    ]);

    expect(self.calls).toHaveLength(1);
    expect(rows[0].peerUpvotes).toBe(1);
    expect(rows[1].peerUpvotes).toBe(2);
    expect(rows[2].peerUpvotes).toBeUndefined();
  });

  it('queries nothing for a page with no questions', async () => {
    const self = makeSelf({ data: [], error: null });
    const rows = await self.attach([{ id: 't1', type: 'TEXT', sender_id: AUTHOR }]);
    expect(self.calls).toHaveLength(0);
    expect(rows[0].peerUpvotes).toBeUndefined();
  });

  it('leaves the field absent when the read fails, rather than reporting zero', async () => {
    const self = makeSelf({ data: null, error: { code: '42P01' } });
    const rows = await self.attach([{ id: 'q1', type: 'QUESTION', sender_id: AUTHOR }]);
    expect(rows[0].peerUpvotes).toBeUndefined();
  });
});
