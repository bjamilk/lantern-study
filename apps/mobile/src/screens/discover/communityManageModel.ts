/**
 * Manage this community — the pure part.
 *
 * Who may open the screen, which actions each member row offers, and the words
 * an invite is shared with. Every permission answer comes from
 * `@lantern/shared/network` (communityGovernance.ts): `canAssignCommunityRole`
 * for roles, `canModerateCommunityMember` for mutes. Nothing here compares a
 * role itself, and the API re-decides both from the same helpers — a row this
 * file hides is a request the server refuses.
 *
 * WHAT THE SCREEN CANNOT KNOW, AND WHY IT DOES NOT PRETEND
 * -------------------------------------------------------
 * The roster (`GET /communities/:id/members`) does not carry
 * `community_members.muted_until` — it selects `user_id, source, role,
 * joined_at, profiles(...)` and nothing else. So a manage screen cannot tell
 * whether a member is muted RIGHT NOW; it only knows the mutes it has just
 * applied itself. `memberMuteLabel` therefore answers null unless this session
 * has an answer from the server, and the row never claims someone is unmuted.
 * Unmute stays offered for the same reason: on a member who is not muted the
 * server simply clears an empty field.
 */
import {
  COMMUNITY_MUTE_DURATIONS,
  canAssignCommunityRole,
  canModerateCommunityMember,
  communityInviteUrl,
  isCommunityMemberMuted,
  muteRemainingLabel,
  type AssignableCommunityRole,
  type CommunityMuteDurationId,
  type CommunityRole,
} from '@lantern/shared/network';

export interface ManageViewer {
  id: string;
  role?: CommunityRole | null;
  isPlatformAdmin?: boolean;
}

export interface ManageAccess {
  /** May the Manage entry be drawn at all? */
  canManage: boolean;
  /** Owner (or platform admin) only — the Role rows. */
  canAssignRoles: boolean;
  /** Owner / admin / moderator — mutes, removals, invites. */
  canModerate: boolean;
}

/**
 * The manage-screen visibility matrix.
 *
 * The two capabilities are asked about a HYPOTHETICAL plain member, which is
 * exactly what the screen is for: an owner may change roles, every moderating
 * role may mute and invite, and a member sees no entry at all. Each row is
 * re-asked per target before it is drawn (`memberActions` below), so this is
 * only the door, never the decision.
 */
export function resolveManageAccess(viewer: ManageViewer): ManageAccess {
  const probe = {
    actorRole: viewer.role ?? null,
    actorId: viewer.id,
    targetId: `${viewer.id}:probe`,
    targetRole: 'member' as CommunityRole,
    ...(viewer.isPlatformAdmin ? { isPlatformAdmin: true } : {}),
  };
  const canAssignRoles = canAssignCommunityRole(probe).ok;
  const canModerate = canModerateCommunityMember(probe).ok;
  return { canManage: canAssignRoles || canModerate, canAssignRoles, canModerate };
}

export interface ManageTarget {
  id: string;
  role?: CommunityRole | null;
  /** What the server last said about this member's mute, if anything. */
  mutedUntil?: string | null;
}

export interface MemberActions {
  /** The roles this actor may move the target to (never their current one). */
  roles: AssignableCommunityRole[];
  canMute: boolean;
  canUnmute: boolean;
  /** Reporting is open to every member — a report is not moderation. */
  canReport: boolean;
  /** Why the moderation rows are absent, for a screen that wants to say so. */
  refusal: 'self' | 'peer' | 'owner_target' | 'forbidden' | null;
}

const ASSIGNABLE: readonly AssignableCommunityRole[] = ['admin', 'moderator', 'member'];

/**
 * One roster row's actions.
 *
 * Self is excluded by the shared rules (a moderator cannot moderate
 * themselves), so the viewer's own row shows nothing but the report-less
 * silence it should: you cannot report yourself either.
 */
export function memberActions(viewer: ManageViewer, target: ManageTarget): MemberActions {
  const input = {
    actorRole: viewer.role ?? null,
    actorId: viewer.id,
    targetId: target.id,
    targetRole: target.role ?? 'member',
    ...(viewer.isPlatformAdmin ? { isPlatformAdmin: true } : {}),
  };
  const roleVerdict = canAssignCommunityRole(input);
  const moderateVerdict = canModerateCommunityMember(input);
  const isSelf = viewer.id === target.id;

  return {
    roles: roleVerdict.ok
      ? ASSIGNABLE.filter((role) => role !== (target.role ?? 'member'))
      : [],
    canMute: moderateVerdict.ok,
    canUnmute: moderateVerdict.ok,
    canReport: !isSelf,
    refusal: moderateVerdict.ok ? null : moderateVerdict.reason,
  };
}

/** "Muted for 6 hours", or null when this session has no answer. */
export function memberMuteLabel(
  mutedUntil: string | null | undefined,
  now: number = Date.now()
): string | null {
  return muteRemainingLabel(mutedUntil, now);
}

export function isMemberMuted(
  mutedUntil: string | null | undefined,
  now: number = Date.now()
): boolean {
  return isCommunityMemberMuted(mutedUntil, now);
}

export const MUTE_DURATIONS = COMMUNITY_MUTE_DURATIONS;

export function muteDurationLabel(id: CommunityMuteDurationId): string {
  return COMMUNITY_MUTE_DURATIONS.find((d) => d.id === id)?.label ?? id;
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export interface InviteRow {
  code: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
}

/**
 * The message a student pastes into WhatsApp: the community's name, then the
 * link, then the code on its own line so someone who cannot open a link can
 * still type it into "Join with a code".
 *
 * The link is `communityInviteUrl` — one absolute URL minted in shared, so the
 * phone and the web app never send two different links for one code.
 */
export function inviteShareText(communityName: string, code: string): string {
  const name = (communityName || '').trim() || 'a Lantern community';
  return [
    `Join ${name} on Lantern:`,
    communityInviteUrl(code),
    `Or open Lantern and use the code ${code}.`,
  ].join('\n');
}

export { communityInviteUrl };

/** "12 of 25 used · expires 12 Sep" — what one invite row says under its code. */
export function inviteSummaryLine(
  invite: InviteRow,
  now: number = Date.now()
): string {
  const parts: string[] = [];
  if (typeof invite.maxUses === 'number' && invite.maxUses > 0) {
    parts.push(`${invite.uses} of ${invite.maxUses} used`);
  } else {
    parts.push(invite.uses === 1 ? '1 use' : `${invite.uses} uses`);
  }
  const expiry = invite.expiresAt ? Date.parse(invite.expiresAt) : NaN;
  if (Number.isFinite(expiry)) {
    if (expiry <= now) {
      // Expired links are never returned by the API, but a list held on screen
      // while the clock passes must not keep advertising a dead link.
      parts.push('expired');
    } else {
      const hours = Math.ceil((expiry - now) / (60 * 60 * 1000));
      parts.push(
        hours <= 1
          ? 'expires within the hour'
          : hours < 48
            ? `expires in ${hours} hours`
            : `expires in ${Math.ceil(hours / 24)} days`
      );
    }
  }
  return parts.join(' · ');
}

/** Live invite links a community may hold — the API answers 409 past this. */
export { COMMUNITY_INVITE_ACTIVE_MAX } from '@lantern/shared/network';

export const MANAGE_COPY = {
  title: 'Manage community',
  membersTab: 'Members',
  invitesTab: 'Invites',
  roleSection: 'Role',
  muteSection: 'Mute',
  unmute: 'Unmute',
  report: 'Report member',
  /** Said where a mute state cannot be known — see the file header. */
  muteStateUnknown: 'Mute state shows here after you change it',
  inviteCreate: 'Create an invite link',
  inviteEmpty: 'No invite links yet. Create one to bring people in.',
  inviteRevoke: 'Revoke',
  inviteShare: 'Share',
  inviteCopied: 'Invite code copied',
  inviteAtMax: 'This community already has the most invite links it can hold. Revoke one first.',
  removedPostsUnavailable:
    'Removed posts are shown on the board itself — there is no server list of them yet.',
} as const;
