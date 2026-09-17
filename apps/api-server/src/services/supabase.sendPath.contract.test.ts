/**
 * supabase.sendPath.contract.test.ts — the send path's ORDER, frozen.
 *
 * `sendMessage` is the widest method in `services/supabase.ts` and the single
 * highest-risk move in the monolith programme (`TEAM-S1-api-structure.md`,
 * "Risk (high)"): one call resolves the board, refuses a muted member,
 * resolves mentions and the thread root, writes the row (retrying twice past
 * unapplied migrations), bumps the group preview, fans out three kinds of
 * notification and invalidates the page cache — with no transaction around any
 * of it. The danger in extracting it is not that a step disappears. It is that
 * two awaits swap places, so a client that used to see "you are muted" now
 * sees "not a moderator", or a row is written before a gate that used to
 * refuse it.
 *
 * This suite is written against the UNTOUCHED file, before the extraction, and
 * asserts three things per case:
 *   (a) the exact ORDER of transport calls and sibling steps on the happy path,
 *   (b) WHICH error surfaces, with what message/statusCode, when step N fails,
 *   (c) which SIDE EFFECTS have already happened by the time it surfaces.
 *
 * Mutation-checked: swapping the `groups` preview update with
 * `cacheService.invalidateGroupCache`, or the mute check with the JSON parse,
 * fails cases here.
 *
 * The trace records `from:<table>` at the moment `.from()` is CALLED, not when
 * the query resolves, because two of the writes are fire-and-forget (`void
 * this.supabase.from("groups")…`) and their resolution order is a microtask
 * detail, not a contract. Everything else is recorded where it is awaited.
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

import * as chatSendData from './data/chatSend';
import { cacheService } from './cache';
import { setSchemaCapabilities } from './schemaCapabilities';
import { COMMUNITY_MODERATION_COPY } from '@lantern/shared/network';

const GROUP = '44444444-4444-4444-8444-444444444444';
const SENDER = '11111111-1111-4111-8111-111111111111';
const COMMUNITY = '77777777-7777-4777-8777-777777777777';
const PARENT = '22222222-2222-4222-8222-222222222222';

type Q = { table: string; ops: string[]; payload: any };

/** A 42703 — the shape `isMissingColumnError` recognises. */
const missingColumn = (column: string) => ({
  code: '42703',
  message: `column messages.${column} does not exist`,
});

type HarnessOptions = {
  isBoard?: boolean;
  mutedUntil?: string | null;
  /** Answer for each `messages` insert attempt, in order. */
  insertResults?: Array<{ data: any; error: any }>;
  existingByClientId?: any;
  role?: string | null;
  resolveBoardContext?: () => Promise<any>;
  mentionedUserIds?: string[];
  threadRootId?: string | undefined;
};

function harness(opts: HarnessOptions = {}) {
  const trace: string[] = [];
  const queries: Q[] = [];
  const inserts = [...(opts.insertResults ?? [{ data: { id: 'm1', timestamp: 'T0', thread_root_id: null }, error: null }])];

  const from = (table: string) => {
    const q: any = { table, ops: [], payload: undefined };
    trace.push(`from:${table}`);
    for (const fn of ['select', 'insert', 'update', 'eq', 'is', 'in', 'like', 'gte', 'order', 'limit', 'not']) {
      q[fn] = (...args: any[]) => {
        q.ops.push(fn);
        if (fn === 'insert' || fn === 'update') q.payload = args[0];
        return q;
      };
    }
    q.single = () => q;
    q.maybeSingle = () => q;
    q.then = (resolve: any, reject: any) =>
      Promise.resolve()
        .then(() => {
          if (q.table === 'community_members') {
            return { data: { muted_until: opts.mutedUntil ?? null }, error: null };
          }
          if (q.table === 'messages' && q.ops.includes('insert')) {
            return inserts.shift() ?? { data: null, error: { code: 'EXHAUSTED' } };
          }
          return { data: null, error: null, count: 0 };
        })
        .then(resolve, reject);
    queries.push(q);
    return q;
  };

  const step = <T>(name: string, value: T) =>
    jest.fn(async (...args: any[]) => {
      trace.push(name);
      return typeof value === 'function' ? (value as any)(...args) : value;
    });

  const self: any = {
    supabase: { from },
    resolveBoardContext:
      opts.resolveBoardContext
        ? jest.fn(async (...a: any[]) => {
            trace.push('resolveBoardContext');
            return opts.resolveBoardContext!.apply(null, a as any);
          })
        : step('resolveBoardContext', {
            isBoard: !!opts.isBoard,
            communityId: COMMUNITY,
            communitySlug: 'unilag',
            communityCreatedBy: null,
            loungeGroupId: opts.isBoard ? null : GROUP,
            adminIds: [],
          }),
    resolveGroupMentionUserIds: step('resolveGroupMentionUserIds', opts.mentionedUserIds ?? []),
    resolveThreadRootForReply: step('resolveThreadRootForReply', opts.threadRootId),
    resolveCommunityRoleFor: step('resolveCommunityRoleFor', opts.role ?? 'member'),
    findGroupMessageByClientId: step('findGroupMessageByClientId', opts.existingByClientId ?? null),
    incrementUserStatsAndAwardBadges: step('incrementUserStatsAndAwardBadges', undefined),
    notifyGroupMessageRecipients: step('notifyGroupMessageRecipients', undefined),
    notifyMentionedUsers: step('notifyMentionedUsers', undefined),
    notifyReplyRecipient: step('notifyReplyRecipient', undefined),
    notifyBoardCommentRecipients: step('notifyBoardCommentRecipients', undefined),
    attachReplyPreview: jest.fn(async (row: any) => {
      trace.push('attachReplyPreview');
      return row;
    }),
  };

  (cacheService.invalidateGroupCache as jest.Mock).mockImplementation(async () => {
    trace.push('invalidateGroupCache');
  });

  return { self, trace, queries };
}

/**
 * HARNESS (monolith lane M3, Phase B): this was
 * `proto.sendMessage.apply(self, args)`. The body is `data/chatSend.sendMessage`
 * and always was — the facade only forwarded `(this.supabase, {deps…}, …args)`,
 * and `self` carries exactly those deps. All 18 cases, their fixtures and their
 * assertions are unchanged; the mutation check (move the mute gate after
 * mention resolution → 7 of 18 must fail) was re-run against this harness.
 */
const send = (self: any, ...args: any[]) =>
  (chatSendData.sendMessage as any)(self.supabase, self, ...args);
const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

beforeEach(() => {
  jest.clearAllMocks();
  // Every capability decided, so no probe query enters the trace and no test
  // inherits a `mark…Missing()` latch from the one before it.
  setSchemaCapabilities({
    messageBoardColumns: true,
    messagePostKind: true,
    communityMemberMute: true,
  });
});

describe('sendMessage — happy-path order', () => {
  it('a plain chat message: board context → mute → mentions → insert → preview → notify → cache → reply preview', async () => {
    const { self, trace } = harness();
    const result = await send(self, GROUP, SENDER, 'hello', undefined, {});

    expect(trace).toEqual([
      'resolveBoardContext',
      'from:community_members',
      'resolveGroupMentionUserIds',
      'from:messages',
      'from:groups',
      'notifyGroupMessageRecipients',
      'notifyMentionedUsers',
      'invalidateGroupCache',
      'attachReplyPreview',
    ]);
    expect(result).toMatchObject({
      id: 'm1',
      replyCount: 0,
      receiptStatus: 'sent',
      seenByCount: 0,
      seenByTotal: 0,
    });
  });

  it('a QUESTION invalidates the cache and awards the badge BEFORE it bumps the group preview — the TEXT branch does the opposite', async () => {
    const { self, trace } = harness();
    await send(self, GROUP, SENDER, JSON.stringify({ type: 'QUESTION', questionStem: 'Why?' }), undefined, {});

    expect(trace).toEqual([
      'resolveBoardContext',
      'from:community_members',
      'resolveGroupMentionUserIds',
      'from:messages',
      'invalidateGroupCache',
      'incrementUserStatsAndAwardBadges',
      'from:groups',
      'notifyGroupMessageRecipients',
      'notifyMentionedUsers',
      'attachReplyPreview',
    ]);
    // …and the TEXT branch is the mirror image: preview and notifications
    // first, cache invalidation last.
    const text = harness();
    await send(text.self, GROUP, SENDER, 'hello', undefined, {});
    expect(text.trace.indexOf('from:groups')).toBeLessThan(text.trace.indexOf('invalidateGroupCache'));
    expect(text.trace.indexOf('notifyMentionedUsers')).toBeLessThan(
      text.trace.indexOf('invalidateGroupCache'),
    );
  });

  it('a board post skips the JSON parse, probes the board columns for a subject, and fans NOTHING out to the board members', async () => {
    const { self, trace, queries } = harness({ isBoard: true });
    // A body that is valid JSON with a questionStem — on a board it must stay
    // a TEXT post (spec §3.4), which is what "skips the parse" means.
    await send(self, GROUP, SENDER, JSON.stringify({ questionStem: 'Why?' }), undefined, {
      subject: 'Title',
    });

    expect(trace).toEqual([
      'resolveBoardContext',
      'from:community_members',
      'resolveGroupMentionUserIds',
      'from:messages',
      'from:groups',
      'notifyMentionedUsers',
      'invalidateGroupCache',
      'attachReplyPreview',
    ]);
    expect(trace).not.toContain('notifyGroupMessageRecipients');
    const insert = queries.find((q) => q.table === 'messages' && q.ops.includes('insert'))!;
    expect(insert.payload).toMatchObject({ type: 'TEXT', subject: 'Title' });
    expect(insert.payload.question_data).toBeUndefined();
  });

  it('a board COMMENT resolves the thread root before the insert and notifies the thread, not the reply author', async () => {
    const { self, trace } = harness({ isBoard: true, threadRootId: 'root-1' });
    await send(self, GROUP, SENDER, 'a comment', undefined, { replyToMessageId: PARENT });

    expect(trace.indexOf('resolveThreadRootForReply')).toBeLessThan(trace.indexOf('from:messages'));
    expect(trace).toContain('notifyBoardCommentRecipients');
    expect(trace).not.toContain('notifyReplyRecipient');
  });

  it('a chat reply notifies the reply author, not the thread', async () => {
    const { self, trace } = harness({ threadRootId: 'root-1' });
    await send(self, GROUP, SENDER, 'a reply', undefined, { replyToMessageId: PARENT });

    expect(trace).toContain('notifyReplyRecipient');
    expect(trace).not.toContain('notifyBoardCommentRecipients');
  });
});

describe('sendMessage — which error surfaces, and what has already happened', () => {
  it('step 1 — the board context fails: that error surfaces and NOTHING else has run', async () => {
    const boom = Object.assign(new Error('board lookup failed'), { statusCode: 500 });
    const { self, trace } = harness({
      resolveBoardContext: async () => {
        throw boom;
      },
    });

    await expect(send(self, GROUP, SENDER, 'hello', undefined, {})).rejects.toBe(boom);
    expect(trace).toEqual(['resolveBoardContext']);
  });

  it('step 2 — a live mute wins over EVERY later refusal: 403 with the muted copy, before any parse, mention lookup or insert', async () => {
    const { self, trace } = harness({ isBoard: true, mutedUntil: future() });

    await expect(
      send(self, GROUP, SENDER, 'hello', undefined, { postKind: 'announcement' }),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: COMMUNITY_MODERATION_COPY.mutedTitle,
    });
    // Not "restrictedKind": the mute is checked first, so a muted non-moderator
    // is told they are muted rather than that they may not post an announcement.
    expect(trace).toEqual(['resolveBoardContext', 'from:community_members']);
    expect(cacheService.invalidateGroupCache).not.toHaveBeenCalled();
  });

  it('step 3 — an announcement from a non-moderator: 403 restrictedKind, AFTER mentions are resolved and BEFORE any row is written', async () => {
    const { self, trace } = harness({ isBoard: true, role: 'member' });

    await expect(
      send(self, GROUP, SENDER, 'notice', undefined, { postKind: 'announcement' }),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: COMMUNITY_MODERATION_COPY.restrictedKind,
    });
    expect(trace).toEqual([
      'resolveBoardContext',
      'from:community_members',
      'resolveGroupMentionUserIds',
      'resolveCommunityRoleFor',
    ]);
    expect(trace).not.toContain('from:messages');
  });

  it('step 4 — the insert fails: the raw database error surfaces and no preview, notification or cache invalidation has happened', async () => {
    const dbError = { code: '23514', message: 'messages_text_check' };
    const { self, trace } = harness({ insertResults: [{ data: null, error: dbError }] });

    await expect(send(self, GROUP, SENDER, 'hello', undefined, {})).rejects.toBe(dbError);
    expect(trace).toEqual([
      'resolveBoardContext',
      'from:community_members',
      'resolveGroupMentionUserIds',
      'from:messages',
    ]);
    expect(trace).not.toContain('from:groups');
    expect(cacheService.invalidateGroupCache).not.toHaveBeenCalled();
  });

  it('step 4 — a duplicate client_message_id replays the existing row: no second write, no notification, no cache invalidation', async () => {
    const existing = { id: 'already-here' };
    const { self, trace } = harness({
      insertResults: [{ data: null, error: { code: '23505' } }],
      existingByClientId: existing,
    });

    const result = await send(self, GROUP, SENDER, 'hello', 'client-1', {});
    expect(result).toBe(existing);
    expect(trace).toEqual([
      'resolveBoardContext',
      'from:community_members',
      'resolveGroupMentionUserIds',
      'from:messages',
      'findGroupMessageByClientId',
    ]);
    expect(cacheService.invalidateGroupCache).not.toHaveBeenCalled();
    expect(self.attachReplyPreview).not.toHaveBeenCalled();
  });

  it('step 4 — a 23505 whose row cannot be found again surfaces the constraint error itself', async () => {
    const dbError = { code: '23505', message: 'duplicate key' };
    const { self } = harness({
      insertResults: [{ data: null, error: dbError }],
      existingByClientId: null,
    });

    await expect(send(self, GROUP, SENDER, 'hello', 'client-1', {})).rejects.toBe(dbError);
  });

  it('step 4 — a 23505 with NO client_message_id is never replayed', async () => {
    const dbError = { code: '23505', message: 'duplicate key' };
    const { self, trace } = harness({ insertResults: [{ data: null, error: dbError }] });

    await expect(send(self, GROUP, SENDER, 'hello', undefined, {})).rejects.toBe(dbError);
    expect(trace).not.toContain('findGroupMessageByClientId');
  });

  it('a QUESTION insert failure surfaces before the cache is invalidated and before the badge is awarded', async () => {
    const dbError = { code: '23502', message: 'null value in column' };
    const { self, trace } = harness({ insertResults: [{ data: null, error: dbError }] });

    await expect(
      send(self, GROUP, SENDER, JSON.stringify({ type: 'QUESTION', questionStem: 'Why?' }), undefined, {}),
    ).rejects.toBe(dbError);
    expect(trace).not.toContain('invalidateGroupCache');
    expect(trace).not.toContain('incrementUserStatsAndAwardBadges');
  });
});

describe('sendMessage — the two migration degradations, in order', () => {
  it('an unapplied post_kind column retries WITHOUT the kind, keeping the subject', async () => {
    const row = { id: 'm1', timestamp: 'T0', thread_root_id: null };
    const { self, queries } = harness({
      isBoard: true,
      insertResults: [
        { data: null, error: missingColumn('post_kind') },
        { data: row, error: null },
      ],
    });

    await send(self, GROUP, SENDER, 'body', undefined, { subject: 'Title', postKind: 'question' });

    const inserts = queries.filter((q) => q.table === 'messages' && q.ops.includes('insert'));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].payload).toMatchObject({ subject: 'Title', post_kind: 'question' });
    expect(inserts[1].payload).toMatchObject({ subject: 'Title' });
    expect(inserts[1].payload.post_kind).toBeUndefined();
  });

  it('an unapplied subject column then drops the title too — three attempts, never a 500', async () => {
    const row = { id: 'm1', timestamp: 'T0', thread_root_id: null };
    const { self, queries } = harness({
      isBoard: true,
      insertResults: [
        { data: null, error: missingColumn('post_kind') },
        { data: null, error: missingColumn('subject') },
        { data: row, error: null },
      ],
    });

    const result = await send(self, GROUP, SENDER, 'body', undefined, {
      subject: 'Title',
      postKind: 'question',
    });

    const inserts = queries.filter((q) => q.table === 'messages' && q.ops.includes('insert'));
    expect(inserts).toHaveLength(3);
    expect(inserts[2].payload.subject).toBeUndefined();
    expect(inserts[2].payload.post_kind).toBeUndefined();
    expect(result).toMatchObject({ id: 'm1' });
  });
});

describe('sendMessage — the reserved-prefix and image gates', () => {
  it('a forged `repost:` client_message_id is dropped, not rejected: the row is written without it', async () => {
    const { self, queries } = harness();
    await send(self, GROUP, SENDER, 'hello', 'repost:someone-elses-id', {});

    const insert = queries.find((q) => q.table === 'messages' && q.ops.includes('insert'))!;
    expect(insert.payload.client_message_id).toBeUndefined();
  });

  it('an image_url that does not belong to this sender and board is dropped, and the post is still written', async () => {
    const { self, queries } = harness({ isBoard: true });
    await send(self, GROUP, SENDER, 'body', undefined, {
      imageUrl: 'https://example.com/someone-elses.png',
    });

    const insert = queries.find((q) => q.table === 'messages' && q.ops.includes('insert'))!;
    expect(insert.payload.image_url).toBeUndefined();
    expect(insert.payload.type).toBe('TEXT');
  });

  it('a chat message never writes image_url, even when the caller supplies one', async () => {
    const { self, queries } = harness({ isBoard: false });
    await send(self, GROUP, SENDER, 'body', undefined, {
      imageUrl: `https://cdn.example.com/storage/v1/object/public/chat-media/${SENDER}/${GROUP}/p.png`,
    });

    const insert = queries.find((q) => q.table === 'messages' && q.ops.includes('insert'))!;
    expect(insert.payload.image_url).toBeUndefined();
  });
});
