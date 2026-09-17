/**
 * Repost — a same-board bump written as an ordinary `messages` row (spec §6).
 *
 * There is no migration behind this feature, so every guarantee it has comes
 * from three things being exactly right, and each one is pinned here:
 *
 *  1. the ROW SHAPE. `reply_to_message_id` set, `thread_root_id` NULL,
 *     `client_message_id = repost:<originalId>`, `type = 'TEXT'`. That shape is
 *     what makes `idx_messages_group_client_message_id`
 *     UNIQUE (group_id, sender_id, client_message_id) (20260711170000) enforce
 *     "one repost per person per post" in the database rather than in a client;
 *  2. the REFUSALS. Same board only, never a repost of a repost, never your own
 *     post inside a day, never a removed post, never a comment — all enforced
 *     in the service, so calling the endpoint directly is refused exactly like
 *     tapping a control the UI has hidden;
 *  3. the EMBED. A repost card renders the original from a snippet plus
 *     hasImage/hasAudio flags and NEVER a media URL, so it downloads zero bytes
 *     of media like every other list card.
 */
import * as storageAclData from './data/storageAcl';
/**
 * HARNESS (monolith lane M3, Phase B): this suite used to drive
 * `SupabaseService.prototype.<m>.call(self, …)`. It now calls the data module
 * that owns the body. Nothing else moved: the same stand-in is built the same
 * way, and it is passed as the `deps` literal, which is what the facade's
 * inline `deps` arrows read off `this` anyway. Every `it` title, every
 * `expect` and every fixture is byte-identical.
 */
import * as boardActionsData from './data/boardActions';
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

import { boardRepostClientId } from '@lantern/shared/network';
import { setSchemaCapabilities } from './schemaCapabilities';

const GROUP = '44444444-4444-4444-8444-444444444444';
const OTHER_GROUP = '55555555-5555-4555-8555-555555555555';
const ORIGINAL = '66666666-6666-4666-8666-666666666666';
const VIEWER = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';

type Query = {
  table: string;
  ops: Array<{ fn: string; args: any[] }>;
  select: string;
  selectOptions?: any;
  payload?: any;
  singleRow?: boolean;
  has: (fn: string) => boolean;
  arg: (fn: string, index?: number) => any;
};

/** A scriptable stand-in for the PostgREST builder: every call is recorded. */
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
      q.singleRow = true;
      return q;
    };
    q.maybeSingle = () => {
      q.ops.push({ fn: 'maybeSingle', args: [] });
      q.singleRow = true;
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


const liveOriginal = (over: Record<string, unknown> = {}) => ({
  id: ORIGINAL,
  group_id: GROUP,
  sender_id: AUTHOR,
  timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  removed_at: null,
  thread_root_id: null,
  reply_to_message_id: null,
  client_message_id: null,
  ...over,
});

function repostHarness(options: {
  original?: Record<string, unknown> | null;
  recentReposts?: number;
  insertError?: { code: string } | null;
  isBoard?: boolean;
}) {
  const {
    original = liveOriginal(),
    recentReposts = 0,
    insertError = null,
    isBoard = true,
  } = options;
  const inserted: any[] = [];
  const { db, calls } = makeDb((q) => {
    if (q.table === 'messages' && q.has('insert')) {
      if (insertError) return { data: null, error: insertError };
      inserted.push(q.payload);
      return { data: { id: 'repost-row', ...q.payload }, error: null };
    }
    if (q.table === 'messages' && q.selectOptions?.head) {
      return { count: recentReposts, error: null };
    }
    if (q.table === 'messages') return { data: original, error: null };
    return { data: null, error: null };
  });

  const self: any = {
    supabase: db,
    resolveBoardContext: jest.fn(async () => ({
      isBoard,
      communityId: 'c1',
      communitySlug: 'unilag',
      communityCreatedBy: null,
      loungeGroupId: null,
      adminIds: [],
    })),
    reviveRemovedRepost: jest.fn(async () => null),
  };

  return {
    inserted,
    calls,
    self,
    repost: (quote?: string, viewer = VIEWER) =>
      boardActionsData.createBoardRepost((self as any).supabase, self as any, GROUP, viewer, ORIGINAL, quote),
  };
}

describe('createBoardRepost', () => {
  beforeEach(() => {
    // The harness's `self` carries no capability probe, and every query it
    // sees is scripted — pin the mute column off so the repost path asks no
    // membership question here.
    setSchemaCapabilities({ communityMemberMute: false });
  });

  it('writes exactly the row shape the unique index needs', async () => {
    const h = repostHarness({});
    const result = await h.repost('still the one');

    expect(result.status).toBe('ok');
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]).toMatchObject({
      group_id: GROUP,
      sender_id: VIEWER,
      type: 'TEXT',
      text: 'still the one',
      reply_to_message_id: ORIGINAL,
      client_message_id: `repost:${ORIGINAL}`,
    });
    // thread_root_id is never written: a repost is a ROOT, so it shows up in
    // the rootsOnly page query and uses idx_messages_group_roots unchanged.
    expect(h.inserted[0].thread_root_id).toBeUndefined();
    expect(boardRepostClientId(ORIGINAL)).toBe(h.inserted[0].client_message_id);
  });

  it('stores a blank quote as NULL, never as an empty string', async () => {
    const h = repostHarness({});
    await h.repost('   ');
    expect(h.inserted[0].text).toBeNull();
  });

  it('answers `already` when the unique index rejects the second attempt', async () => {
    const h = repostHarness({ insertError: { code: '23505' } });
    const result = await h.repost();
    expect(result).toEqual({ status: 'already' });
    expect(h.inserted).toHaveLength(0);
  });

  it('revives the viewer‘s own soft-removed repost instead of 409ing forever', async () => {
    const h = repostHarness({ insertError: { code: '23505' } });
    h.self.reviveRemovedRepost = jest.fn(async () => ({ id: 'revived' }));
    const result = await h.repost();
    expect(result).toEqual({ status: 'ok', message: { id: 'revived' } });
  });

  it('refuses a post that lives on another board', async () => {
    const h = repostHarness({ original: liveOriginal({ group_id: OTHER_GROUP }) });
    expect(await h.repost()).toEqual({ status: 'not_same_board' });
    expect(h.inserted).toHaveLength(0);
  });

  it('refuses a repost of a repost', async () => {
    const h = repostHarness({
      original: liveOriginal({
        reply_to_message_id: 'p0',
        thread_root_id: null,
        client_message_id: 'repost:p0',
      }),
    });
    expect(await h.repost()).toEqual({ status: 'repost_of_repost' });
  });

  /**
   * The same orphan the hydration has to render: once the original author's
   * account is deleted the repost row keeps `client_message_id = repost:<id>`
   * but loses `reply_to_message_id`, so the three-clause check no longer sees
   * it. Reposting THAT would build a chain the embed cannot describe. The
   * surviving client id is trustworthy because `sendMessage` refuses the
   * prefix, so nothing but `createBoardRepost` can have written it.
   */
  it('refuses a repost of an ORPHANED repost, whose pointer was nulled', async () => {
    const h = repostHarness({
      original: liveOriginal({
        reply_to_message_id: null,
        thread_root_id: null,
        client_message_id: 'repost:p0',
      }),
    });
    expect(await h.repost()).toEqual({ status: 'repost_of_repost' });
  });

  it('refuses a comment, which is not a post', async () => {
    const h = repostHarness({
      original: liveOriginal({ reply_to_message_id: 'p0', thread_root_id: 'p0' }),
    });
    expect(await h.repost()).toEqual({ status: 'not_a_post' });
  });

  it('refuses a removed post', async () => {
    const h = repostHarness({
      original: liveOriginal({ removed_at: new Date().toISOString() }),
    });
    expect(await h.repost()).toEqual({ status: 'removed' });
  });

  it('refuses bumping your own post within a day, and allows it after', async () => {
    const soon = repostHarness({
      original: liveOriginal({
        sender_id: VIEWER,
        timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(await soon.repost()).toEqual({ status: 'own_too_soon' });

    const later = repostHarness({
      original: liveOriginal({
        sender_id: VIEWER,
        timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      }),
    });
    expect((await later.repost()).status).toBe('ok');
  });

  it('caps reposts per person per board per hour', async () => {
    const h = repostHarness({ recentReposts: 5 });
    expect(await h.repost()).toEqual({ status: 'too_many' });
    expect(h.inserted).toHaveLength(0);
  });

  it('refuses a quote longer than the shared limit', async () => {
    const h = repostHarness({});
    expect(await h.repost('x'.repeat(281))).toEqual({ status: 'quote_too_long' });
  });

  it('refuses a group that is not a board', async () => {
    const h = repostHarness({ isBoard: false });
    expect(await h.repost()).toEqual({ status: 'not_board' });
  });

  it('never touches groups.last_message and never notifies (§6.3 rule 7)', async () => {
    const h = repostHarness({});
    await h.repost('bump');
    expect(h.calls.some((q) => q.table === 'groups')).toBe(false);
    expect(h.calls.some((q) => q.table === 'notifications')).toBe(false);
  });
});

describe('undoBoardRepost', () => {
  function undoHarness(options: { row?: any; children?: any[] } = {}) {
    const { row = { id: 'repost-row', group_id: GROUP, removed_at: null }, children = [] } =
      options;
    const deletes: Query[] = [];
    const updates: Query[] = [];
    const audits: any[] = [];
    const { db } = makeDb((q) => {
      if (q.table === 'chat_message_audit') {
        audits.push(q.payload);
        return { data: null, error: null };
      }
      if (q.table === 'messages' && q.has('delete')) {
        deletes.push(q);
        return { data: null, error: null };
      }
      if (q.table === 'messages' && q.has('update')) {
        updates.push(q);
        return { data: null, error: null };
      }
      if (q.table === 'messages' && q.arg('eq', 0) === 'thread_root_id') {
        return { data: children, error: null };
      }
      return { data: row ? [row] : [], error: null };
    });
    const self: any = { supabase: db };
    return {
      deletes,
      updates,
      audits,
      undo: () => boardActionsData.undoBoardRepost((self as any).supabase, ORIGINAL, VIEWER),
    };
  }

  it('hard-deletes the viewer‘s own repost row, scoped to sender_id', async () => {
    const h = undoHarness();
    const result = await h.undo();
    expect(result).toEqual({ status: 'ok', groupId: GROUP, repostId: 'repost-row' });
    expect(h.deletes).toHaveLength(1);
    const scoped = h.deletes[0]!.ops.filter((o) => o.fn === 'eq').map((o) => o.args);
    expect(scoped).toEqual(
      expect.arrayContaining([
        ['id', 'repost-row'],
        ['sender_id', VIEWER],
      ])
    );
  });

  it('works long after the 30-minute mutation window, by never calling the RPC', async () => {
    // remove_chat_message enforces `timestamp < now() - 30 minutes` in SQL, so
    // going through it would make a 45-minute-old repost impossible to undo.
    // The proof is that no rpc() call exists on the client at all.
    const h = undoHarness();
    await h.undo();
    expect(h.deletes).toHaveLength(1);
  });

  it('soft-removes, with an audit row, when something hangs off the repost', async () => {
    const h = undoHarness({ children: [{ id: 'c1' }] });
    const result = await h.undo();
    expect(result.status).toBe('ok');
    expect(h.deletes).toHaveLength(0);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]!.payload).toMatchObject({ removed_by: VIEWER, text: null });
    expect(h.audits[0]).toMatchObject({
      group_message_id: 'repost-row',
      actor_id: VIEWER,
      action: 'REMOVE',
    });
  });

  it('is a 404 when the viewer has no repost of that post', async () => {
    const h = undoHarness({ row: null });
    expect(await h.undo()).toEqual({ status: 'not_found' });
    expect(h.deletes).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });
});

describe('attachBoardRepostContext', () => {
  const PHOTO_URL =
    'https://x.supabase.co/storage/v1/object/sign/note-files/u1/chat/g1/1-a.webp?token=abc';

  function hydrateHarness(quotedRows: any[], repostRows: any[] = []) {
    const { db } = makeDb((q) => {
      if (q.table !== 'messages') return { data: [], error: null };
      if (q.select.includes('reply_to_message_id') && q.has('like')) {
        return { data: repostRows, error: null };
      }
      return { data: quotedRows, error: null };
    });
    const self: any = {
      supabase: db,
      toQuotedPost: boardActionsData.toQuotedPost,
      countRepostsFor: function (this: any, ids: string[]) { return boardActionsData.countRepostsFor(this.supabase, ids); },
      orphanedRepostEmbed: boardActionsData.orphanedRepostEmbed,
      normalizeStorageUrl: function (this: any, url: string) { return storageAclData.normalizeStorageUrl(this.supabaseUrl, url); },
    };
    return (rows: any[]) => boardActionsData.attachBoardRepostContext((self as any).supabase, self as any, rows, GROUP);
  }

  const repostRow = (id: string, target = ORIGINAL) => ({
    id,
    reply_to_message_id: target,
    thread_root_id: null,
    client_message_id: `repost:${target}`,
  });

  it('embeds the original as text and never as a media url', async () => {
    const hydrate = hydrateHarness([
      {
        id: ORIGINAL,
        sender_id: AUTHOR,
        subject: 'Exam week',
        text: `![photo](${PHOTO_URL}) Timetable is out`,
        image_url: null,
        timestamp: '2026-09-01T10:00:00.000Z',
        removed_at: null,
        profiles: { id: AUTHOR, name: 'Ada' },
      },
    ]);
    const [row] = await hydrate([repostRow('r1')]);

    expect(row.repostOf).toMatchObject({
      id: ORIGINAL,
      senderName: 'Ada',
      subject: 'Exam week',
      snippet: 'Timetable is out',
      hasImage: true,
      hasAudio: false,
      removedAt: null,
    });
    const serialised = JSON.stringify(row.repostOf);
    expect(serialised).not.toContain('/storage/v1/object/');
    expect(serialised).not.toContain('![photo](');
    expect(serialised).not.toContain('token=');
  });

  it('propagates a takedown of the original with zero writes to the repost', async () => {
    const hydrate = hydrateHarness([
      {
        id: ORIGINAL,
        sender_id: AUTHOR,
        subject: 'Exam week',
        text: 'Timetable is out',
        timestamp: '2026-09-01T10:00:00.000Z',
        removed_at: '2026-09-02T10:00:00.000Z',
        profiles: { id: AUTHOR, name: 'Ada' },
      },
    ]);
    const [row] = await hydrate([repostRow('r1')]);
    expect(row.repostOf.removedAt).toBe('2026-09-02T10:00:00.000Z');
    expect(row.repostOf.snippet).toBe('');
    expect(row.repostOf.subject).toBeNull();
  });

  it('is null when the pointer survives but the quoted row does not resolve', async () => {
    const hydrate = hydrateHarness([]);
    const [row] = await hydrate([repostRow('r1')]);
    expect(row.repostOf).toBeNull();
  });

  /**
   * The author deleting their ACCOUNT is the path that gets here:
   * `messages.sender_id` is ON DELETE CASCADE so the original is hard-deleted,
   * and `messages.reply_to_message_id` is ON DELETE SET NULL so every repost of
   * it loses its pointer. That fails the first clause of `isBoardRepostRow`, so
   * without a fallback the row stopped being a repost and rendered as an
   * ordinary — and, with no quote typed, completely blank — post under the
   * reposter's name.
   */
  it('still renders an orphaned repost as a repost when ON DELETE SET NULL fired', async () => {
    const hydrate = hydrateHarness([]);
    const [row] = await hydrate([
      {
        id: 'r1',
        // The pointer is gone; only the client id survives the delete.
        reply_to_message_id: null,
        thread_root_id: null,
        client_message_id: `repost:${ORIGINAL}`,
        timestamp: '2026-09-02T10:00:00.000Z',
      },
    ]);
    expect(row.repostOf).not.toBeNull();
    expect(row.repostOf.id).toBe(ORIGINAL);
    // A tombstone: the card says the original is gone rather than inventing it.
    expect(row.repostOf.removedAt).toBe('2026-09-02T10:00:00.000Z');
    expect(row.repostOf.snippet).toBe('');
    expect(row.repostOf.subject).toBeNull();
    expect(row.repostOf.hasImage).toBe(false);
    expect(row.repostOf.hasAudio).toBe(false);
  });

  it('does not mistake a plain post with no client id for an orphaned repost', async () => {
    const hydrate = hydrateHarness([]);
    const [row] = await hydrate([
      {
        id: 'p1',
        reply_to_message_id: null,
        thread_root_id: null,
        client_message_id: 'send-1725379200000',
        timestamp: '2026-09-02T10:00:00.000Z',
      },
    ]);
    expect(row.repostOf).toBeNull();
  });

  it('leaves an ordinary post alone and counts its reposts', async () => {
    const hydrate = hydrateHarness(
      [],
      [{ reply_to_message_id: ORIGINAL }, { reply_to_message_id: ORIGINAL }]
    );
    const rows = await hydrate([
      { id: ORIGINAL, reply_to_message_id: null, thread_root_id: null, client_message_id: null },
    ]);
    expect(rows[0].repostOf).toBeNull();
    expect(rows[0].repostCount).toBe(2);
  });
});
