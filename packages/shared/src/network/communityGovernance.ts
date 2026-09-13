/**
 * Community governance — the vocabulary that decides WHO may do WHAT inside a
 * community, and WHAT KINDS of community and post exist.
 *
 * Founder decisions encoded here (2026-09-07, binding):
 *  1. Communities are open to every signed-in student with an academic
 *     profile, and members POST — they are not a read-only gallery. The gate
 *     is `canAccessDiscoverHub`, and the server re-checks it: a client flag is
 *     not a gate.
 *  2. Communities go BEYOND academic discussion. A student can create and find
 *     a community for an interest, a club, a hostel, an event, a faith group,
 *     a sport, or anything else campus life holds — with the SAME moderation
 *     everywhere. Shop and Jobs stay behind their own gates and are untouched
 *     by anything in this file.
 *  3. Academic kinds stay derived. `institution`/`programme`/`level`/`course`
 *     are minted by `ensure_scope_community` from the academic profile; a
 *     student-made community is never `is_official`.
 *
 * Everything here is PURE. Both clients and the API decide from these helpers
 * so a permission cannot mean one thing on the phone and another on the
 * server. Every rule below is re-checked server-side — a limit that lives only
 * in a client is not a limit.
 *
 * Mobile imports via the `@lantern/shared/network` subpath, never the bare
 * package (jest does not map the bare specifier).
 */

import type { CommunityRole } from './communityServer';

// ---------------------------------------------------------------------------
// 1. The gate
// ---------------------------------------------------------------------------

/**
 * What the gate reads. Only two academic fields matter: an institution and a
 * programme. Study level is deliberately NOT required — a student who has not
 * filled in their year is still a student at a university on a programme, and
 * demanding it would lock out exactly the newest accounts.
 */
export interface DiscoverHubAccessInput {
  isPlatformAdmin?: boolean | null;
  /** `profiles.institution_id`. */
  institutionId?: string | null;
  /** `profiles.programme`. */
  programme?: string | null;
}

/** Is this academic profile complete enough to enter Communities? */
export function hasCompleteAcademicProfile(input: DiscoverHubAccessInput): boolean {
  const institution = typeof input?.institutionId === 'string' ? input.institutionId.trim() : '';
  const programme = typeof input?.programme === 'string' ? input.programme.trim() : '';
  return institution.length > 0 && programme.length > 0;
}

/**
 * The ONE gate on Communities and the Discover hub.
 *
 * A platform admin always passes. Everyone else passes with an academic
 * profile that names an institution AND a programme — founder decision 1.
 *
 * The legacy `boolean` form is still accepted so no caller breaks mid-rollout:
 * it means "platform admin?" and nothing else, so a client that has not been
 * updated keeps its old, STRICTER behaviour rather than silently opening the
 * hub before its screens can handle members. Clients should move to the object
 * form; the server always passes the object form.
 */
export function canAccessDiscoverHub(input: boolean | DiscoverHubAccessInput): boolean {
  if (typeof input === 'boolean') return input === true;
  if (!input || typeof input !== 'object') return false;
  if (input.isPlatformAdmin === true) return true;
  return hasCompleteAcademicProfile(input);
}

/** Shown where the gate refuses — plain copy, no "upgrade" grammar. */
export const COMMUNITY_GATE_COPY = {
  needsProfileTitle: 'Add your school and programme',
  needsProfileBody:
    'Communities are built from your university and programme. Add them in your profile to see the rooms for your campus.',
  needsProfileAction: 'Open profile',
} as const;

// ---------------------------------------------------------------------------
// 2. Community kinds
// ---------------------------------------------------------------------------

/**
 * Derived from the academic profile by `ensure_scope_community`. A client may
 * never create one: forking the canonical row is what auto-membership,
 * `member_count` and campus scoping all depend on.
 */
export const ACADEMIC_COMMUNITY_KINDS = [
  'institution',
  'programme',
  'level',
  'course',
] as const;

/**
 * Everything campus life holds. Any student past the gate can create one, and
 * it is NEVER `is_official`.
 *
 * `topic` is kept first and unrenamed: it is the kind every community created
 * before this migration carries, and renaming it would orphan those rows.
 */
export const SOCIAL_COMMUNITY_KINDS = [
  'topic',
  'interest',
  'club',
  'hostel',
  'event',
  'faith',
  'sports',
  'general',
] as const;

export const COMMUNITY_KINDS = [
  ...ACADEMIC_COMMUNITY_KINDS,
  ...SOCIAL_COMMUNITY_KINDS,
] as const;

export type CommunityKind = (typeof COMMUNITY_KINDS)[number];
export type AcademicCommunityKind = (typeof ACADEMIC_COMMUNITY_KINDS)[number];
export type SocialCommunityKind = (typeof SOCIAL_COMMUNITY_KINDS)[number];

export function isCommunityKind(value: unknown): value is CommunityKind {
  return typeof value === 'string' && (COMMUNITY_KINDS as readonly string[]).includes(value);
}

/**
 * Kinds a student may create. Academic kinds are excluded because they are
 * derived, not because they are privileged.
 */
export function isCreatableCommunityKind(value: unknown): value is SocialCommunityKind {
  return (
    typeof value === 'string' && (SOCIAL_COMMUNITY_KINDS as readonly string[]).includes(value)
  );
}

export interface CommunityKindMeta {
  kind: CommunityKind;
  /** The one label both clients render. */
  label: string;
  /** An `components/ui/AppIcon` name — the same vocabulary on web and mobile. */
  icon: string;
  /** Feature ink token: the community/campus ink is `campus`, groups is `groups`. */
  ink: 'campus' | 'groups';
  /** Derived from the academic profile; never student-created. */
  academic: boolean;
  /** Requires a `course_id` scope key. */
  needsCourse: boolean;
  /** Carries `starts_at` / `ends_at` / `location` and lists soonest-first. */
  timed: boolean;
}

const KIND_META: Record<CommunityKind, Omit<CommunityKindMeta, 'kind'>> = {
  institution: { label: 'Campus', icon: 'school', ink: 'campus', academic: true, needsCourse: false, timed: false },
  programme: { label: 'Programme', icon: 'library', ink: 'campus', academic: true, needsCourse: false, timed: false },
  level: { label: 'Year', icon: 'layers', ink: 'campus', academic: true, needsCourse: false, timed: false },
  course: { label: 'Course', icon: 'book', ink: 'campus', academic: true, needsCourse: true, timed: false },
  topic: { label: 'Interest', icon: 'sparkles', ink: 'groups', academic: false, needsCourse: false, timed: false },
  interest: { label: 'Interest', icon: 'sparkles', ink: 'groups', academic: false, needsCourse: false, timed: false },
  club: { label: 'Club', icon: 'people', ink: 'groups', academic: false, needsCourse: false, timed: false },
  hostel: { label: 'Hostel', icon: 'home', ink: 'groups', academic: false, needsCourse: false, timed: false },
  event: { label: 'Event', icon: 'calendar', ink: 'groups', academic: false, needsCourse: false, timed: true },
  faith: { label: 'Faith', icon: 'ribbon', ink: 'groups', academic: false, needsCourse: false, timed: false },
  sports: { label: 'Sports', icon: 'trophy', ink: 'groups', academic: false, needsCourse: false, timed: false },
  general: { label: 'General', icon: 'chatbubbles', ink: 'groups', academic: false, needsCourse: false, timed: false },
};

/** Unknown kinds degrade to a neutral community rather than throwing. */
const UNKNOWN_KIND_META: Omit<CommunityKindMeta, 'kind'> = {
  label: 'Community',
  icon: 'chatbubbles',
  ink: 'groups',
  academic: false,
  needsCourse: false,
  timed: false,
};

/** The one description of a kind, used by both clients and the API. */
export function communityKindMeta(kind: CommunityKind | string): CommunityKindMeta {
  const meta = KIND_META[kind as CommunityKind] ?? UNKNOWN_KIND_META;
  return { kind: (isCommunityKind(kind) ? kind : 'general') as CommunityKind, ...meta };
}

/** Event communities carry a schedule; nothing else does. */
export interface CommunityEventFields {
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
}

export const COMMUNITY_EVENT_LOCATION_MAX = 120;

/**
 * A datetime the event create field typed. `datetime-local` and ISO strings
 * parse; "Fri 12 Sep, 4pm" does not, and those stay in the description.
 */
export function parseCommunityEventStart(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ts = Date.parse(trimmed);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

// ---------------------------------------------------------------------------
// 3. Board post kinds
// ---------------------------------------------------------------------------

/**
 * What a board post IS. NO POLLS this wave — a poll needs its own vote table,
 * its own realtime fan-out and its own abuse story, and shipping the enum
 * value without them is how a dead feature reaches production.
 */
export const BOARD_POST_KINDS = ['discussion', 'question', 'announcement', 'event'] as const;
export type BoardPostKind = (typeof BOARD_POST_KINDS)[number];

export const BOARD_POST_KIND_DEFAULT: BoardPostKind = 'discussion';

export function isBoardPostKind(value: unknown): value is BoardPostKind {
  return typeof value === 'string' && (BOARD_POST_KINDS as readonly string[]).includes(value);
}

/** A missing/unknown value is a discussion — legacy rows carry NULL. */
export function normalizeBoardPostKind(value: unknown): BoardPostKind {
  return isBoardPostKind(value) ? value : BOARD_POST_KIND_DEFAULT;
}

export interface BoardPostKindMeta {
  kind: BoardPostKind;
  label: string;
  icon: string;
  /** Only owner/admin/moderator may post one. */
  restricted: boolean;
  /** Pinned at creation time. */
  pinnedByDefault: boolean;
  /** Can be marked answered by the author or a moderator. */
  answerable: boolean;
}

const POST_KIND_META: Record<BoardPostKind, Omit<BoardPostKindMeta, 'kind'>> = {
  discussion: { label: 'Discussion', icon: 'chatbubbles', restricted: false, pinnedByDefault: false, answerable: false },
  question: { label: 'Question', icon: 'help-circle', restricted: false, pinnedByDefault: false, answerable: true },
  announcement: { label: 'Announcement', icon: 'megaphone', restricted: true, pinnedByDefault: true, answerable: false },
  event: { label: 'Event', icon: 'calendar', restricted: false, pinnedByDefault: false, answerable: false },
};

export function boardPostKindMeta(kind: BoardPostKind | string): BoardPostKindMeta {
  const normalized = normalizeBoardPostKind(kind);
  return { kind: normalized, ...POST_KIND_META[normalized] };
}

/**
 * Announcements pinned at once, per COMMUNITY (not per board). The oldest
 * unpins when a fourth is posted — a board that can accumulate pins is a board
 * whose top is permanently spent.
 */
export const BOARD_ANNOUNCEMENT_PIN_MAX = 3;

/** Roles that moderate. Owner is `communities.created_by`. */
const MODERATING_ROLES: readonly CommunityRole[] = ['owner', 'admin', 'moderator'];

export function isModeratingRole(role: CommunityRole | null | undefined): boolean {
  return !!role && MODERATING_ROLES.includes(role);
}

/** May this role post this kind? Only moderators may announce. */
export function canPostBoardKind(
  role: CommunityRole | null | undefined,
  kind: BoardPostKind | string,
): boolean {
  const meta = boardPostKindMeta(kind);
  if (!meta.restricted) return true;
  return isModeratingRole(role);
}

/** What `boardPostRules` is told about the post and the viewer. */
export interface BoardPostRuleInput {
  /** `messages.sender_id`. */
  senderId: string;
  /** The signed-in user deciding. */
  viewerId: string;
  postKind?: BoardPostKind | string | null;
  pinnedAt?: string | null;
  removedAt?: string | null;
  /** The accepted answer, when the post is a question. */
  answeredMessageId?: string | null;
  /** The viewer's `community_members.muted_until`. */
  mutedUntil?: string | null;
  /**
   * Is the viewer a PLATFORM admin? They moderate every community, which is
   * the only moderation an auto-derived campus room — one with no owner and
   * no appointed moderators — ever gets. The API decides the same way
   * (`services/communityModeration.ts` removePost checks
   * `actor.isPlatformAdmin` first), so a client that omits this hides a
   * control the server would have allowed.
   */
  isPlatformAdmin?: boolean | null;
  /** Now, for mute expiry. Defaults to `Date.now()`. */
  now?: number;
}

export interface BoardPostPermissions {
  canPin: boolean;
  canUnpin: boolean;
  /** Soft removal with a reason; the card stays, as a tombstone. */
  canRemove: boolean;
  canMarkAnswered: boolean;
  canComment: boolean;
  canReport: boolean;
}

const NO_PERMISSIONS: BoardPostPermissions = {
  canPin: false,
  canUnpin: false,
  canRemove: false,
  canMarkAnswered: false,
  canComment: false,
  canReport: false,
};

/**
 * The ONE permission matrix for a board post.
 *
 * - pin/unpin: moderators only. An already-pinned post cannot be pinned again
 *   and an unpinned one cannot be unpinned, so the two are never both true.
 * - remove: a moderator removes anyone's post; an author removes their own.
 *   A post that is already removed cannot be removed twice.
 * - mark answered: questions only, by the author or a moderator.
 * - comment: anyone who is not muted, on a post that is not removed. A muted
 *   member READS the whole board — muting is not a ban.
 * - report: anyone but the author. Reporting your own post is a no-op that
 *   costs a moderator a queue item.
 *
 * A removed post keeps `canReport` false: the thing being complained about is
 * already gone, and moderators see it as removed.
 *
 * A PLATFORM admin widens EXACTLY ONE row: `canRemove`. That is the whole of
 * what the server grants them — `communityModeration.removePost` credits
 * `actor.isPlatformAdmin`, and it is the only moderation an auto-derived
 * campus room with no owner ever gets. Pinning deliberately does NOT widen:
 * `setMessagePin` decides from the community role and the board's admin list
 * alone, so a Pin button shown to a platform admin here would be a button
 * that 403s. Muting does not widen either — a platform admin who has somehow
 * been muted still reads without commenting, exactly as `assertCanPost`
 * decides.
 */
export function boardPostRules(
  role: CommunityRole | null | undefined,
  post: BoardPostRuleInput,
): BoardPostPermissions {
  if (!post || typeof post !== 'object') return NO_PERMISSIONS;
  const viewerId = typeof post.viewerId === 'string' ? post.viewerId : '';
  if (!viewerId) return NO_PERMISSIONS;

  const moderator = isModeratingRole(role ?? null);
  // See the note above: the platform admin widens removal and nothing else.
  const platformAdmin = post.isPlatformAdmin === true;
  const isAuthor = !!post.senderId && post.senderId === viewerId;
  const removed = !!post.removedAt;
  const pinned = !!post.pinnedAt;
  const muted = isCommunityMemberMuted(post.mutedUntil, post.now);
  const kind = normalizeBoardPostKind(post.postKind);

  return {
    canPin: moderator && !removed && !pinned,
    canUnpin: moderator && !removed && pinned,
    canRemove: !removed && (moderator || platformAdmin || isAuthor),
    canMarkAnswered: boardPostKindMeta(kind).answerable && !removed && (moderator || isAuthor),
    canComment: !removed && !muted,
    canReport: !removed && !isAuthor,
  };
}

/** May this member post at all right now? Muted members read, never write. */
export function canPostOnBoard(input: {
  role?: CommunityRole | null;
  isMember: boolean;
  mutedUntil?: string | null;
  postKind?: BoardPostKind | string | null;
  now?: number;
  /**
   * A platform admin may post in a room they never joined — the server's
   * `assertCanPost` lets that actor through, so the shared matrix must too or
   * the composer hides a box the API would accept.
   */
  isPlatformAdmin?: boolean | null;
}): { ok: true } | { ok: false; reason: 'not_member' | 'muted' | 'restricted_kind' } {
  if (!input?.isMember && input?.isPlatformAdmin !== true) return { ok: false, reason: 'not_member' };
  if (isCommunityMemberMuted(input.mutedUntil, input.now)) return { ok: false, reason: 'muted' };
  if (!canPostBoardKind(input.role ?? null, input.postKind ?? BOARD_POST_KIND_DEFAULT)) {
    return { ok: false, reason: 'restricted_kind' };
  }
  return { ok: true };
}

/**
 * Merge a roster page's `mutedUntil` (present only for a moderating viewer)
 * into the client's mute map without erasing a mute this session just set:
 * the roster wins only where it actually carries a value.
 */
export function seedMuteState(
  prev: Record<string, string | null>,
  members: ReadonlyArray<{ id: string; mutedUntil?: string | null }>
): Record<string, string | null> {
  let next = prev;
  for (const m of members) {
    if (m.mutedUntil === undefined) continue;
    if (next === prev) next = { ...prev };
    next[m.id] = m.mutedUntil;
  }
  return next;
}

export const COMMUNITY_MODERATION_COPY = {
  mutedTitle: 'You are muted in this community',
  mutedBody: 'You can read everything here. A moderator can unmute you.',
  notMember: 'Join this community to post',
  restrictedKind: 'Only moderators can post an announcement',
  announcementUnpinned: 'The oldest announcement was unpinned',
  removedByModerator: 'Removed by a moderator',
  removeReasonPlaceholder: 'Why is this being removed?',
  roleChanged: 'Role updated',
  onlyOwner: 'Only the community owner can change roles',
  cannotModerateSelf: 'You cannot moderate yourself',
  cannotModeratePeer: 'You cannot moderate a moderator at or above your level',
  autoCommunityModeration: 'Campus rooms are moderated by Lantern',
} as const;

// ---------------------------------------------------------------------------
// 4. Roles and mutes
// ---------------------------------------------------------------------------

/** Roles the OWNER may assign. Owner itself is `communities.created_by`. */
export const ASSIGNABLE_COMMUNITY_ROLES = ['admin', 'moderator', 'member'] as const;
export type AssignableCommunityRole = (typeof ASSIGNABLE_COMMUNITY_ROLES)[number];

export function isAssignableCommunityRole(value: unknown): value is AssignableCommunityRole {
  return (
    typeof value === 'string' &&
    (ASSIGNABLE_COMMUNITY_ROLES as readonly string[]).includes(value)
  );
}

/** Higher wins. Used for "you cannot moderate a peer". */
const ROLE_RANK: Record<CommunityRole, number> = {
  owner: 3,
  admin: 2,
  moderator: 1,
  member: 0,
};

export function communityRoleRank(role: CommunityRole | null | undefined): number {
  return role ? (ROLE_RANK[role] ?? 0) : -1;
}

/**
 * Who may change a member's role. ONLY the owner — an admin who could mint
 * admins is an owner by another name, and an auto-derived academic community
 * has no owner at all (platform admins moderate those instead).
 */
export function canAssignCommunityRole(input: {
  actorRole: CommunityRole | null | undefined;
  actorId: string;
  targetId: string;
  targetRole: CommunityRole | null | undefined;
  isPlatformAdmin?: boolean;
}): { ok: true } | { ok: false; reason: 'forbidden' | 'self' | 'owner_target' } {
  if (input.actorId && input.actorId === input.targetId) return { ok: false, reason: 'self' };
  if (input.targetRole === 'owner') return { ok: false, reason: 'owner_target' };
  if (input.isPlatformAdmin === true) return { ok: true };
  if (input.actorRole !== 'owner') return { ok: false, reason: 'forbidden' };
  return { ok: true };
}

/**
 * Who may mute / remove a post / kick. A moderator acts on members BELOW
 * them, never on a peer and never on themselves. A platform admin always may
 * — that is the only moderation an auto-derived campus room has.
 */
export function canModerateCommunityMember(input: {
  actorRole: CommunityRole | null | undefined;
  actorId: string;
  targetId: string;
  targetRole: CommunityRole | null | undefined;
  isPlatformAdmin?: boolean;
}): { ok: true } | { ok: false; reason: 'forbidden' | 'self' | 'peer' } {
  if (input.actorId && input.actorId === input.targetId) return { ok: false, reason: 'self' };
  if (input.isPlatformAdmin === true) return { ok: true };
  if (!isModeratingRole(input.actorRole ?? null)) return { ok: false, reason: 'forbidden' };
  if (communityRoleRank(input.targetRole ?? 'member') >= communityRoleRank(input.actorRole)) {
    return { ok: false, reason: 'peer' };
  }
  return { ok: true };
}

/** The only mute lengths either client offers, and the only ones the API takes. */
export const COMMUNITY_MUTE_DURATIONS = [
  { id: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
  { id: '24h', label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
] as const;
export type CommunityMuteDurationId = (typeof COMMUNITY_MUTE_DURATIONS)[number]['id'];

export const COMMUNITY_MUTE_REASON_MAX = 200;

export function isCommunityMuteDuration(value: unknown): value is CommunityMuteDurationId {
  return (
    typeof value === 'string' && COMMUNITY_MUTE_DURATIONS.some((d) => d.id === value)
  );
}

/**
 * The ISO instant a mute expires, or null for "unmute". There is no permanent
 * mute on purpose: a mute nobody remembers to lift is a ban with no appeal,
 * and bans belong to the Phase 1 · E suspension machinery, not here.
 */
export function resolveMuteUntil(
  duration: unknown,
  now: number = Date.now(),
): string | null {
  if (!isCommunityMuteDuration(duration)) return null;
  const entry = COMMUNITY_MUTE_DURATIONS.find((d) => d.id === duration);
  if (!entry) return null;
  return new Date(now + entry.ms).toISOString();
}

/** Is this member muted right now? An expired mute is simply not a mute. */
export function isCommunityMemberMuted(
  mutedUntil: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!mutedUntil) return false;
  const ts = Date.parse(mutedUntil);
  if (!Number.isFinite(ts)) return false;
  return ts > now;
}

/** "Muted for 3 days" / null when not muted. */
export function muteRemainingLabel(
  mutedUntil: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!isCommunityMemberMuted(mutedUntil, now)) return null;
  const ms = Date.parse(mutedUntil as string) - now;
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours <= 1) return 'Muted for under an hour';
  if (hours < 48) return `Muted for ${hours} hours`;
  return `Muted for ${Math.ceil(hours / 24)} days`;
}

// ---------------------------------------------------------------------------
// 5. Invite codes
// ---------------------------------------------------------------------------

/**
 * Codes are minted server-side from an unambiguous alphabet: no O/0, no I/1/L.
 * A code is read off a phone screen and typed into another phone, so a glyph
 * pair that can be confused is a support ticket.
 */
export const COMMUNITY_INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const COMMUNITY_INVITE_CODE_LENGTH = 8;
export const COMMUNITY_INVITE_MAX_USES_DEFAULT = 25;
export const COMMUNITY_INVITE_MAX_USES_LIMIT = 500;
export const COMMUNITY_INVITE_TTL_MS_DEFAULT = 7 * 24 * 60 * 60 * 1000;
export const COMMUNITY_INVITE_TTL_MS_MAX = 30 * 24 * 60 * 60 * 1000;
/** Live invites one community may hold at once. */
export const COMMUNITY_INVITE_ACTIVE_MAX = 5;

const INVITE_CODE_RE = new RegExp(`^[${COMMUNITY_INVITE_ALPHABET}]{${COMMUNITY_INVITE_CODE_LENGTH}}$`);

/**
 * Uppercase, strip separators a human would type (spaces, dashes), then
 * validate. Returns null for anything that could never be a code — so a
 * malformed guess never becomes a database query.
 */
export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toUpperCase().replace(/[\s-]+/g, '');
  return INVITE_CODE_RE.test(cleaned) ? cleaned : null;
}

export interface CommunityInvite {
  code: string;
  communityId: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  revokedAt?: string | null;
}

export type InviteRefusal = 'unknown' | 'expired' | 'exhausted' | 'revoked';

/** Why an invite cannot be redeemed, or null when it can. */
export function inviteRefusal(
  invite: Pick<CommunityInvite, 'expiresAt' | 'maxUses' | 'uses' | 'revokedAt'> | null | undefined,
  now: number = Date.now(),
): InviteRefusal | null {
  if (!invite) return 'unknown';
  if (invite.revokedAt) return 'revoked';
  if (invite.expiresAt) {
    const ts = Date.parse(invite.expiresAt);
    if (Number.isFinite(ts) && ts <= now) return 'expired';
  }
  if (typeof invite.maxUses === 'number' && invite.maxUses > 0 && invite.uses >= invite.maxUses) {
    return 'exhausted';
  }
  return null;
}

/**
 * Every refusal answers the SAME string. An invite page that distinguishes
 * "expired" from "never existed" is an oracle for which codes are real.
 */
export const INVITE_REFUSAL_COPY = 'That invite link is not valid any more. Ask for a new one.';

/** Clamp a requested expiry to the ceiling; null means "use the default". */
export function resolveInviteExpiry(
  requestedMs: unknown,
  now: number = Date.now(),
): string {
  const raw = Number(requestedMs);
  const ms =
    Number.isFinite(raw) && raw > 0
      ? Math.min(COMMUNITY_INVITE_TTL_MS_MAX, Math.floor(raw))
      : COMMUNITY_INVITE_TTL_MS_DEFAULT;
  return new Date(now + ms).toISOString();
}

export function resolveInviteMaxUses(requested: unknown): number {
  const raw = Number(requested);
  if (!Number.isFinite(raw) || raw <= 0) return COMMUNITY_INVITE_MAX_USES_DEFAULT;
  return Math.min(COMMUNITY_INVITE_MAX_USES_LIMIT, Math.floor(raw));
}

/** The link a student pastes into WhatsApp. Deliberately an absolute URL. */
export function communityInviteUrl(code: string, origin = 'https://lanternstudy.com'): string {
  return `${origin}/join/${encodeURIComponent(code)}`;
}

// ---------------------------------------------------------------------------
// 6. Discovery ranking
// ---------------------------------------------------------------------------

/** The subset of a community row ranking reads. */
export interface RankableCommunity {
  id: string;
  kind: CommunityKind | string;
  institution_id: string | null;
  member_count: number;
  created_at?: string | null;
  starts_at?: string | null;
}

/**
 * Own campus > member count > newest.
 *
 * There is deliberately no social signal ("your friends are in it"): there is
 * no follow graph on communities, and inventing one from co-membership would
 * leak who is in a private room. If a ranking cannot be explained in one line
 * to the student seeing it, it does not ship.
 *
 * Event communities are the ONE exception and sort soonest-first among
 * themselves: an event that has already happened is noise, and a big old event
 * outranking tomorrow's is the failure mode member-count sorting has here.
 */
export function compareDiscoverCommunities(
  a: RankableCommunity,
  b: RankableCommunity,
  ctx: { institutionId?: string | null; now?: number } = {},
): number {
  const institutionId = ctx.institutionId || null;
  const now = ctx.now ?? Date.now();

  const onCampus = (c: RankableCommunity) =>
    institutionId && c.institution_id === institutionId ? 1 : 0;
  const campusDelta = onCampus(b) - onCampus(a);
  if (campusDelta !== 0) return campusDelta;

  const aEvent = communityKindMeta(a.kind).timed;
  const bEvent = communityKindMeta(b.kind).timed;
  if (aEvent && bEvent) {
    const start = (c: RankableCommunity) => {
      const ts = c.starts_at ? Date.parse(c.starts_at) : NaN;
      if (!Number.isFinite(ts)) return Number.MAX_SAFE_INTEGER;
      // Past events sort after every upcoming one rather than to the top.
      return ts < now ? Number.MAX_SAFE_INTEGER - 1 : ts;
    };
    const startDelta = start(a) - start(b);
    if (startDelta !== 0) return startDelta;
  }

  const members = (c: RankableCommunity) =>
    Number.isFinite(c.member_count) ? Math.max(0, Math.floor(c.member_count)) : 0;
  const memberDelta = members(b) - members(a);
  if (memberDelta !== 0) return memberDelta;

  const created = (c: RankableCommunity) => {
    const ts = c.created_at ? Date.parse(c.created_at) : NaN;
    return Number.isFinite(ts) ? ts : 0;
  };
  return created(b) - created(a);
}

/** `compareDiscoverCommunities` over a page. Never mutates the input. */
export function rankDiscoverCommunities<T extends RankableCommunity>(
  rows: readonly T[],
  ctx: { institutionId?: string | null; now?: number } = {},
): T[] {
  return [...(rows ?? [])].sort((a, b) => compareDiscoverCommunities(a, b, ctx));
}

/**
 * The free-text search term, cleaned. `%` and `_` are stripped because they
 * are PostgREST `ilike` wildcards: a query of `%` would otherwise match every
 * community on the platform, and `,` and `.` terminate a PostgREST filter.
 */
export function normalizeCommunitySearch(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/[%_,.()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return cleaned.length >= 2 ? cleaned : null;
}
