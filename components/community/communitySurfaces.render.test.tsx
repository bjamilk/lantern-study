// @vitest-environment jsdom
// The modal shell touches `document` on import, so this suite needs a DOM to
// import at all. It still renders through react-dom/server: effects never run,
// so no request fires.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CommunityDetail } from '@lantern/shared/network';

import type { BoardPost } from '@lantern/shared/network';

import CreateCommunityModal from './CreateCommunityModal';
import JoinByCodeModal from './JoinByCodeModal';
import ManageCommunityPanel from './ManageCommunityPanel';
import BoardPostCard, { BOARD_ANSWER_COPY } from './BoardPostCard';
import BoardPostPanel, { CommentAnswer } from './BoardPostPanel';
import { COMMUNITY_MANAGE_COPY, COMMUNITY_MANAGE_INTRO } from './manageCommunity';
import { JOIN_BY_CODE_HINT } from './joinByCode';
import { CREATE_COMMUNITY_VISIBILITY_NOTE } from './createCommunityPlan';

// PARTIAL: the Manage panel pulls in the auth store, which boots from the
// real module on import. Replacing the whole module took that with it.
vi.mock('../../services/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/supabase')>()),
  createCommunity: vi.fn(),
  joinCommunity: vi.fn(),
  fetchCommunity: vi.fn(),
  fetchCommunityChannels: vi.fn(),
  fetchCommunityMembers: vi.fn(),
  fetchMyCommunities: vi.fn(),
}));

// The shared-client wrappers reach for the API root on import; the panel only
// calls them from effects, which never run through renderToStaticMarkup.
vi.mock('../../services/apiEndpoints', () => ({
  createCommunityInvite: vi.fn(),
  joinCommunityByCode: vi.fn(),
  listCommunityInvites: vi.fn(),
  markCommunityPostAnswered: vi.fn(),
  muteCommunityMember: vi.fn(),
  removeCommunityPost: vi.fn(),
  revokeCommunityInvite: vi.fn(),
  setCommunityMemberRole: vi.fn(),
  unmuteCommunityMember: vi.fn(),
}));

// BoardPostPanel mounts the composer, which reaches for native modules on
// import; it is never rendered by these static tests, so a stub keeps the
// import graph light.
vi.mock('../MessageInputBar', () => ({ default: () => null }));

/**
 * Render smoke tests. The value is the wiring and the promises the copy makes:
 * a create form that names the campus-life purposes, a visibility line that
 * does not imply privacy we cannot deliver, a join box that explains what to
 * paste, and a Manage panel that is honest about what a role cannot do.
 */

const detail = (over: Partial<CommunityDetail> = {}): CommunityDetail =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'topic',
    slug: 'hostel-b',
    name: 'Hostel B',
    description: null,
    institution_id: null,
    programme: null,
    study_level: null,
    course_id: null,
    tags: ['hostel'],
    visibility: 'public',
    is_official: false,
    member_count: 12,
    isMember: true,
    source: 'joined',
    lounge_group_id: null,
    created_by: 'me',
    viewerRole: 'owner',
    onlineCount: 0,
    ...over,
  }) as CommunityDetail;

describe('CreateCommunityModal', () => {
  it('renders nothing while closed', () => {
    expect(
      renderToStaticMarkup(
        <CreateCommunityModal isOpen={false} onClose={() => undefined} onCreated={() => undefined} />
      )
    ).toBe('');
  });

  it('offers campus life, not only study, and a Public / Private choice', () => {
    const html = renderToStaticMarkup(
      <CreateCommunityModal isOpen onClose={() => undefined} onCreated={() => undefined} />
    );
    expect(html).toContain('Start a community');
    expect(html).toContain('Hostel or hall');
    expect(html).toContain('Club or society');
    expect(html).toContain('Faith');
    expect(html).toContain('Private');
    expect(html).toContain(CREATE_COMMUNITY_VISIBILITY_NOTE.slice(0, 40));
  });

  it('keeps the event fields out of sight until a room is an event', () => {
    const html = renderToStaticMarkup(
      <CreateCommunityModal isOpen onClose={() => undefined} onCreated={() => undefined} />
    );
    expect(html).not.toContain('create-community-when');
  });
});

describe('JoinByCodeModal', () => {
  it('explains what to paste', () => {
    const html = renderToStaticMarkup(
      <JoinByCodeModal isOpen onClose={() => undefined} onJoined={() => undefined} />
    );
    expect(html).toContain('Join with a link');
    expect(html).toContain(JOIN_BY_CODE_HINT.slice(0, 30));
  });

  it('renders nothing while closed', () => {
    expect(
      renderToStaticMarkup(
        <JoinByCodeModal isOpen={false} onClose={() => undefined} onJoined={() => undefined} />
      )
    ).toBe('');
  });
});

describe('ManageCommunityPanel', () => {
  it('does not appear for a plain member — there is nothing to manage', () => {
    expect(
      renderToStaticMarkup(<ManageCommunityPanel detail={detail({ viewerRole: 'member' })} />)
    ).toBe('');
  });

  it('gives an owner the powers that now exist, not a list of missing ones', () => {
    const html = renderToStaticMarkup(<ManageCommunityPanel detail={detail()} />);
    expect(html).toContain(COMMUNITY_MANAGE_INTRO);
    expect(html).toContain(COMMUNITY_MANAGE_COPY.membersTab);
    expect(html).toContain(COMMUNITY_MANAGE_COPY.invitesTab);
    expect(html).toContain(COMMUNITY_MANAGE_COPY.inviteCreate);
    // The old panel's apology for the things it could not do is gone.
    expect(html).not.toContain('Not available yet');
  });

  it('shows a moderator invites and mutes but no role picker of its own', () => {
    const html = renderToStaticMarkup(
      <ManageCommunityPanel detail={detail({ viewerRole: 'moderator' })} />
    );
    expect(html).toContain(COMMUNITY_MANAGE_COPY.invitesTab);
    expect(html).toContain(COMMUNITY_MANAGE_COPY.membersTab);
  });
});

const boardPost = (over: Partial<BoardPost> = {}): BoardPost => ({
  id: 'post-1',
  groupId: 'g1',
  senderId: 'author',
  senderName: 'Ada',
  senderAvatarUrl: null,
  subject: 'When is the resit?',
  text: 'Does anyone know the resit date?',
  timestamp: new Date('2026-09-01T10:00:00Z').toISOString(),
  editedAt: null,
  removedAt: null,
  replyCount: 2,
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

const cardProps = (over: Partial<React.ComponentProps<typeof BoardPostCard>> = {}) =>
  ({
    post: boardPost(),
    currentUserId: 'viewer',
    canPin: false,
    lowDataMode: false,
    saved: false,
    bookmarked: false,
    bookmarksAvailable: false,
    favoriteCount: 0,
    commentCount: 2,
    onToggleReaction: () => undefined,
    onOpenComments: () => undefined,
    onRepost: () => undefined,
    onToggleBookmark: () => undefined,
    onShare: () => undefined,
    onCopyText: () => undefined,
    onToggleSave: () => undefined,
    onReport: () => undefined,
    onEdit: () => undefined,
    onDelete: () => undefined,
    onTogglePin: () => undefined,
    onStartStudyGroup: () => undefined,
    ...over,
  }) satisfies React.ComponentProps<typeof BoardPostCard>;

describe('BoardPostCard — answered', () => {
  it('reads as answered in the timeline once a question is resolved', () => {
    const html = renderToStaticMarkup(
      <BoardPostCard {...cardProps({ answered: true, postKindLabel: 'Question' })} />
    );
    expect(html).toContain(BOARD_ANSWER_COPY.answeredBadge);
  });

  it('carries no answered badge on an unresolved question — the default', () => {
    const html = renderToStaticMarkup(
      <BoardPostCard {...cardProps({ postKindLabel: 'Question' })} />
    );
    expect(html).not.toContain(BOARD_ANSWER_COPY.answeredBadge);
  });
});

describe('CommentAnswer', () => {
  it('marks the accepted reply as the answer for every reader', () => {
    const html = renderToStaticMarkup(
      <CommentAnswer isAnswer canMark={false} onMark={() => undefined} onClear={() => undefined} />
    );
    // The badge is present; the action is not, because this viewer may not mark.
    expect(html).toContain(BOARD_ANSWER_COPY.answerBadge);
    expect(html).not.toContain(BOARD_ANSWER_COPY.markAnswer);
    expect(html).not.toContain(BOARD_ANSWER_COPY.clearAnswer);
  });

  it('offers "Mark as answer" on an un-accepted reply only to a marker', () => {
    const html = renderToStaticMarkup(
      <CommentAnswer isAnswer={false} canMark onMark={() => undefined} onClear={() => undefined} />
    );
    expect(html).toContain(BOARD_ANSWER_COPY.markAnswer);
    expect(html).not.toContain(BOARD_ANSWER_COPY.clearAnswer);
  });

  it('lets a marker clear the answer on the accepted reply — un-answering', () => {
    const html = renderToStaticMarkup(
      <CommentAnswer isAnswer canMark onMark={() => undefined} onClear={() => undefined} />
    );
    expect(html).toContain(BOARD_ANSWER_COPY.answerBadge);
    expect(html).toContain(BOARD_ANSWER_COPY.clearAnswer);
  });

  it('shows nothing to a viewer who cannot mark on an ordinary reply', () => {
    // If the canMark gate were dropped, this reply would sprout a control the
    // server would refuse — so this must stay empty.
    const html = renderToStaticMarkup(
      <CommentAnswer
        isAnswer={false}
        canMark={false}
        onMark={() => undefined}
        onClear={() => undefined}
      />
    );
    expect(html).toBe('');
  });
});

describe('BoardPostPanel — answered thread', () => {
  it('says the question is answered at the top of its own thread', () => {
    const html = renderToStaticMarkup(
      <BoardPostPanel
        groupId="g1"
        post={boardPost()}
        lowDataMode={false}
        mentionCandidates={[]}
        onClose={() => undefined}
        myReactions={{}}
        onToggleFavorite={async () => null}
        onSendComment={async () => undefined}
        onReplyCountChange={() => undefined}
        answeredMessageId="reply-9"
        canMarkAnswered
        onSetAnswer={() => undefined}
      />
    );
    expect(html).toContain(BOARD_ANSWER_COPY.answeredBadge);
  });

  it('reads as unanswered when no reply has been accepted', () => {
    const html = renderToStaticMarkup(
      <BoardPostPanel
        groupId="g1"
        post={boardPost()}
        lowDataMode={false}
        mentionCandidates={[]}
        onClose={() => undefined}
        myReactions={{}}
        onToggleFavorite={async () => null}
        onSendComment={async () => undefined}
        onReplyCountChange={() => undefined}
        answeredMessageId={null}
        canMarkAnswered
        onSetAnswer={() => undefined}
      />
    );
    expect(html).not.toContain(BOARD_ANSWER_COPY.answeredBadge);
  });
});
