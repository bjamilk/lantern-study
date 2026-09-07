/**
 * Community boards — the two server guarantees a board rests on (spec §3.4,
 * §3.9, founder decision 3).
 *
 * 1. A board post is NEVER a question. `sendMessage` skips the
 *    `JSON.parse(content)` branch entirely when the target group is a board,
 *    so a body that looks like a question stays `type='TEXT'` with the raw
 *    string in `text`: `question_data` is null, the `groups.question_count`
 *    trigger never fires, and `routes/messages.ts` writes no
 *    `group_question_posted` learning event, because that branch tests the
 *    type. The same body in a study group still mints a QUESTION.
 *
 * 2. A board post issues ZERO per-post fan-out. `notifyGroupMessageRecipients`
 *    inserts one notification plus one Expo push per non-sender member; on a
 *    community-scale board that is a campus-wide push per post. Mentions still
 *    notify, a comment notifies the thread, and every board notification links
 *    to /discover/c/:slug/ch/:groupId — never /chat/:groupId, which is the one
 *    surface a board must not open in.
 *
 * The lounge is the derived exception (founder decision 1): it carries a
 * community_id but stays a live chat, so it keeps the per-message fan-out.
 */
jest.mock('./cache', () => ({
  cacheService: {
    // Pass through: the board context is resolved fresh in every test.
    cached: async (_key: string, fn: () => Promise<unknown>) => fn(),
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deletePattern: jest.fn(async () => undefined),
    invalidateGroupCache: jest.fn(async () => undefined),
    invalidateUserCache: jest.fn(async () => undefined),
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { SupabaseService } from './supabase';
import { setSchemaCapabilities } from './schemaCapabilities';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';
const GROUP = '44444444-4444-4444-8444-444444444444';
const COMMUNITY = '55555555-5555-4555-8555-555555555555';
const ROOT = '66666666-6666-4666-8666-666666666666';

type Op = { fn: string; args: any[] };
type Call = { table: string; ops: Op[]; terminal: string };

const QUESTION_BODY = JSON.stringify({
  type: 'QUESTION',
  questionStem: 'Which drug is a beta blocker?',
  questionType: 'MCQ',
});

function makeSelf(options: {
  communitySurface?: 'board' | 'study_group' | null;
  communityId?: string | null;
  loungeGroupId?: string | null;
  slug?: string | null;
  memberCount?: number;
  boardColumns?: boolean;
  threadSenders?: string[];
  rootSenderId?: string;
}) {
  const {
    communitySurface = null,
    communityId = COMMUNITY,
    loungeGroupId = null,
    slug = 'course-pharm-101',
    memberCount = 40,
    boardColumns = true,
    threadSenders = [],
    rootSenderId = OTHER,
  } = options;

  setSchemaCapabilities({
    groupCommunitySurface: true,
    messageBoardColumns: boardColumns,
    // The mute read is a real query on a post-migration database; this
    // harness scripts every step, so the capability is pinned off.
    communityMemberMute: false,
  });

  const calls: Call[] = [];
  const inserted: Record<string, unknown>[] = [];
  const notifications: Array<{ userId: string; payload: any }> = [];

  const members = Array.from({ length: memberCount }, (_, i) =>
    i === 0 ? { user_id: USER } : { user_id: `member-${i}` },
  );

  const resolve = (call: Call): { data: unknown; error: unknown } => {
    const op = (fn: string) => call.ops.find((o) => o.fn === fn);
    if (call.table === 'communities') {
      return {
        data: { id: communityId, slug, created_by: OTHER, lounge_group_id: loungeGroupId },
        error: null,
      };
    }
    if (call.table === 'group_members') {
      return { data: members, error: null };
    }
    if (call.table === 'groups') {
      return { data: { id: GROUP }, error: null };
    }
    if (call.table === 'messages') {
      const insert = op('insert');
      if (insert) {
        const row = { id: 'new-message', timestamp: '2026-09-03T10:00:00.000Z', ...insert.args[0] };
        inserted.push(row);
        return { data: row, error: null };
      }
      // The comment fan-out reads the root, then that thread's senders.
      if (call.terminal === 'maybeSingle') {
        return { data: { id: ROOT, sender_id: rootSenderId }, error: null };
      }
      return { data: threadSenders.map((sender_id) => ({ sender_id })), error: null };
    }
    return { data: null, error: null };
  };

  const supabase = {
    from(table: string) {
      const ops: Op[] = [];
      const chain: any = {};
      for (const fn of ['select', 'eq', 'is', 'in', 'not', 'insert', 'update', 'order', 'limit']) {
        chain[fn] = (...args: any[]) => {
          ops.push({ fn, args });
          return chain;
        };
      }
      const settle = (terminal: string) => {
        const call: Call = { table, ops, terminal };
        calls.push(call);
        return Promise.resolve(resolve(call));
      };
      chain.single = () => settle('single');
      chain.maybeSingle = () => settle('maybeSingle');
      chain.then = (onOk: any, onErr: any) => settle('then').then(onOk, onErr);
      return chain;
    },
  };

  const proto = SupabaseService.prototype as any;
  const self: any = {
    supabase,
    // Real: these are the code under test.
    resolveBoardContext: proto.resolveBoardContext,
    notifyGroupMessageRecipients: proto.notifyGroupMessageRecipients,
    notifyMentionedUsers: proto.notifyMentionedUsers,
    notifyBoardCommentRecipients: proto.notifyBoardCommentRecipients,
    notifyReplyRecipient: proto.notifyReplyRecipient,
    // Stubbed: resolved elsewhere and separately covered.
    getGroupById: jest.fn(async () => ({
      id: GROUP,
      name: 'exam-week',
      adminIds: [],
      permissions: {},
      communityId,
      communitySurface,
    })),
    getUserById: jest.fn(async () => ({ id: USER, name: 'Ada', username: 'ada' })),
    resolveGroupMentionUserIds: jest.fn(
      async (_g: string, _u: string, _t: string, explicit?: string[]) => explicit ?? [],
    ),
    resolveThreadRootForReply: jest.fn(async () => ROOT),
    attachReplyPreview: jest.fn(async (row: any) => row),
    findGroupMessageByClientId: jest.fn(async () => null),
    incrementUserStatsAndAwardBadges: jest.fn(async () => undefined),
    createNotification: jest.fn(async (userId: string, payload: any) => {
      notifications.push({ userId, payload });
    }),
  };

  const send = (content: string, opts?: Record<string, unknown>) =>
    proto.sendMessage.call(self, GROUP, USER, content, undefined, opts);

  return { self, send, calls, inserted, notifications };
}

/** The notifications are fired with `void`; let those microtasks settle. */
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
};

describe('sendMessage on a community board', () => {
  it('never mints a QUESTION from a question-shaped body', async () => {
    const board = makeSelf({ communitySurface: null });
    const message = await board.send(QUESTION_BODY);
    await flush();

    expect(message.type).toBe('TEXT');
    expect(board.inserted[0]).toMatchObject({ type: 'TEXT', text: QUESTION_BODY });
    expect(board.inserted[0]).not.toHaveProperty('question_data');
    // question_count is a trigger on QUESTION rows; nothing here can fire it.
    expect(board.self.incrementUserStatsAndAwardBadges).not.toHaveBeenCalled();
  });

  it('still mints a QUESTION in a study group (regression)', async () => {
    const studyGroup = makeSelf({ communitySurface: 'study_group' });
    const message = await studyGroup.send(QUESTION_BODY);
    await flush();

    expect(message.type).toBe('QUESTION');
    expect(studyGroup.inserted[0]).toMatchObject({ type: 'QUESTION' });
    expect(studyGroup.inserted[0].question_data).toMatchObject({ type: 'QUESTION' });
    expect(studyGroup.self.incrementUserStatsAndAwardBadges).toHaveBeenCalledWith(USER, {
      questionsCreated: 1,
    });
  });

  it('creates ZERO notifications for a 40-member board and never reads the roster', async () => {
    const board = makeSelf({ communitySurface: 'board', memberCount: 40 });
    await board.send('Timetable is out');
    await flush();

    expect(board.notifications).toHaveLength(0);
    // The fan-out's own query must not even be issued.
    expect(board.calls.some((c) => c.table === 'group_members')).toBe(false);
  });

  it('still fans out per message in a study group (regression)', async () => {
    const studyGroup = makeSelf({ communitySurface: 'study_group', memberCount: 3 });
    await studyGroup.send('Timetable is out');
    await flush();

    // Two non-sender members, one notification each.
    expect(studyGroup.notifications).toHaveLength(2);
    expect(studyGroup.notifications[0].payload.type).toBe('group_message');
    expect(studyGroup.notifications[0].payload.link).toBe(`/chat/${GROUP}`);
  });

  it('still fans out in the lounge — it is a chat, not a board (founder decision 1)', async () => {
    const lounge = makeSelf({
      communitySurface: null,
      loungeGroupId: GROUP,
      memberCount: 2,
    });
    await lounge.send('Morning all');
    await flush();

    expect(lounge.notifications).toHaveLength(1);
    expect(lounge.notifications[0].payload.link).toBe(`/chat/${GROUP}`);
  });

  it('an @mention on a board notifies exactly one person, into the community', async () => {
    const board = makeSelf({ communitySurface: 'board', memberCount: 40 });
    await board.send('@ada look at this', { mentionedUserIds: [OTHER] });
    await flush();

    expect(board.notifications).toHaveLength(1);
    const only = board.notifications[0];
    expect(only.userId).toBe(OTHER);
    expect(only.payload.type).toBe('mention');
    // The link points AT THE POST (§8.2). `?messageId=` was read by no client
    // and could not be opened on web at all; `/p/{postId}` is the path both
    // platforms route, and the one a shared link uses.
    expect(only.payload.link).toBe(
      `/discover/c/course-pharm-101/ch/${GROUP}/p/new-message`,
    );
    expect(only.payload.link).not.toContain('/chat/');
  });

  it('an unresolvable slug falls back to /discover, never to /chat', async () => {
    const board = makeSelf({ communitySurface: 'board', slug: null });
    await board.send('@ada hello', { mentionedUserIds: [OTHER] });
    await flush();

    expect(board.notifications[0].payload.link).toBe('/discover');
  });

  it('a comment notifies the root author and prior repliers only', async () => {
    const board = makeSelf({
      communitySurface: 'board',
      memberCount: 40,
      rootSenderId: OTHER,
      // The sender's own earlier reply and a duplicate must not double-notify.
      threadSenders: [THIRD, THIRD, USER, OTHER],
    });
    await board.send('Agreed', { replyToMessageId: ROOT });
    await flush();

    expect(board.notifications.map((n) => n.userId).sort()).toEqual([OTHER, THIRD].sort());
    const rootAuthor = board.notifications.find((n) => n.userId === OTHER)!;
    const replier = board.notifications.find((n) => n.userId === THIRD)!;
    expect(rootAuthor.payload.message).toContain('replied to your post in exam-week');
    expect(replier.payload.message).toContain('commented on a post you follow in exam-week');
    // A comment has no surface of its own, so the link opens the POST that
    // holds it — the thread root — not the comment row.
    expect(rootAuthor.payload.link).toBe(
      `/discover/c/course-pharm-101/ch/${GROUP}/p/${ROOT}`,
    );
    // Still zero per-post fan-out for the other 38 members.
    expect(board.calls.some((c) => c.table === 'group_members')).toBe(false);
  });

  it('a mentioned commenter is notified once, as a mention, not twice', async () => {
    const board = makeSelf({
      communitySurface: 'board',
      rootSenderId: OTHER,
      threadSenders: [THIRD],
    });
    await board.send('@ada and @bo', {
      replyToMessageId: ROOT,
      mentionedUserIds: [OTHER, THIRD],
    });
    await flush();

    expect(board.notifications).toHaveLength(2);
    expect(board.notifications.every((n) => n.payload.type === 'mention')).toBe(true);
  });

  it('persists a post title, and drops it (never rejects it) pre-migration', async () => {
    const withColumn = makeSelf({ communitySurface: 'board', boardColumns: true });
    await withColumn.send('Body', { subject: '  Exam week plan  ' });
    expect(withColumn.inserted[0].subject).toBe('Exam week plan');

    const preMigration = makeSelf({ communitySurface: 'board', boardColumns: false });
    const message = await preMigration.send('Body', { subject: 'Exam week plan' });
    expect(preMigration.inserted[0]).not.toHaveProperty('subject');
    expect(message.type).toBe('TEXT');
  });
});
