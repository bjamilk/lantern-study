// @vitest-environment jsdom
// The modal shell touches `document` on import, so this suite needs a DOM to
// import at all. It still renders through react-dom/server: effects never run,
// so no request fires.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CommunityDetail } from '@lantern/shared/network';

import CreateCommunityModal from './CreateCommunityModal';
import JoinByCodeModal from './JoinByCodeModal';
import ManageCommunityPanel from './ManageCommunityPanel';
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
  muteCommunityMember: vi.fn(),
  removeCommunityPost: vi.fn(),
  revokeCommunityInvite: vi.fn(),
  setCommunityMemberRole: vi.fn(),
  unmuteCommunityMember: vi.fn(),
}));

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

  it('offers campus life, not only study, and says the room will be public', () => {
    const html = renderToStaticMarkup(
      <CreateCommunityModal isOpen onClose={() => undefined} onCreated={() => undefined} />
    );
    expect(html).toContain('Start a community');
    expect(html).toContain('Hostel or hall');
    expect(html).toContain('Club or society');
    expect(html).toContain('Faith');
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
