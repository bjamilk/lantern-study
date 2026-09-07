/**
 * Every rule in communityGovernance, as a matrix. These are the rules the API
 * enforces, so a break here is a break in the gate, in who may moderate, or in
 * who may redeem an invite.
 */
import { describe, it, expect } from '@jest/globals';
import {
  ACADEMIC_COMMUNITY_KINDS,
  ASSIGNABLE_COMMUNITY_ROLES,
  BOARD_ANNOUNCEMENT_PIN_MAX,
  BOARD_POST_KINDS,
  COMMUNITY_INVITE_ACTIVE_MAX,
  COMMUNITY_INVITE_CODE_LENGTH,
  COMMUNITY_INVITE_MAX_USES_DEFAULT,
  COMMUNITY_INVITE_MAX_USES_LIMIT,
  COMMUNITY_INVITE_TTL_MS_MAX,
  COMMUNITY_KINDS,
  SOCIAL_COMMUNITY_KINDS,
  boardPostKindMeta,
  boardPostRules,
  canAccessDiscoverHub,
  canAssignCommunityRole,
  canModerateCommunityMember,
  canPostBoardKind,
  canPostOnBoard,
  communityInviteUrl,
  communityKindMeta,
  compareDiscoverCommunities,
  hasCompleteAcademicProfile,
  inviteRefusal,
  isBoardPostKind,
  isCommunityKind,
  isCommunityMemberMuted,
  isCreatableCommunityKind,
  muteRemainingLabel,
  normalizeBoardPostKind,
  normalizeCommunitySearch,
  normalizeInviteCode,
  rankDiscoverCommunities,
  resolveInviteExpiry,
  resolveInviteMaxUses,
  resolveMuteUntil,
  seedMuteState,
} from './communityGovernance';
import { communityKindLabel } from './communityLabels';
import type { CommunityRole } from './communityServer';

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

describe('canAccessDiscoverHub', () => {
  it('keeps the legacy boolean form working, meaning platform-admin only', () => {
    expect(canAccessDiscoverHub(true)).toBe(true);
    expect(canAccessDiscoverHub(false)).toBe(false);
  });

  it('lets a platform admin in with no academic profile at all', () => {
    expect(canAccessDiscoverHub({ isPlatformAdmin: true })).toBe(true);
    expect(
      canAccessDiscoverHub({ isPlatformAdmin: true, institutionId: null, programme: null }),
    ).toBe(true);
  });

  it('lets any student with institution AND programme in', () => {
    expect(canAccessDiscoverHub({ institutionId: 'inst-1', programme: 'MBBS' })).toBe(true);
  });

  it('refuses a half-filled academic profile', () => {
    expect(canAccessDiscoverHub({ institutionId: 'inst-1' })).toBe(false);
    expect(canAccessDiscoverHub({ programme: 'MBBS' })).toBe(false);
    expect(canAccessDiscoverHub({ institutionId: '   ', programme: 'MBBS' })).toBe(false);
    expect(canAccessDiscoverHub({ institutionId: 'inst-1', programme: '  ' })).toBe(false);
  });

  it('refuses junk without throwing', () => {
    expect(canAccessDiscoverHub(null as never)).toBe(false);
    expect(canAccessDiscoverHub(undefined as never)).toBe(false);
    expect(canAccessDiscoverHub({} as never)).toBe(false);
  });

  it('does not require study level — the newest accounts have none', () => {
    expect(hasCompleteAcademicProfile({ institutionId: 'i', programme: 'p' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

describe('community kinds', () => {
  it('keeps every legacy kind, so no existing row is orphaned', () => {
    for (const kind of ['institution', 'programme', 'level', 'course', 'topic']) {
      expect(isCommunityKind(kind)).toBe(true);
    }
  });

  it('adds the campus-life kinds', () => {
    for (const kind of ['interest', 'club', 'hostel', 'event', 'faith', 'sports', 'general']) {
      expect(isCommunityKind(kind)).toBe(true);
    }
  });

  it('COMMUNITY_KINDS is academic + social with no duplicates', () => {
    expect(COMMUNITY_KINDS.length).toBe(
      ACADEMIC_COMMUNITY_KINDS.length + SOCIAL_COMMUNITY_KINDS.length,
    );
    expect(new Set(COMMUNITY_KINDS).size).toBe(COMMUNITY_KINDS.length);
  });

  it('only social kinds are student-creatable — academic kinds stay derived', () => {
    for (const kind of ACADEMIC_COMMUNITY_KINDS) {
      expect(isCreatableCommunityKind(kind)).toBe(false);
      expect(communityKindMeta(kind).academic).toBe(true);
    }
    for (const kind of SOCIAL_COMMUNITY_KINDS) {
      expect(isCreatableCommunityKind(kind)).toBe(true);
      expect(communityKindMeta(kind).academic).toBe(false);
    }
  });

  it('gives every kind a label, an icon and a feature ink', () => {
    for (const kind of COMMUNITY_KINDS) {
      const meta = communityKindMeta(kind);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.icon.length).toBeGreaterThan(0);
      expect(['campus', 'groups']).toContain(meta.ink);
    }
  });

  it('academic kinds carry the campus ink, social kinds the groups ink', () => {
    expect(communityKindMeta('course').ink).toBe('campus');
    expect(communityKindMeta('club').ink).toBe('groups');
  });

  it('only course needs a course id, only event is timed', () => {
    const needsCourse = COMMUNITY_KINDS.filter((k) => communityKindMeta(k).needsCourse);
    expect(needsCourse).toEqual(['course']);
    const timed = COMMUNITY_KINDS.filter((k) => communityKindMeta(k).timed);
    expect(timed).toEqual(['event']);
  });

  it('degrades an unknown kind instead of throwing', () => {
    expect(communityKindMeta('quidditch').label).toBe('Community');
    expect(communityKindLabel('quidditch')).toBe('Community');
    expect(isCommunityKind('quidditch')).toBe(false);
  });

  it('communityKindLabel agrees with the meta for every known kind', () => {
    for (const kind of COMMUNITY_KINDS) {
      expect(communityKindLabel(kind)).toBe(communityKindMeta(kind).label);
    }
  });
});

// ---------------------------------------------------------------------------
// Board post kinds
// ---------------------------------------------------------------------------

describe('board post kinds', () => {
  it('ships no poll this wave', () => {
    expect(BOARD_POST_KINDS).toEqual(['discussion', 'question', 'announcement', 'event']);
    expect(isBoardPostKind('poll')).toBe(false);
  });

  it('normalizes legacy NULL / junk to discussion', () => {
    expect(normalizeBoardPostKind(null)).toBe('discussion');
    expect(normalizeBoardPostKind(undefined)).toBe('discussion');
    expect(normalizeBoardPostKind('poll')).toBe('discussion');
    expect(normalizeBoardPostKind('question')).toBe('question');
  });

  it('announcements are the only restricted kind, and pin by default', () => {
    const restricted = BOARD_POST_KINDS.filter((k) => boardPostKindMeta(k).restricted);
    expect(restricted).toEqual(['announcement']);
    const pinned = BOARD_POST_KINDS.filter((k) => boardPostKindMeta(k).pinnedByDefault);
    expect(pinned).toEqual(['announcement']);
  });

  it('caps announcements at three per community', () => {
    expect(BOARD_ANNOUNCEMENT_PIN_MAX).toBe(3);
  });

  it.each([
    ['owner', true],
    ['admin', true],
    ['moderator', true],
    ['member', false],
    [null, false],
  ] as Array<[CommunityRole | null, boolean]>)(
    'canPostBoardKind(%s, announcement) === %s',
    (role, expected) => {
      expect(canPostBoardKind(role, 'announcement')).toBe(expected);
      // Everything else is open to every member.
      expect(canPostBoardKind(role, 'discussion')).toBe(true);
      expect(canPostBoardKind(role, 'question')).toBe(true);
      expect(canPostBoardKind(role, 'event')).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// boardPostRules matrix
// ---------------------------------------------------------------------------

describe('boardPostRules', () => {
  const AUTHOR = 'user-author';
  const OTHER = 'user-other';
  const base = { senderId: AUTHOR, viewerId: OTHER, postKind: 'discussion' as const };

  it('only moderators pin, and pin/unpin are never both true', () => {
    for (const role of ['owner', 'admin', 'moderator'] as CommunityRole[]) {
      const unpinned = boardPostRules(role, base);
      expect(unpinned.canPin).toBe(true);
      expect(unpinned.canUnpin).toBe(false);
      const pinned = boardPostRules(role, { ...base, pinnedAt: '2026-09-07T00:00:00Z' });
      expect(pinned.canPin).toBe(false);
      expect(pinned.canUnpin).toBe(true);
    }
    const member = boardPostRules('member', base);
    expect(member.canPin).toBe(false);
    expect(member.canUnpin).toBe(false);
  });

  it('an author removes their own post; a member cannot remove someone else’s', () => {
    expect(boardPostRules('member', { ...base, viewerId: AUTHOR }).canRemove).toBe(true);
    expect(boardPostRules('member', base).canRemove).toBe(false);
    expect(boardPostRules('moderator', base).canRemove).toBe(true);
  });

  it('an already-removed post cannot be pinned, removed or commented on again', () => {
    const removed = boardPostRules('owner', { ...base, removedAt: '2026-09-07T00:00:00Z' });
    expect(removed).toEqual({
      canPin: false,
      canUnpin: false,
      canRemove: false,
      canMarkAnswered: false,
      canComment: false,
      canReport: false,
    });
  });

  it('marks answered on questions only, by the author or a moderator', () => {
    expect(boardPostRules('member', { ...base, postKind: 'question', viewerId: AUTHOR }).canMarkAnswered).toBe(true);
    expect(boardPostRules('moderator', { ...base, postKind: 'question' }).canMarkAnswered).toBe(true);
    expect(boardPostRules('member', { ...base, postKind: 'question' }).canMarkAnswered).toBe(false);
    expect(boardPostRules('owner', { ...base, postKind: 'discussion' }).canMarkAnswered).toBe(false);
  });

  it('a muted member still reads but cannot comment', () => {
    const now = Date.parse('2026-09-07T12:00:00Z');
    const muted = boardPostRules('member', {
      ...base,
      mutedUntil: '2026-09-08T12:00:00Z',
      now,
    });
    expect(muted.canComment).toBe(false);
    expect(muted.canReport).toBe(true);
  });

  it('an expired mute is not a mute', () => {
    const now = Date.parse('2026-09-07T12:00:00Z');
    expect(
      boardPostRules('member', { ...base, mutedUntil: '2026-09-06T12:00:00Z', now }).canComment,
    ).toBe(true);
  });

  it('nobody reports their own post', () => {
    expect(boardPostRules('member', { ...base, viewerId: AUTHOR }).canReport).toBe(false);
    expect(boardPostRules('member', base).canReport).toBe(true);
  });

  it('a signed-out viewer gets nothing', () => {
    const none = boardPostRules('owner', { ...base, viewerId: '' });
    expect(Object.values(none).every((v) => v === false)).toBe(true);
  });

  /**
   * THE PLATFORM-ADMIN COLUMN. An auto-derived campus room has no owner and no
   * appointed moderators, so the only person who can ever take a post down in
   * it is a platform admin. The server grants exactly that and no more
   * (`communityModeration.removePost` credits `actor.isPlatformAdmin`;
   * `setMessagePin` does not), so this matrix has to grant exactly that too —
   * a wider column here is a button that 403s.
   */
  it('a platform admin with no community role removes anyone’s post', () => {
    const admin = boardPostRules(null, { ...base, isPlatformAdmin: true });
    expect(admin.canRemove).toBe(true);
    expect(boardPostRules(null, base).canRemove).toBe(false);
    expect(boardPostRules('member', { ...base, isPlatformAdmin: true }).canRemove).toBe(true);
  });

  it('a platform admin does NOT gain pin — the pin endpoint does not credit them', () => {
    const admin = boardPostRules(null, { ...base, isPlatformAdmin: true });
    expect(admin.canPin).toBe(false);
    expect(admin.canUnpin).toBe(false);
    expect(
      boardPostRules(null, { ...base, isPlatformAdmin: true, pinnedAt: '2026-09-07T00:00:00Z' })
        .canUnpin,
    ).toBe(false);
  });

  it('a platform admin cannot remove an already-removed post, or report their own', () => {
    expect(
      boardPostRules(null, { ...base, isPlatformAdmin: true, removedAt: '2026-09-07T00:00:00Z' })
        .canRemove,
    ).toBe(false);
    expect(
      boardPostRules(null, { ...base, isPlatformAdmin: true, viewerId: AUTHOR }).canReport,
    ).toBe(false);
  });

  it('being a platform admin does not lift a mute — muting is not a role check', () => {
    const now = Date.parse('2026-09-07T12:00:00Z');
    expect(
      boardPostRules(null, {
        ...base,
        isPlatformAdmin: true,
        mutedUntil: '2026-09-08T12:00:00Z',
        now,
      }).canComment,
    ).toBe(false);
  });

  it('an explicit false or a missing flag is not a platform admin', () => {
    expect(boardPostRules(null, { ...base, isPlatformAdmin: false }).canRemove).toBe(false);
    expect(boardPostRules(null, { ...base, isPlatformAdmin: null }).canRemove).toBe(false);
  });
});

describe('canPostOnBoard', () => {
  it('refuses a non-member, a muted member and a restricted kind, with distinct reasons', () => {
    const now = Date.parse('2026-09-07T12:00:00Z');
    expect(canPostOnBoard({ isMember: false, role: 'member' })).toEqual({
      ok: false,
      reason: 'not_member',
    });
    expect(
      canPostOnBoard({ isMember: true, role: 'member', mutedUntil: '2026-09-08T00:00:00Z', now }),
    ).toEqual({ ok: false, reason: 'muted' });
    expect(canPostOnBoard({ isMember: true, role: 'member', postKind: 'announcement' })).toEqual({
      ok: false,
      reason: 'restricted_kind',
    });
    expect(canPostOnBoard({ isMember: true, role: 'moderator', postKind: 'announcement' })).toEqual({
      ok: true,
    });
    expect(canPostOnBoard({ isMember: true, role: 'member' })).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Roles and mutes
// ---------------------------------------------------------------------------

describe('canAssignCommunityRole', () => {
  it('is owner-only — an admin cannot mint admins', () => {
    expect(
      canAssignCommunityRole({ actorRole: 'owner', actorId: 'a', targetId: 'b', targetRole: 'member' }),
    ).toEqual({ ok: true });
    expect(
      canAssignCommunityRole({ actorRole: 'admin', actorId: 'a', targetId: 'b', targetRole: 'member' }),
    ).toEqual({ ok: false, reason: 'forbidden' });
    expect(
      canAssignCommunityRole({ actorRole: 'moderator', actorId: 'a', targetId: 'b', targetRole: 'member' }),
    ).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('a platform admin can act where an auto-derived community has no owner', () => {
    expect(
      canAssignCommunityRole({
        actorRole: null,
        actorId: 'admin',
        targetId: 'b',
        targetRole: 'member',
        isPlatformAdmin: true,
      }),
    ).toEqual({ ok: true });
  });

  it('never targets yourself or the owner', () => {
    expect(
      canAssignCommunityRole({ actorRole: 'owner', actorId: 'a', targetId: 'a', targetRole: 'owner' }),
    ).toEqual({ ok: false, reason: 'self' });
    expect(
      canAssignCommunityRole({
        actorRole: 'owner',
        actorId: 'a',
        targetId: 'b',
        targetRole: 'owner',
        isPlatformAdmin: true,
      }),
    ).toEqual({ ok: false, reason: 'owner_target' });
  });

  it('offers exactly admin/moderator/member', () => {
    expect(ASSIGNABLE_COMMUNITY_ROLES).toEqual(['admin', 'moderator', 'member']);
  });
});

describe('canModerateCommunityMember', () => {
  it('a moderator acts on members below them, never on a peer', () => {
    expect(
      canModerateCommunityMember({ actorRole: 'moderator', actorId: 'a', targetId: 'b', targetRole: 'member' }),
    ).toEqual({ ok: true });
    expect(
      canModerateCommunityMember({ actorRole: 'moderator', actorId: 'a', targetId: 'b', targetRole: 'moderator' }),
    ).toEqual({ ok: false, reason: 'peer' });
    expect(
      canModerateCommunityMember({ actorRole: 'admin', actorId: 'a', targetId: 'b', targetRole: 'moderator' }),
    ).toEqual({ ok: true });
    expect(
      canModerateCommunityMember({ actorRole: 'admin', actorId: 'a', targetId: 'b', targetRole: 'owner' }),
    ).toEqual({ ok: false, reason: 'peer' });
  });

  it('a plain member moderates nobody, and nobody moderates themselves', () => {
    expect(
      canModerateCommunityMember({ actorRole: 'member', actorId: 'a', targetId: 'b', targetRole: 'member' }),
    ).toEqual({ ok: false, reason: 'forbidden' });
    expect(
      canModerateCommunityMember({ actorRole: 'owner', actorId: 'a', targetId: 'a', targetRole: 'owner' }),
    ).toEqual({ ok: false, reason: 'self' });
  });

  /**
   * THE PLATFORM-ADMIN COLUMN, same rule the API applies in
   * `communityModeration.muteMember`: an auto-derived campus room has no owner,
   * so without this nobody could ever mute in one.
   */
  it('a platform admin moderates anyone, in a room where they hold no role at all', () => {
    for (const targetRole of ['member', 'moderator', 'admin', 'owner'] as CommunityRole[]) {
      expect(
        canModerateCommunityMember({
          actorRole: null,
          actorId: 'a',
          targetId: 'b',
          targetRole,
          isPlatformAdmin: true,
        }),
      ).toEqual({ ok: true });
    }
  });

  it('a platform admin still does not moderate themselves', () => {
    expect(
      canModerateCommunityMember({
        actorRole: null,
        actorId: 'a',
        targetId: 'a',
        targetRole: 'member',
        isPlatformAdmin: true,
      }),
    ).toEqual({ ok: false, reason: 'self' });
  });

  it('an explicit false is not a platform admin', () => {
    expect(
      canModerateCommunityMember({
        actorRole: null,
        actorId: 'a',
        targetId: 'b',
        targetRole: 'member',
        isPlatformAdmin: false,
      }),
    ).toEqual({ ok: false, reason: 'forbidden' });
  });
});

describe('mutes', () => {
  const NOW = Date.parse('2026-09-07T12:00:00Z');

  it('resolves only the four offered durations', () => {
    expect(resolveMuteUntil('1h', NOW)).toBe(new Date(NOW + 3600_000).toISOString());
    expect(resolveMuteUntil('24h', NOW)).toBe(new Date(NOW + 86_400_000).toISOString());
    expect(resolveMuteUntil('7d', NOW)).toBe(new Date(NOW + 7 * 86_400_000).toISOString());
    expect(resolveMuteUntil('30d', NOW)).toBe(new Date(NOW + 30 * 86_400_000).toISOString());
  });

  it('treats anything else as unmute rather than as a permanent mute', () => {
    expect(resolveMuteUntil('forever', NOW)).toBeNull();
    expect(resolveMuteUntil(null, NOW)).toBeNull();
    expect(resolveMuteUntil(999_999, NOW)).toBeNull();
  });

  it('expires', () => {
    expect(isCommunityMemberMuted('2026-09-07T12:00:01Z', NOW)).toBe(true);
    expect(isCommunityMemberMuted('2026-09-07T12:00:00Z', NOW)).toBe(false);
    expect(isCommunityMemberMuted('2026-09-07T11:59:59Z', NOW)).toBe(false);
    expect(isCommunityMemberMuted(null, NOW)).toBe(false);
    expect(isCommunityMemberMuted('not-a-date', NOW)).toBe(false);
  });

  it('labels the remaining time, or nothing once expired', () => {
    expect(muteRemainingLabel('2026-09-07T12:30:00Z', NOW)).toBe('Muted for under an hour');
    expect(muteRemainingLabel('2026-09-08T12:00:00Z', NOW)).toBe('Muted for 24 hours');
    expect(muteRemainingLabel('2026-09-14T12:00:00Z', NOW)).toBe('Muted for 7 days');
    expect(muteRemainingLabel('2026-09-06T12:00:00Z', NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

describe('invite codes', () => {
  const NOW = Date.parse('2026-09-07T12:00:00Z');

  it('normalizes a code a human typed off a phone screen', () => {
    expect(normalizeInviteCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(normalizeInviteCode('ABCD2345')).toBe('ABCD2345');
  });

  it('refuses ambiguous glyphs and wrong lengths, so a guess never becomes a query', () => {
    expect(normalizeInviteCode('ABCD234')).toBeNull();
    expect(normalizeInviteCode('ABCD23456')).toBeNull();
    expect(normalizeInviteCode('ABCD2340')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeInviteCode('ABCDI345')).toBeNull(); // I is not in the alphabet
    expect(normalizeInviteCode(12345678 as never)).toBeNull();
    expect(normalizeInviteCode(null)).toBeNull();
  });

  it('keeps the code length and the alphabet in step', () => {
    expect(COMMUNITY_INVITE_CODE_LENGTH).toBe(8);
    expect(normalizeInviteCode('A'.repeat(COMMUNITY_INVITE_CODE_LENGTH))).toBe(
      'A'.repeat(COMMUNITY_INVITE_CODE_LENGTH),
    );
  });

  it('refuses an expired, exhausted, revoked or unknown invite', () => {
    const live = { expiresAt: '2026-09-08T12:00:00Z', maxUses: 10, uses: 3, revokedAt: null };
    expect(inviteRefusal(live, NOW)).toBeNull();
    expect(inviteRefusal({ ...live, expiresAt: '2026-09-07T12:00:00Z' }, NOW)).toBe('expired');
    expect(inviteRefusal({ ...live, uses: 10 }, NOW)).toBe('exhausted');
    expect(inviteRefusal({ ...live, uses: 11 }, NOW)).toBe('exhausted');
    expect(inviteRefusal({ ...live, revokedAt: '2026-09-07T00:00:00Z' }, NOW)).toBe('revoked');
    expect(inviteRefusal(null, NOW)).toBe('unknown');
  });

  it('treats a null cap and a null expiry as unlimited', () => {
    expect(inviteRefusal({ expiresAt: null, maxUses: null, uses: 9999 }, NOW)).toBeNull();
  });

  it('clamps expiry and uses to their ceilings', () => {
    expect(resolveInviteExpiry(365 * 86_400_000, NOW)).toBe(
      new Date(NOW + COMMUNITY_INVITE_TTL_MS_MAX).toISOString(),
    );
    expect(resolveInviteExpiry(-1, NOW)).toBe(
      new Date(NOW + 7 * 86_400_000).toISOString(),
    );
    expect(resolveInviteMaxUses(1_000_000)).toBe(COMMUNITY_INVITE_MAX_USES_LIMIT);
    expect(resolveInviteMaxUses(0)).toBe(COMMUNITY_INVITE_MAX_USES_DEFAULT);
    expect(resolveInviteMaxUses(12)).toBe(12);
  });

  it('bounds live invites per community', () => {
    expect(COMMUNITY_INVITE_ACTIVE_MAX).toBe(5);
  });

  it('mints an absolute link, so a code copied inside the Android app opens the website', () => {
    expect(communityInviteUrl('ABCD2345')).toBe('https://lanternstudy.com/join/ABCD2345');
  });
});

// ---------------------------------------------------------------------------
// Discovery ranking + search
// ---------------------------------------------------------------------------

describe('discovery ranking', () => {
  const NOW = Date.parse('2026-09-07T12:00:00Z');
  const row = (over: Partial<Parameters<typeof compareDiscoverCommunities>[0]>) => ({
    id: 'x',
    kind: 'club',
    institution_id: null,
    member_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  });

  it('puts own campus first, whatever the member counts say', () => {
    const mine = row({ id: 'mine', institution_id: 'inst-1', member_count: 2 });
    const huge = row({ id: 'huge', institution_id: 'inst-2', member_count: 9999 });
    expect(rankDiscoverCommunities([huge, mine], { institutionId: 'inst-1', now: NOW }).map((r) => r.id)).toEqual([
      'mine',
      'huge',
    ]);
  });

  it('then member count, then newest', () => {
    const big = row({ id: 'big', member_count: 50 });
    const small = row({ id: 'small', member_count: 5 });
    const smallNewer = row({
      id: 'smallNewer',
      member_count: 5,
      created_at: '2026-06-01T00:00:00Z',
    });
    expect(
      rankDiscoverCommunities([small, smallNewer, big], { now: NOW }).map((r) => r.id),
    ).toEqual(['big', 'smallNewer', 'small']);
  });

  it('sorts events soonest-first, with past events last', () => {
    const soon = row({ id: 'soon', kind: 'event', starts_at: '2026-09-08T00:00:00Z', member_count: 1 });
    const later = row({ id: 'later', kind: 'event', starts_at: '2026-10-01T00:00:00Z', member_count: 900 });
    const past = row({ id: 'past', kind: 'event', starts_at: '2026-01-01T00:00:00Z', member_count: 900 });
    expect(
      rankDiscoverCommunities([past, later, soon], { now: NOW }).map((r) => r.id),
    ).toEqual(['soon', 'later', 'past']);
  });

  it('does not mutate its input', () => {
    const rows = [row({ id: 'a', member_count: 1 }), row({ id: 'b', member_count: 2 })];
    const before = rows.map((r) => r.id);
    rankDiscoverCommunities(rows, { now: NOW });
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('normalizeCommunitySearch', () => {
  it('strips PostgREST wildcards and filter terminators', () => {
    expect(normalizeCommunitySearch('%')).toBeNull();
    expect(normalizeCommunitySearch('law_soc')).toBe('law soc');
    expect(normalizeCommunitySearch('a,b.c()')).toBe('a b c');
  });

  it('needs two characters and caps the length', () => {
    expect(normalizeCommunitySearch('a')).toBeNull();
    expect(normalizeCommunitySearch('  ')).toBeNull();
    expect(normalizeCommunitySearch(null)).toBeNull();
    expect(normalizeCommunitySearch('x'.repeat(200))!.length).toBe(60);
  });
});

describe('canPostOnBoard platform admin', () => {
  it('lets a platform admin post in a room they never joined, as the server does', () => {
    expect(canPostOnBoard({ isMember: false, isPlatformAdmin: true })).toEqual({ ok: true });
    expect(canPostOnBoard({ isMember: false })).toEqual({ ok: false, reason: 'not_member' });
  });
});

describe('seedMuteState', () => {
  it('takes the roster value where the roster carries one and keeps the rest', () => {
    const prev = { a: '2030-01-01T00:00:00Z', b: null };
    const next = seedMuteState(prev, [
      { id: 'a', mutedUntil: null },
      { id: 'b' },
      { id: 'c', mutedUntil: '2031-01-01T00:00:00Z' },
    ]);
    expect(next).toEqual({ a: null, b: null, c: '2031-01-01T00:00:00Z' });
  });

  it('returns the same object when the roster carries no mute field', () => {
    const prev = { a: null };
    expect(seedMuteState(prev, [{ id: 'a' }, { id: 'b' }])).toBe(prev);
  });
});
