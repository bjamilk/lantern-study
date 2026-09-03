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
  isCommunityBoardGroupIn,
  pinnedPostAccessibilityLabel,
  reactionAccessibilityLabel,
  studyGroupAnnouncement,
  studyGroupNameFromPost,
  studyGroupSubtitle,
  validateBoardSubject,
} from './communityBoard';
import type { BoardPost } from './communityBoard';
import { COMMUNITY_COPY } from './communityServer';
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
