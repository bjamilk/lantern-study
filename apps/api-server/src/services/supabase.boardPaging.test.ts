/**
 * The board's roots-only page (spec §3.3).
 *
 * A board shows post cards, not a transcript: its page is
 * `thread_root_id IS NULL`, and comments live behind "N comments". Two things
 * have to hold or a board and a chat corrupt each other:
 *
 *  - the roots filter is actually applied;
 *  - the roots-only page gets its OWN cache key. Same group, same page number,
 *    different result set — sharing one key would serve a chat's full page to
 *    a board, or a board's roots-only page to the chat tab.
 *
 * The board columns (subject/pinned_at/pinned_by) are selected when they
 * exist and dropped, without a throw, when the migration is not applied.
 */
const cached = jest.fn(async (_key: string, fn: () => Promise<unknown>) => fn());
jest.mock('./cache', () => ({
  cacheService: {
    cached: (...args: any[]) => (cached as any)(...args),
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deletePattern: jest.fn(async () => undefined),
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { SupabaseService } from './supabase';
import { setSchemaCapabilities } from './schemaCapabilities';

const GROUP = '44444444-4444-4444-8444-444444444444';

type Op = { fn: string; args: any[] };

function makeSelf(options: { boardColumns?: boolean; failFirstWith42703?: boolean } = {}) {
  const { boardColumns = true, failFirstWith42703 = false } = options;
  setSchemaCapabilities({ messageBoardColumns: boardColumns });

  const selects: string[] = [];
  const opsByCall: Op[][] = [];
  let attempts = 0;

  const supabase = {
    from() {
      const ops: Op[] = [];
      opsByCall.push(ops);
      const chain: any = {};
      for (const fn of ['select', 'eq', 'is', 'lt', 'gt', 'order']) {
        chain[fn] = (...args: any[]) => {
          ops.push({ fn, args });
          if (fn === 'select') selects.push(String(args[0]));
          return chain;
        };
      }
      chain.range = (...args: any[]) => {
        ops.push({ fn: 'range', args });
        attempts += 1;
        if (failFirstWith42703 && attempts === 1) {
          return Promise.resolve({
            data: null,
            error: { code: '42703', message: 'column messages.subject does not exist' },
          });
        }
        return Promise.resolve({
          data: [
            {
              id: 'm1',
              group_id: GROUP,
              sender_id: 'u1',
              type: 'TEXT',
              text: 'Timetable is out',
              subject: boardColumns ? 'Exam week' : undefined,
              timestamp: '2026-09-03T10:00:00.000Z',
              profiles: { id: 'u1', name: 'Ada' },
            },
          ],
          error: null,
        });
      };
      return chain;
    },
  };

  const proto = SupabaseService.prototype as any;
  const self: any = {
    supabase,
    getResponseProfile: proto.getResponseProfile,
    normalizeMessageRecord: proto.normalizeMessageRecord,
    parseMessageContent: proto.parseMessageContent,
    normalizeStorageUrl: proto.normalizeStorageUrl,
    attachReplyPreviewsBatch: jest.fn(async (rows: any[]) => rows),
    attachThreadReplyCounts: jest.fn(async (rows: any[]) =>
      rows.map((r) => ({ ...r, replyCount: 2 })),
    ),
  };

  const fetchPage = (opts: Record<string, unknown>) =>
    proto.getGroupMessages.call(self, GROUP, opts);

  return { self, fetchPage, selects, opsByCall };
}

describe('getGroupMessages rootsOnly', () => {
  beforeEach(() => cached.mockClear());

  it('applies the roots filter only when asked', async () => {
    const board = makeSelf();
    await board.fetchPage({ page: 1, limit: 20, rootsOnly: true });
    expect(board.opsByCall[0].some((o) => o.fn === 'is' && o.args[0] === 'thread_root_id')).toBe(
      true,
    );

    const chat = makeSelf();
    await chat.fetchPage({ page: 1, limit: 20 });
    expect(chat.opsByCall[0].some((o) => o.fn === 'is' && o.args[0] === 'thread_root_id')).toBe(
      false,
    );
  });

  it('gives the roots-only page its own cache key', async () => {
    const board = makeSelf();
    await board.fetchPage({ page: 1, limit: 20, rootsOnly: true });
    await board.fetchPage({ page: 1, limit: 20 });

    const [rootsKey, chatKey] = cached.mock.calls.map((c) => c[0]);
    expect(rootsKey).not.toBe(chatKey);
    expect(rootsKey).toContain(':roots:1');
    expect(chatKey).toContain(':roots:0');
  });

  it('carries the reply count and the post title through', async () => {
    const board = makeSelf();
    const [post] = await board.fetchPage({ page: 1, limit: 20, rootsOnly: true });
    expect(post).toMatchObject({ id: 'm1', replyCount: 2, subject: 'Exam week', type: 'TEXT' });
    expect(board.selects[0]).toContain('subject, pinned_at, pinned_by');
  });

  it('drops the board columns pre-migration instead of selecting them', async () => {
    const board = makeSelf({ boardColumns: false });
    const [post] = await board.fetchPage({ page: 1, limit: 20, rootsOnly: true });
    expect(board.selects[0]).not.toContain('pinned_at');
    expect(post.subject).toBeUndefined();
  });

  it('retries once without the board columns when the probe was stale', async () => {
    const board = makeSelf({ boardColumns: true, failFirstWith42703: true });
    const rows = await board.fetchPage({ page: 1, limit: 20, rootsOnly: true });
    expect(rows).toHaveLength(1);
    expect(board.selects).toHaveLength(2);
    expect(board.selects[0]).toContain('pinned_at');
    expect(board.selects[1]).not.toContain('pinned_at');
  });
});
