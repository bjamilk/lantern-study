/**
 * A realtime `messages` UPDATE is the raw table row, not an API payload.
 *
 * It carries `reactions` — REPLICA IDENTITY FULL means a favorite count really
 * does update live — but it carries none of the hydration the API adds on top:
 * `repostOf` and `repostCount` come from a batched query per page, and
 * `bookmarked` / `repostedByMe` are attached per viewer AFTER the shared
 * 120-second page cache, precisely so one student never sees another's
 * bookmarks.
 *
 * Mapping such a row through `toBoardPost` therefore yields `bookmarked:
 * false`, `repostCount: 0`, `repostOf: null` and `replyCount: 0`. The board
 * used to spread that straight over the loaded post, so anyone reacting to a
 * post un-bookmarked it on your screen and blanked a repost's embed.
 */
import { describe, expect, it } from 'vitest';
import type { BoardPost } from '@lantern/shared/network';
import { mergeRealtimeBoardPost, toBoardPost } from './boardPosts';

const loaded = (over: Partial<BoardPost> = {}): BoardPost =>
  ({
    id: 'm1',
    groupId: 'g1',
    senderId: 'u1',
    senderName: 'Ada',
    senderAvatarUrl: null,
    subject: 'Timetable',
    text: 'exam week',
    timestamp: '2026-09-01T10:00:00.000Z',
    editedAt: null,
    removedAt: null,
    replyCount: 4,
    reactions: { '❤️': 2 },
    pinnedAt: null,
    pinnedBy: null,
    isLegacyQuestion: false,
    legacyQuestionStem: null,
    imageUrl: null,
    favoriteCount: 2,
    favorited: false,
    bookmarked: true,
    repostCount: 3,
    repostedByMe: true,
    repostOf: null,
    ...over,
  }) as BoardPost;

describe('mergeRealtimeBoardPost', () => {
  it('takes the new reaction counts from the row', () => {
    const row = toBoardPost(
      { id: 'm1', group_id: 'g1', sender_id: 'u1', text: 'exam week', reactions: { '❤️': 5 } },
      'g1'
    );
    const merged = mergeRealtimeBoardPost(loaded(), row);
    expect(merged.reactions).toEqual({ '❤️': 5 });
    expect(merged.favoriteCount).toBe(5);
  });

  it('keeps the viewer state and the board hydration the row cannot carry', () => {
    const row = toBoardPost(
      { id: 'm1', group_id: 'g1', sender_id: 'u1', text: 'exam week', reactions: { '❤️': 5 } },
      'g1'
    );
    expect(row.bookmarked).toBe(false);
    expect(row.repostCount).toBe(0);
    expect(row.replyCount).toBe(0);

    const merged = mergeRealtimeBoardPost(loaded(), row);
    expect(merged.bookmarked).toBe(true);
    expect(merged.repostedByMe).toBe(true);
    expect(merged.repostCount).toBe(3);
    expect(merged.replyCount).toBe(4);
  });

  it('keeps a repost embed alive when someone reacts to the repost', () => {
    const previous = loaded({
      repostOf: {
        id: 'm0',
        senderName: 'Bola',
        timestamp: '2026-08-10T09:00:00.000Z',
        subject: null,
        snippet: 'past questions drive',
        hasImage: true,
        hasAudio: false,
        removedAt: null,
      },
    });
    const row = toBoardPost({ id: 'm1', group_id: 'g1', reactions: { '❤️': 1 } }, 'g1');
    expect(mergeRealtimeBoardPost(previous, row).repostOf?.snippet).toBe('past questions drive');
  });

  it('still lets a takedown through — that is content, not hydration', () => {
    const row = toBoardPost(
      { id: 'm1', group_id: 'g1', removed_at: '2026-09-02T10:00:00.000Z' },
      'g1'
    );
    const merged = mergeRealtimeBoardPost(loaded(), row);
    expect(merged.removedAt).toBe('2026-09-02T10:00:00.000Z');
    expect(merged.text).toBe('');
    expect(merged.subject).toBeNull();
  });

  it('does not mutate the post it was given', () => {
    const previous = loaded();
    mergeRealtimeBoardPost(previous, toBoardPost({ id: 'm1', reactions: { '❤️': 9 } }, 'g1'));
    expect(previous.reactions).toEqual({ '❤️': 2 });
    expect(previous.bookmarked).toBe(true);
  });
});

describe('toBoardPost and the post photo', () => {
  it('prefers messages.image_url over the legacy markdown in the body', () => {
    const post = toBoardPost(
      {
        id: 'm1',
        group_id: 'g1',
        image_url: 'https://cdn.example/note-files/u1/chat/g1/new.webp',
        text: 'see this ![image](https://cdn.example/note-files/u1/chat/g1/old.webp)',
      },
      'g1'
    );
    expect(post.imageUrl).toBe('https://cdn.example/note-files/u1/chat/g1/new.webp');
  });

  it('leaves a legacy markdown-only post with no image_url, so the card still parses the body', () => {
    const post = toBoardPost(
      { id: 'm1', group_id: 'g1', text: '![image](https://cdn.example/a.webp)' },
      'g1'
    );
    expect(post.imageUrl).toBeNull();
    expect(post.text).toContain('![image](');
  });

  it('drops the photo of a removed post along with its body', () => {
    const post = toBoardPost(
      { id: 'm1', group_id: 'g1', image_url: 'https://cdn.example/a.webp', removed_at: 'x' },
      'g1'
    );
    expect(post.imageUrl).toBeNull();
  });

  it('reads the board hydration the API sends on a roots-only page', () => {
    const post = toBoardPost(
      {
        id: 'm1',
        group_id: 'g1',
        bookmarked: true,
        repostedByMe: true,
        repostCount: 2,
        repostOf: { id: 'm0', senderName: 'Bola', snippet: 'x' },
      },
      'g1'
    );
    expect(post.bookmarked).toBe(true);
    expect(post.repostedByMe).toBe(true);
    expect(post.repostCount).toBe(2);
    expect(post.repostOf?.id).toBe('m0');
  });
});
