import {
  COMMUNITY_INVITE_ACTIVE_MAX,
  COMMUNITY_INVITE_MAX_USES_DEFAULT,
  COMMUNITY_MODERATION_COPY,
  COMMUNITY_MUTE_DURATIONS,
  COMMUNITY_MUTE_REASON_MAX,
  canAssignCommunityRole,
  canModerateCommunityMember,
  communityInviteUrl,
  communityRoleLabel,
  inviteRefusal,
  isCommunityMemberMuted,
  muteRemainingLabel,
  type AssignableCommunityRole,
  type CommunityMuteDurationId,
  type CommunityRole,
} from '@lantern/shared/network';
import {
  COMMUNITY_NOT_ENABLED_COPY,
  isNotEnabledError,
  type CommunityInviteSummary,
} from '@lantern/shared/api';

/**
 * Manage a community — the pure part.
 *
 * Every decision here comes from `@lantern/shared/network`
 * (communityGovernance.ts): `canAssignCommunityRole` for who may promote,
 * `canModerateCommunityMember` for who may mute, `isCommunityMemberMuted` and
 * `inviteRefusal` for what a row currently is. There is NO local role check in
 * this file and there must never be one — the API re-decides every one of
 * these from the same helpers, so a rule invented here would only produce a
 * button that 403s.
 *
 * This module replaces the old capability table, which hard-coded
 * `canManageMembers: false` / `canRemoveOthersPosts: false` because no
 * endpoint existed. They exist now (Wave 8): roles, mutes, soft post removal
 * and invite codes. The panel shows the real ones and says out loud when the
 * migration behind mutes and invites has not been applied yet — a 503 reads as
 * "Not switched on for this campus yet", never as a raw error.
 */

/** The signed-in moderator, as every planner here wants them. */
export interface CommunityManageViewer {
  userId: string;
  role: CommunityRole | null | undefined;
  isPlatformAdmin?: boolean;
}

export interface CommunityManageCapabilities {
  /** Promote or demote a member. Owner (or a platform admin) only. */
  canManageRoles: boolean;
  /** Mute a member, and remove somebody else's post. */
  canModerate: boolean;
  /** Mint, list and revoke invite links. */
  canInvite: boolean;
  /** Pin a post to the top of a board. */
  canPin: boolean;
  /** Create boards and start study groups / rooms. Every member can. */
  canCreateBoards: boolean;
}

/**
 * A probe target: "could this viewer act on an ordinary member at all?".
 *
 * The shared rules are per-target by design (you cannot moderate a peer), so
 * the panel's top-level capabilities are the same rules asked about a plain
 * member who is not the viewer. That keeps ONE implementation of the rule.
 */
const PROBE_TARGET_ID = '__probe__';

export function communityManageCapabilities(input: {
  viewer: CommunityManageViewer;
  isMember: boolean;
  visibility?: 'public' | 'private';
}): CommunityManageCapabilities {
  const probe = {
    actorRole: input.viewer.role ?? null,
    actorId: input.viewer.userId || PROBE_TARGET_ID + 'actor',
    targetId: PROBE_TARGET_ID,
    targetRole: 'member' as CommunityRole,
    isPlatformAdmin: input.viewer.isPlatformAdmin === true,
  };
  const canManageRoles = canAssignCommunityRole(probe).ok;
  const canModerate = canModerateCommunityMember(probe).ok;
  return {
    canManageRoles,
    canModerate,
    // Invites are a moderator power, and a non-member is never a moderator of
    // a room they are not in — the API refuses either way.
    canInvite: input.isMember && canModerate,
    canPin: input.isMember && canModerate,
    canCreateBoards: input.isMember,
  };
}

/** Is there anything to manage? Drives whether the panel mounts at all. */
export function hasCommunityManagePowers(caps: CommunityManageCapabilities): boolean {
  return caps.canManageRoles || caps.canModerate || caps.canInvite;
}

// ---------------------------------------------------------------------------
// One member row
// ---------------------------------------------------------------------------

export interface MemberActionPlan {
  /** Roles offered in the picker. Empty when the viewer may not assign roles. */
  roleOptions: readonly AssignableCommunityRole[];
  canChangeRole: boolean;
  canMute: boolean;
  canUnmute: boolean;
  muted: boolean;
  /** "Muted for 3 days", or null. */
  muteLabel: string | null;
  /** The label the role badge shows, or null for a plain member. */
  roleLabel: string | null;
  /**
   * Why nothing is offered, in the words the shared copy already uses. Null
   * when the viewer can act. Shown as a hint, never as an error.
   */
  refusal: string | null;
}

const NO_ROLES: readonly AssignableCommunityRole[] = [];
/**
 * Ordered as a moderator reads them: the power they are handing over first.
 * `member` IS in the list — demoting is the same endpoint as promoting, and
 * leaving it out is how a mis-click becomes permanent.
 */
const ROLE_OPTIONS: readonly AssignableCommunityRole[] = ['admin', 'moderator', 'member'];

export function memberActionPlan(input: {
  viewer: CommunityManageViewer;
  member: { id: string; role: CommunityRole };
  /** The member's `muted_until`, when this session knows it. */
  mutedUntil?: string | null;
  now?: number;
}): MemberActionPlan {
  const now = input.now ?? Date.now();
  const shared = {
    actorRole: input.viewer.role ?? null,
    actorId: input.viewer.userId,
    targetId: input.member.id,
    targetRole: input.member.role,
    isPlatformAdmin: input.viewer.isPlatformAdmin === true,
  };
  const role = canAssignCommunityRole(shared);
  const moderate = canModerateCommunityMember(shared);
  const muted = isCommunityMemberMuted(input.mutedUntil, now);

  const refusal =
    role.ok || moderate.ok
      ? null
      : refusalCopy(role.ok ? null : role.reason, moderate.ok ? null : moderate.reason);

  return {
    roleOptions: role.ok ? ROLE_OPTIONS : NO_ROLES,
    canChangeRole: role.ok,
    canMute: moderate.ok && !muted,
    canUnmute: moderate.ok && muted,
    muted,
    muteLabel: muteRemainingLabel(input.mutedUntil, now),
    roleLabel: communityRoleLabel(input.member.role),
    refusal,
  };
}

/** The shared sentence for a refusal, so web and mobile say the same thing. */
function refusalCopy(
  roleReason: 'forbidden' | 'self' | 'owner_target' | null,
  moderateReason: 'forbidden' | 'self' | 'peer' | null,
): string | null {
  if (roleReason === 'self' || moderateReason === 'self') {
    return COMMUNITY_MODERATION_COPY.cannotModerateSelf;
  }
  if (moderateReason === 'peer' || roleReason === 'owner_target') {
    return COMMUNITY_MODERATION_COPY.cannotModeratePeer;
  }
  // A moderator who is not the owner: roles are the owner's, muting is theirs.
  return COMMUNITY_MODERATION_COPY.onlyOwner;
}

export const MUTE_DURATION_OPTIONS = COMMUNITY_MUTE_DURATIONS;
export type MuteDurationId = CommunityMuteDurationId;
export const MUTE_REASON_MAX = COMMUNITY_MUTE_REASON_MAX;

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export interface InviteExpiryOption {
  id: string;
  label: string;
  hours: number;
}

/** The only expiries the panel offers. The server clamps anything longer. */
export const INVITE_EXPIRY_OPTIONS: readonly InviteExpiryOption[] = [
  { id: '24h', label: '24 hours', hours: 24 },
  { id: '7d', label: '7 days', hours: 24 * 7 },
  { id: '30d', label: '30 days', hours: 24 * 30 },
];

export const INVITE_USES_DEFAULT = COMMUNITY_INVITE_MAX_USES_DEFAULT;
export const INVITE_ACTIVE_MAX = COMMUNITY_INVITE_ACTIVE_MAX;

export interface InviteRowView {
  code: string;
  url: string;
  /** "12 of 25 used", or "12 used" when the link has no ceiling. */
  usesLabel: string;
  /** "Expires in 3 days" / "Expired" / "No expiry". */
  expiryLabel: string;
  /** Dead links are still listed, greyed, so a moderator knows to revoke them. */
  dead: boolean;
}

/**
 * One invite as the panel renders it. `origin` is passed in rather than read
 * from `window` so the link a moderator copies on a preview build points at
 * the preview, and so this stays testable.
 */
export function describeInvite(
  invite: CommunityInviteSummary,
  options: { now?: number; origin?: string } = {},
): InviteRowView {
  const now = options.now ?? Date.now();
  const refusal = inviteRefusal(
    {
      expiresAt: invite.expiresAt,
      maxUses: invite.maxUses,
      uses: invite.uses,
      revokedAt: null,
    },
    now,
  );
  const uses = Number.isFinite(invite.uses) ? Math.max(0, Math.floor(invite.uses)) : 0;
  const usesLabel =
    typeof invite.maxUses === 'number' && invite.maxUses > 0
      ? `${uses} of ${invite.maxUses} used`
      : `${uses} used`;

  return {
    code: invite.code,
    url: communityInviteUrl(invite.code, options.origin),
    usesLabel,
    expiryLabel: expiryLabel(invite.expiresAt, now, refusal),
    dead: refusal !== null,
  };
}

function expiryLabel(
  expiresAt: string | null,
  now: number,
  refusal: ReturnType<typeof inviteRefusal>,
): string {
  if (refusal === 'exhausted') return 'All uses taken';
  if (refusal === 'expired') return 'Expired';
  if (!expiresAt) return 'No expiry';
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms)) return 'No expiry';
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours <= 1) return 'Expires within the hour';
  if (hours < 48) return `Expires in ${hours} hours`;
  return `Expires in ${Math.ceil(hours / 24)} days`;
}

/** Is there room for another link, or must one be revoked first? */
export function canMintInvite(count: number): boolean {
  return count < COMMUNITY_INVITE_ACTIVE_MAX;
}

// ---------------------------------------------------------------------------
// Failure copy
// ---------------------------------------------------------------------------

/**
 * The one sentence a manage action shows when it fails.
 *
 * A 503 from a mute or invite route means the 20260908120000 migration has not
 * been hand-applied on this deployment. That is not the moderator's problem
 * and it is not an error they can act on, so it reads as
 * "Not switched on for this campus yet" — never a raw message, never a stack.
 */
export function manageCommunityErrorCopy(error: unknown, fallback: string): string {
  if (isNotEnabledError(error)) return COMMUNITY_NOT_ENABLED_COPY;
  const message = error instanceof Error ? error.message.trim() : '';
  return message || fallback;
}

export function isManageFeatureOff(error: unknown): boolean {
  return isNotEnabledError(error);
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export const COMMUNITY_MANAGE_TITLE = 'Manage';

export const COMMUNITY_MANAGE_INTRO =
  'You help run this community. Roles, mutes and invite links live here.';

/** The pre-migration sentence, shown in place of a section's controls. */
export const COMMUNITY_MANAGE_NOT_ENABLED = COMMUNITY_NOT_ENABLED_COPY;

export const COMMUNITY_MANAGE_COPY = {
  roleChanged: COMMUNITY_MODERATION_COPY.roleChanged,
  membersTab: 'Members',
  invitesTab: 'Invite links',
  moderationTab: 'Removed posts',
  roleLabel: 'Role',
  mute: 'Mute',
  unmute: 'Unmute',
  muteReason: COMMUNITY_MODERATION_COPY.removeReasonPlaceholder,
  muteHeading: (name: string) => `Mute ${name}`,
  muteExplain:
    'A muted member still reads everything here. They cannot post until the mute runs out or you lift it.',
  inviteCreate: 'Create an invite link',
  inviteCopy: 'Copy link',
  inviteCopied: 'Invite link copied',
  inviteRevoke: 'Revoke',
  inviteEmpty: 'No invite links yet. Create one to bring people in from WhatsApp.',
  inviteFull: `You already have ${COMMUNITY_INVITE_ACTIVE_MAX} live links. Revoke one to create another.`,
  inviteExpiry: 'Expires after',
  inviteUses: 'Number of uses',
  /**
   * Removals have no list endpoint. Rather than a section that would always be
   * empty, the panel says where removals happen and what they leave behind.
   */
  removedExplain:
    'Remove a post from its own menu on the board. The card stays where it was, showing that a moderator removed it and why, so nobody is left wondering what happened.',
  removedReasonNote: 'Everyone who can see the board sees the reason you type.',
} as const;

export const COMMUNITY_MANAGE_MODERATION_COPY = COMMUNITY_MODERATION_COPY;
