/**
 * A board post carries a title, a body and ONE photo as ONE `messages` row
 * (spec §5).
 *
 * `messages.image_url` has existed since 20251117020518 and is written by NO
 * message path today, so this is the FIRST encoding rather than a third one —
 * legacy markdown posts keep rendering through `parseChatImageUrl` /
 * `splitBoardBody`, which are not touched.
 *
 * Two properties matter enough to pin:
 *
 *  - the column is written on BOARDS ONLY. Group chat and DMs keep sending a
 *    photo as its own markdown message this phase, and widening that here
 *    would change how every existing chat bubble renders;
 *  - the path IS the ACL. `canAccessStorageObject` resolves
 *    `note-files/{owner}/chat/{groupId}/…` back to `isGroupMember(groupId, …)`,
 *    so an `image_url` pointing anywhere else is refused before the insert.
 *    Without that check a client could name another group's object.
 */
import * as groupMessagesData from './data/groupMessages';
/**
 * HARNESS (monolith lane M3, Phase B): this suite used to drive
 * `SupabaseService.prototype.<m>.call(self, …)`. It now calls the data module
 * that owns the body. Nothing else moved: the same stand-in is built the same
 * way, and it is passed as the `deps` literal, which is what the facade's
 * inline `deps` arrows read off `this` anyway. Every `it` title, every
 * `expect` and every fixture is byte-identical.
 */
import * as chatSendData from './data/chatSend';
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
import { isBoardImageUrlAllowed } from '@lantern/shared/network';
import { parseStorageObjectUrl } from '@lantern/shared/utils/storageUrl';

const GROUP = '44444444-4444-4444-8444-444444444444';
const OTHER_GROUP = '55555555-5555-4555-8555-555555555555';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';

const SUPABASE = 'https://project.supabase.co';
const signed = (path: string) =>
  `${SUPABASE}/storage/v1/object/sign/note-files/${path}?token=abc`;

const MINE = signed(`${USER}/chat/${GROUP}/1756900000-photo.webp`);


function makeDb(handler: (q: any) => any) {
  const calls: any[] = [];
  const CHAIN = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'is', 'not'];
  const from = (table: string) => {
    const q: any = { table, ops: [] };
    for (const fn of CHAIN) {
      q[fn] = (...args: any[]) => {
        q.ops.push({ fn, args });
        if (fn === 'insert' || fn === 'update') q.payload = args[0];
        return q;
      };
    }
    q.single = () => q;
    q.maybeSingle = () => q;
    q.then = (resolve: any, reject: any) =>
      Promise.resolve()
        .then(() => handler(q))
        .then(resolve, reject);
    calls.push(q);
    return q;
  };
  return { db: { from }, calls };
}

function sendHarness(isBoard: boolean) {
  const inserts: any[] = [];
  const { db } = makeDb((q) => {
    if (q.table === 'messages' && q.ops.some((o: any) => o.fn === 'insert')) {
      inserts.push(q.payload);
      return {
        data: { id: 'm1', timestamp: '2026-09-03T12:00:00.000Z', ...q.payload },
        error: null,
      };
    }
    return { data: null, error: null };
  });

  const self: any = {
    supabase: db,
    resolveBoardContext: jest.fn(async () => ({
      isBoard,
      communityId: isBoard ? 'c1' : null,
      communitySlug: isBoard ? 'unilag' : null,
      communityCreatedBy: null,
      loungeGroupId: null,
      adminIds: [],
    })),
    resolveGroupMentionUserIds: jest.fn(async () => []),
    notifyGroupMessageRecipients: jest.fn(async () => undefined),
    notifyMentionedUsers: jest.fn(async () => undefined),
    notifyBoardCommentRecipients: jest.fn(async () => undefined),
    notifyReplyRecipient: jest.fn(async () => undefined),
    attachReplyPreview: jest.fn(async (row: any) => row),
    findGroupMessageByClientId: jest.fn(async () => null),
  };

  return {
    inserts,
    send: (content: string, options: Record<string, unknown>) =>
      chatSendData.sendMessage((self as any).supabase, self as any, GROUP, USER, content, undefined, options),
  };
}

beforeEach(() => {
  setSchemaCapabilities({ messageBoardColumns: true, messageReactionsColumn: true, communityMemberMute: false });
});

describe('the shared board-image ACL rule', () => {
  const check = (url: string, userId = USER, groupId = GROUP) =>
    isBoardImageUrlAllowed({ url, userId, groupId, parse: parseStorageObjectUrl });

  it('accepts the caller‘s own upload for this board', () => {
    expect(check(MINE)).toBe(true);
  });

  it('refuses another user‘s object and another board‘s object', () => {
    expect(check(signed(`${OTHER_USER}/chat/${GROUP}/1-a.webp`))).toBe(false);
    expect(check(signed(`${USER}/chat/${OTHER_GROUP}/1-a.webp`))).toBe(false);
  });

  it('refuses a bucket other than note-files', () => {
    expect(
      check(
        `${SUPABASE}/storage/v1/object/sign/question-images/${USER}/chat/${GROUP}/1-a.webp?token=abc`
      )
    ).toBe(false);
  });

  it('refuses anything that is not a storage object url', () => {
    expect(check('https://evil.test/a.webp')).toBe(false);
    expect(check('')).toBe(false);
    expect(check('not a url')).toBe(false);
  });
});

describe('sendMessage with a board photo', () => {
  it('writes image_url and leaves the body free of image markdown', async () => {
    const h = sendHarness(true);
    await h.send('Timetable is out', { subject: 'Exam week', imageUrl: MINE });

    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({
      type: 'TEXT',
      text: 'Timetable is out',
      subject: 'Exam week',
      image_url: MINE,
    });
    expect(String(h.inserts[0].text)).not.toContain('![image](');
  });

  it('ignores imageUrl entirely on a group that is not a board', async () => {
    const h = sendHarness(false);
    await h.send('hello', { imageUrl: MINE });
    expect(h.inserts[0].image_url).toBeUndefined();
  });

  it('drops an imageUrl that points outside this caller‘s board prefix', async () => {
    const h = sendHarness(true);
    await h.send('hello', { imageUrl: signed(`${OTHER_USER}/chat/${OTHER_GROUP}/1-a.webp`) });
    expect(h.inserts[0].image_url).toBeUndefined();
  });

  it('drops an imageUrl in another bucket', async () => {
    const h = sendHarness(true);
    await h.send('hello', {
      imageUrl: `${SUPABASE}/storage/v1/object/sign/job-resumes/${USER}/chat/${GROUP}/1-a.pdf`,
    });
    expect(h.inserts[0].image_url).toBeUndefined();
  });

  it('posts text only when nothing is attached', async () => {
    const h = sendHarness(true);
    await h.send('just words', {});
    expect(h.inserts[0].image_url).toBeUndefined();
  });

  it('refuses a forged repost client id on the ordinary send path', async () => {
    // repost:<id> is the third clause of the repost discriminator. If a client
    // could set it here, a comment that later loses thread_root_id to
    // ON DELETE SET NULL would render as somebody's repost.
    const inserts: any[] = [];
    const { db } = makeDb((q) => {
      if (q.table === 'messages' && q.ops.some((o: any) => o.fn === 'insert')) {
        inserts.push(q.payload);
        return { data: { id: 'm1', ...q.payload }, error: null };
      }
      return { data: null, error: null };
    });
    const self: any = {
      supabase: db,
      resolveBoardContext: jest.fn(async () => ({
        isBoard: true,
        communityId: 'c1',
        communitySlug: 'unilag',
        communityCreatedBy: null,
        loungeGroupId: null,
        adminIds: [],
      })),
      resolveGroupMentionUserIds: jest.fn(async () => []),
      notifyMentionedUsers: jest.fn(async () => undefined),
      notifyBoardCommentRecipients: jest.fn(async () => undefined),
      attachReplyPreview: jest.fn(async (row: any) => row),
      findGroupMessageByClientId: jest.fn(async () => null),
    };
    await chatSendData.sendMessage((self as any).supabase, self as any, GROUP, USER, 'hello', 'repost:deadbeef', {});
    expect(inserts[0].client_message_id).toBeUndefined();
  });
});

describe('editing a post never touches its photo', () => {
  it('is guaranteed by edit_chat_message, which updates text and edited_at only', async () => {
    // 20260723210655 defines edit_chat_message as
    //   UPDATE public.messages SET text = p_new_text, edited_at = v_now
    // and the service passes only (kind, messageId, actorId, content), so
    // there is no code path from PUT /messages/:messageId to image_url.
    //
    // REWRITTEN (M3 Phase B, PR 4): this used to assert
    // `toHaveLength(4)` on `SupabaseService.editChatMessage`, which measured
    // the FACADE's signature rather than the behaviour. The arity of a deleted
    // method is not a property worth freezing; what the test was protecting is
    // WHAT REACHES THE RPC — the four named arguments, the actor id among them
    // so an edit can never be made anonymously, and no image column anywhere.
    // That is asserted directly now, by driving the function.
    const rpc = jest.fn(async (..._args: unknown[]) => ({
      data: { status: 'not_found' },
      error: null,
    }));
    await groupMessagesData.editChatMessage(
      { rpc } as never,
      {} as never,
      'group',
      'message-1',
      'actor-1',
      'edited text',
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('edit_chat_message', {
      p_message_kind: 'group',
      p_message_id: 'message-1',
      p_actor_id: 'actor-1',
      p_new_text: 'edited text',
    });
    const payload = rpc.mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(Object.keys(payload)).toHaveLength(4);
    expect(JSON.stringify(payload)).not.toContain('image');
  });
});
