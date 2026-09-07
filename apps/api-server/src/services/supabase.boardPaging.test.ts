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

function makeSelf(
  options: {
    boardColumns?: boolean;
    reactionsColumn?: boolean;
    /** How many leading page reads answer 42703 before the mock returns rows. */
    failFirstAttempts?: number;
  } = {},
) {
  const { boardColumns = true, reactionsColumn = true, failFirstAttempts = 0 } = options;
  // Both capabilities are forced so the probe query never runs: an unforced
  // probe would be `opsByCall[0]` and shift every index below.
  setSchemaCapabilities({
    messageBoardColumns: boardColumns,
    messageReactionsColumn: reactionsColumn,
    // 20260908120000 (post kinds) is a third, independent probe — forced for
    // the same reason as the two above.
    messagePostKind: false,
  });

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
        if (attempts <= failFirstAttempts) {
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
              reactions: reactionsColumn ? { '\u2764\ufe0f': 3, '\ud83d\udd25': 1 } : undefined,
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
    // Board-only hydration (§6.4): `repostOf` / `repostCount` inside the
    // shared page cache, `repostedByMe` / `bookmarked` outside it.
    attachBoardRepostContext: jest.fn(async (rows: any[]) =>
      rows.map((r) => ({ ...r, repostCount: 0, repostOf: null })),
    ),
    // Peer-upvote progress, inside the page cache like the repost context.
    // Stubbed here for the same reason: its own query would shift every
    // `opsByCall` index the assertions below count on. Covered directly in
    // supabase.peerUpvotes.test.ts.
    attachPeerUpvotes: jest.fn(async (rows: any[]) => rows),
    enrichGroupMessageReceipts: jest.fn(async (rows: any[]) => rows),
    enrichBoardViewerState: jest.fn(async (rows: any[]) =>
      rows.map((r) => ({ ...r, repostedByMe: false, bookmarked: false })),
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

  it('hydrates reposts on a board page and never on a chat page', async () => {
    const board = makeSelf();
    await board.fetchPage({ page: 1, limit: 20, rootsOnly: true });
    expect(board.self.attachBoardRepostContext).toHaveBeenCalled();

    const chat = makeSelf();
    await chat.fetchPage({ page: 1, limit: 20 });
    // A comment thread and a group chat pay nothing for a board-only feature.
    expect(chat.self.attachBoardRepostContext).not.toHaveBeenCalled();
  });

  it('keeps viewer-specific state OUT of the shared page cache', async () => {
    // repostedByMe and bookmarked are per viewer; the 120s page cache is
    // shared by every member of the board, so attaching them inside it would
    // show one student another student's bookmarks.
    const board = makeSelf();
    await board.fetchPage({ page: 1, limit: 20, rootsOnly: true, viewerUserId: 'u9' });
    const insideCache = cached.mock.calls.length;
    expect(insideCache).toBe(1);
    expect(board.self.enrichBoardViewerState).toHaveBeenCalled();
    // The cached factory produced rows without either flag.
    const cachedRows = await (cached.mock.results[0]!.value as Promise<any[]>);
    expect(cachedRows[0].bookmarked).toBeUndefined();
    expect(cachedRows[0].repostedByMe).toBeUndefined();
  });

  it('does not attach viewer board state to a chat page', async () => {
    const chat = makeSelf();
    await chat.fetchPage({ page: 1, limit: 20, viewerUserId: 'u9' });
    expect(chat.self.enrichBoardViewerState).not.toHaveBeenCalled();
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

  it('drops reactions first when the probe was stale, then the board columns', async () => {
    // Two optional column sets from two migrations, so the ladder is two rungs
    // and never more: `reactions` goes first, the board columns second.
    const board = makeSelf({ failFirstAttempts: 2 });
    const rows = await board.fetchPage({ page: 1, limit: 20, rootsOnly: true });
    expect(rows).toHaveLength(1);
    expect(board.selects).toHaveLength(3);
    expect(board.selects[0]).toContain('reactions');
    expect(board.selects[0]).toContain('pinned_at');
    expect(board.selects[1]).not.toContain('reactions');
    expect(board.selects[1]).toContain('pinned_at');
    expect(board.selects[2]).not.toContain('reactions');
    expect(board.selects[2]).not.toContain('pinned_at');
  });

  /**
   * Regression — the counts were selected by nobody.
   *
   * `messages.reactions` (20260830120000) was in neither select profile and in
   * no branch of `normalizeMessageRecord`, so a freshly loaded board or chat
   * read `{}` for every post. Counts only appeared once a realtime UPDATE
   * arrived or the viewer tapped a reaction themselves — which is exactly why
   * it survived manual testing.
   */
  it('carries reaction counts on a listed message', async () => {
    const board = makeSelf();
    const [post] = await board.fetchPage({ page: 1, limit: 20, rootsOnly: true });
    expect(board.selects[0]).toContain('reactions');
    expect(post.reactions).toEqual({ '\u2764\ufe0f': 3, '\ud83d\udd25': 1 });
  });

  it('reads {} rather than undefined when the reactions migration is not applied', async () => {
    const board = makeSelf({ reactionsColumn: false });
    const [post] = await board.fetchPage({ page: 1, limit: 20, rootsOnly: true });
    expect(board.selects[0]).not.toContain('reactions');
    expect(post.reactions).toEqual({});
  });

  it('selects client_message_id so an optimistic row is not rendered twice', async () => {
    const board = makeSelf();
    await board.fetchPage({ page: 1, limit: 20, rootsOnly: true });
    expect(board.selects[0]).toContain('client_message_id');
  });
});
