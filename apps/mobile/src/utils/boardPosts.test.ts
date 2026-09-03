import type { Message } from '../stores/groupStore';
import {
  isBoardComment,
  isLegacyQuestionPost,
  mergeComments,
  selectBoardPosts,
  selectPostComments,
  splitBoardBody,
  toBoardPost,
} from './boardPosts';

const message = (over: Partial<Message> & { id: string }): Message => ({
  groupId: 'g1',
  senderId: 'u1',
  senderName: 'Ada',
  text: 'body',
  type: 'text',
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('selectBoardPosts', () => {
  it('keeps roots only, newest first', () => {
    const posts = selectBoardPosts([
      message({ id: 'a', createdAt: '2026-09-01T10:00:00.000Z' }),
      message({ id: 'reply', createdAt: '2026-09-01T11:00:00.000Z', threadRootId: 'a' }),
      message({ id: 'b', createdAt: '2026-09-01T12:00:00.000Z' }),
    ]);
    expect(posts.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('returns an empty list for an unloaded board rather than throwing', () => {
    expect(selectBoardPosts(undefined)).toEqual([]);
  });

  it('keeps a removed post so the tombstone still renders', () => {
    const posts = selectBoardPosts([
      message({ id: 'gone', removedAt: '2026-09-01T10:00:00.000Z', isRemoved: true }),
    ]);
    expect(posts.map((p) => p.id)).toEqual(['gone']);
  });

  it('does not mutate the array it was given', () => {
    const input = [
      message({ id: 'a', createdAt: '2026-09-01T10:00:00.000Z' }),
      message({ id: 'b', createdAt: '2026-09-01T12:00:00.000Z' }),
    ];
    selectBoardPosts(input);
    expect(input.map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('selectPostComments', () => {
  it('returns one root’s replies oldest first', () => {
    const comments = selectPostComments(
      [
        message({ id: 'root' }),
        message({ id: 'c2', createdAt: '2026-09-01T12:00:00.000Z', threadRootId: 'root' }),
        message({ id: 'c1', createdAt: '2026-09-01T11:00:00.000Z', threadRootId: 'root' }),
        message({ id: 'other', threadRootId: 'elsewhere' }),
      ],
      'root'
    );
    expect(comments.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('is empty without a root id', () => {
    expect(selectPostComments([message({ id: 'c', threadRootId: 'root' })], '')).toEqual([]);
  });
});

describe('mergeComments', () => {
  it('prefers the fetched row over the cached one and stays oldest first', () => {
    const merged = mergeComments(
      [message({ id: 'c1', text: 'server', createdAt: '2026-09-01T11:00:00.000Z' })],
      [
        message({ id: 'c1', text: 'optimistic', createdAt: '2026-09-01T11:00:00.000Z' }),
        message({ id: 'c2', text: 'just sent', createdAt: '2026-09-01T12:00:00.000Z' }),
      ]
    );
    expect(merged.map((c) => [c.id, c.text])).toEqual([
      ['c1', 'server'],
      ['c2', 'just sent'],
    ]);
  });
});

describe('isBoardComment / isLegacyQuestionPost', () => {
  it('splits roots from comments', () => {
    expect(isBoardComment(message({ id: 'a' }))).toBe(false);
    expect(isBoardComment(message({ id: 'b', threadRootId: 'a' }))).toBe(true);
  });

  it('treats a QUESTION row as legacy, and nothing else', () => {
    expect(isLegacyQuestionPost(message({ id: 'a', type: 'question' }))).toBe(true);
    expect(isLegacyQuestionPost(message({ id: 'c' }))).toBe(false);
  });

  it('does not demote a text post to a read-only card just because it has a stem', () => {
    // A board post whose body looks like a question is stored TEXT (§3.4);
    // web renders it as an ordinary post and mobile must match.
    expect(
      isLegacyQuestionPost(message({ id: 'b', type: 'text', questionStem: 'What is 2+2?' }))
    ).toBe(false);
  });
});

describe('toBoardPost', () => {
  it('maps a plain post, defaulting the counts the card reads', () => {
    const post = toBoardPost(message({ id: 'p', subject: 'Timetable', replyCount: 2 }));
    expect(post).toMatchObject({
      id: 'p',
      subject: 'Timetable',
      replyCount: 2,
      reactions: {},
      isLegacyQuestion: false,
      legacyQuestionStem: null,
      pinnedAt: null,
    });
  });

  it('carries the stem for a legacy question row', () => {
    const post = toBoardPost(
      message({ id: 'q', type: 'question', questionStem: 'Define osmosis', text: '' })
    );
    expect(post.isLegacyQuestion).toBe(true);
    expect(post.legacyQuestionStem).toBe('Define osmosis');
  });

  it('falls back to a name rather than rendering an empty byline', () => {
    expect(toBoardPost(message({ id: 'p', senderName: '' })).senderName).toBe('Someone');
  });
});

describe('splitBoardBody', () => {
  it('pulls the photo url out and leaves the caption behind', () => {
    const split = splitBoardBody('![image](https://cdn.example/a.jpg) exam timetable');
    expect(split.imageUrl).toBe('https://cdn.example/a.jpg');
    expect(split.audioUrl).toBeNull();
    expect(split.body).toBe('exam timetable');
  });

  it('pulls a voice note url out', () => {
    const split = splitBoardBody('[audio](https://cdn.example/a.m4a)');
    expect(split.audioUrl).toBe('https://cdn.example/a.m4a');
    expect(split.body).toBe('');
  });

  it('leaves a plain post untouched', () => {
    expect(splitBoardBody('just words')).toEqual({
      imageUrl: null,
      audioUrl: null,
      body: 'just words',
    });
  });

  it('handles an absent body', () => {
    expect(splitBoardBody(undefined).body).toBe('');
  });
});
