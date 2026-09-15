/**
 * The ONE group row → `Group` mapper (refactor R2).
 *
 * Before this module the same mapping existed in eleven places — six in
 * `apps/api-server/src/services/supabase.ts`, two in root-web
 * `hooks/useGroupHandlers.ts`, two in root-web `hooks/useAppEffects.ts`, one in
 * root-web `services/supabase.ts`, one in `apps/mobile/src/stores/groupStore.ts`
 * and a dead one in `utils/apiMappers.ts` — and they had drifted. The drift was
 * not cosmetic: two copies silently dropped `communitySurface` (so a community
 * study group rendered as a board), one dropped `visibility`/`communityId`
 * entirely, one defaulted `courseId` to `undefined` where every other copy used
 * `null`, and three disagreed on whether the snake_case or the camelCase key of
 * the same field wins.
 *
 * Exports: `mapGroupRow` / `mapGroupRows` (canonical), `toServerGroupPayload`
 * (the API's narrower response shape), `mapGroupMemberRow` and
 * `deriveGroupMemberRole`.
 *
 * Touches: nothing. Pure, dependency-free, node-safe — importable from the API
 * server, from a node-environment jest test and from React Native alike.
 *
 * Gotchas:
 *  - Two sources feed this: raw Postgres rows (snake_case only) and API JSON
 *    (mixed, because different endpoints were written at different times). One
 *    mapper handles both by resolving per KEY PRESENCE, not by `||` chains —
 *    see `pickRowValue`. An explicit `null` from the server therefore WINS over
 *    the other casing instead of being resurrected by a `||`.
 *  - `ctx.fallback` is PRESENCE-gated for the same reason (`resolveNullable`):
 *    web's `mergeFetchedGroups` passes the previous UI state in as the
 *    fallback, so a `?? fallback` would resurrect a community/course the
 *    student just detached — the server sends those as literal `null`.
 *  - `members` is usually absent on list rows. `memberCount` is left
 *    `undefined` (not 0) when nothing on the row or in `ctx` knows it, so a
 *    caller can tell "unknown" from "empty"; the mobile adapter coerces to 0.
 *  - Member `role` is DERIVED from `adminIds` (element 0 is the owner — that is
 *    what `createGroup` writes), never read from the member row.
 */

import type { Group, GroupPermissions, User } from '../types';

/** A Postgres `groups` row, or one API group object. Deliberately loose. */
export type GroupRow = Record<string, any>;

export type GroupMemberRole = 'owner' | 'admin' | 'member';

/** A roster row after mapping: a `User` plus the group-scoped extras. */
export interface MappedGroupMember extends User {
  /** Auth user id. Equals `id` — kept because both platforms read both names. */
  userId: string;
  role: GroupMemberRole;
  joinedAt: string;
}

export interface MappedGroup extends Group {
  members: MappedGroupMember[];
  /** `groups.created_at` / `updated_at`. Not on `Group`; mobile requires them. */
  createdAt?: string;
  updatedAt?: string;
  /**
   * The viewer's role, when `ctx.viewerId` is supplied AND the row can answer:
   * `adminIds` alone proves owner/admin, and a loaded roster proves 'member'.
   * `null` means "this row cannot tell" — never assume non-membership from it.
   */
  viewerRole?: GroupMemberRole | null;
}

export interface MapGroupRowContext {
  /** Enables `viewerRole`. Optional; nothing else depends on it. */
  viewerId?: string;
  /** `groupId → unread`. Wins over anything on the row (the row is stale). */
  unreadCounts?: Record<string, number>;
  /** `groupId → member count`, for callers that counted separately. */
  memberCounts?: Record<string, number>;
  /**
   * Values to use when the row carries none — the create/update paths know
   * what they just asked for, and the server may answer without the column
   * (pre-migration `community_surface`).
   */
  fallback?: Partial<
    Pick<
      Group,
      | 'adminIds'
      | 'permissions'
      | 'courseId'
      | 'visibility'
      | 'communityId'
      | 'communitySurface'
      | 'memberCount'
    >
  >;
}

/**
 * Resolve one logical field from a row that may spell it either way.
 *
 * Presence, not truthiness: a key that is present and not `undefined` wins,
 * snake_case first. That is what makes an explicit `null` (the user just
 * cleared the course) survive instead of being overwritten by the other
 * casing, which the `||` chains in the old copies got wrong.
 */
function pickRowValue(row: GroupRow, snakeKey: string, camelKey: string): unknown {
  if (row[snakeKey] !== undefined) return row[snakeKey];
  return row[camelKey];
}

/**
 * Resolve a nullable field against `ctx.fallback`, by PRESENCE.
 *
 * `?? fallback` cannot tell "the row omitted this key" from "the row says
 * null", and the API puts `course_id` / `community_id` / `community_surface` on
 * the wire as literal `null`. Web's `mergeFetchedGroups` passes the PREVIOUS UI
 * state in as the fallback, so a `??` chain resurrected a community the student
 * had just detached: the group kept rendering inside the community (and on
 * mobile a resurrected `communitySurface` rendered a board as a study group)
 * until the app restarted. Key present — even as `null` — wins; only a key that
 * is genuinely absent falls back.
 */
function resolveNullable<T>(
  row: GroupRow,
  snakeKey: string,
  camelKey: string,
  fallbackValue: T | null | undefined,
): T | null {
  const raw = pickRowValue(row, snakeKey, camelKey);
  if (raw !== undefined) return (raw as T | null) ?? null;
  return (fallbackValue as T | null | undefined) ?? null;
}

/**
 * Non-empty string, or undefined. For the plain string fields (name, preview,
 * avatar, ids) the old copies all used a `||` chain, and blank really does mean
 * "no value" — an empty `avatar_url` must fall through to `avatarUrl`, not
 * shadow it. `null` and `''` are therefore both absent here.
 */
function pickString(row: GroupRow, snakeKey: string, camelKey: string): string | undefined {
  const snake = row[snakeKey];
  if (typeof snake === 'string' && snake.length > 0) return snake;
  const camel = row[camelKey];
  return typeof camel === 'string' && camel.length > 0 ? camel : undefined;
}

function pickStringArray(row: GroupRow, snakeKey: string, camelKey: string): string[] | undefined {
  const value = pickRowValue(row, snakeKey, camelKey);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
}

function pickNumber(row: GroupRow, snakeKey: string, camelKey: string): number | undefined {
  const value = pickRowValue(row, snakeKey, camelKey);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * `adminIds[0]` is the creator (`createGroup` writes `admin_ids: [userId]`), so
 * element 0 is the owner and every other entry is an admin.
 */
export function deriveGroupMemberRole(
  userId: string | undefined | null,
  adminIds: readonly string[],
): GroupMemberRole {
  if (!userId) return 'member';
  if (adminIds[0] === userId) return 'owner';
  return adminIds.includes(userId) ? 'admin' : 'member';
}

/**
 * One roster row → `MappedGroupMember`. The members endpoint, the realtime
 * payload and the embedded group row disagree on casing and on whether the
 * identifier is `user_id` or `id`; the auth user id wins so chat roster lookups
 * match `sender_id`.
 */
export function mapGroupMemberRow(
  member: GroupRow,
  adminIds: readonly string[] = [],
): MappedGroupMember {
  const userId: string = member.user_id || member.userId || member.id || '';
  return {
    id: userId,
    userId,
    name: member.name || 'Unknown',
    username: member.username,
    avatarUrl: member.avatar_url || member.avatarUrl,
    email: member.email,
    points: member.points || 0,
    badges: member.badges || [],
    stats: member.stats || ({} as User['stats']),
    role: deriveGroupMemberRole(userId, adminIds),
    joinedAt: member.joined_at || member.joinedAt || new Date().toISOString(),
  };
}

/**
 * The canonical mapping. Every field's resolution is stated here once; no
 * caller may re-derive one.
 */
export function mapGroupRow(row: GroupRow, ctx: MapGroupRowContext = {}): MappedGroup {
  const fallback = ctx.fallback || {};

  const adminIds =
    pickStringArray(row, 'admin_ids', 'adminIds') ?? fallback.adminIds ?? [];

  const rawMembers = Array.isArray(row.members) ? row.members : [];
  const members = rawMembers.map((m: GroupRow) => mapGroupMemberRow(m, adminIds));

  const id: string = row.id;

  // Caller map first (it was fetched for exactly this), then the row, then 0.
  // Never undefined: the unread badge reads it unguarded on both platforms.
  const unreadCount =
    ctx.unreadCounts?.[id] ?? pickNumber(row, 'unread_count', 'unreadCount') ?? 0;

  // undefined = nobody knows. 0 would be a claim, and an empty roster on a
  // list row is the normal case, not evidence of an empty group.
  //
  // Presence again (see `resolveNullable`): a row that SAYS `member_count: null`
  // is saying "unknown", so the previous UI state must not refill it — only a
  // row with no such key at all falls back. A loaded roster still outranks the
  // fallback either way, because it is evidence, not memory.
  const memberCountPresent =
    pickRowValue(row, 'member_count', 'memberCount') !== undefined;
  const memberCount =
    ctx.memberCounts?.[id] ??
    pickNumber(row, 'member_count', 'memberCount') ??
    (members.length > 0 ? members.length : undefined) ??
    (memberCountPresent ? undefined : fallback.memberCount);

  // `visibility` is not nullable on `Group`. A row that says `null` (or '') is
  // saying "unset", which is 'private' — not whatever the UI showed before.
  const visibilityRaw = pickRowValue(row, 'visibility', 'visibility');
  const visibility: Group['visibility'] =
    visibilityRaw !== undefined
      ? (pickString(row, 'visibility', 'visibility') as Group['visibility']) || 'private'
      : fallback.visibility || 'private';

  const permissionsValue = pickRowValue(row, 'permissions', 'permissions');
  const permissions = (permissionsValue ||
    fallback.permissions ||
    {}) as GroupPermissions;

  const viewerRole: GroupMemberRole | null = ctx.viewerId
    ? adminIds.includes(ctx.viewerId)
      ? deriveGroupMemberRole(ctx.viewerId, adminIds)
      : members.some((m) => m.userId === ctx.viewerId)
        ? 'member'
        : null
    : null;

  const description = pickRowValue(row, 'description', 'description') as
    | string
    | null
    | undefined;

  const mapped: MappedGroup = {
    id,
    name: row.name,
    description: description ?? undefined,
    avatarUrl: pickString(row, 'avatar_url', 'avatarUrl'),
    members,
    memberEmails: pickStringArray(row, 'member_emails', 'memberEmails'),
    lastMessage: pickString(row, 'last_message', 'lastMessage'),
    lastMessageTime: pickString(row, 'last_message_time', 'lastMessageTime'),
    unreadCount,
    adminIds,
    moderatorIds: pickStringArray(row, 'moderator_ids', 'moderatorIds'),
    parentId: pickString(row, 'parent_id', 'parentId'),
    // `??` not `||`: an explicit `false` must not fall through to the other
    // casing, and the raw Postgres `null` must land on `false`, not on `null`.
    isArchived: Boolean(pickRowValue(row, 'is_archived', 'isArchived') ?? false),
    inviteId: pickString(row, 'invite_id', 'inviteId'),
    permissions,
    invitedPhoneNumbers:
      pickStringArray(row, 'invited_phone_numbers', 'invitedPhoneNumbers') ?? [],
    courseId: resolveNullable<string>(row, 'course_id', 'courseId', fallback.courseId),
    visibility,
    communityId: resolveNullable<string>(row, 'community_id', 'communityId', fallback.communityId),
    // NULL/absent = legacy = 'board'. Dropping this field (two web copies did)
    // makes a community study group render as a board.
    communitySurface: resolveNullable<NonNullable<Group['communitySurface']>>(
      row,
      'community_surface',
      'communitySurface',
      fallback.communitySurface,
    ),
    tags: pickStringArray(row, 'tags', 'tags'),
    memberCount,
    questionCount: pickNumber(row, 'question_count', 'questionCount'),
    createdAt: pickString(row, 'created_at', 'createdAt'),
    updatedAt: pickString(row, 'updated_at', 'updatedAt'),
    viewerRole,
  };

  return mapped;
}

export function mapGroupRows(rows: GroupRow[] | null | undefined, ctx: MapGroupRowContext = {}): MappedGroup[] {
  return (rows || []).map((row) => mapGroupRow(row, ctx));
}

/**
 * Keys the API server has never put on the wire for a group. Emitting them
 * would be harmless but noisy, and `members: []` on a list response reads like
 * "this group has no members" to a client that merges rosters.
 */
const SERVER_OMITTED_KEYS = [
  'members',
  'unreadCount',
  'viewerRole',
  'memberEmails',
  'moderatorIds',
  'invitedPhoneNumbers',
] as const;

/**
 * The API server's group response: the canonical mapping minus the client-only
 * fields, minus every key whose value is `undefined` (so a compact list row
 * stays compact).
 */
export function toServerGroupPayload(row: GroupRow, ctx: MapGroupRowContext = {}): Group {
  const mapped = mapGroupRow(row, ctx) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mapped)) {
    if ((SERVER_OMITTED_KEYS as readonly string[]).includes(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out as unknown as Group;
}
