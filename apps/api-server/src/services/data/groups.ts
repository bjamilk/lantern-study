/**
 * data/groups.ts — `groups` and `group_members`: the invite lifecycle, the
 * roster reads, and the authorization primitives the rest of the server leans
 * on.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1c, step 10):
 * the whole GROUPS AND MEMBERSHIP section, 21 methods.
 *
 * ## What it touches
 *
 * Tables: `groups`, `group_members`, `dm_threads`, `dm_messages`, `messages`,
 * `profiles`. No storage buckets, no RPCs.
 *
 * ## This block owns the most reused predicates in the server
 *
 *   isGroupMember(groupId, userId)        — may read the group's content
 *   isGroupAdmin(groupId, userId)         — may moderate it
 *   isDmThreadParticipant(threadId, uid)  — the DM equivalent
 *   getAuthorizedGroupMessage(...)        — membership + the message row
 *   getAuthorizedDmMessage(...)           — participation + the message row
 *   canNotifyUser(...)                    — may address a notification at them
 *
 * The service role bypasses RLS, so these ARE the access control. Prefer the
 * `getAuthorized*Message` helpers over fetching a message and checking
 * membership separately: they are what makes "can see" and "can read this row"
 * one decision. They prove membership only — a write on someone ELSE's message
 * additionally needs author-or-admin, which is the rule `routes/messages.ts`
 * applies for both `/status` and the similarity-flag route.
 *
 * ## The gotchas
 *
 * 1. PENDING IS NOT MEMBERSHIP. A `group_members` row exists from the moment
 *    someone is invited; `pending !== true` is what makes them a member. Every
 *    predicate here checks it, and a new query that forgets `.eq("pending",
 *    false)` hands an un-accepted invitee the group's content.
 *
 * 2. `community_surface` is read and written through the capability probe
 *    (`groupColumns` / `hasGroupCommunitySurface` /
 *    `markGroupCommunitySurfaceMissing`), because migration 20260903120000 is
 *    hand-applied. The group list is the hottest read in the app: a stale
 *    probe must DEGRADE it, never 500 it — hence the retry ladders.
 *
 * 3. Cache invalidation is three-way. Every membership change clears the
 *    per-group cache, the per-user cache AND the `groups:list:*` pattern;
 *    `updateGroup` additionally clears `board:context:<id>`, which is keyed
 *    outside `group:<id>:*` on purpose (every send would otherwise blow it).
 *
 * ## Why the cross-method calls go back through `deps`
 *
 * Eight functions call a sibling (`isGroupAdmin` → `getGroupById`,
 * `canNotifyUser` → `getGroupById` + `isGroupMember`, `addGroupMember` →
 * `acceptGroupInvite`, …). They are NOT wired as local calls: suites across
 * `routes/messages.*`, `routes/groups.*`, `supabase.bookmarks.test.ts` and
 * `storageAccess.test.ts` stub exactly these predicates on a `SupabaseService`
 * stand-in, so a sibling call would step around the stub. The facade builds
 * the `deps` literal INLINE at each call site as arrows over `this`.
 *
 * `incrementUserStatsAndAwardBadges` (gamification) is injected for the same
 * reason and to keep this module a leaf.
 */
import { logger } from "../../utils/logger";
import { resolveGroupDiscovery } from "@lantern/shared/network";
import { toServerGroupPayload } from "@lantern/shared/groups";

import { cacheService } from "../cache";
import {
  groupColumns,
  hasGroupCommunitySurface,
  isMissingColumnError,
  markGroupCommunitySurfaceMissing,
} from "../schemaCapabilities";
import { Group, User } from "../../types";
import { initialUserStats } from "@lantern/shared/utils/testHelpers";

import type { DataClient } from "./client";

/** Same alias the monolith uses: the shape of `profiles.stats`. */
type UserStats = typeof initialUserStats;

/**
 * Moved with the section: `getGroups` was the only reader of either. They were
 * `private static readonly` on `SupabaseService`.
 */
const DEFAULT_GROUP_PAGE_SIZE = 20;
const MAX_GROUP_PAGE_SIZE = 50;

/**
 * Everything a moved body used to reach through `this`.
 *
 * Build this literal INLINE at each delegating call site, with arrows that
 * read `this.<method>` at CALL time. Hoisting it to an instance field compiles
 * and passes the surface freeze, but breaks every suite that invokes these
 * methods on a bare `{ supabase }` stand-in that never ran a constructor, and
 * bypasses every `jest.spyOn` on a predicate.
 */
export type GroupDeps = {
  getGroupById: (groupId: string, userId?: string) => Promise<Group | null>;
  isGroupMember: (groupId: string, userId: string) => Promise<boolean>;
  isDmThreadParticipant: (
    threadId: string,
    userId: string,
  ) => Promise<boolean>;
  acceptGroupInvite: (groupId: string, userId: string) => Promise<boolean>;
  getResponseProfile: (profile?: string) => "compact" | "full";
  /** Gamification, still in the monolith (lane M1c step 12 moves it). */
  incrementUserStatsAndAwardBadges: (
    userId: string,
    increments: Partial<UserStats>,
  ) => Promise<unknown>;
};

export async function getGroups(
  supabase: DataClient,
  deps: GroupDeps,
  options: {
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    userId?: string;
    responseProfile?: "compact" | "full";
  } = {},
): Promise<Group[]> {
  const {
    page = 1,
    limit = DEFAULT_GROUP_PAGE_SIZE,
    search,
    sortBy = "created_at",
    sortOrder = "desc",
    userId,
    responseProfile = "full",
  } = options;
  const profile = deps.getResponseProfile(responseProfile);
  const safeLimit = Math.min(
    MAX_GROUP_PAGE_SIZE,
    Math.max(1, limit),
  );
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * safeLimit;

  const cacheKey = `groups:list:${safePage}:${safeLimit}:${search || ""}:${sortBy}:${sortOrder}:${userId || ""}:profile:${profile}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      // community_surface rides along on BOTH profiles: the chat list
      // filters boards out of Chat with it (spec §4.5), and the compact
      // profile is exactly what that list fetches.
      const baseClause =
        profile === "compact"
          ? "id, name, avatar_url, last_message_time, is_archived, community_id"
          : "id, name, description, avatar_url, last_message, last_message_time, admin_ids, permissions, parent_id, is_archived, invite_id, course_id, visibility, community_id, created_at";

      let memberGroupIds: string[] | null = null;
      if (userId) {
        // Only return groups where the user is an active (non-pending) member
        const { data: memberGroups, error: memberError } = await supabase
          .from("group_members")
          .select("group_id")
          .eq("user_id", userId)
          .eq("pending", false);

        if (memberError) throw memberError;

        memberGroupIds = memberGroups?.map((mg) => mg.group_id) || [];
        if (memberGroupIds.length === 0) return [];
      }

      const runList = async (selectClause: string) => {
        let query = (supabase as any)
          .from("groups")
          .select(selectClause)
          .range(offset, offset + safeLimit - 1);
        if (search) query = query.ilike("name", `%${search}%`);
        if (memberGroupIds) query = query.in("id", memberGroupIds);
        return query.order(sortBy, { ascending: sortOrder === "asc" });
      };

      // The group list is the hottest read in the app: a stale capability
      // probe must degrade it, never 500 it.
      let { data, error } = await runList(
        await groupColumns(supabase, baseClause),
      );
      if (error && isMissingColumnError(error)) {
        markGroupCommunitySurfaceMissing();
        ({ data, error } = await runList(baseClause));
      }
      if (error) throw error;

      const groupIds = (data || []).map((item: any) => item.id);
      const memberCounts: Record<string, number> = {};

      if (groupIds.length > 0) {
        const { data: memberRows, error: memberCountError } =
          await supabase
            .from("group_members")
            .select("group_id")
            .in("group_id", groupIds);

        if (!memberCountError && memberRows) {
          memberRows.forEach((row: { group_id: string }) => {
            memberCounts[row.group_id] =
              (memberCounts[row.group_id] || 0) + 1;
          });
        }
      }

      // Snake_case row -> `Group`, through the one shared mapper.
      // `memberCounts` was counted separately above; `|| 0` keeps the
      // pre-refactor promise that this endpoint always answers a number.
      return (data || []).map((item: any) =>
        toServerGroupPayload(item, {
          memberCounts: { [item.id]: memberCounts[item.id] || 0 },
        }),
      ) as Group[];
    },
    { ttl: 300 },
  ); // Cache for 5 minutes
}

/**
 * Every column a group row carries on the wire. `community_surface` is
 * appended only once 20260903120000 is applied — pre-migration the column
 * does not exist and NULL (= board) is the right answer anyway.
 */
const GROUP_COLUMNS_BASE =
  "id, name, description, avatar_url, last_message, last_message_time, admin_ids, permissions, parent_id, is_archived, invite_id, course_id, visibility, community_id, created_at";

export async function getGroupById(
  supabase: DataClient,
  groupId: string,
  userId?: string,
): Promise<Group | null> {
  const base = GROUP_COLUMNS_BASE;
  if (!userId) {
    const readOne = (columns: string) =>
      (supabase as any)
        .from("groups")
        .select(columns)
        .eq("id", groupId)
        .maybeSingle();
    let { data, error } = await readOne(await groupColumns(supabase, base));
    if (error && isMissingColumnError(error)) {
      markGroupCommunitySurfaceMissing();
      ({ data, error } = await readOne(base));
    }
    if (error) throw error;
    if (!data) return null;
    return toServerGroupPayload(data) as Group;
  }

  const cacheKey = `group:${groupId}:user:${userId}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      const readOne = (columns: string) =>
        (supabase as any)
          .from("groups")
          .select(columns)
          .eq("id", groupId)
          .single();
      let { data, error } = await readOne(await groupColumns(supabase, base));
      if (error && isMissingColumnError(error)) {
        markGroupCommunitySurfaceMissing();
        ({ data, error } = await readOne(base));
      }

      if (error) {
        if (error.code === "PGRST116") return null; // Not found
        throw error;
      }

      // Check if user has active (non-pending) membership
      if (userId) {
        const { data: membership, error: memberError } = await supabase
          .from("group_members")
          .select("user_id, pending")
          .eq("group_id", groupId)
          .eq("user_id", userId)
          .single();

        if (memberError && memberError.code !== "PGRST116") throw memberError;
        if (!membership || membership.pending === true) return null;
      }

      // Transform snake_case to camelCase
      return toServerGroupPayload(data, { viewerId: userId }) as Group;
    },
    { ttl: 600 },
  ); // Cache for 10 minutes
}

export async function createGroup(
  supabase: DataClient,
  deps: GroupDeps,
  groupData: Partial<Group>,
  userId: string,
  memberIds: string[] = [],
): Promise<Group> {
  const discovery = resolveGroupDiscovery({
    visibility: groupData.visibility,
    communityId: groupData.communityId,
  });
  /**
   * Which surface this group renders as inside its community. Only
   * meaningful with a community_id, and only written once the column
   * exists — pre-migration NULL means board, which is the default anyway,
   * and 'study_group' is refused at the route with a 503 (spec §3.1).
   */
  const surface: "board" | "study_group" | null = discovery.communityId
    ? groupData.communitySurface === "study_group"
      ? "study_group"
      : "board"
    : null;
  const baseInsert: Record<string, unknown> = {
    name: groupData.name,
    description: groupData.description,
    avatar_url: groupData.avatarUrl,
    admin_ids: [userId],
    permissions: groupData.permissions || {},
    invite_id: groupData.inviteId,
    parent_id: groupData.parentId,
    course_id: groupData.courseId || null,
    visibility: discovery.visibility,
    community_id: discovery.communityId,
    is_archived: false,
  };
  const insertGroup = (row: Record<string, unknown>) =>
    (supabase as any).from("groups").insert(row).select().single();
  const withSurface =
    surface && (await hasGroupCommunitySurface(supabase))
      ? { ...baseInsert, community_surface: surface }
      : baseInsert;
  let { data, error } = await insertGroup(withSurface);
  if (error && withSurface !== baseInsert && isMissingColumnError(error)) {
    markGroupCommunitySurfaceMissing();
    ({ data, error } = await insertGroup(baseInsert));
  }

  if (error) throw error;

  // If this is a subgroup, add all parent group members to the subgroup
  const allMemberIds = [userId, ...memberIds];

  if (groupData.parentId) {
    // Fetch parent group members
    const { data: parentMembers, error: parentError } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupData.parentId);

    if (!parentError && parentMembers) {
      const parentMemberIds = parentMembers.map((m) => m.user_id);
      // Add parent members that aren't already in the list
      for (const parentMemberId of parentMemberIds) {
        if (!allMemberIds.includes(parentMemberId)) {
          allMemberIds.push(parentMemberId);
        }
      }
    }
  }

  // Creator + inherited parent members join immediately; explicitly invited users stay pending until they accept.
  const explicitInviteSet = new Set(memberIds.filter((id) => id !== userId));
  const membersToInsert = allMemberIds.map((id) => ({
    group_id: data.id,
    user_id: id,
    pending: explicitInviteSet.has(id),
  }));

  const { error: memberError } = await supabase
    .from("group_members")
    .insert(membersToInsert);

  if (memberError) throw memberError;

  // Invalidate caches
  await cacheService.invalidateUserCache(userId);
  for (const memberId of memberIds) {
    await cacheService.invalidateUserCache(memberId);
  }
  await cacheService.deletePattern("groups:list:*");

  await deps.incrementUserStatsAndAwardBadges(userId, {
    groupsCreated: 1,
  }).catch((err) => {
    logger.warn("Failed to increment groupsCreated gamification", {
      userId,
      err,
    });
  });

  // Transform snake_case to camelCase. The discovery trio is what we just
  // asked the database for, so it wins over a row that may predate the
  // `community_surface` column.
  return {
    ...toServerGroupPayload(data, {
      viewerId: userId,
      fallback: {
        visibility: discovery.visibility,
        communityId: discovery.communityId,
        communitySurface: surface,
      },
    }),
    visibility: discovery.visibility,
    communityId: discovery.communityId,
    communitySurface: data.community_surface ?? surface,
    pendingInviteUserIds: Array.from(explicitInviteSet),
  } as Group & { pendingInviteUserIds?: string[] };
}

export async function updateGroup(
  supabase: DataClient,
  deps: GroupDeps,
  groupId: string,
  updates: Partial<Group>,
): Promise<Group | null> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.avatarUrl !== undefined) dbUpdates.avatar_url = updates.avatarUrl;
  if (updates.permissions !== undefined) dbUpdates.permissions = updates.permissions;
  if (updates.inviteId !== undefined) dbUpdates.invite_id = updates.inviteId;
  if (updates.parentId !== undefined) dbUpdates.parent_id = updates.parentId;
  if (updates.isArchived !== undefined) dbUpdates.is_archived = updates.isArchived;
  if (updates.adminIds !== undefined) dbUpdates.admin_ids = updates.adminIds;
  if (updates.courseId !== undefined) dbUpdates.course_id = updates.courseId || null;
  // Phase 3 L discovery fields. A group is private by default; making it
  // discoverable is an explicit, admin-only act.
  if (updates.visibility !== undefined || updates.communityId !== undefined) {
    const discovery = resolveGroupDiscovery({
      visibility: updates.visibility ?? "private",
      communityId: updates.communityId,
    });
    dbUpdates.visibility = discovery.visibility;
    dbUpdates.community_id = discovery.communityId;
  }
  if (updates.tags !== undefined) dbUpdates.tags = Array.isArray(updates.tags) ? updates.tags : [];

  if (Object.keys(dbUpdates).length === 0) {
    return deps.getGroupById(groupId);
  }

  const { data, error } = await supabase
    .from("groups")
    .update(dbUpdates)
    .eq("id", groupId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // Not found
    throw error;
  }

  // Invalidate caches. The board context is keyed outside `group:<id>:*` on
  // purpose (every send would otherwise blow it), so clear it explicitly —
  // moving a group between communities changes its surface.
  await cacheService.invalidateGroupCache(groupId);
  await cacheService.delete(`board:context:${groupId}`);
  await cacheService.deletePattern("groups:list:*");

  // Transform snake_case to camelCase
  return toServerGroupPayload(data) as Group;
}

export async function getGroupByInviteId(
  supabase: DataClient,
  inviteId: string,
): Promise<Group | null> {
  const { data, error } = await supabase
    .from("groups")
    .select("*")
    .eq("invite_id", inviteId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // Not found
    throw error;
  }

  // Was the one copy that dropped visibility/communityId/communitySurface,
  // so a group opened from an invite link lost its community surface.
  return toServerGroupPayload(data) as Group;
}

/**
 * Invite a user into a group. By default creates a pending membership that the
 * invitee must accept. Pass `pending: false` only for invitee-initiated joins
 * (e.g. invite-link Accept) or the group creator.
 */
export async function addGroupMember(
  supabase: DataClient,
  deps: GroupDeps,
  groupId: string,
  userId: string,
  options: { pending?: boolean } = {},
): Promise<Group | null> {
  const pending = options.pending !== false;

  const { error: memberError } = await supabase
    .from("group_members")
    .insert({
      group_id: groupId,
      user_id: userId,
      pending,
    });

  if (memberError) {
    if (memberError.code === "23505") {
      // Already a row — invite again leaves pending as-is; self-join accepts a pending invite.
      if (!pending) {
        const accepted = await deps.acceptGroupInvite(groupId, userId);
        if (accepted) return await deps.getGroupById(groupId, userId);
        return await deps.getGroupById(groupId, userId);
      }
      return null;
    }
    throw memberError;
  }

  await cacheService.invalidateGroupCache(groupId);
  await cacheService.invalidateUserCache(userId);
  await cacheService.deletePattern("groups:list:*");

  return pending ? null : await deps.getGroupById(groupId, userId);
}

/** Bulk invite members as pending (invitee must accept). */
export async function addGroupMembersBatch(
  supabase: DataClient,
  groupId: string,
  userIds: string[],
): Promise<{
  invited: string[];
  alreadyMembers: string[];
  alreadyPending: string[];
}> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueIds.length) {
    return { invited: [], alreadyMembers: [], alreadyPending: [] };
  }

  const { data: existing, error: checkError } = await supabase
    .from("group_members")
    .select("user_id, pending")
    .eq("group_id", groupId)
    .in("user_id", uniqueIds);

  if (checkError) throw checkError;

  const alreadyMembers: string[] = [];
  const alreadyPending: string[] = [];
  const existingSet = new Set<string>();
  for (const row of existing || []) {
    existingSet.add(row.user_id);
    if (row.pending === true) alreadyPending.push(row.user_id);
    else alreadyMembers.push(row.user_id);
  }
  const toInvite = uniqueIds.filter((id) => !existingSet.has(id));

  if (toInvite.length) {
    const { error: insertError } = await supabase
      .from("group_members")
      .upsert(
        toInvite.map((user_id) => ({
          group_id: groupId,
          user_id,
          pending: true,
        })),
        { onConflict: "group_id,user_id", ignoreDuplicates: true },
      );
    if (insertError) throw insertError;

    await cacheService.invalidateGroupCache(groupId);
    await cacheService.invalidateGlobalCache("groups:list:*");
    for (const memberId of toInvite) {
      await cacheService.invalidateUserCache(memberId);
    }
  }

  return { invited: toInvite, alreadyMembers, alreadyPending };
}

export async function acceptGroupInvite(
  supabase: DataClient,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("group_members")
    .update({ pending: false, joined_at: new Date().toISOString() })
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .eq("pending", true)
    .select("user_id");

  if (error) throw error;
  if (!data?.length) return false;

  await cacheService.invalidateGroupCache(groupId);
  await cacheService.invalidateUserCache(userId);
  await cacheService.deletePattern("groups:list:*");
  return true;
}

export async function declineGroupInvite(
  supabase: DataClient,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .eq("pending", true)
    .select("user_id");

  if (error) throw error;
  if (!data?.length) return false;

  await cacheService.invalidateGroupCache(groupId);
  await cacheService.invalidateUserCache(userId);
  await cacheService.deletePattern("groups:list:*");
  return true;
}

export async function getPendingGroupInvitesForUser(
  supabase: DataClient,
  userId: string,
): Promise<
  Array<{
    groupId: string;
    groupName: string;
    avatarUrl?: string;
    invitedAt?: string;
  }>
> {
  const { data, error } = await supabase
    .from("group_members")
    .select("group_id, joined_at, groups(id, name, avatar_url)")
    .eq("user_id", userId)
    .eq("pending", true);

  if (error) throw error;

  return (data || []).map((row: any) => ({
    groupId: row.group_id,
    groupName: row.groups?.name || "Group",
    avatarUrl: row.groups?.avatar_url,
    invitedAt: row.joined_at,
  }));
}

export async function isGroupMember(
  supabase: DataClient,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("group_members")
    .select("user_id, pending")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") throw error;
  return !!data && data.pending !== true;
}

export async function isDmThreadParticipant(
  supabase: DataClient,
  threadId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("dm_threads")
    .select("participant_ids")
    .eq("id", threadId)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  const ids = Array.isArray(data?.participant_ids)
    ? data!.participant_ids
    : [];
  return ids.includes(userId);
}

/**
 * A DM message the viewer is allowed to act on: the message must exist and
 * the viewer must be a participant in its thread. Mirrors
 * getAuthorizedGroupMessage so reaction routes can 404 uniformly.
 */
export async function getAuthorizedDmMessage(
  supabase: DataClient,
  deps: GroupDeps,
  messageId: string,
  userId: string,
): Promise<{ id: string; threadId: string } | null> {
  const { data, error } = await supabase
    .from("dm_messages")
    .select("id, thread_id")
    .eq("id", messageId)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  if (!data) return null;
  const threadId = String((data as any).thread_id);
  const allowed = await deps.isDmThreadParticipant(threadId, userId);
  return allowed ? { id: String((data as any).id), threadId } : null;
}

/**
 * True when viewer may see peer's profile avatar in chat (DM partner or shared active group),
 * even if the peer's profile visibility is private.
 */
export async function canViewPeerChatAvatar(
  supabase: DataClient,
  viewerId: string,
  peerId: string,
): Promise<boolean> {
  if (!viewerId || !peerId || viewerId === peerId) return viewerId === peerId;
  const threadId = [viewerId, peerId].sort().join("-");
  const { data: dm, error: dmError } = await supabase
    .from("dm_threads")
    .select("id")
    .eq("id", threadId)
    .maybeSingle();
  if (dmError && dmError.code !== "PGRST116") throw dmError;
  if (dm) return true;

  const { data: shared, error: sharedError } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", viewerId)
    .eq("pending", false);
  if (sharedError) throw sharedError;
  const groupIds = (shared || []).map(
    (row: { group_id: string }) => row.group_id,
  );
  if (groupIds.length === 0) return false;

  const { data: peerMembership, error: peerError } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", peerId)
    .eq("pending", false)
    .in("group_id", groupIds)
    .limit(1)
    .maybeSingle();
  if (peerError && peerError.code !== "PGRST116") throw peerError;
  return !!peerMembership;
}

/**
 * Authorize mutation of a group message. Returns the message row when the user
 * is an active (non-pending) member of its group; otherwise null (treat as not
 * found to avoid IDOR leaks).
 */
export async function getAuthorizedGroupMessage(
  supabase: DataClient,
  messageId: string,
  userId: string,
): Promise<{
  id: string;
  group_id: string;
  sender_id: string;
  type: string;
} | null> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, group_id, sender_id, type")
    .eq("id", messageId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") throw error;
  if (!data?.group_id) return null;

  const { data: membership, error: memberError } = await supabase
    .from("group_members")
    .select("user_id, pending")
    .eq("group_id", data.group_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError && memberError.code !== "PGRST116") throw memberError;
  if (!membership || membership.pending === true) return null;

  return data;
}

export async function isGroupAdmin(
  supabase: DataClient,
  deps: GroupDeps,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const group = await deps.getGroupById(groupId);
  if (!group) return false;
  return (
    (group.adminIds || []).includes(userId) ||
    !!(group.permissions && group.permissions[userId]?.admin)
  );
}

/** Whether an authenticated user may deliver a notification to another user. */
export async function canNotifyUser(
  supabase: DataClient,
  deps: GroupDeps,
  requestingUserId: string,
  targetUserId: string,
  link?: string,
): Promise<boolean> {
  if (!link) return false;

  const groupMatch = link.match(/^\/chat\/([0-9a-f-]{36})$/i);
  if (groupMatch) {
    const groupId = groupMatch[1];
    const group = await deps.getGroupById(groupId);
    if (!group) return false;

    const isAdmin =
      (group.adminIds || []).includes(requestingUserId) ||
      !!(group.permissions && group.permissions[requestingUserId]?.admin);

    const requesterIsMember = await deps.isGroupMember(
      groupId,
      requestingUserId,
    );
    if (!requesterIsMember && !isAdmin) return false;

    if (isAdmin) return true;

    return deps.isGroupMember(groupId, targetUserId);
  }

  if (link === "/dashboard" || link.startsWith("/dashboard")) {
    const { data, error } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", targetUserId);

    if (error) throw error;
    for (const row of data || []) {
      const group = await deps.getGroupById(row.group_id);
      if ((group?.adminIds || []).includes(requestingUserId)) return true;
    }
    return false;
  }

  return false;
}

export async function removeGroupMember(
  supabase: DataClient,
  deps: GroupDeps,
  groupId: string,
  userId: string,
): Promise<Group | null> {
  const group = await deps.getGroupById(groupId);

  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);

  if (error) throw error;

  // Keep admin_ids in sync when an admin leaves or is removed.
  if (group?.adminIds?.includes(userId)) {
    const nextAdminIds = group.adminIds.filter((id) => id !== userId);
    const { error: adminError } = await supabase
      .from("groups")
      .update({ admin_ids: nextAdminIds })
      .eq("id", groupId);
    if (adminError) throw adminError;
  }

  // Invalidate caches
  await cacheService.invalidateGroupCache(groupId);
  await cacheService.invalidateUserCache(userId);
  await cacheService.deletePattern("groups:list:*");

  return await deps.getGroupById(groupId);
}

export async function deleteGroup(
  supabase: DataClient,
  groupId: string,
): Promise<void> {
  // Cascade removes members/messages. Intentionally do NOT purge test_sessions:
  // group id lives in config JSONB with no FK, and product keeps orphan history
  // for the user's Recent Tests (Group performance simply drops missing groups).
  const { error } = await supabase
    .from("groups")
    .delete()
    .eq("id", groupId);

  if (error) {
    logger.error(`Error deleting group ${groupId}:`, error);
    throw error;
  }

  logger.info(
    `Group ${groupId} deleted. Members/messages cascaded; test history retained.`,
  );

  // Invalidate relevant caches
  await cacheService.invalidateGroupCache(groupId);
  await cacheService.deletePattern("groups:list:*");
}

export async function getGroupMembers(
  supabase: DataClient,
  groupId: string,
  options: { page?: number; limit?: number; requestingUserId?: string } = {},
): Promise<User[]> {
  const { page = 1, limit = 50, requestingUserId } = options;
  const offset = (page - 1) * limit;

  // SEC-04: partition by viewer; payload stays public-only (phone/settings attached after).
  const cacheKey = `group:members:${groupId}:${page}:${limit}:${requestingUserId || "anon"}`;

  const publicMembers = await cacheService.cached(
    cacheKey,
    async () => {
      const { data: memberData, error: memberError } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId)
        .eq("pending", false)
        .range(offset, offset + limit - 1);

      if (memberError) {
        logger.error("Error fetching group members:", memberError);
        throw memberError;
      }

      if (!memberData || memberData.length === 0) {
        return [];
      }

      const userIds = memberData.map((m) => m.user_id);
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id, name, username, avatar_url, points, stats, badges")
        .in("id", userIds);

      if (profileError) {
        logger.error("Error fetching member profiles:", profileError);
        throw profileError;
      }

      return (profileData || []).map((profile: any) => ({
        id: profile.id,
        name: profile.name,
        username: profile.username,
        avatarUrl: profile.avatar_url,
        points: profile.points || 0,
        stats: profile.stats || {},
        badges: profile.badges || [],
      }));
    },
    { ttl: 300 },
  );

  if (!requestingUserId) return publicMembers as User[];

  const selfInPage = publicMembers.some(
    (m: any) => m.id === requestingUserId,
  );
  if (!selfInPage) return publicMembers as User[];

  const { data: selfProfile, error: selfError } = await supabase
    .from("profiles")
    .select("phone, settings")
    .eq("id", requestingUserId)
    .maybeSingle();

  if (selfError) {
    logger.error("Error fetching self member profile:", selfError);
    throw selfError;
  }

  return (publicMembers as User[]).map((member: any) => {
    if (member.id !== requestingUserId) return member;
    return {
      ...member,
      phoneNumber: selfProfile?.phone,
      settings: selfProfile?.settings,
    };
  });
}

export async function getGroupStats(
  supabase: DataClient,
  groupId: string,
): Promise<any> {
  const cacheKey = `group:stats:${groupId}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      // Get member count
      const { count: memberCount, error: memberError } = await supabase
        .from("group_members")
        .select("user_id", { count: "exact", head: true })
        .eq("group_id", groupId);

      // Get message count
      const { count: messageCount, error: messageError } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("group_id", groupId);

      // Get recent activity
      const { data: recentMessages, error: recentError } = await supabase
        .from("messages")
        .select("timestamp")
        .eq("group_id", groupId)
        .is("removed_at", null)
        .eq("is_archived", false)
        .order("timestamp", { ascending: false })
        .limit(10);

      if (memberError || messageError || recentError) {
        throw memberError || messageError || recentError;
      }

      const lastActivity =
        recentMessages && recentMessages.length > 0
          ? new Date(recentMessages[0].timestamp)
          : null;

      return {
        groupId,
        memberCount: memberCount || 0,
        messageCount: messageCount || 0,
        lastActivity,
        isActive:
          lastActivity &&
          Date.now() - lastActivity.getTime() < 7 * 24 * 60 * 60 * 1000, // Active if activity in last 7 days
      };
    },
    { ttl: 300 },
  ); // Cache for 5 minutes
}
