import {
  BOARD_PAGE_SIZE,
  BOARD_PAGE_SIZE_LOW_DATA,
  BOARD_POST_SUBJECT_MAX,
  BOARD_STUDY_GROUP_NAME_MAX,
  COMMUNITY_BOARD_COPY,
  boardDeepLinkPath,
  boardDisplayName,
  boardPageSize,
  boardPostAccessibilityLabel,
  boardRelativeTime,
  boardSubtitle,
  canPinOnBoard,
  isCommunityBoard,
  isCommunityBoardGroup,
  isCampusLoungeGroupIn,
  isCommunityBoardGroupIn,
  isHiddenFromChatInbox,
  pinnedPostAccessibilityLabel,
  reactionAccessibilityLabel,
  studyGroupAnnouncement,
  studyGroupNameFromPost,
  studyGroupSubtitle,
  validateBoardSubject,
  BOARD_ACTION_ROW_ORDER,
  BOARD_FAVORITE_EMOJI,
  BOARD_QUOTE_SNIPPET_MAX,
  BOARD_REPOST_CLIENT_ID_PREFIX,
  BOARD_REPOST_SELF_COOLDOWN_MS,
  BOARD_SHARE_ORIGIN,
  boardBookmarkAccessibilityLabel,
  boardCommentAccessibilityLabel,
  boardFavoriteAccessibilityLabel,
  boardFavoriteCount,
  boardPostDeepLinkPath,
  boardPostShareUrl,
  boardQuoteSnippet,
  boardRepostAccessibilityLabel,
  boardRepostClientId,
  boardRepostOriginalId,
  boardRepostControlState,
  boardRepostRefusalCopy,
  boardShareAccessibilityLabel,
  boardSharePayload,
  canRepostBoardPost,
  isBoardFavorited,
  isBoardRepostRow,
} from './communityBoard';
import type { BoardPost } from './communityBoard';
import { COMMUNITY_COPY } from './communityServer';
import { CHAT_REACTION_EMOJI } from '../chat/reactions';
import type { CommunityChannel, CommunityStudyGroup } from './communityServer';
import type { Group } from '../types';

const NOW = Date.parse('2026-09-02T12:00:00.000Z');

const board = (
  over: Partial<CommunityChannel> & { id: string; name: string }
): CommunityChannel => ({
  description: null,
  avatarUrl: null,
  memberCount: 1,
  questionCount: 0,
  visibility: 'community',
  courseId: null,
  isLounge: false,
  isMember: false,
  unreadCount: 0,
  lastMessage: null,
  lastMessageTime: null,
  ...over,
});

const studyGroup = (
  over: Partial<CommunityStudyGroup> & { id: string; name: string }
): CommunityStudyGroup => ({
  description: null,
  avatarUrl: null,
  memberCount: 1,
  questionCount: 0,
  isMember: false,
  visibility: 'community',
  lastMessageTime: null,
  ...over,
});

const post = (over: Partial<BoardPost> = {}): BoardPost => ({
  id: 'p1',
  groupId: 'g1',
  senderId: 'u1',
  senderName: 'Ada',
  senderAvatarUrl: null,
  subject: null,
  text: 'Body text',
  timestamp: '2026-09-02T10:00:00.000Z',
  editedAt: null,
  removedAt: null,
  replyCount: 0,
  reactions: {},
  pinnedAt: null,
  pinnedBy: null,
  isLegacyQuestion: false,
  legacyQuestionStem: null,
  imageUrl: null,
  favoriteCount: 0,
  favorited: false,
  bookmarked: false,
  repostCount: 0,
  repostedByMe: false,
  repostOf: null,
  ...over,
});

describe('isCommunityBoard', () => {
  it('a group with no community is never a board', () => {
    expect(isCommunityBoard({ communityId: null } as Pick<Group, 'communityId' | 'communitySurface'>))
      .toBe(false);
    expect(isCommunityBoard({ communityId: undefined })).toBe(false);
  });

  it('any group with a community id is a board unless it opts out', () => {
    expect(isCommunityBoard({ communityId: 'x' })).toBe(true);
    expect(isCommunityBoard({ communityId: 'x', communitySurface: null })).toBe(true);
    expect(isCommunityBoard({ communityId: 'x', communitySurface: 'board' })).toBe(true);
    expect(isCommunityBoard({ communityId: 'x', communitySurface: 'study_group' })).toBe(false);
  });
});

describe('isCommunityBoardGroup', () => {
  it('the lounge is a live chat, never a board (founder decision 1)', () => {
    expect(isCommunityBoardGroup({ id: 'lounge', communityId: 'x' }, 'lounge')).toBe(false);
    expect(isCommunityBoardGroup({ id: 'other', communityId: 'x' }, 'lounge')).toBe(true);
  });

  it('falls back to the bare rule when the lounge id is unknown', () => {
    expect(isCommunityBoardGroup({ id: 'lounge', communityId: 'x' }, null)).toBe(true);
    expect(
      isCommunityBoardGroup({ id: 'sg', communityId: 'x', communitySurface: 'study_group' }, null)
    ).toBe(false);
  });
});

describe('isCommunityBoardGroupIn', () => {
  const known = (lounges: string[], communities: string[]) => ({
    loungeGroupIds: new Set(lounges),
    resolvedCommunityIds: new Set(communities),
  });

  it('the lounge is a live chat, never a board', () => {
    expect(isCommunityBoardGroupIn({ id: 'lounge', communityId: 'x' }, known(['lounge'], ['x'])))
      .toBe(false);
    expect(isCommunityBoardGroupIn({ id: 'other', communityId: 'x' }, known(['lounge'], ['x'])))
      .toBe(true);
  });

  it('refuses to guess "board" for a community it has not resolved', () => {
    // A cold start knows no lounges. Calling the lounge a board there drops the
    // community's one chat out of Chat and opens it as a post board.
    expect(isCommunityBoardGroupIn({ id: 'lounge', communityId: 'x' }, known([], []))).toBe(false);
    expect(isCommunityBoardGroupIn({ id: 'board', communityId: 'x' }, known([], []))).toBe(false);
  });

  it('still answers false for a study group and for a non-community group', () => {
    expect(
      isCommunityBoardGroupIn(
        { id: 'sg', communityId: 'x', communitySurface: 'study_group' },
        known([], ['x'])
      )
    ).toBe(false);
    expect(isCommunityBoardGroupIn({ id: 'g', communityId: null }, known([], ['x']))).toBe(false);
  });
});

describe('isHiddenFromChatInbox', () => {
  const known = (lounges: string[], communities: string[]) => ({
    loungeGroupIds: new Set(lounges),
    resolvedCommunityIds: new Set(communities),
  });

  it('hides boards and known lounges, keeps study groups', () => {
    const resolved = known(['lounge'], ['x']);
    expect(isCampusLoungeGroupIn({ id: 'lounge' }, resolved)).toBe(true);
    expect(isHiddenFromChatInbox({ id: 'lounge', communityId: 'x' }, resolved)).toBe(true);
    expect(isHiddenFromChatInbox({ id: 'board', communityId: 'x' }, resolved)).toBe(true);
    expect(
      isHiddenFromChatInbox(
        { id: 'sg', communityId: 'x', communitySurface: 'study_group' },
        resolved,
      ),
    ).toBe(false);
  });

  it('does not hide a lounge it has not resolved — fail toward chat', () => {
    expect(isHiddenFromChatInbox({ id: 'lounge', communityId: 'x' }, known([], []))).toBe(false);
  });
});

describe('boardDisplayName', () => {
  it('renders the lounge as General, with no hash', () => {
    expect(boardDisplayName({ isLounge: true, name: 'Biology lounge' })).toBe('General');
    expect(boardDisplayName({ isLounge: true, name: 'lounge' })).not.toContain('#');
  });

  it('renders a board with the hash the lounge does not get', () => {
    expect(boardDisplayName({ isLounge: false, name: 'exam-week' })).toBe('# exam-week');
  });
});

describe('boardRelativeTime', () => {
  it('buckets into now / m / h / d / w', () => {
    expect(boardRelativeTime('2026-09-02T11:59:30.000Z', NOW)).toBe('now');
    expect(boardRelativeTime('2026-09-02T11:56:00.000Z', NOW)).toBe('4m');
    expect(boardRelativeTime('2026-09-02T10:00:00.000Z', NOW)).toBe('2h');
    expect(boardRelativeTime('2026-08-30T12:00:00.000Z', NOW)).toBe('3d');
    expect(boardRelativeTime('2026-07-29T12:00:00.000Z', NOW)).toBe('5w');
  });

  it('returns null rather than a fake time for missing or unparseable input', () => {
    expect(boardRelativeTime(null, NOW)).toBeNull();
    expect(boardRelativeTime(undefined, NOW)).toBeNull();
    expect(boardRelativeTime('not-a-date', NOW)).toBeNull();
  });
});

describe('boardSubtitle', () => {
  it('the lounge keeps its own chat copy', () => {
    expect(boardSubtitle(board({ id: 'l', name: 'l', isLounge: true, isMember: true }), NOW)).toBe(
      COMMUNITY_COPY.loungeSubtitle
    );
  });

  it('joined: unread count and time since the last post', () => {
    expect(
      boardSubtitle(
        board({
          id: 'a',
          name: 'a',
          isMember: true,
          unreadCount: 3,
          lastMessageTime: '2026-09-02T10:00:00.000Z',
        }),
        NOW
      )
    ).toBe('3 new · last post 2h');
  });

  it('joined with nothing unread shows only the last post', () => {
    expect(
      boardSubtitle(
        board({ id: 'a', name: 'a', isMember: true, lastMessageTime: '2026-09-02T10:00:00.000Z' }),
        NOW
      )
    ).toBe('last post 2h');
  });

  it('joined but empty falls back to the member count', () => {
    expect(boardSubtitle(board({ id: 'a', name: 'a', isMember: true, memberCount: 4 }), NOW)).toBe(
      '4 members'
    );
  });

  it('unjoined gets the count and the join hint, never a preview', () => {
    expect(
      boardSubtitle(
        board({ id: 'a', name: 'a', isMember: false, lastMessage: 'leak', memberCount: 1 }),
        NOW
      )
    ).toBe('1 member · Tap to join');
  });
});

describe('studyGroupSubtitle', () => {
  it('"12 members · 40 questions · Opens in Chat"', () => {
    expect(studyGroupSubtitle(studyGroup({ id: 'g', name: 'g', memberCount: 12, questionCount: 40 })))
      .toBe('12 members · 40 questions · Opens in Chat');
  });

  it('singularises and never shows a negative count', () => {
    expect(
      studyGroupSubtitle(studyGroup({ id: 'g', name: 'g', memberCount: 1, questionCount: 1 }))
    ).toBe('1 member · 1 question · Opens in Chat');
    expect(
      studyGroupSubtitle(studyGroup({ id: 'g', name: 'g', memberCount: 3, questionCount: -5 }))
    ).toBe('3 members · 0 questions · Opens in Chat');
  });
});

describe('canPinOnBoard', () => {
  it('the community owner, admins and moderators may pin', () => {
    expect(canPinOnBoard({ role: 'owner', adminIds: [], userId: 'u1' })).toBe(true);
    expect(canPinOnBoard({ role: 'admin', adminIds: [], userId: 'u1' })).toBe(true);
    expect(canPinOnBoard({ role: 'moderator', adminIds: [], userId: 'u1' })).toBe(true);
  });

  it("an admin of the board group itself may pin", () => {
    expect(canPinOnBoard({ role: 'member', adminIds: ['u1'], userId: 'u1' })).toBe(true);
    expect(canPinOnBoard({ role: null, adminIds: ['u1'], userId: 'u1' })).toBe(true);
  });

  it('a plain member may not, and an anonymous caller never may', () => {
    expect(canPinOnBoard({ role: 'member', adminIds: ['someone-else'], userId: 'u1' })).toBe(false);
    expect(canPinOnBoard({ role: null, adminIds: [], userId: 'u1' })).toBe(false);
    expect(canPinOnBoard({ role: 'owner', adminIds: [], userId: '' })).toBe(false);
  });

  it('survives a missing admin list', () => {
    expect(
      canPinOnBoard({ role: 'member', adminIds: undefined as unknown as string[], userId: 'u1' })
    ).toBe(false);
  });
});

describe('boardPageSize', () => {
  it('10 in low-data mode, 20 otherwise (§8 parity rule 5)', () => {
    expect(boardPageSize(true)).toBe(BOARD_PAGE_SIZE_LOW_DATA);
    expect(boardPageSize(false)).toBe(BOARD_PAGE_SIZE);
    expect(BOARD_PAGE_SIZE_LOW_DATA).toBe(10);
    expect(BOARD_PAGE_SIZE).toBe(20);
  });
});

describe('validateBoardSubject', () => {
  it('a blank title is not an error — it is simply absent', () => {
    expect(validateBoardSubject('')).toEqual({ subject: null, error: null });
    expect(validateBoardSubject('   ')).toEqual({ subject: null, error: null });
    expect(validateBoardSubject(null)).toEqual({ subject: null, error: null });
    expect(validateBoardSubject(undefined)).toEqual({ subject: null, error: null });
  });

  it('trims and accepts a title up to the maximum', () => {
    expect(validateBoardSubject('  Exam week  ')).toEqual({ subject: 'Exam week', error: null });
    const max = 'a'.repeat(BOARD_POST_SUBJECT_MAX);
    expect(validateBoardSubject(max)).toEqual({ subject: max, error: null });
  });

  it('rejects one character over, with the same copy the server uses', () => {
    const result = validateBoardSubject('a'.repeat(BOARD_POST_SUBJECT_MAX + 1));
    expect(result).toEqual({ subject: null, error: COMMUNITY_BOARD_COPY.subjectTooLong });
    expect(COMMUNITY_BOARD_COPY.subjectTooLong).toBe('Title must be 120 characters or fewer');
  });
});

describe('boardPostAccessibilityLabel', () => {
  it('"<author>, <time>, <subject>, <n> comments"', () => {
    expect(
      boardPostAccessibilityLabel(
        post({ subject: 'Timetable', replyCount: 2, timestamp: '2026-09-02T10:00:00.000Z' }),
        NOW
      )
    ).toBe('Ada, 2h, Timetable, 2 comments');
  });

  it('falls back to the first 60 characters of the body', () => {
    const body = 'x'.repeat(80);
    const label = boardPostAccessibilityLabel(post({ text: body, replyCount: 1 }), NOW);
    expect(label).toBe(`Ada, 2h, ${'x'.repeat(60)}, 1 comment`);
  });

  it('a removed post announces the tombstone, not its old body', () => {
    const label = boardPostAccessibilityLabel(
      post({ text: 'secret', removedAt: '2026-09-02T11:00:00.000Z' }),
      NOW
    );
    expect(label).toContain(COMMUNITY_BOARD_COPY.postRemoved);
    expect(label).not.toContain('secret');
  });

  it('drops an unparseable timestamp instead of announcing a blank', () => {
    expect(boardPostAccessibilityLabel(post({ timestamp: 'nope', subject: 'T' }), NOW)).toBe(
      'Ada, T, 0 comments'
    );
  });
});

describe('pinnedPostAccessibilityLabel / reactionAccessibilityLabel', () => {
  it('the pinned strip names the author and the snippet', () => {
    expect(pinnedPostAccessibilityLabel(post({ subject: 'Read this' }))).toBe(
      'Pinned post: Ada, Read this'
    );
  });

  it('reaction chips announce their pressed state', () => {
    expect(reactionAccessibilityLabel('👍', 3, true)).toBe('👍 reaction, 3, selected');
    expect(reactionAccessibilityLabel('👍', 0, false)).toBe('👍 reaction, 0, not selected');
  });
});

describe('boardDeepLinkPath', () => {
  it('board notifications open the community board, never /chat', () => {
    expect(boardDeepLinkPath('unilag-medicine', 'g1')).toBe(
      '/discover/c/unilag-medicine/ch/g1'
    );
  });

  it('an unresolvable slug falls back to /discover, not to the Chat tab', () => {
    expect(boardDeepLinkPath(null, 'g1')).toBe('/discover');
    expect(boardDeepLinkPath('', 'g1')).toBe('/discover');
  });

  it('escapes both segments', () => {
    expect(boardDeepLinkPath('a/b', 'c d')).toBe('/discover/c/a%2Fb/ch/c%20d');
  });
});

describe('studyGroupNameFromPost', () => {
  it('prefers the title', () => {
    expect(studyGroupNameFromPost(post({ subject: '  Anatomy revision  ', text: 'ignored' }))).toBe(
      'Anatomy revision'
    );
  });

  it('otherwise takes the first ~40 characters of the body, at a word boundary', () => {
    const name = studyGroupNameFromPost(
      post({
        subject: null,
        text: 'Anyone want to revise the cardiovascular system together before Friday?',
      })
    );
    expect(name.length).toBeLessThanOrEqual(BOARD_STUDY_GROUP_NAME_MAX);
    expect(name).toBe('Anyone want to revise the cardiovascular');
  });

  it('collapses whitespace and returns empty for an empty post', () => {
    expect(studyGroupNameFromPost(post({ subject: null, text: 'a\n\n  b' }))).toBe('a b');
    expect(studyGroupNameFromPost(post({ subject: null, text: '   ' }))).toBe('');
  });
});

describe('studyGroupAnnouncement', () => {
  it('the plain TEXT pointer a board keeps to the group a post spawned', () => {
    expect(studyGroupAnnouncement('Ada', 'Cardio crew')).toBe(
      'Ada started a study group: Cardio crew'
    );
    expect(studyGroupAnnouncement('', 'Cardio crew')).toBe(
      'Someone started a study group: Cardio crew'
    );
  });
});

describe('COMMUNITY_BOARD_COPY', () => {
  it('pluralises comments and new-post pills', () => {
    expect(COMMUNITY_BOARD_COPY.comments(1)).toBe('1 comment');
    expect(COMMUNITY_BOARD_COPY.comments(0)).toBe('0 comments');
    expect(COMMUNITY_BOARD_COPY.newPosts(1)).toBe('1 new post');
    expect(COMMUNITY_BOARD_COPY.newPosts(4)).toBe('4 new posts');
  });

  it('carries the degrade copy the pre-migration API answers with', () => {
    expect(COMMUNITY_BOARD_COPY.pinUnavailable).toBe('Pinning is not available yet');
    expect(COMMUNITY_BOARD_COPY.studyGroupsUnavailable).toBe(
      'Study groups are not available yet'
    );
  });

  it('the list never promises to have downloaded an image', () => {
    expect(COMMUNITY_BOARD_COPY.photoTapToLoad).toBe('Photo · tap to load');
  });
});


// ---------------------------------------------------------------------------
// Phase 1 board actions: favorite, repost, bookmark, share (§10.1).
// ---------------------------------------------------------------------------

describe('favorite', () => {
  it('is an emoji already inside the shipped reaction set, so no validator changes', () => {
    expect(BOARD_FAVORITE_EMOJI).toBe('❤️');
    expect(CHAT_REACTION_EMOJI as readonly string[]).toContain(BOARD_FAVORITE_EMOJI);
  });

  it('counts only hearts', () => {
    expect(boardFavoriteCount({})).toBe(0);
    expect(boardFavoriteCount({ [BOARD_FAVORITE_EMOJI]: 3 })).toBe(3);
    expect(boardFavoriteCount({ '👍': 5 })).toBe(0);
    expect(boardFavoriteCount(undefined)).toBe(0);
    expect(boardFavoriteCount({ [BOARD_FAVORITE_EMOJI]: -2 })).toBe(0);
  });

  it('reads the viewer state off the existing user-reactions row', () => {
    expect(isBoardFavorited([BOARD_FAVORITE_EMOJI, '🔥'])).toBe(true);
    expect(isBoardFavorited(['🔥'])).toBe(false);
    expect(isBoardFavorited(undefined)).toBe(false);
  });
});

describe('repost client ids', () => {
  it('round-trips', () => {
    const id = '66666666-6666-4666-8666-666666666666';
    expect(boardRepostClientId(id)).toBe(`${BOARD_REPOST_CLIENT_ID_PREFIX}${id}`);
    expect(boardRepostOriginalId(boardRepostClientId(id))).toBe(id);
  });

  it('refuses anything that is not a repost key', () => {
    expect(boardRepostOriginalId(null)).toBeNull();
    expect(boardRepostOriginalId(undefined)).toBeNull();
    expect(boardRepostOriginalId('66666666-6666-4666-8666-666666666666')).toBeNull();
    expect(boardRepostOriginalId('repost:')).toBeNull();
  });
});

describe('isBoardRepostRow', () => {
  it('is true for a repost row', () => {
    expect(
      isBoardRepostRow({ replyToMessageId: 'a', threadRootId: null, clientMessageId: 'repost:a' })
    ).toBe(true);
  });

  it('is false for a comment, which always carries thread_root_id', () => {
    expect(
      isBoardRepostRow({ replyToMessageId: 'a', threadRootId: 'a', clientMessageId: 'repost:a' })
    ).toBe(false);
  });

  it('is false for a comment orphaned by ON DELETE SET NULL', () => {
    // Deleting a thread root nulls thread_root_id on a nested comment while
    // reply_to_message_id still points at its sibling. Without the client-id
    // clause that orphan would render as a repost.
    expect(
      isBoardRepostRow({ replyToMessageId: 'sibling', threadRootId: null, clientMessageId: null })
    ).toBe(false);
    expect(
      isBoardRepostRow({
        replyToMessageId: 'sibling',
        threadRootId: null,
        clientMessageId: '9c1f0f4e-0000-4000-8000-000000000000',
      })
    ).toBe(false);
  });

  it('is false for a root post', () => {
    expect(
      isBoardRepostRow({ replyToMessageId: null, threadRootId: null, clientMessageId: 'repost:a' })
    ).toBe(false);
  });
});

describe('canRepostBoardPost', () => {
  const now = Date.parse('2026-09-03T12:00:00.000Z');
  const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();

  it('refuses a post the viewer already reposted', () => {
    expect(
      canRepostBoardPost({ post: post({ repostedByMe: true }), viewerId: 'u2', now })
    ).toEqual({ ok: false, reason: 'already' });
  });

  it('refuses the viewer bumping their own post inside a day, and allows it after', () => {
    expect(
      canRepostBoardPost({ post: post({ senderId: 'u1', timestamp: hoursAgo(1) }), viewerId: 'u1', now })
    ).toEqual({ ok: false, reason: 'ownTooSoon' });
    expect(
      canRepostBoardPost({ post: post({ senderId: 'u1', timestamp: hoursAgo(25) }), viewerId: 'u1', now })
    ).toEqual({ ok: true });
    expect(BOARD_REPOST_SELF_COOLDOWN_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('never refuses someone else bumping a day-old post', () => {
    expect(
      canRepostBoardPost({ post: post({ senderId: 'u1', timestamp: hoursAgo(1) }), viewerId: 'u2', now })
    ).toEqual({ ok: true });
  });

  it('refuses a repost of a repost, and a removed post', () => {
    const quoted = {
      id: 'p0',
      senderName: 'Ada',
      timestamp: hoursAgo(48),
      subject: null,
      snippet: 'Timetable',
      hasImage: false,
      hasAudio: false,
      removedAt: null,
    };
    expect(canRepostBoardPost({ post: post({ repostOf: quoted }), viewerId: 'u2', now })).toEqual({
      ok: false,
      reason: 'isRepost',
    });
    expect(
      canRepostBoardPost({ post: post({ removedAt: hoursAgo(2) }), viewerId: 'u2', now })
    ).toEqual({ ok: false, reason: 'removed' });
  });

  it('dims a refused repost but keeps it pressable, so the reason can be said', () => {
    // The regression: the control was rendered `disabled`, so the press that
    // would have shown `boardRepostRefusalCopy` never fired and the icon was
    // permanently grey and silent.
    const refused = canRepostBoardPost({
      post: post({ senderId: 'u1', timestamp: hoursAgo(1) }),
      viewerId: 'u1',
      now,
    });
    expect(refused.ok).toBe(false);
    expect(boardRepostControlState(refused, false)).toEqual({ pressable: true, dimmed: true });
  });

  it('leaves an allowed repost, and an undo, at full strength', () => {
    const allowed = canRepostBoardPost({ post: post(), viewerId: 'u2', now });
    expect(boardRepostControlState(allowed, false)).toEqual({ pressable: true, dimmed: false });
    // Already reposted: refused as a repost, but the tap is the undo.
    const already = canRepostBoardPost({ post: post({ repostedByMe: true }), viewerId: 'u2', now });
    expect(boardRepostControlState(already, true)).toEqual({ pressable: true, dimmed: false });
  });

  it('gives every refusal a single string both platforms show', () => {
    expect(boardRepostRefusalCopy('already')).toBe(COMMUNITY_BOARD_COPY.repostAlready);
    expect(boardRepostRefusalCopy('ownTooSoon')).toBe(COMMUNITY_BOARD_COPY.repostOwnTooSoon);
    expect(boardRepostRefusalCopy('isRepost')).toBe(COMMUNITY_BOARD_COPY.repostOfRepost);
    expect(boardRepostRefusalCopy('removed')).toBe(COMMUNITY_BOARD_COPY.repostRemoved);
    expect(boardRepostRefusalCopy('notSameBoard')).toBe(COMMUNITY_BOARD_COPY.repostNotSameBoard);
    expect(boardRepostRefusalCopy('tooMany')).toBe(COMMUNITY_BOARD_COPY.repostTooMany);
    expect(boardRepostRefusalCopy('unavailable')).toBe(COMMUNITY_BOARD_COPY.repostUnavailable);
  });
});

describe('boardQuoteSnippet', () => {
  it('strips image and audio markdown', () => {
    expect(
      boardQuoteSnippet('![photo](https://x.test/storage/v1/object/sign/note-files/a.webp) Timetable')
    ).toBe('Timetable');
    expect(boardQuoteSnippet('[audio](https://x.test/a.m4a) Listen')).toBe('Listen');
  });

  it('truncates at the shared limit and never exceeds it', () => {
    const long = 'a'.repeat(400);
    const snippet = boardQuoteSnippet(long);
    expect(snippet.length).toBe(BOARD_QUOTE_SNIPPET_MAX);
    expect(snippet.endsWith('…')).toBe(true);
    expect(boardQuoteSnippet('short')).toBe('short');
    expect(boardQuoteSnippet(null)).toBe('');
  });
});

describe('board post deep links', () => {
  it('appends the post id to the board link', () => {
    expect(boardPostDeepLinkPath('unilag', 'g1', 'p1')).toBe('/discover/c/unilag/ch/g1/p/p1');
  });

  it('falls back to the board link with no post id, and to /discover with no slug', () => {
    expect(boardPostDeepLinkPath('unilag', 'g1')).toBe(boardDeepLinkPath('unilag', 'g1'));
    expect(boardPostDeepLinkPath(null, 'g1', 'p1')).toBe('/discover');
  });

  it('never falls back to the chat tab', () => {
    for (const link of [
      boardPostDeepLinkPath(null, 'g1', 'p1'),
      boardPostDeepLinkPath('', 'g1', 'p1'),
      boardPostDeepLinkPath(undefined, 'g1'),
    ]) {
      expect(link.startsWith('/chat')).toBe(false);
    }
  });

  it('builds an absolute share url on the production origin', () => {
    expect(boardPostShareUrl('unilag', 'g1', 'p1')).toBe(
      `${BOARD_SHARE_ORIGIN}/discover/c/unilag/ch/g1/p/p1`
    );
    expect(boardPostShareUrl('unilag', 'g1', 'p1', 'https://staging.test/')).toBe(
      'https://staging.test/discover/c/unilag/ch/g1/p/p1'
    );
  });
});

describe('boardSharePayload', () => {
  const ctx = { slug: 'unilag', groupId: 'g1', boardName: 'exam-week' };

  it('is exactly a title and a url', () => {
    const payload = boardSharePayload(post({ subject: 'Timetable is out' }), ctx);
    expect(Object.keys(payload).sort()).toEqual(['title', 'url']);
    expect(payload.title).toBe('Timetable is out');
    expect(payload.url).toBe(`${BOARD_SHARE_ORIGIN}/discover/c/unilag/ch/g1/p/p1`);
  });

  it('names the board when the post has no title', () => {
    expect(boardSharePayload(post(), ctx).title).toBe('Post in # exam-week');
  });

  it('never carries the body, an image markdown or a storage url', () => {
    const leaky = post({
      subject: null,
      text: '![photo](https://x.test/storage/v1/object/sign/note-files/u1/chat/g1/a.webp?token=xyz)',
    });
    const serialised = JSON.stringify(boardSharePayload(leaky, ctx));
    expect(serialised).not.toContain('![image](');
    expect(serialised).not.toContain('![photo](');
    expect(serialised).not.toContain('/storage/v1/object/');
    expect(serialised).not.toContain('token=');
  });
});

describe('board action row and accessibility labels', () => {
  it('binds one row order for both platforms', () => {
    expect(BOARD_ACTION_ROW_ORDER).toEqual(['comment', 'repost', 'favorite', 'bookmark', 'share']);
  });

  it('announces state in words, never by colour alone', () => {
    expect(boardFavoriteAccessibilityLabel(12, true)).toBe('Favorite, 12, favorited');
    expect(boardFavoriteAccessibilityLabel(12, false)).toBe('Favorite, 12, not favorited');
    expect(boardRepostAccessibilityLabel(2, true)).toBe('Repost, 2, you reposted this');
    expect(boardRepostAccessibilityLabel(2, false)).toBe('Repost, 2, not reposted');
    expect(boardBookmarkAccessibilityLabel(true)).toBe('Bookmark, saved');
    expect(boardBookmarkAccessibilityLabel(false)).toBe('Bookmark, not saved');
    expect(boardCommentAccessibilityLabel(3)).toBe('Comment, 3');
    expect(boardShareAccessibilityLabel()).toBe('Share post');
  });

  it('keeps a count out of the label when it is not a number', () => {
    expect(boardFavoriteAccessibilityLabel(Number.NaN, false)).toBe('Favorite, 0, not favorited');
  });
});

describe('board copy after the action row lands', () => {
  it('drops the emoji React affordance from BOARD copy', () => {
    expect('react' in COMMUNITY_BOARD_COPY).toBe(false);
  });

  it('keeps reactionAccessibilityLabel exported for chat and DMs', () => {
    expect(reactionAccessibilityLabel('🔥', 2, true)).toBe(
      '🔥 reaction, 2, selected'
    );
  });

  it('keeps the device-local save copy while bookmarks may be unavailable', () => {
    // §2: on a database without message_bookmarks the clients hide Bookmark
    // and keep today's local save. The copy therefore has to still exist.
    expect(COMMUNITY_BOARD_COPY.saveForMe).toBe('Save for me');
    expect(COMMUNITY_BOARD_COPY.bookmarksUnavailable).toBe('Bookmarks are not available yet');
  });

  it('tells a non-member what to do without naming the post', () => {
    expect(COMMUNITY_BOARD_COPY.notAMemberBody('UNILAG')).toBe('Join UNILAG to open it.');
    const strings = [
      COMMUNITY_BOARD_COPY.notAMemberTitle,
      COMMUNITY_BOARD_COPY.notAMemberBody('UNILAG'),
      COMMUNITY_BOARD_COPY.notAMemberUnknown,
    ].join(' ');
    expect(strings).not.toContain('http');
  });
});
