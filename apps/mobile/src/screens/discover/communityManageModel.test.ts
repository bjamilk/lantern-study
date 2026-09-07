import {
  inviteShareText,
  inviteSummaryLine,
  isMemberMuted,
  memberActions,
  memberMuteLabel,
  resolveManageAccess,
} from './communityManageModel';

const NOW = Date.parse('2026-09-08T12:00:00.000Z');
const OWNER = { id: 'owner-1', role: 'owner' as const };
const ADMIN = { id: 'admin-1', role: 'admin' as const };
const MODERATOR = { id: 'mod-1', role: 'moderator' as const };
const MEMBER = { id: 'member-1', role: 'member' as const };

describe('resolveManageAccess — the visibility matrix', () => {
  it('gives the owner both halves', () => {
    expect(resolveManageAccess(OWNER)).toEqual({
      canManage: true,
      canAssignRoles: true,
      canModerate: true,
    });
  });

  it.each([ADMIN, MODERATOR])('gives %o moderation but never roles', (viewer) => {
    const access = resolveManageAccess(viewer);
    expect(access.canManage).toBe(true);
    expect(access.canModerate).toBe(true);
    expect(access.canAssignRoles).toBe(false);
  });

  it('shows a plain member no entry at all', () => {
    expect(resolveManageAccess(MEMBER)).toEqual({
      canManage: false,
      canAssignRoles: false,
      canModerate: false,
    });
  });

  it('shows a non-member no entry', () => {
    expect(resolveManageAccess({ id: 'guest', role: null }).canManage).toBe(false);
  });

  it('gives a platform admin both halves in an auto campus room with no owner', () => {
    const access = resolveManageAccess({ id: 'staff', role: null, isPlatformAdmin: true });
    expect(access).toEqual({ canManage: true, canAssignRoles: true, canModerate: true });
  });
});

describe('memberActions', () => {
  it('lets the owner move a member to any other assignable role', () => {
    expect(memberActions(OWNER, { id: 'member-1', role: 'member' }).roles).toEqual([
      'admin',
      'moderator',
    ]);
    expect(memberActions(OWNER, { id: 'x', role: 'admin' }).roles).toEqual([
      'moderator',
      'member',
    ]);
  });

  it('never lets an admin mint roles — that would be a second owner', () => {
    const actions = memberActions(ADMIN, { id: 'member-1', role: 'member' });
    expect(actions.roles).toEqual([]);
    expect(actions.canMute).toBe(true);
  });

  it('refuses a peer and says which rule refused', () => {
    const actions = memberActions(MODERATOR, { id: 'mod-2', role: 'moderator' });
    expect(actions.canMute).toBe(false);
    expect(actions.refusal).toBe('peer');
  });

  it('refuses the viewer’s own row, and offers no self-report', () => {
    const actions = memberActions(MODERATOR, { id: MODERATOR.id, role: 'moderator' });
    expect(actions.canMute).toBe(false);
    expect(actions.refusal).toBe('self');
    expect(actions.canReport).toBe(false);
  });

  it('never offers the owner’s row a role change', () => {
    expect(memberActions(OWNER, { id: 'someone', role: 'owner' }).roles).toEqual([]);
  });

  it('gives a plain member nothing but Report', () => {
    const actions = memberActions(MEMBER, { id: 'other', role: 'member' });
    expect(actions.roles).toEqual([]);
    expect(actions.canMute).toBe(false);
    expect(actions.canReport).toBe(true);
    expect(actions.refusal).toBe('forbidden');
  });

  it('offers Unmute wherever Mute is offered — the roster cannot report mute state', () => {
    const actions = memberActions(ADMIN, { id: 'member-1', role: 'member' });
    expect(actions.canUnmute).toBe(actions.canMute);
  });
});

describe('mute labels', () => {
  it('says nothing when this session has no answer from the server', () => {
    expect(memberMuteLabel(null, NOW)).toBeNull();
    expect(memberMuteLabel(undefined, NOW)).toBeNull();
    expect(isMemberMuted(null, NOW)).toBe(false);
  });

  it('reports a live mute in hours and days', () => {
    expect(memberMuteLabel('2026-09-08T18:00:00.000Z', NOW)).toBe('Muted for 6 hours');
    expect(memberMuteLabel('2026-09-15T12:00:00.000Z', NOW)).toBe('Muted for 7 days');
  });

  it('an expired mute is not a mute', () => {
    expect(memberMuteLabel('2026-09-08T06:00:00.000Z', NOW)).toBeNull();
    expect(isMemberMuted('2026-09-08T06:00:00.000Z', NOW)).toBe(false);
  });
});

describe('inviteShareText', () => {
  it('carries the name, the link and the typed code', () => {
    const text = inviteShareText('Pharmacology 300', 'ABCD2345');
    expect(text).toContain('Join Pharmacology 300 on Lantern:');
    expect(text).toContain('https://lanternstudy.com/join/ABCD2345');
    expect(text).toContain('use the code ABCD2345');
  });

  it('degrades without a name rather than shipping "Join  on Lantern"', () => {
    expect(inviteShareText('  ', 'ABCD2345')).toContain('Join a Lantern community on Lantern:');
  });
});

describe('inviteSummaryLine', () => {
  const base = { code: 'ABCD2345', maxUses: 25, uses: 12 };

  it('counts uses against the cap and says when it expires', () => {
    expect(
      inviteSummaryLine({ ...base, expiresAt: '2026-09-12T12:00:00.000Z' }, NOW)
    ).toBe('12 of 25 used · expires in 4 days');
  });

  it('handles an uncapped link and one that has just run out of time', () => {
    expect(inviteSummaryLine({ ...base, maxUses: null, uses: 1, expiresAt: null }, NOW)).toBe(
      '1 use'
    );
    expect(
      inviteSummaryLine({ ...base, expiresAt: '2026-09-08T11:00:00.000Z' }, NOW)
    ).toBe('12 of 25 used · expired');
  });

  it('rounds the last hour up rather than saying "expires in 0 hours"', () => {
    expect(
      inviteSummaryLine({ ...base, expiresAt: '2026-09-08T12:30:00.000Z' }, NOW)
    ).toBe('12 of 25 used · expires within the hour');
  });
});
