import { describe, expect, it } from 'vitest';
import { COMMUNITY_NOT_ENABLED_COPY } from '@lantern/shared/api';
import {
  canMintInvite,
  communityManageCapabilities,
  describeInvite,
  hasCommunityManagePowers,
  INVITE_ACTIVE_MAX,
  manageCommunityErrorCopy,
  memberActionPlan,
} from './manageCommunity';

const OWNER = 'owner-id';
const MEMBER = 'member-id';
const NOW = Date.parse('2026-09-07T12:00:00.000Z');

const viewer = (over: Partial<{ userId: string; role: any; isPlatformAdmin: boolean }> = {}) => ({
  userId: OWNER,
  role: 'owner' as const,
  ...over,
});

describe('communityManageCapabilities', () => {
  it('gives an owner roles, mutes and invite links', () => {
    const caps = communityManageCapabilities({ viewer: viewer(), isMember: true });
    expect(caps).toMatchObject({
      canManageRoles: true,
      canModerate: true,
      canInvite: true,
      canPin: true,
    });
    expect(hasCommunityManagePowers(caps)).toBe(true);
  });

  it('lets a moderator moderate but never hand out roles', () => {
    const caps = communityManageCapabilities({
      viewer: viewer({ role: 'moderator' }),
      isMember: true,
    });
    expect(caps.canManageRoles).toBe(false);
    expect(caps.canModerate).toBe(true);
    expect(caps.canInvite).toBe(true);
  });

  it('gives a plain member nothing, so the panel never mounts', () => {
    const caps = communityManageCapabilities({ viewer: viewer({ role: 'member' }), isMember: true });
    expect(hasCommunityManagePowers(caps)).toBe(false);
  });

  it('gives a platform admin the auto-derived campus room it is the only moderation for', () => {
    const caps = communityManageCapabilities({
      viewer: viewer({ role: null, isPlatformAdmin: true }),
      isMember: true,
    });
    expect(caps.canManageRoles).toBe(true);
    expect(caps.canModerate).toBe(true);
  });

  it('never offers invite links to somebody who is not in the room', () => {
    expect(
      communityManageCapabilities({ viewer: viewer(), isMember: false }).canInvite,
    ).toBe(false);
  });
});

describe('memberActionPlan', () => {
  it('offers demotion as well as promotion — a mis-click must be undoable', () => {
    const plan = memberActionPlan({
      viewer: viewer(),
      member: { id: MEMBER, role: 'moderator' },
      now: NOW,
    });
    expect(plan.canChangeRole).toBe(true);
    expect(plan.roleOptions).toEqual(['admin', 'moderator', 'member']);
  });

  it('refuses the viewer acting on themselves', () => {
    const plan = memberActionPlan({
      viewer: viewer(),
      member: { id: OWNER, role: 'owner' },
      now: NOW,
    });
    expect(plan.canChangeRole).toBe(false);
    expect(plan.canMute).toBe(false);
    expect(plan.refusal).toBe('You cannot moderate yourself');
  });

  it('refuses a moderator acting on a peer', () => {
    const plan = memberActionPlan({
      viewer: viewer({ userId: 'mod-a', role: 'moderator' }),
      member: { id: 'mod-b', role: 'moderator' },
      now: NOW,
    });
    expect(plan.canMute).toBe(false);
    expect(plan.refusal).toBe('You cannot moderate a moderator at or above your level');
  });

  it('swaps Mute for Unmute while a mute is live, and back once it lapses', () => {
    const live = new Date(NOW + 60 * 60 * 1000).toISOString();
    const lapsed = new Date(NOW - 1000).toISOString();
    const base = { viewer: viewer(), member: { id: MEMBER, role: 'member' as const }, now: NOW };

    const muted = memberActionPlan({ ...base, mutedUntil: live });
    expect(muted.muted).toBe(true);
    expect(muted.canUnmute).toBe(true);
    expect(muted.canMute).toBe(false);
    expect(muted.muteLabel).toBe('Muted for under an hour');

    const clear = memberActionPlan({ ...base, mutedUntil: lapsed });
    expect(clear.muted).toBe(false);
    expect(clear.canMute).toBe(true);
    expect(clear.muteLabel).toBeNull();
  });
});

describe('describeInvite', () => {
  const invite = (over: Partial<Record<string, any>> = {}) => ({
    code: 'ABCD2345',
    expiresAt: new Date(NOW + 3 * 24 * 60 * 60 * 1000).toISOString(),
    maxUses: 25,
    uses: 4,
    createdAt: new Date(NOW).toISOString(),
    createdBy: OWNER,
    ...over,
  });

  it('builds the pasteable link and counts the uses left', () => {
    const view = describeInvite(invite(), { now: NOW });
    expect(view.url).toBe('https://lanternstudy.com/join/ABCD2345');
    expect(view.usesLabel).toBe('4 of 25 used');
    expect(view.expiryLabel).toBe('Expires in 3 days');
    expect(view.dead).toBe(false);
  });

  it('marks a spent link dead so a moderator knows to revoke it', () => {
    expect(describeInvite(invite({ uses: 25 }), { now: NOW })).toMatchObject({
      dead: true,
      expiryLabel: 'All uses taken',
    });
    expect(
      describeInvite(invite({ expiresAt: new Date(NOW - 1000).toISOString() }), { now: NOW }),
    ).toMatchObject({ dead: true, expiryLabel: 'Expired' });
  });

  it('stops at the live-link ceiling', () => {
    expect(canMintInvite(INVITE_ACTIVE_MAX - 1)).toBe(true);
    expect(canMintInvite(INVITE_ACTIVE_MAX)).toBe(false);
  });
});

describe('manageCommunityErrorCopy', () => {
  it('says the campus line for a pre-migration 503, not the server wording', () => {
    const notEnabled = Object.assign(new Error('community_invites missing'), {
      code: 'NOT_ENABLED' as const,
      status: 503,
      notEnabled: true as const,
    });
    expect(manageCommunityErrorCopy(notEnabled, 'fallback')).toBe(COMMUNITY_NOT_ENABLED_COPY);
  });

  it('keeps a real failure’s own message, and falls back when it has none', () => {
    expect(manageCommunityErrorCopy(new Error('Only the owner can do that'), 'fallback')).toBe(
      'Only the owner can do that',
    );
    expect(manageCommunityErrorCopy(new Error('   '), 'fallback')).toBe('fallback');
    expect(manageCommunityErrorCopy(null, 'fallback')).toBe('fallback');
  });
});
