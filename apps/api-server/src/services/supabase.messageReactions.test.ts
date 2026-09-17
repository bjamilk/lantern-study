/**
 * Reaction counts must arrive with the LIST, not with the first realtime tick.
 *
 * `message_reactions` (20260830120000) denormalises its counts onto
 * `messages.reactions` / `dm_messages.reactions`, and a trigger keeps them
 * true. Every listing query nonetheless omitted the column and no mapper read
 * it, so a client opened a board, a group chat or a DM and saw `{}` on every
 * row. The counts appeared moments later — once the viewer tapped a reaction
 * (the write returns the authoritative map) or an unrelated UPDATE rode the
 * realtime channel — which is precisely why the hole passed manual testing:
 * the number was only ever missing for the first second, and only if you did
 * nothing.
 *
 * `getGroupMessages` is covered in supabase.boardPaging.test.ts. This file
 * closes the other two listing paths — the comment thread and the DM page —
 * plus the pre-migration fallback for each, because the founder hand-applies
 * migrations and the API always deploys first.
 */
import * as storageAclData from './data/storageAcl';
import * as mappersData from './data/mappers';
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
    cached: async (_key: string, fn: () => Promise<unknown>) => fn(),
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deletePattern: jest.fn(async () => undefined),
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import * as chatSendData from './data/chatSend';
import * as directMessagesData from './data/directMessages';
import { setSchemaCapabilities } from './schemaCapabilities';

const GROUP = '44444444-4444-4444-8444-444444444444';
const ROOT = '66666666-6666-4666-8666-666666666666';
const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';

const HEART = '❤️';
const FIRE = '🔥';


/** Chain stub: records every `.select(...)` string, resolves to fixed rows. */
function makeChain(
  table: string,
  selects: string[],
  resolve: (terminal: string) => { data: unknown; error: unknown },
) {
  const chain: any = {};
  for (const fn of ['eq', 'is', 'in', 'not', 'gt', 'lt', 'order', 'limit']) {
    chain[fn] = () => chain;
  }
  chain.select = (columns: string) => {
    selects.push(`${table}:${columns}`);
    return chain;
  };
  chain.range = () => chain;
  chain.single = () => Promise.resolve(resolve('single'));
  chain.maybeSingle = () => Promise.resolve(resolve('maybeSingle'));
  chain.then = (onOk: any, onErr: any) => Promise.resolve(resolve('then')).then(onOk, onErr);
  return chain;
}

describe('getGroupThread', () => {
  function makeSelf(options: { reactionsColumn?: boolean } = {}) {
    const { reactionsColumn = true } = options;
    setSchemaCapabilities({
      messageBoardColumns: true,
      messageReactionsColumn: reactionsColumn,
      // Forced so the post-kind probe never becomes selects[0].
      messagePostKind: false,
    });

    const selects: string[] = [];
    const row = (id: string, reactions: Record<string, number>) => ({
      id,
      group_id: GROUP,
      sender_id: 'u1',
      type: 'TEXT',
      text: id === ROOT ? 'Timetable is out' : 'Thanks!',
      thread_root_id: id === ROOT ? null : ROOT,
      timestamp: '2026-09-03T10:00:00.000Z',
      profiles: { id: 'u1', name: 'Ada' },
      ...(reactionsColumn ? { reactions } : {}),
    });

    const supabase = {
      from: (table: string) =>
        makeChain(table, selects, (terminal) =>
          terminal === 'maybeSingle'
            ? { data: row(ROOT, { [HEART]: 4 }), error: null }
            : { data: [row('c1', { [FIRE]: 2 })], error: null },
        ),
    };

    const self: any = {
      supabase,
      normalizeMessageRecord: function (this: any, row: any) { return mappersData.normalizeMessageRecord(this, row); },
      parseMessageContent: mappersData.parseMessageContent,
      normalizeStorageUrl: function (this: any, url: string) { return storageAclData.normalizeStorageUrl(this.supabaseUrl, url); },
      attachReplyPreviewsBatch: jest.fn(async (rows: any[]) => rows),
      attachThreadReplyCounts: jest.fn(async (rows: any[]) => rows),
    };

    return {
      selects,
      run: () => chatSendData.getGroupThread((self as any).supabase, self as any, GROUP, ROOT) as Promise<any[]>,
    };
  }

  it('carries reaction counts on the post and on every comment', async () => {
    const thread = makeSelf();
    const [root, comment] = await thread.run();
    expect(thread.selects[0]).toContain('reactions');
    expect(root.reactions).toEqual({ [HEART]: 4 });
    expect(comment.reactions).toEqual({ [FIRE]: 2 });
  });

  it('still loads the thread when the reactions migration is not applied', async () => {
    const thread = makeSelf({ reactionsColumn: false });
    const [root] = await thread.run();
    expect(thread.selects[0]).not.toContain('reactions');
    expect(root.reactions).toEqual({});
  });
});

describe('getDirectMessages', () => {
  function makeSelf(options: { reactionsColumn?: boolean } = {}) {
    const { reactionsColumn = true } = options;
    setSchemaCapabilities({
      messageBoardColumns: true,
      messageReactionsColumn: reactionsColumn,
      messagePostKind: false,
    });

    const selects: string[] = [];
    const supabase = {
      from: (table: string) =>
        makeChain(table, selects, (terminal) => {
          if (table === 'dm_threads') {
            return { data: { history_cleared_at: null }, error: null };
          }
          if (terminal === 'maybeSingle') return { data: null, error: null };
          return {
            data: [
              {
                id: 'dm1',
                thread_id: [ME, THEM].sort().join('-'),
                sender_id: THEM,
                text: 'Saw the timetable',
                timestamp: '2026-09-03T10:00:00.000Z',
                profiles: { id: THEM, name: 'Bala' },
                ...(reactionsColumn ? { reactions: { [HEART]: 1 } } : {}),
              },
            ],
            error: null,
          };
        }),
    };

    const self: any = {
      supabase,
      attachReplyPreviewsBatch: jest.fn(async (rows: any[]) => rows),
      attachThreadReplyCounts: jest.fn(async (rows: any[]) => rows),
      enrichDmMessageReceipts: jest.fn(async (rows: any[]) => rows),
    };

    return {
      selects,
      run: () => directMessagesData.getDirectMessages((self as any).supabase, self as any, ME, THEM, {}) as Promise<any[]>,
    };
  }

  it('carries reaction counts on a listed direct message', async () => {
    const dm = makeSelf();
    const [message] = await dm.run();
    expect(dm.selects.some((s) => s.startsWith('dm_messages:') && s.includes('reactions'))).toBe(
      true,
    );
    expect(message.reactions).toEqual({ [HEART]: 1 });
  });

  it('still loads the thread when the reactions migration is not applied', async () => {
    const dm = makeSelf({ reactionsColumn: false });
    const [message] = await dm.run();
    expect(dm.selects.some((s) => s.startsWith('dm_messages:') && s.includes('reactions'))).toBe(
      false,
    );
    expect(message.reactions).toEqual({});
  });
});
