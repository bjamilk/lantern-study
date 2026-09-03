import { describe, expect, it } from 'vitest';
import { collectKnownLounges, isBoardGroup } from './communityBoards';
import { mergeBoardPosts, sortBoardPostsNewestFirst, toBoardPost } from './boardPosts';

const group = (over: Record<string, unknown> = {}) =>
  ({ id: 'g1', communityId: 'c1', communitySurface: null, ...over }) as any;

const known = (lounges: string[], communities: string[]) => ({
  loungeGroupIds: new Set(lounges),
  resolvedCommunityIds: new Set(communities),
});

describe('isBoardGroup', () => {
  const resolved = known([], ['c1']);

  it('is false for a group with no community', () => {
    expect(isBoardGroup(group({ communityId: null }), resolved)).toBe(false);
  });

  it('is true for a legacy community group (NULL surface means board)', () => {
    expect(isBoardGroup(group(), resolved)).toBe(true);
  });

  it('is false for a study group — it stays in Chat', () => {
    expect(isBoardGroup(group({ communitySurface: 'study_group' }), resolved)).toBe(false);
  });

  it("is false for a community's lounge — founder decision 1 keeps it a chat", () => {
    expect(isBoardGroup(group({ id: 'lounge-1' }), known(['lounge-1'], ['c1']))).toBe(false);
  });

  it('is false while the community is unresolved — never guess "board"', () => {
    // A cold page load knows no lounges; calling one a board drops the
    // community's only chat out of the chat list.
    expect(isBoardGroup(group({ id: 'lounge-1' }), known([], []))).toBe(false);
    expect(isBoardGroup(group(), known([], []))).toBe(false);
  });
});

describe('collectKnownLounges', () => {
  it('unions the detail cache, the channels cache and the active community', () => {
    const { loungeGroupIds } = collectKnownLounges(
      { alpha: { id: 'c1', lounge_group_id: 'l1' } as any },
      { c2: { communityId: 'c2', loungeGroupId: 'l2' } as any },
      'l3'
    );
    expect([...loungeGroupIds].sort()).toEqual(['l1', 'l2', 'l3']);
  });

  it('skips communities with no lounge minted yet, but still marks them resolved', () => {
    const { loungeGroupIds, resolvedCommunityIds } = collectKnownLounges(
      { alpha: { id: 'c1', lounge_group_id: null } as any },
      {},
      null
    );
    expect(loungeGroupIds.size).toBe(0);
    expect(resolvedCommunityIds.has('c1')).toBe(true);
  });

  it('reads the membership list, so a cold load knows the lounge without a community page', () => {
    const { loungeGroupIds, resolvedCommunityIds } = collectKnownLounges({}, {}, null, [
      { id: 'c1', lounge_group_id: 'l1' } as any,
    ]);
    expect(loungeGroupIds.has('l1')).toBe(true);
    expect(resolvedCommunityIds.has('c1')).toBe(true);
  });

  it('treats a membership row with no pointer at all as unresolved', () => {
    const { resolvedCommunityIds } = collectKnownLounges({}, {}, null, [{ id: 'c1' } as any]);
    expect(resolvedCommunityIds.has('c1')).toBe(false);
  });
});

describe('toBoardPost', () => {
  it('reads camelCase and snake_case, and treats absent pin columns as unpinned', () => {
    const post = toBoardPost(
      {
        id: 'm1',
        groupId: 'g1',
        sender: { id: 'u1', name: 'Ada', avatarUrl: 'a.png' },
        senderId: 'u1',
        text: 'Timetable is out',
        subject: 'Exam week',
        timestamp: '2026-09-02T10:00:00.000Z',
        replyCount: 3,
        reactions: { '👍': 2 },
        type: 'TEXT',
      },
      'g1'
    );
    expect(post).toMatchObject({
      id: 'm1',
      senderName: 'Ada',
      subject: 'Exam week',
      replyCount: 3,
      pinnedAt: null,
      isLegacyQuestion: false,
    });
  });

  it('marks a pre-board QUESTION row as legacy and keeps its stem', () => {
    const post = toBoardPost({ id: 'q1', type: 'QUESTION', question_stem: 'What is X?' }, 'g1');
    expect(post.isLegacyQuestion).toBe(true);
    expect(post.legacyQuestionStem).toBe('What is X?');
  });

  it('drops the body and title of a removed post', () => {
    const post = toBoardPost(
      { id: 'm2', text: 'gone', subject: 'gone', removed_at: '2026-09-02T11:00:00.000Z' },
      'g1'
    );
    expect(post.text).toBe('');
    expect(post.subject).toBeNull();
    expect(post.removedAt).toBe('2026-09-02T11:00:00.000Z');
  });
});

describe('mergeBoardPosts', () => {
  const at = (id: string, iso: string) => toBoardPost({ id, timestamp: iso }, 'g1');

  it('keeps one row per id and orders newest first', () => {
    const page1 = [at('a', '2026-09-02T10:00:00.000Z'), at('b', '2026-09-02T12:00:00.000Z')];
    const page2 = [at('b', '2026-09-02T12:00:00.000Z'), at('c', '2026-09-02T11:00:00.000Z')];
    expect(mergeBoardPosts(page1, page2).map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('returns the same list when there is nothing to merge', () => {
    const existing = [at('a', '2026-09-02T10:00:00.000Z')];
    expect(mergeBoardPosts(existing, [])).toBe(existing);
  });

  it('sorts newest first', () => {
    const sorted = sortBoardPostsNewestFirst([
      at('old', '2026-09-01T10:00:00.000Z'),
      at('new', '2026-09-02T10:00:00.000Z'),
    ]);
    expect(sorted.map((p) => p.id)).toEqual(['new', 'old']);
  });
});
