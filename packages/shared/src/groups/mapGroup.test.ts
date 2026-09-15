/**
 * Table tests for the ONE group mapper (refactor R2).
 *
 * Every case here is a point where at least one of the eleven pre-refactor
 * copies behaved differently from the others — the drift is the reason this
 * module exists, so the resolution of each drift point is pinned by a test.
 */

import {
  deriveGroupMemberRole,
  mapGroupMemberRow,
  mapGroupRow,
  mapGroupRows,
  toServerGroupPayload,
} from './mapGroup';

describe('mapGroupRow — drift points', () => {
  type Case = {
    /** Which old copies disagreed here. */
    drift: string;
    row: Record<string, any>;
    ctx?: Parameters<typeof mapGroupRow>[1];
    expect: Record<string, unknown>;
  };

  const cases: Case[] = [
    {
      drift: 'communitySurface: dropped by apiMappers + both useAppEffects copies',
      row: { id: 'g1', community_id: 'c1', community_surface: 'study_group' },
      expect: { communitySurface: 'study_group', communityId: 'c1' },
    },
    {
      drift: 'communitySurface: absent column (pre-migration) means board, i.e. null',
      row: { id: 'g1', community_id: 'c1' },
      expect: { communitySurface: null },
    },
    {
      drift: 'communitySurface: camelCase from the API resolves identically',
      row: { id: 'g1', communitySurface: 'study_group' },
      expect: { communitySurface: 'study_group' },
    },
    {
      drift: 'visibility: getGroupByInviteId omitted it entirely (undefined)',
      row: { id: 'g1' },
      expect: { visibility: 'private' },
    },
    {
      drift: 'visibility: an explicit value always wins over the default',
      row: { id: 'g1', visibility: 'public' },
      expect: { visibility: 'public' },
    },
    {
      drift: 'courseId: apiMappers defaulted to undefined, everyone else to null',
      row: { id: 'g1' },
      expect: { courseId: null },
    },
    {
      drift: 'courseId: an explicit null must NOT be resurrected by the other casing',
      row: { id: 'g1', course_id: null, courseId: 'stale' },
      expect: { courseId: null },
    },
    {
      drift: 'courseId: mobile read snake first, web read camel first — same answer',
      row: { id: 'g1', courseId: 'course-1' },
      expect: { courseId: 'course-1' },
    },
    {
      drift: 'communityId: raw null from Postgres stays null, never undefined',
      row: { id: 'g1', community_id: null },
      expect: { communityId: null },
    },
    {
      drift: 'isArchived: the API copies passed the raw NULL straight through',
      row: { id: 'g1', is_archived: null },
      expect: { isArchived: false },
    },
    {
      drift: 'isArchived: `||` copies let a stale camel true beat an explicit false',
      row: { id: 'g1', is_archived: false, isArchived: true },
      expect: { isArchived: false },
    },
    {
      drift: 'isArchived: absent on both casings defaults to false, not undefined',
      row: { id: 'g1' },
      expect: { isArchived: false },
    },
    {
      drift: 'adminIds: always an array — apiMappers/web/API all defaulted to []',
      row: { id: 'g1' },
      expect: { adminIds: [] },
    },
    {
      drift: 'adminIds: ctx.fallback covers the create path (web used [currentUser.id])',
      row: { id: 'g1' },
      ctx: { fallback: { adminIds: ['me'] } },
      expect: { adminIds: ['me'] },
    },
    {
      drift: 'permissions: apiMappers + mobile left it undefined, web/API used {}',
      row: { id: 'g1' },
      expect: { permissions: {} },
    },
    {
      drift: 'unreadCount: the caller map wins over the row (web supabase rule)',
      row: { id: 'g1', unread_count: 9 },
      ctx: { unreadCounts: { g1: 2 } },
      expect: { unreadCount: 2 },
    },
    {
      drift: 'unreadCount: the row is the fallback — mobile/hooks ignored it entirely',
      row: { id: 'g1', unread_count: 9 },
      expect: { unreadCount: 9 },
    },
    {
      drift: 'unreadCount: never undefined',
      row: { id: 'g1' },
      expect: { unreadCount: 0 },
    },
    {
      drift: 'memberCount: unknown stays undefined, NOT 0 (0 is a claim)',
      row: { id: 'g1' },
      expect: { memberCount: undefined },
    },
    {
      drift: 'memberCount: a separately counted map wins (API list endpoint)',
      row: { id: 'g1', member_count: 3 },
      ctx: { memberCounts: { g1: 7 } },
      expect: { memberCount: 7 },
    },
    {
      drift: 'memberCount: falls back to a loaded roster length (mobile rule)',
      row: { id: 'g1', members: [{ user_id: 'u1', name: 'A' }] },
      expect: { memberCount: 1 },
    },
    {
      drift: 'lastMessage/Time: snake and camel resolve to the same pair',
      row: { id: 'g1', lastMessage: 'hi', lastMessageTime: '2026-01-01T00:00:00Z' },
      expect: { lastMessage: 'hi', lastMessageTime: '2026-01-01T00:00:00Z' },
    },
    {
      drift: 'lastMessage: an empty preview is no preview',
      row: { id: 'g1', last_message: '' },
      expect: { lastMessage: undefined },
    },
    {
      drift: 'avatarUrl: `||` chain semantics kept — an empty string is no avatar',
      row: { id: 'g1', avatar_url: '', avatarUrl: 'https://a/b.png' },
      expect: { avatarUrl: 'https://a/b.png' },
    },
    {
      drift: 'inviteId/parentId: snake wins, camel is the API spelling',
      row: { id: 'g1', invite_id: 'inv-1', parentId: 'p-1' },
      expect: { inviteId: 'inv-1', parentId: 'p-1' },
    },
    {
      drift: 'invitedPhoneNumbers: web hardcoded [] — never undefined',
      row: { id: 'g1' },
      expect: { invitedPhoneNumbers: [] },
    },
    {
      drift: 'tags/questionCount: only one copy mapped them at all',
      row: { id: 'g1', tags: ['bio'], question_count: 12 },
      expect: { tags: ['bio'], questionCount: 12 },
    },
    {
      drift: 'createdAt/updatedAt: API set createdAt, mobile needed both, web dropped them',
      row: { id: 'g1', created_at: '2026-01-01', updated_at: '2026-02-02' },
      expect: { createdAt: '2026-01-01', updatedAt: '2026-02-02' },
    },
    {
      drift: 'members: web passed the raw rows through unmapped',
      row: { id: 'g1', admin_ids: ['u1'], members: [{ user_id: 'u1', name: 'Ada' }] },
      expect: {
        members: [
          {
            id: 'u1',
            userId: 'u1',
            name: 'Ada',
            username: undefined,
            avatarUrl: undefined,
            email: undefined,
            points: 0,
            badges: [],
            stats: {},
            role: 'owner',
            joinedAt: expect.any(String),
          },
        ],
      },
    },
  ];

  it.each(cases.map((c) => [c.drift, c] as const))('%s', (_label, testCase) => {
    const mapped = mapGroupRow(testCase.row, testCase.ctx) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(testCase.expect)) {
      expect({ [key]: mapped[key] }).toEqual({ [key]: value });
    }
  });
});

/**
 * Review H0: `?? fallback` could not tell "key absent" from "key present and
 * null". The API sends `course_id` / `community_id` / `community_surface` as
 * literal `null`, and web's `mergeFetchedGroups` feeds the PREVIOUS UI state in
 * as the fallback — so detaching a group from its community was undone by the
 * next refresh. Presence decides; each field is pinned in both directions.
 */
describe('mapGroupRow — explicit null vs absent against ctx.fallback', () => {
  const fallback: NonNullable<Parameters<typeof mapGroupRow>[1]>['fallback'] = {
    courseId: 'stale-course',
    visibility: 'community',
    communityId: 'stale-community',
    communitySurface: 'study_group',
    memberCount: 12,
  };

  type Case = {
    label: string;
    row: Record<string, any>;
    expect: Record<string, unknown>;
  };

  const cases: Case[] = [
    // communityId — the detach case from the review.
    {
      label: 'communityId: an explicit null clears the carried-over community',
      row: { id: 'g1', community_id: null },
      expect: { communityId: null },
    },
    {
      label: 'communityId: an explicit camelCase null clears it too',
      row: { id: 'g1', communityId: null },
      expect: { communityId: null },
    },
    {
      label: 'communityId: absent falls back (compact list row)',
      row: { id: 'g1' },
      expect: { communityId: 'stale-community' },
    },
    {
      label: 'communityId: a real server value still wins over the fallback',
      row: { id: 'g1', community_id: 'comm-2' },
      expect: { communityId: 'comm-2' },
    },

    // communitySurface — a resurrected value renders a board as a study group.
    {
      label: 'communitySurface: an explicit null falls back to board (null)',
      row: { id: 'g1', community_surface: null },
      expect: { communitySurface: null },
    },
    {
      label: 'communitySurface: absent falls back (pre-migration column)',
      row: { id: 'g1' },
      expect: { communitySurface: 'study_group' },
    },
    {
      label: 'communitySurface: a real server value wins',
      row: { id: 'g1', community_surface: 'board' },
      expect: { communitySurface: 'board' },
    },

    // courseId
    {
      label: 'courseId: an explicit null clears a course the student just unlinked',
      row: { id: 'g1', course_id: null },
      expect: { courseId: null },
    },
    {
      label: 'courseId: absent falls back',
      row: { id: 'g1' },
      expect: { courseId: 'stale-course' },
    },
    {
      label: 'courseId: a real server value wins',
      row: { id: 'g1', courseId: 'course-2' },
      expect: { courseId: 'course-2' },
    },

    // visibility — not nullable on `Group`, so "cleared" means 'private'.
    {
      label: 'visibility: an explicit null means unset, i.e. private — not the old value',
      row: { id: 'g1', visibility: null },
      expect: { visibility: 'private' },
    },
    {
      label: 'visibility: absent falls back',
      row: { id: 'g1' },
      expect: { visibility: 'community' },
    },
    {
      label: 'visibility: a real server value wins',
      row: { id: 'g1', visibility: 'public' },
      expect: { visibility: 'public' },
    },

    // memberCount — null is the server saying "unknown", not "use the old one".
    {
      label: 'memberCount: an explicit null means unknown, not the previous count',
      row: { id: 'g1', member_count: null },
      expect: { memberCount: undefined },
    },
    {
      label: 'memberCount: absent falls back',
      row: { id: 'g1' },
      expect: { memberCount: 12 },
    },
    {
      label: 'memberCount: a loaded roster outranks the fallback (evidence, not memory)',
      row: { id: 'g1', members: [{ user_id: 'u1', name: 'Ada' }] },
      expect: { memberCount: 1 },
    },
    {
      label: 'memberCount: a real server value wins',
      row: { id: 'g1', member_count: 30 },
      expect: { memberCount: 30 },
    },
  ];

  it.each(cases.map((c) => [c.label, c] as const))('%s', (_label, testCase) => {
    const mapped = mapGroupRow(testCase.row, { fallback }) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(testCase.expect)) {
      expect({ [key]: mapped[key] }).toEqual({ [key]: value });
    }
  });
});

describe('deriveGroupMemberRole', () => {
  it('treats adminIds[0] as the owner and the rest as admins', () => {
    const adminIds = ['owner', 'admin'];
    expect(deriveGroupMemberRole('owner', adminIds)).toBe('owner');
    expect(deriveGroupMemberRole('admin', adminIds)).toBe('admin');
    expect(deriveGroupMemberRole('someone', adminIds)).toBe('member');
    expect(deriveGroupMemberRole(undefined, adminIds)).toBe('member');
    expect(deriveGroupMemberRole('owner', [])).toBe('member');
  });
});

describe('mapGroupMemberRow', () => {
  it('prefers the auth user id so roster lookups match sender_id', () => {
    expect(mapGroupMemberRow({ id: 'row-id', user_id: 'auth-id', name: 'A' }, []).id).toBe('auth-id');
    expect(mapGroupMemberRow({ id: 'row-id', name: 'A' }, []).id).toBe('row-id');
  });

  it('falls back to a placeholder name rather than undefined', () => {
    expect(mapGroupMemberRow({ user_id: 'u' }, []).name).toBe('Unknown');
  });
});

describe('viewerRole', () => {
  it('is derived from adminIds without a roster', () => {
    const g = mapGroupRow({ id: 'g1', admin_ids: ['owner', 'admin'] }, { viewerId: 'admin' });
    expect(g.viewerRole).toBe('admin');
  });

  it('is member only when a loaded roster proves it', () => {
    expect(
      mapGroupRow({ id: 'g1', members: [{ user_id: 'u1', name: 'A' }] }, { viewerId: 'u1' }).viewerRole,
    ).toBe('member');
  });

  it('is null — not "member" — when the row cannot tell', () => {
    expect(mapGroupRow({ id: 'g1' }, { viewerId: 'u1' }).viewerRole).toBeNull();
    expect(mapGroupRow({ id: 'g1' }).viewerRole).toBeNull();
  });
});

describe('mapGroupRows', () => {
  it('tolerates null/undefined payloads', () => {
    expect(mapGroupRows(null)).toEqual([]);
    expect(mapGroupRows(undefined)).toEqual([]);
  });

  it('applies the per-group unread map by id', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    const mapped = mapGroupRows(rows, { unreadCounts: { b: 4 } });
    expect(mapped.map((g) => g.unreadCount)).toEqual([0, 4]);
  });
});

describe('toServerGroupPayload', () => {
  it('omits the client-only fields the API has never put on the wire', () => {
    const payload = toServerGroupPayload({ id: 'g1', admin_ids: ['u1'] }) as unknown as Record<string, unknown>;
    expect(payload).not.toHaveProperty('members');
    expect(payload).not.toHaveProperty('unreadCount');
    expect(payload).not.toHaveProperty('viewerRole');
    expect(payload).not.toHaveProperty('invitedPhoneNumbers');
  });

  it('omits undefined keys so a compact list row stays compact', () => {
    const payload = toServerGroupPayload({ id: 'g1' }) as unknown as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ['adminIds', 'communityId', 'communitySurface', 'courseId', 'id', 'isArchived', 'permissions', 'visibility'].sort(),
    );
  });

  it('keeps the fields the group list and detail responses carry', () => {
    const payload = toServerGroupPayload({
      id: 'g1',
      name: 'Bio 101',
      description: 'd',
      avatar_url: 'https://a/b.png',
      last_message: 'hi',
      last_message_time: '2026-01-01',
      admin_ids: ['u1'],
      permissions: { canSendMessages: true },
      parent_id: null,
      is_archived: false,
      invite_id: 'inv',
      course_id: 'c',
      visibility: 'community',
      community_id: 'comm',
      community_surface: 'study_group',
      created_at: '2026-01-01',
    }) as unknown as Record<string, unknown>;
    expect(payload).toMatchObject({
      id: 'g1',
      name: 'Bio 101',
      description: 'd',
      avatarUrl: 'https://a/b.png',
      lastMessage: 'hi',
      lastMessageTime: '2026-01-01',
      adminIds: ['u1'],
      isArchived: false,
      inviteId: 'inv',
      courseId: 'c',
      visibility: 'community',
      communityId: 'comm',
      communitySurface: 'study_group',
      createdAt: '2026-01-01',
    });
  });
});
