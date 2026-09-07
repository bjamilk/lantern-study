import type { Message } from '../stores/groupStore';
import {
  boardActionTargetId,
  isBoardComment,
  isBoardRepost,
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

  it('prefers messages.image_url over the markdown parsed out of the body', () => {
    // §5.2: `image_url` is the FIRST encoding, not a third one. A post made in
    // one action carries its photo there and its body stays markdown-free.
    const post = toBoardPost(
      message({
        id: 'p',
        imageUrl: 'https://cdn.example/new.webp',
        text: '![image](https://cdn.example/legacy.jpg) caption',
      })
    );
    expect(post.imageUrl).toBe('https://cdn.example/new.webp');
  });

  it('leaves a legacy markdown post with a null imageUrl, for the card to split', () => {
    const post = toBoardPost(
      message({ id: 'p', text: '![image](https://cdn.example/legacy.jpg)' })
    );
    expect(post.imageUrl).toBeNull();
    expect(splitBoardBody(post.text).imageUrl).toBe('https://cdn.example/legacy.jpg');
  });

  it('counts hearts as favorites and every other emoji as none', () => {
    expect(toBoardPost(message({ id: 'a', reactions: { '\u2764\ufe0f': 3 } })).favoriteCount).toBe(3);
    // §4.4: nothing is folded. A 👍 stays on the row and counts as zero
    // favorites, because you cannot un-favorite a reaction you never placed.
    expect(toBoardPost(message({ id: 'b', reactions: { '\ud83d\udc4d': 5 } })).favoriteCount).toBe(0);
  });

  it('takes favorited and bookmarked from the caller, not from the row', () => {
    // `favorited` never rides the row: it comes from the board's own
    // user-reactions map, which both boards already fetch on mount.
    const post = toBoardPost(message({ id: 'p' }), { favorited: true, bookmarked: true });
    expect(post.favorited).toBe(true);
    expect(post.bookmarked).toBe(true);
  });

  it('falls back to the row bookmark flag when the caller has no answer', () => {
    expect(toBoardPost(message({ id: 'p', bookmarked: true })).bookmarked).toBe(true);
    expect(toBoardPost(message({ id: 'p' })).bookmarked).toBe(false);
  });

  it('carries the repost hydration the board page attached', () => {
    const post = toBoardPost(
      message({
        id: 'r',
        repostCount: 2,
        repostedByMe: true,
        repostOf: {
          id: 'orig',
          senderName: 'Ada',
          timestamp: '2026-09-01T00:00:00.000Z',
          subject: 'Timetable',
          snippet: 'exam week',
          hasImage: true,
          hasAudio: false,
          removedAt: null,
        },
      })
    );
    expect(post.repostCount).toBe(2);
    expect(post.repostedByMe).toBe(true);
    expect(post.repostOf?.id).toBe('orig');
    // The embed is TEXT ONLY: a media chip, never a media URL (§6.5).
    expect(JSON.stringify(post.repostOf)).not.toContain('/storage/v1/object/');
  });
});

describe('isBoardRepost / boardActionTargetId', () => {
  const repostRow = (over: Record<string, unknown> = {}) =>
    message({
      id: 'r',
      replyToMessageId: 'orig',
      clientMessageId: 'repost:orig',
      ...over,
    });

  it('recognises a repost from its three columns, with no hydration', () => {
    // An optimistic or realtime row carries no `repostOf`, so the card has to
    // be able to answer this from the row itself.
    expect(isBoardRepost(repostRow())).toBe(true);
  });

  it('is not fooled by a comment', () => {
    // Every comment carries thread_root_id, because the only write path that
    // sets reply_to also sets COALESCE(parent.thread_root_id, parent.id).
    expect(
      isBoardRepost(message({ id: 'c', replyToMessageId: 'orig', threadRootId: 'orig' }))
    ).toBe(false);
  });

  it('is not fooled by an ORPHANED comment', () => {
    // Both FKs are ON DELETE SET NULL, so hard-deleting a root leaves a nested
    // comment with reply_to set and thread_root_id nulled. Without the
    // client_message_id clause that orphan would render as a repost.
    expect(isBoardRepost(message({ id: 'c', replyToMessageId: 'sibling' }))).toBe(false);
    expect(
      isBoardRepost(
        message({ id: 'c', replyToMessageId: 'sibling', clientMessageId: 'a-plain-uuid' })
      )
    ).toBe(false);
  });

  it('points every action on a repost card at the ORIGINAL', () => {
    // Favorite, Comment, Bookmark and Report act on the original so counts
    // never fragment and no comment attaches to a repost row (§6.5).
    expect(boardActionTargetId(repostRow())).toBe('orig');
  });

  it('points an ordinary post at itself', () => {
    expect(boardActionTargetId(message({ id: 'p' }))).toBe('p');
    expect(boardActionTargetId(message({ id: 'c', threadRootId: 'p', replyToMessageId: 'p' })))
      .toBe('c');
  });

  it('still finds the original when the client id is missing but the embed is not', () => {
    const row = message({
      id: 'r',
      replyToMessageId: 'orig',
      clientMessageId: 'repost:orig',
    });
    expect(boardActionTargetId({ ...row, clientMessageId: undefined, repostOf: {
      id: 'orig',
      senderName: 'Ada',
      timestamp: '2026-09-01T00:00:00.000Z',
      subject: null,
      snippet: '',
      hasImage: false,
      hasAudio: false,
      removedAt: null,
    } })).toBe('orig');
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

describe('selectBoardPosts — announcements', () => {
  const post = (over: Partial<Message> & { id: string; createdAt: string }): Message =>
    ({
      groupId: 'g1',
      senderId: 'u1',
      senderName: 'Ada',
      text: 'body',
      type: 'text',
      ...over,
    }) as Message;

  it('pins an announcement above newer discussions', () => {
    const posts = selectBoardPosts([
      post({ id: 'old-announcement', createdAt: '2026-09-01T09:00:00Z', postKind: 'announcement' }),
      post({ id: 'new-discussion', createdAt: '2026-09-08T09:00:00Z' }),
      post({ id: 'older-discussion', createdAt: '2026-09-07T09:00:00Z', postKind: 'discussion' }),
    ]);
    expect(posts.map((p) => p.id)).toEqual([
      'old-announcement',
      'new-discussion',
      'older-discussion',
    ]);
  });

  it('keeps announcements newest-first among themselves', () => {
    const posts = selectBoardPosts([
      post({ id: 'a1', createdAt: '2026-09-01T09:00:00Z', postKind: 'announcement' }),
      post({ id: 'a2', createdAt: '2026-09-05T09:00:00Z', postKind: 'announcement' }),
    ]);
    expect(posts.map((p) => p.id)).toEqual(['a2', 'a1']);
  });

  it('lets a removed announcement fall back into the ordinary run', () => {
    const posts = selectBoardPosts([
      post({
        id: 'removed',
        createdAt: '2026-09-01T09:00:00Z',
        postKind: 'announcement',
        removedAt: '2026-09-02T09:00:00Z',
      }),
      post({ id: 'live', createdAt: '2026-09-08T09:00:00Z' }),
    ]);
    expect(posts.map((p) => p.id)).toEqual(['live', 'removed']);
  });

  it('treats a legacy row with no kind as a discussion', () => {
    const posts = selectBoardPosts([
      post({ id: 'legacy', createdAt: '2026-09-08T09:00:00Z' }),
      post({ id: 'announcement', createdAt: '2026-09-01T09:00:00Z', postKind: 'announcement' }),
    ]);
    expect(posts[0]!.id).toBe('announcement');
  });

  it('floats at most BOARD_ANNOUNCEMENT_PIN_MAX announcements, the rest fall back in place', () => {
    // The server unpins the oldest announcement past the cap but leaves its
    // kind as `announcement`; web caps its list the same way. Five
    // announcements must not bury the conversation on the phone.
    const posts = selectBoardPosts([
      post({ id: 'a1', createdAt: '2026-09-01T09:00:00Z', postKind: 'announcement' }),
      post({ id: 'a2', createdAt: '2026-09-02T09:00:00Z', postKind: 'announcement' }),
      post({ id: 'a3', createdAt: '2026-09-03T09:00:00Z', postKind: 'announcement' }),
      post({ id: 'a4', createdAt: '2026-09-04T09:00:00Z', postKind: 'announcement' }),
      post({ id: 'a5', createdAt: '2026-09-05T09:00:00Z', postKind: 'announcement' }),
      post({ id: 'd-new', createdAt: '2026-09-08T09:00:00Z' }),
      post({ id: 'd-old', createdAt: '2026-08-30T09:00:00Z' }),
    ]);
    expect(posts.map((p) => p.id)).toEqual(['a5', 'a4', 'a3', 'd-new', 'a2', 'a1', 'd-old']);
  });
});
