/**
 * Table tests for the group-store mapping layer (lane M2).
 *
 * `mapApiMessage` is the most complex function in the mobile client
 * (cyclomatic 119) and, until this file, had no direct test: the only way to
 * exercise it was to drive the whole 3.1k-line store. Every branch it carries
 * is a rule some chat surface depends on, and several of them are scar tissue
 * from shipped defects — the `type` vs `questionType` normaliser, the board
 * post whose body starts with `{`, the author label that must not collapse to
 * "Member", the partial realtime payload that must not blank a question.
 *
 * Pulled out, each rule is a pure input→output table asserted here.
 */
jest.mock('../authStore', () => ({
  __esModule: true,
  useAuthStore: { getState: () => mockAuthState },
}));

let mockAuthState: {
  user: { id: string; user_metadata?: Record<string, unknown> } | null;
  profileName: string | null;
} = { user: null, profileName: null };

import {
  applyDirectMessageMutation,
  applyGroupMessageMutation,
  isOptimisticMessageId,
  mapApiGroup,
  mapApiMember,
  mapApiMessage,
  mapDirectMessage,
  mapDmThread,
  mergeGroupMessageIntoList,
  replaceOptimisticWithServer,
  resolveDmHistoryClearedAt,
  stripOptimisticDuplicates,
} from './mapping';
import type { DirectMessage, Message } from './types';

beforeEach(() => {
  mockAuthState = { user: null, profileName: null };
});

const msg = (over: Partial<Message> = {}): Message =>
  ({
    id: 'm1',
    groupId: 'g1',
    senderId: 'u1',
    senderName: 'Ada',
    text: 'hello',
    type: 'text',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as Message;

// ---------------------------------------------------------------------------
// mapApiMessage — the type / questionType normaliser
// ---------------------------------------------------------------------------

describe('mapApiMessage: what makes a row a question', () => {
  const cases: Array<{ name: string; row: any; type: Message['type']; text: string }> = [
    {
      name: 'a plain chat row is text',
      row: { id: 'm', content: 'hi there' },
      type: 'text',
      text: 'hi there',
    },
    {
      name: 'an explicit server type=QUESTION is a question',
      row: { id: 'm', type: 'QUESTION', content: 'What is K?', question_stem: 'What is K?' },
      type: 'question',
      text: 'What is K?',
    },
    {
      name: 'a lowercase server type is upper-cased before it is read',
      row: { id: 'm', type: 'question', content: '{"questionStem":"Stem"}' },
      type: 'question',
      text: 'Stem',
    },
    {
      name: 'a JSON body with a questionStem is a question when no type is declared',
      row: { id: 'm', content: '{"questionStem":"Why?","type":"QUESTION"}' },
      type: 'question',
      text: 'Why?',
    },
    {
      name: 'a JSON body with type=question (lowercase, in the body) is a question',
      row: { id: 'm', content: '{"type":"question","text":"x"}' },
      type: 'question',
      text: '{"type":"question","text":"x"}',
    },
    {
      // The board regression: a post whose body happens to start with `{` was
      // re-derived as a question and rendered as a read-only legacy question
      // card on mobile while web showed an ordinary post.
      name: 'an explicit type=TEXT wins over a body that starts with {',
      row: { id: 'm', type: 'TEXT', content: '{"questionStem":"not a question"}' },
      type: 'text',
      text: '{"questionStem":"not a question"}',
    },
    {
      name: 'unparseable JSON falls back to text rather than throwing',
      row: { id: 'm', content: '{not json' },
      type: 'text',
      text: '{not json',
    },
    {
      name: 'a system-ish row with neither type nor stem is text',
      row: { id: 'm', text: 'joined the group' },
      type: 'text',
      text: 'joined the group',
    },
  ];

  it.each(cases)('$name', ({ row, type, text }) => {
    const mapped = mapApiMessage(row, 'g1');
    expect(mapped.type).toBe(type);
    expect(mapped.text).toBe(text);
  });

  it('reads question fields from question_data on a realtime postgres payload', () => {
    const mapped = mapApiMessage(
      {
        id: 'm',
        type: 'QUESTION',
        content: '',
        question_data: {
          questionStem: 'From JSONB',
          questionType: 'MULTIPLE_CHOICE',
          questionStatus: 'VERIFIED',
          options: ['a', 'b'],
          correctAnswerIds: ['a'],
          tags: ['bio'],
          explanation: 'because',
        },
      },
      'g1'
    );
    expect(mapped).toMatchObject({
      questionStem: 'From JSONB',
      questionType: 'MULTIPLE_CHOICE',
      questionStatus: 'VERIFIED',
      options: ['a', 'b'],
      correctAnswerIds: ['a'],
      tags: ['bio'],
      explanation: 'because',
    });
  });

  it('prefers the row\'s own camelCase/snake_case fields over question_data and the body', () => {
    const mapped = mapApiMessage(
      {
        id: 'm',
        type: 'QUESTION',
        question_type: 'SHORT_ANSWER',
        question_status: 'PENDING',
        content: '{"questionType":"FROM_BODY","questionStatus":"FROM_BODY"}',
        question_data: { questionType: 'FROM_JSONB', questionStatus: 'FROM_JSONB' },
      },
      'g1'
    );
    expect(mapped.questionType).toBe('SHORT_ANSWER');
    expect(mapped.questionStatus).toBe('PENDING');
  });

  it('normalises option shapes to both `options` and `optionItems`, and omits empties', () => {
    const mapped = mapApiMessage(
      { id: 'm', type: 'QUESTION', question_stem: 'q', options: ['plain', { id: 'o2', text: 'Two' }, { text: 'Three' }, { id: 'o4' }] },
      'g1'
    );
    expect(mapped.optionItems).toEqual([
      { id: 'plain', text: 'plain' },
      { id: 'o2', text: 'Two' },
      { id: 'Three', text: 'Three' },
    ]);
    expect(mapped.options).toEqual(['plain', 'Two', 'Three']);
    expect(mapApiMessage({ id: 'm', content: 'hi' }, 'g1').options).toBeUndefined();
    expect(mapApiMessage({ id: 'm', content: 'hi' }, 'g1').optionItems).toBeUndefined();
  });

  it('keeps correctAnswerIds only when it is an array', () => {
    expect(mapApiMessage({ id: 'm', correct_answer_ids: ['a'] }, 'g1').correctAnswerIds).toEqual(['a']);
    expect(mapApiMessage({ id: 'm', correct_answer_ids: 'a' }, 'g1').correctAnswerIds).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mapApiMessage — identity, removal, board fields, counters
// ---------------------------------------------------------------------------

describe('mapApiMessage: sender identity', () => {
  it('uses the embedded sender when the payload carries one', () => {
    const mapped = mapApiMessage(
      { id: 'm', sender_id: 'u1', sender: { username: 'ada', name: 'Ada L', avatar_url: 'a.png' } },
      'g1'
    );
    expect(mapped.senderId).toBe('u1');
    // A real display name outranks the @username; the username is the fallback.
    expect(mapped.senderName).toBe('Ada L');
    expect(mapped.senderAvatar).toBe('a.png');
  });

  it('falls back to the roster when the payload has no sender', () => {
    const mapped = mapApiMessage({ id: 'm', sender_id: 'u2' }, 'g1', [
      { id: 'mem2', userId: 'u2', name: 'Grace H', role: 'member', joinedAt: '' },
    ]);
    expect(mapped.senderName).toBe('Grace H');
  });

  it('matches a roster row by membership id as well as by auth user id', () => {
    const mapped = mapApiMessage({ id: 'm', sender_id: 'mem3' }, 'g1', [
      { id: 'mem3', userId: 'u3', name: 'Alan T', role: 'member', joinedAt: '' },
    ]);
    expect(mapped.senderName).toBe('Alan T');
  });

  it("falls back to the viewer's own profile for their own row on a board (no roster, no sender)", () => {
    mockAuthState = {
      user: { id: 'me', user_metadata: { username: 'mine', avatar_url: 'me.png' } },
      profileName: 'My Name',
    };
    const mapped = mapApiMessage({ id: 'm', sender_id: 'me' }, 'g1');
    expect(mapped.senderName).toBe('My Name');
    expect(mapped.senderAvatar).toBe('me.png');
  });
});

describe('mapApiMessage: removal, board fields and counters', () => {
  it('blanks the text of a removed row but keeps the reason', () => {
    const mapped = mapApiMessage(
      { id: 'm', content: 'gone', removed_at: '2026-01-02T00:00:00.000Z', removed_reason: 'spam' },
      'g1'
    );
    expect(mapped.text).toBe('');
    expect(mapped.isRemoved).toBe(true);
    expect(mapped.removedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(mapped.removedReason).toBe('spam');
  });

  it('treats an explicit isRemoved with no timestamp as removed', () => {
    expect(mapApiMessage({ id: 'm', content: 'x', isRemoved: true }, 'g1').isRemoved).toBe(true);
  });

  it('defaults the board fields to null rather than undefined', () => {
    const mapped = mapApiMessage({ id: 'm', content: 'x' }, 'g1');
    expect(mapped.subject).toBeNull();
    expect(mapped.postKind).toBeNull();
    expect(mapped.removedReason).toBeNull();
    expect(mapped.pinnedAt).toBeNull();
    expect(mapped.pinnedBy).toBeNull();
  });

  it('defaults vote counts to 0 but leaves peerUpvotes undefined when not reported', () => {
    const mapped = mapApiMessage({ id: 'm', content: 'x' }, 'g1');
    expect(mapped.upvotes).toBe(0);
    expect(mapped.downvotes).toBe(0);
    // Undefined, never 0: an API build that does not report it has not said
    // "zero peers upvoted this".
    expect(mapped.peerUpvotes).toBeUndefined();
    expect(mapApiMessage({ id: 'm', peer_upvotes: 0 }, 'g1').peerUpvotes).toBe(0);
    expect(mapApiMessage({ id: 'm', peerUpvotes: 3 }, 'g1').peerUpvotes).toBe(3);
  });

  it('keeps reactions as an object and never as null', () => {
    expect(mapApiMessage({ id: 'm', reactions: { '👍': 2 } }, 'g1').reactions).toEqual({ '👍': 2 });
    expect(mapApiMessage({ id: 'm', reactions: null }, 'g1').reactions).toEqual({});
  });

  it('falls back through timestamp / created_at / createdAt', () => {
    expect(mapApiMessage({ id: 'm', created_at: '2026-02-01T00:00:00.000Z' }, 'g1').createdAt).toBe(
      '2026-02-01T00:00:00.000Z'
    );
    expect(mapApiMessage({ id: 'm', createdAt: '2026-03-01T00:00:00.000Z' }, 'g1').createdAt).toBe(
      '2026-03-01T00:00:00.000Z'
    );
    expect(
      mapApiMessage({ id: 'm', timestamp: Date.parse('2026-04-01T00:00:00.000Z') }, 'g1').createdAt
    ).toBe('2026-04-01T00:00:00.000Z');
  });

  it('falls back to the caller\'s groupId when the row carries none', () => {
    expect(mapApiMessage({ id: 'm' }, 'fallback').groupId).toBe('fallback');
    expect(mapApiMessage({ id: 'm', group_id: 'row' }, 'fallback').groupId).toBe('row');
  });

  it('accepts both casings for reply, thread and receipt fields', () => {
    const mapped = mapApiMessage(
      {
        id: 'm',
        reply_to_message_id: 'p1',
        mentioned_user_ids: ['u9'],
        thread_root_id: 'r1',
        reply_count: 4,
        receipt_status: 'read',
        seen_by_count: 2,
        seen_by_total: 5,
      },
      'g1'
    );
    expect(mapped).toMatchObject({
      replyToMessageId: 'p1',
      mentionedUserIds: ['u9'],
      threadRootId: 'r1',
      replyCount: 4,
      receiptStatus: 'read',
      seenByCount: 2,
      seenByTotal: 5,
    });
  });
});

// ---------------------------------------------------------------------------
// mergeGroupMessageIntoList — the realtime UPDATE merge
// ---------------------------------------------------------------------------

describe('mergeGroupMessageIntoList', () => {
  it('returns null for a row this process never loaded', () => {
    expect(mergeGroupMessageIntoList([msg({ id: 'a' })], msg({ id: 'z' }))).toBeNull();
  });

  it('matches a still-optimistic row by clientMessageId', () => {
    const merged = mergeGroupMessageIntoList(
      [msg({ id: 'optimistic-1', text: 'draft' })],
      msg({ id: 'server-1', text: 'draft' }),
      'optimistic-1'
    );
    expect(merged).toHaveLength(1);
    expect(merged![0].id).toBe('server-1');
  });

  it('keeps a concrete author label when the incoming payload only has a fallback', () => {
    for (const generic of ['Member', '@member', undefined]) {
      const merged = mergeGroupMessageIntoList(
        [msg({ senderName: 'Ada L' })],
        msg({ senderName: generic as string })
      );
      expect(merged![0].senderName).toBe('Ada L');
    }
  });

  it('lets a real incoming author label win', () => {
    const merged = mergeGroupMessageIntoList([msg({ senderName: 'Member' })], msg({ senderName: 'Ada L' }));
    expect(merged![0].senderName).toBe('Ada L');
  });

  it('does not let a partial payload blank the question fields', () => {
    const prev = msg({
      options: ['a', 'b'],
      optionItems: [{ id: 'a', text: 'a' }],
      correctAnswerIds: ['a'],
      questionStem: 'Why?',
      questionType: 'MCQ',
      questionStatus: 'VERIFIED',
    });
    const merged = mergeGroupMessageIntoList([prev], msg({ text: 'edited' }));
    expect(merged![0]).toMatchObject({
      text: 'edited',
      options: ['a', 'b'],
      optionItems: [{ id: 'a', text: 'a' }],
      correctAnswerIds: ['a'],
      questionStem: 'Why?',
      questionType: 'MCQ',
      questionStatus: 'VERIFIED',
    });
  });

  it('lets a populated incoming payload replace the question fields', () => {
    const prev = msg({ options: ['a'], questionStem: 'Old' });
    const merged = mergeGroupMessageIntoList([prev], msg({ options: ['x'], questionStem: 'New' }));
    expect(merged![0].options).toEqual(['x']);
    expect(merged![0].questionStem).toBe('New');
  });

  it('refreshes reply previews that point at the merged message', () => {
    const merged = mergeGroupMessageIntoList(
      [msg({ id: 'm1', text: 'original' }), msg({ id: 'm2', replyTo: { id: 'm1', text: 'original' } })],
      msg({ id: 'm1', text: 'edited' })
    );
    expect(merged![1].replyTo).toMatchObject({ id: 'm1', text: 'edited', isRemoved: false });
  });

  it('strips the preview text when the merged message was removed', () => {
    const merged = mergeGroupMessageIntoList(
      [msg({ id: 'm1' }), msg({ id: 'm2', replyTo: { id: 'm1', text: 'original' } })],
      msg({ id: 'm1', text: '', isRemoved: true, questionStem: undefined })
    );
    expect(merged![1].replyTo).toMatchObject({ text: undefined, questionStem: undefined, isRemoved: true });
  });
});

// ---------------------------------------------------------------------------
// Optimistic-row reconciliation
// ---------------------------------------------------------------------------

describe('optimistic row reconciliation', () => {
  it('recognises the optimistic id prefix', () => {
    expect(isOptimisticMessageId('msg-123')).toBe(true);
    expect(isOptimisticMessageId('uuid-123')).toBe(false);
  });

  it('strips only an optimistic twin of the same sender, text and minute', () => {
    const server = msg({ id: 's1', senderId: 'u1', text: 'hi', createdAt: '2026-01-01T00:00:00.000Z' });
    const twin = msg({ id: 'msg-1', senderId: 'u1', text: 'hi', createdAt: '2026-01-01T00:00:10.000Z' });
    const otherSender = msg({ id: 'msg-2', senderId: 'u2', text: 'hi' });
    const otherText = msg({ id: 'msg-3', senderId: 'u1', text: 'bye' });
    const tooOld = msg({ id: 'msg-4', senderId: 'u1', text: 'hi', createdAt: '2026-01-01T01:00:00.000Z' });
    const real = msg({ id: 'r1', senderId: 'u1', text: 'hi' });
    const kept = stripOptimisticDuplicates([twin, otherSender, otherText, tooOld, real], server);
    expect(kept.map((m) => m.id)).toEqual(['msg-2', 'msg-3', 'msg-4', 'r1']);
  });

  it('replaces the optimistic row in place, preserving its position', () => {
    const list = [msg({ id: 'a' }), msg({ id: 'msg-1' }), msg({ id: 'b' })];
    const out = replaceOptimisticWithServer(list, 'msg-1', msg({ id: 's1' }));
    expect(out.map((m) => m.id)).toEqual(['a', 's1', 'b']);
  });

  it('appends when the optimistic row is gone and nothing matches', () => {
    const out = replaceOptimisticWithServer([msg({ id: 'a' })], 'msg-1', msg({ id: 's1' }));
    expect(out.map((m) => m.id)).toEqual(['a', 's1']);
  });

  it('never leaves two copies of the server row', () => {
    const list = [msg({ id: 's1' }), msg({ id: 'msg-1' })];
    const out = replaceOptimisticWithServer(list, 'msg-1', msg({ id: 's1', text: 'fresh' }));
    expect(out.filter((m) => m.id === 's1')).toHaveLength(1);
    expect(out[0].text).toBe('fresh');
  });
});

// ---------------------------------------------------------------------------
// Edit / remove patches
// ---------------------------------------------------------------------------

describe('applyGroupMessageMutation', () => {
  it('applies an edit to the target row and leaves the rest alone', () => {
    const out = applyGroupMessageMutation([msg({ id: 'm1' }), msg({ id: 'm2' })], {
      id: 'm1',
      text: 'edited',
      edited_at: '2026-01-05T00:00:00.000Z',
    });
    expect(out[0]).toMatchObject({ text: 'edited', editedAt: '2026-01-05T00:00:00.000Z' });
    expect(out[1].text).toBe('hello');
  });

  it('blanks the text and every reply preview of a removed row', () => {
    const out = applyGroupMessageMutation(
      [msg({ id: 'm1', text: 'bad' }), msg({ id: 'm2', replyTo: { id: 'm1', text: 'bad' } })],
      { id: 'm1', removed_at: '2026-01-05T00:00:00.000Z' }
    );
    expect(out[0].text).toBe('');
    expect(out[0].isRemoved).toBe(true);
    expect(out[1].replyTo).toMatchObject({ text: undefined, isRemoved: true });
  });

  it('keeps the existing text when the payload carries none', () => {
    const out = applyGroupMessageMutation([msg({ id: 'm1', text: 'keep' })], { id: 'm1' });
    expect(out[0].text).toBe('keep');
  });
});

describe('applyDirectMessageMutation', () => {
  const dm = (over: Partial<DirectMessage> = {}): DirectMessage =>
    ({ id: 'd1', threadId: 't1', senderId: 'u1', text: 'hi', timestamp: '2026-01-01T00:00:00.000Z', ...over }) as DirectMessage;

  it('merges the incoming row over the held one', () => {
    const out = applyDirectMessageMutation([dm({ id: 'd1' })], dm({ id: 'd1', text: 'edited' }));
    expect(out[0].text).toBe('edited');
  });

  it('keeps the held replyCount when the incoming row omits it', () => {
    const out = applyDirectMessageMutation([dm({ id: 'd1', replyCount: 3 })], dm({ id: 'd1' }));
    expect(out[0].replyCount).toBe(3);
  });

  it('refreshes reply previews pointing at the mutated message', () => {
    const out = applyDirectMessageMutation(
      [dm({ id: 'd1' }), dm({ id: 'd2', replyTo: { id: 'd1', text: 'hi' } })],
      dm({ id: 'd1', text: '', isRemoved: true })
    );
    expect(out[1].replyTo).toMatchObject({ text: undefined, isRemoved: true });
  });
});

// ---------------------------------------------------------------------------
// Group, member, thread and DM row mapping
// ---------------------------------------------------------------------------

describe('mapApiMember', () => {
  it('derives the role from adminIds: [0] owns, the rest administer', () => {
    expect(mapApiMember({ user_id: 'u1' }, ['u1', 'u2']).role).toBe('owner');
    expect(mapApiMember({ user_id: 'u2' }, ['u1', 'u2']).role).toBe('admin');
    expect(mapApiMember({ user_id: 'u3' }, ['u1', 'u2']).role).toBe('member');
  });
});

describe('mapApiGroup', () => {
  const row = {
    id: 'g1',
    name: 'Organic Chem',
    admin_ids: ['u1'],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
  };

  it('fills the mobile-only shape a group row omits', () => {
    const mapped = mapApiGroup(row, {});
    expect(mapped).toMatchObject({
      id: 'g1',
      name: 'Organic Chem',
      ownerId: 'u1',
      members: [],
      memberCount: 0,
      isArchived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(mapped.lastMessage).toBeUndefined();
  });

  it('reads the unread count out of the counts map', () => {
    expect(mapApiGroup(row, { g1: 7 }).unreadCount).toBe(7);
  });

  it('synthesises a preview message that is not a real row', () => {
    const mapped = mapApiGroup({ ...row, last_message: 'see you then' }, {});
    expect(mapped.lastMessage).toMatchObject({
      id: 'preview-g1',
      groupId: 'g1',
      text: 'see you then',
      type: 'text',
      senderId: '',
    });
  });

  it('stamps the preview with the row update time when the server gives no message time', () => {
    const mapped = mapApiGroup({ ...row, last_message: 'hi' }, {});
    expect(mapped.lastMessage?.createdAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('prefers the server last_message_time when there is one', () => {
    const mapped = mapApiGroup(
      { ...row, last_message: 'hi', last_message_time: '2026-01-03T00:00:00.000Z' },
      {}
    );
    expect(mapped.lastMessage?.createdAt).toBe('2026-01-03T00:00:00.000Z');
  });

  it('has an empty ownerId when the row carries no admins', () => {
    expect(mapApiGroup({ id: 'g2', name: 'x' }, {}).ownerId).toBe('');
  });
});

describe('mapDmThread', () => {
  it('normalises participants and both id casings', () => {
    const mapped = mapDmThread(
      {
        id: 't1',
        participant_ids: ['u1', 'u2'],
        participants: { u1: { name: 'Ada', avatar_url: 'a.png' }, u2: {} },
        last_message: 'hi',
        last_message_timestamp: '2026-01-01T00:00:00.000Z',
      },
      {}
    );
    expect(mapped.participantIds).toEqual(['u1', 'u2']);
    expect(mapped.participants).toEqual({
      u1: { name: 'Ada', avatarUrl: 'a.png' },
      u2: { name: 'User', avatarUrl: undefined },
    });
    expect(mapped.lastMessage).toBe('hi');
  });

  it('coerces an unrecognised status to open', () => {
    expect(mapDmThread({ id: 't1', status: 'weird' }, {}).status).toBe('open');
    expect(mapDmThread({ id: 't1', status: 'pending' }, {}).status).toBe('pending');
    expect(mapDmThread({ id: 't1', status: 'declined' }, {}).status).toBe('declined');
  });

  it('lets the counts map override the row unread count', () => {
    expect(mapDmThread({ id: 't1', unread_count: 2 }, { t1: 9 }).unreadCount).toBe(9);
    expect(mapDmThread({ id: 't1', unread_count: 2 }, {}).unreadCount).toBe(2);
    expect(mapDmThread({ id: 't1' }, {}).unreadCount).toBe(0);
  });
});

describe('mapDirectMessage', () => {
  it('reads the sender out of an embedded object or an embedded array', () => {
    expect(mapDirectMessage({ id: 'd', sender: { id: 'u1', name: 'Ada' } }, 't1').senderName).toBe('Ada');
    expect(mapDirectMessage({ id: 'd', profiles: [{ id: 'u1', username: 'ada' }] }, 't1').senderName).toBe('ada');
  });

  it('blanks the text of a removed DM', () => {
    const mapped = mapDirectMessage({ id: 'd', content: 'gone', removed_at: '2026-01-02T00:00:00.000Z' }, 't1');
    expect(mapped.text).toBe('');
    expect(mapped.isRemoved).toBe(true);
  });

  it('falls back to the caller\'s threadId and defaults reactions to an object', () => {
    const mapped = mapDirectMessage({ id: 'd' }, 't9');
    expect(mapped.threadId).toBe('t9');
    expect(mapped.reactions).toEqual({});
  });
});

describe('resolveDmHistoryClearedAt', () => {
  const thread = { id: 't1', historyClearedAt: '2026-01-01T00:00:00.000Z' } as any;

  it('prefers the local map over the thread row', () => {
    expect(resolveDmHistoryClearedAt('t1', [thread], { t1: '2026-02-01T00:00:00.000Z' })).toBe(
      '2026-02-01T00:00:00.000Z'
    );
  });

  it('falls back to the thread row, then to null', () => {
    expect(resolveDmHistoryClearedAt('t1', [thread], {})).toBe('2026-01-01T00:00:00.000Z');
    expect(resolveDmHistoryClearedAt('t2', [thread], {})).toBeNull();
    expect(resolveDmHistoryClearedAt('t1', [{ id: 't1' } as any], {})).toBeNull();
  });
});

describe('mapApiMessage: the @username fallback', () => {
  it('uses the @username when the payload carries no display name', () => {
    expect(mapApiMessage({ id: 'm', sender_id: 'u1', sender: { username: 'ada' } }, 'g1').senderName).toBe(
      '@ada'
    );
  });

  it("falls through to 'Member' when nothing names the sender", () => {
    expect(mapApiMessage({ id: 'm', sender_id: 'u9' }, 'g1').senderName).toBe('Member');
  });
});
