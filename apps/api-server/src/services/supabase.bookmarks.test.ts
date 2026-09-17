/**
 * Bookmarks — account-level "Saved posts" (spec §7), the phase's one migration.
 *
 * Two things are pinned here above everything else:
 *
 *  1. THE LEAVE-THE-BOARD RULE. Bookmarks outlive membership, so
 *     `GET /messages/bookmarks` re-checks `group_members` for the viewer on
 *     every read. Without it a student who left or was removed from a board
 *     keeps reading its members-only posts out of their own saved list. This
 *     is the reason the endpoint has the shape it has.
 *  2. DEGRADE. The API is deployed BEFORE the founder hand-applies
 *     20260904120000, so a database that answers 42P01 must produce a hidden
 *     control, never a 500 and never a broken board.
 *
 * And one absence: there is NO count anywhere. On a board where everyone can
 * see the roster, a visible save count turns a private "read this later" into
 * a social signal.
 */
/**
 * HARNESS (monolith lane M3, Phase B): this suite used to drive
 * `SupabaseService.prototype.<m>.call(self, …)`. It now calls the data module
 * that owns the body. Nothing else moved: the same stand-in is built the same
 * way, and it is passed as the `deps` literal, which is what the facade's
 * inline `deps` arrows read off `this` anyway. Every `it` title, every
 * `expect` and every fixture is byte-identical.
 */
import * as boardActionsData from './data/boardActions';
import * as groupMessagesData from './data/groupMessages';
import * as storageAclData from './data/storageAcl';
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

import { setSchemaCapabilities } from './schemaCapabilities';

const VIEWER = '11111111-1111-4111-8111-111111111111';
const GROUP = '44444444-4444-4444-8444-444444444444';
const LEFT_GROUP = '55555555-5555-4555-8555-555555555555';
const POST = '66666666-6666-4666-8666-666666666666';
const LEFT_POST = '77777777-7777-4777-8777-777777777777';
const REMOVED_POST = '88888888-8888-4888-8888-888888888888';

const MISSING_TABLE = { code: '42P01', message: 'relation "message_bookmarks" does not exist' };

type Query = {
  table: string;
  ops: Array<{ fn: string; args: any[] }>;
  select: string;
  selectOptions?: any;
  payload?: any;
  has: (fn: string) => boolean;
  arg: (fn: string, index?: number) => any;
};

function makeDb(handler: (q: Query) => any) {
  const calls: Query[] = [];
  const CHAIN = [
    'select',
    'insert',
    'upsert',
    'update',
    'delete',
    'eq',
    'in',
    'is',
    'not',
    'like',
    'gte',
    'gt',
    'lt',
    'lte',
    'order',
    'limit',
    'range',
  ];
  const from = (table: string) => {
    const q: any = { table, ops: [], select: '' };
    q.has = (fn: string) => q.ops.some((o: any) => o.fn === fn);
    q.arg = (fn: string, index = 0) => q.ops.find((o: any) => o.fn === fn)?.args[index];
    for (const fn of CHAIN) {
      q[fn] = (...args: any[]) => {
        q.ops.push({ fn, args });
        if (fn === 'select') {
          q.select = String(args[0] ?? '');
          q.selectOptions = args[1];
        }
        if (fn === 'insert' || fn === 'upsert' || fn === 'update') q.payload = args[0];
        return q;
      };
    }
    q.single = () => {
      q.ops.push({ fn: 'single', args: [] });
      return q;
    };
    q.maybeSingle = () => {
      q.ops.push({ fn: 'maybeSingle', args: [] });
      return q;
    };
    q.then = (resolve: any, reject: any) =>
      Promise.resolve()
        .then(() => handler(q as Query))
        .then(resolve, reject);
    calls.push(q as Query);
    return q;
  };
  return { db: { from }, calls };
}


beforeEach(() => {
  // Forced so no probe query runs and the scripted handler stays predictable.
  setSchemaCapabilities({ messageBoardColumns: true, messageReactionsColumn: true });
});

describe('setMessageBookmark', () => {
  function harness(options: { authorized?: boolean; dm?: boolean; error?: any } = {}) {
    const { authorized = true, dm = false, error = null } = options;
    const writes: Query[] = [];
    const { db } = makeDb((q) => {
      if (q.table === 'message_bookmarks') {
        writes.push(q);
        return { data: null, error };
      }
      return { data: null, error: null };
    });
    const self: any = {
      supabase: db,
      bookmarksMissingTable: boardActionsData.bookmarksMissingTable,
      getAuthorizedGroupMessage: jest.fn(async () =>
        authorized ? { id: POST, group_id: GROUP, sender_id: VIEWER, type: 'TEXT' } : null
      ),
      getAuthorizedDmMessage: jest.fn(async () => (dm ? { id: POST, threadId: 't1' } : null)),
    };
    return {
      writes,
      set: (bookmarked: boolean) => boardActionsData.setMessageBookmark((self as any).supabase, self as any, POST, VIEWER, bookmarked),
    };
  }

  it('upserts on the primary key, so saving twice is idempotent', async () => {
    const h = harness();
    expect(await h.set(true)).toEqual({ status: 'ok', bookmarked: true });
    expect(await h.set(true)).toEqual({ status: 'ok', bookmarked: true });
    expect(h.writes).toHaveLength(2);
    expect(h.writes[0]!.has('upsert')).toBe(true);
    expect(h.writes[0]!.payload).toEqual({ user_id: VIEWER, message_id: POST });
    expect(h.writes[0]!.ops.find((o) => o.fn === 'upsert')?.args[1]).toMatchObject({
      onConflict: 'user_id,message_id',
    });
  });

  it('unsaving deletes exactly the viewer‘s own row', async () => {
    const h = harness();
    expect(await h.set(false)).toEqual({ status: 'ok', bookmarked: false });
    expect(h.writes[0]!.has('delete')).toBe(true);
    expect(h.writes[0]!.ops.filter((o) => o.fn === 'eq').map((o) => o.args)).toEqual([
      ['user_id', VIEWER],
      ['message_id', POST],
    ]);
  });

  it('is not_found for a non-member, so it cannot probe for message ids', async () => {
    const h = harness({ authorized: false });
    expect(await h.set(true)).toEqual({ status: 'not_found' });
    expect(h.writes).toHaveLength(0);
  });

  it('says so plainly when the id is a DM message, not a board post', async () => {
    const h = harness({ authorized: false, dm: true });
    expect(await h.set(true)).toEqual({ status: 'not_a_board_post' });
  });

  it('degrades to `unavailable` when the migration is not applied', async () => {
    const h = harness({ error: MISSING_TABLE });
    expect(await h.set(true)).toEqual({ status: 'unavailable' });
  });
});

describe('getBookmarkedMessageIdsForGroup', () => {
  function harness(result: any) {
    const { db, calls } = makeDb(() => result);
    const self: any = { supabase: db, bookmarksMissingTable: boardActionsData.bookmarksMissingTable };
    return {
      calls,
      read: () => boardActionsData.getBookmarkedMessageIdsForGroup((self as any).supabase, self as any, GROUP, VIEWER),
    };
  }

  it('returns the viewer‘s ids on one board, joined through the FK', async () => {
    const h = harness({ data: [{ message_id: POST }], error: null });
    expect(await h.read()).toEqual({ messageIds: [POST], serverBacked: true });
    // The inner join is what keeps this one query instead of listing every
    // message id in a board that may hold thousands of posts. The embed names
    // its FK constraint (message_bookmarks_message_id_fkey) rather than a bare
    // `messages!inner`, so a future second FK to messages cannot make it
    // ambiguous (PGRST201) — see postgrestEmbedDisambiguation.test.ts.
    expect(h.calls[0]!.select).toContain(
      'messages!message_bookmarks_message_id_fkey!inner'
    );
  });

  it('answers serverBacked:false, never a throw, before the migration', async () => {
    const h = harness({ data: null, error: MISSING_TABLE });
    expect(await h.read()).toEqual({ messageIds: [], serverBacked: false });
  });
});

describe('listBookmarkedPosts', () => {
  const savedRows = [
    { message_id: POST, created_at: '2026-09-03T12:00:00.000Z' },
    { message_id: LEFT_POST, created_at: '2026-09-03T11:00:00.000Z' },
    { message_id: REMOVED_POST, created_at: '2026-09-03T10:00:00.000Z' },
  ];

  const postRows = [
    {
      id: POST,
      group_id: GROUP,
      sender_id: VIEWER,
      type: 'TEXT',
      subject: 'Exam week',
      text: 'Timetable is out',
      timestamp: '2026-09-01T10:00:00.000Z',
      removed_at: null,
      image_url: null,
      reactions: { '❤️': 4 },
      profiles: { id: VIEWER, name: 'Ada' },
    },
    {
      id: LEFT_POST,
      group_id: LEFT_GROUP,
      sender_id: 'someone',
      type: 'TEXT',
      subject: 'Private to that board',
      text: 'Members-only body',
      timestamp: '2026-09-01T09:00:00.000Z',
      removed_at: null,
      profiles: { id: 'someone', name: 'Bola' },
    },
    {
      id: REMOVED_POST,
      group_id: GROUP,
      sender_id: 'someone',
      type: 'TEXT',
      text: null,
      timestamp: '2026-09-01T08:00:00.000Z',
      removed_at: '2026-09-02T08:00:00.000Z',
      profiles: { id: 'someone', name: 'Bola' },
    },
  ];

  function harness(options: { bookmarksError?: any; saved?: any[] } = {}) {
    const { bookmarksError = null, saved = savedRows } = options;
    const { db, calls } = makeDb((q) => {
      if (q.table === 'message_bookmarks') {
        return bookmarksError ? { data: null, error: bookmarksError } : { data: saved, error: null };
      }
      if (q.table === 'messages' && q.select.includes('reply_to_message_id') && q.has('like')) {
        return { data: [], error: null };
      }
      if (q.table === 'messages') return { data: postRows, error: null };
      if (q.table === 'group_members') {
        // The viewer is only still in GROUP; they have left LEFT_GROUP.
        return { data: [{ group_id: GROUP }], error: null };
      }
      if (q.table === 'groups') {
        return { data: [{ id: GROUP, name: 'exam-week', community_id: 'c1' }], error: null };
      }
      if (q.table === 'communities') {
        return { data: [{ id: 'c1', slug: 'unilag', name: 'UNILAG' }], error: null };
      }
      if (q.table === 'message_reactions') return { data: [], error: null };
      return { data: [], error: null };
    });
    const self: any = {
      supabase: db,
      bookmarksMissingTable: boardActionsData.bookmarksMissingTable,
      reactionsMissingTable: groupMessagesData.reactionsMissingTable,
      readBoardPostRows: function (this: any, ids: string[]) { return boardActionsData.readBoardPostRows(this.supabase, ids); },
      readBoardContextForGroups: function (this: any, groupIds: string[]) { return boardActionsData.readBoardContextForGroups(this.supabase, groupIds); },
      toBoardPostShape: function (this: any, row: any, extras: any) { return boardActionsData.toBoardPostShape(this, row, extras); },
      normalizeStorageUrl: function (this: any, url: string) { return storageAclData.normalizeStorageUrl(this.supabaseUrl, url); },
      countRepostsFor: function (this: any, ids: string[]) { return boardActionsData.countRepostsFor(this.supabase, ids); },
      repostedByMeAmong: function (this: any, ids: string[], uid: string) { return boardActionsData.repostedByMeAmong(this.supabase, ids, uid); },
      favoritedAmong: function (this: any, ids: string[], uid: string) { return boardActionsData.favoritedAmong(this.supabase, this, ids, uid); },
    };
    return {
      calls,
      list: (options2: Record<string, unknown> = {}) =>
        boardActionsData.listBookmarkedPosts((self as any).supabase, self as any, VIEWER, options2),
    };
  }

  it('excludes a post whose board the viewer has left — the whole point of the endpoint', async () => {
    const h = harness();
    const page = await h.list();
    const ids = page.entries.map((e: any) => e.post.id);
    expect(ids).toContain(POST);
    expect(ids).not.toContain(LEFT_POST);
    // and no fragment of that board's post survives anywhere in the payload
    expect(JSON.stringify(page)).not.toContain('Members-only body');
    expect(JSON.stringify(page)).not.toContain('Private to that board');
  });

  it('excludes a removed post', async () => {
    const page = await harness().list();
    expect(page.entries.map((e: any) => e.post.id)).not.toContain(REMOVED_POST);
  });

  it('carries the board context a cross-board list has to render', async () => {
    const page = await harness().list();
    expect(page.entries[0]).toMatchObject({
      groupId: GROUP,
      boardName: 'exam-week',
      communitySlug: 'unilag',
      communityName: 'UNILAG',
      savedAt: '2026-09-03T12:00:00.000Z',
    });
    expect(page.entries[0].post).toMatchObject({
      subject: 'Exam week',
      favoriteCount: 4,
      bookmarked: true,
    });
  });

  it('publishes no bookmark count, anywhere in the payload', async () => {
    const page = await harness().list();
    const serialised = JSON.stringify(page);
    expect(serialised).not.toContain('bookmarkCount');
    expect(serialised).not.toContain('savedCount');
    expect(serialised).not.toContain('bookmark_count');
  });

  it('advances the cursor past every row EXAMINED, so a filtered page cannot loop', async () => {
    // All three saved rows were read; two were filtered out. A cursor built
    // from the surviving rows would hand back the same page forever.
    const h = harness();
    const page = await h.list({ limit: 3 });
    expect(page.nextCursor).toBe('2026-09-03T10:00:00.000Z');
  });

  it('stops paging when the page was not full', async () => {
    const page = await harness().list({ limit: 20 });
    expect(page.nextCursor).toBeNull();
  });

  it('clamps limit to the shared maximum', async () => {
    const h = harness();
    await h.list({ limit: 500 });
    const savedQuery = h.calls.find((q) => q.table === 'message_bookmarks');
    expect(savedQuery!.arg('limit')).toBe(50);
  });

  it('returns an empty, honestly-flagged page before the migration — never a 500', async () => {
    const page = await harness({ bookmarksError: MISSING_TABLE }).list();
    expect(page).toEqual({ entries: [], nextCursor: null, serverBacked: false });
  });
});

describe('importMessageBookmarks', () => {
  function harness(options: { upsertError?: any } = {}) {
    const upserts: any[] = [];
    const { db } = makeDb((q) => {
      if (q.table === 'messages') {
        return {
          data: [
            { id: POST, group_id: GROUP, thread_root_id: null, removed_at: null },
            // A board the viewer is not in: skipped, silently.
            { id: LEFT_POST, group_id: LEFT_GROUP, thread_root_id: null, removed_at: null },
            // A starred CHAT message imported by mistake would land here as a
            // comment or a removed row; both are dropped.
            { id: REMOVED_POST, group_id: GROUP, thread_root_id: 'root', removed_at: null },
          ],
          error: null,
        };
      }
      if (q.table === 'group_members') return { data: [{ group_id: GROUP }], error: null };
      if (q.table === 'message_bookmarks') {
        if (options.upsertError) return { data: null, error: options.upsertError };
        upserts.push(q.payload);
        return { data: null, error: null };
      }
      return { data: [], error: null };
    });
    const self: any = { supabase: db, bookmarksMissingTable: boardActionsData.bookmarksMissingTable };
    return {
      upserts,
      run: (ids: string[]) => boardActionsData.importMessageBookmarks((self as any).supabase, self as any, VIEWER, ids),
    };
  }

  it('imports only ids the viewer can actually read', async () => {
    const h = harness();
    const result = await h.run([POST, LEFT_POST, REMOVED_POST]);
    expect(result).toEqual({ imported: 1, serverBacked: true });
    expect(h.upserts[0]).toHaveLength(1);
    expect(h.upserts[0][0]).toMatchObject({ user_id: VIEWER, message_id: POST });
  });

  /**
   * `message_bookmarks.created_at` DEFAULTs to NOW(), which is the TRANSACTION
   * timestamp — so one multi-row insert would stamp all 200 imported rows
   * identically. "Saved posts" pages with a STRICT keyset
   * (`created_at < cursor`), so the first page of 20 would be returned and the
   * cursor would then skip every remaining row sharing that timestamp: up to
   * 180 of the very saves this import exists to rescue, gone silently. Each row
   * therefore carries its own descending stamp.
   */
  it('stamps every imported row with a DISTINCT created_at so paging cannot skip them', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `post-${i}`);
    const upserts: any[] = [];
    const { db } = makeDb((q) => {
      if (q.table === 'messages') {
        return {
          data: ids.map((id) => ({
            id,
            group_id: GROUP,
            thread_root_id: null,
            removed_at: null,
          })),
          error: null,
        };
      }
      if (q.table === 'group_members') return { data: [{ group_id: GROUP }], error: null };
      if (q.table === 'message_bookmarks') {
        upserts.push(q.payload);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    });
    const self: any = { supabase: db, bookmarksMissingTable: boardActionsData.bookmarksMissingTable };

    const result = await boardActionsData.importMessageBookmarks((self as any).supabase, self as any, VIEWER, ids);
    expect(result.imported).toBe(40);

    const stamps = upserts[0].map((r: any) => r.created_at);
    expect(stamps).toHaveLength(40);
    expect(new Set(stamps).size).toBe(40);
    // Newest-saved-first is what the list orders by, so the stamps descend.
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i] < stamps[i - 1]).toBe(true);
    }
  });

  it('caps the batch at the shared import maximum', async () => {
    const h = harness();
    const ids = Array.from({ length: 500 }, (_, i) => `id-${i}`);
    await h.run(ids);
    // 200 ids reach the read; the fixture then answers with three known rows.
    expect(h.upserts).toHaveLength(1);
  });

  it('is idempotent, so a client may keep its local key until a 2xx', async () => {
    const h = harness();
    await h.run([POST]);
    expect(h.upserts[0]).toBeDefined();
  });

  it('reports serverBacked:false rather than throwing before the migration', async () => {
    const h = harness({ upsertError: MISSING_TABLE });
    expect(await h.run([POST])).toEqual({ imported: 0, serverBacked: false });
  });
});

describe('enrichBoardViewerState', () => {
  it('keeps the board page loading when message_bookmarks is absent', async () => {
    const { db } = makeDb((q) => {
      if (q.table === 'message_bookmarks') return { data: null, error: MISSING_TABLE };
      return { data: [], error: null };
    });
    const self: any = {
      supabase: db,
      bookmarksMissingTable: boardActionsData.bookmarksMissingTable,
      repostedByMeAmong: function (this: any, ids: string[], uid: string) { return boardActionsData.repostedByMeAmong(this.supabase, ids, uid); },
      bookmarkedAmong: function (this: any, ids: string[], uid: string) { return boardActionsData.bookmarkedAmong(this.supabase, this, ids, uid); },
    };
    const rows = await boardActionsData.enrichBoardViewerState(self as any, [{ id: POST } as any], VIEWER);
    expect(rows[0]).toMatchObject({ bookmarked: false, repostedByMe: false });
  });

  it('marks the viewer‘s own bookmarks and reposts', async () => {
    const { db } = makeDb((q) => {
      if (q.table === 'message_bookmarks') return { data: [{ message_id: POST }], error: null };
      return { data: [{ reply_to_message_id: POST }], error: null };
    });
    const self: any = {
      supabase: db,
      bookmarksMissingTable: boardActionsData.bookmarksMissingTable,
      repostedByMeAmong: function (this: any, ids: string[], uid: string) { return boardActionsData.repostedByMeAmong(this.supabase, ids, uid); },
      bookmarkedAmong: function (this: any, ids: string[], uid: string) { return boardActionsData.bookmarkedAmong(this.supabase, this, ids, uid); },
    };
    const rows = await boardActionsData.enrichBoardViewerState(self as any, [{ id: POST } as any], VIEWER);
    expect(rows[0]).toMatchObject({ bookmarked: true, repostedByMe: true });
  });
});
