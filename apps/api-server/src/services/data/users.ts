/**
 * data/users.ts — `profiles`: CRUD, the derived reads clients treat as part of
 * a user, and the account export / erasure entry points.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1b, step 6).
 * Everything in the file's USERS AND PROFILES section, plus the three
 * module-scope helpers only this section used (`mapProfileRowToUser`,
 * `toNullableInt`, `buildProfileUpsertRow`), which came with it.
 *
 * ## What it touches
 *
 * Tables: `profiles` (owner), `group_members` and `messages` and
 * `test_sessions` (read-only, for `getUserStats` / `getUserGroups` /
 * presentation-cache invalidation). Plus the `profile_visible_to_viewer` RPC
 * and `auth.admin.getUserById`. No storage buckets.
 *
 * ## The gotchas
 *
 * 1. VISIBILITY IS DECIDED HERE, NOT BY RLS. The service role bypasses every
 *    policy, so `isProfileVisibleToViewer` is the predicate every non-self
 *    profile read must pass. `data/storageAcl.ts` calls it (and
 *    `canViewPeerChatAvatar`, still in the monolith) through injected deps, so
 *    widening it widens avatar access too.
 *
 * 2. A PROFILE EDIT INVALIDATES MORE THAN THE PROFILE. Group member lists and
 *    message author previews EMBED presentation fields, which is what
 *    `invalidateProfilePresentationCaches` clears — and only for `avatar_url`,
 *    `name` or `username`. `profilePresentationCache.test.ts` asserts the
 *    per-group fan-out, and it swaps `service.supabase` AFTER construction, so
 *    the delegations must keep reading `this.supabase` at call time.
 *
 * 3. `updateUser` CARRIES AN OPTIMISTIC-CONCURRENCY CHECK. When `settings` is
 *    part of the write it pins `settings_version` and raises
 *    `VersionConflictError` rather than last-write-wins. `test_presets` is a
 *    dedicated column and is deleted out of the settings blob on the way in —
 *    merging it would wipe the other categories.
 *
 * 4. SEC-06: `resolveCollaboratorUserId` answers every failure with ONE
 *    generic message, so a UUID or email probe cannot tell "no such account"
 *    from "not allowed".
 *
 * ## The outward calls are INJECTED, not imported
 *
 * `deleteUser` and `exportUserData` are thin wrappers over
 * `services/userDataLifecycle.ts`, whose functions take the whole
 * `SupabaseService`. Importing it here would point the data layer straight
 * back at the monolith, so both arrive as injected deps and the
 * facade keeps the lazy `await import(...)` at its own call site — the import
 * still happens when the method is called, never at module load.
 */
import { User, Group } from "../../types";
import { cacheService } from "../cache";
import { logger } from "../../utils/logger";
import { VersionConflictError } from "../../utils/versionConflict";

import type { DataClient } from "./client";

/**
 * The two account-lifecycle operations that need the `SupabaseService`
 * instance itself. Injected so this module stays a leaf.
 */
export type DeleteAccountDeps = {
  deleteUserAccountFully: (userId: string) => Promise<{ found: boolean }>;
};

export type ExportAccountDeps = {
  exportUserDataArchive: (userId: string) => Promise<Record<string, unknown>>;
};

/** Map a profiles table row (snake_case) to the API User shape (with snake_case aliases). */
function mapProfileRowToUser(
  row: Record<string, unknown> | null | undefined,
): User | null {
  if (!row || typeof row !== "object") return null;
  const avatarUrl = (row.avatar_url as string | undefined) || undefined;
  const mapped = {
    id: String(row.id),
    name: String(row.name || ""),
    username: (row.username as string | undefined) || undefined,
    firstName: (row.first_name as string | undefined) || undefined,
    lastName: (row.last_name as string | undefined) || undefined,
    email: (row.email as string | undefined) || undefined,
    phoneNumber: (row.phone as string | undefined) || undefined,
    avatarUrl,
    points: typeof row.points === "number" ? row.points : 0,
    badges: Array.isArray(row.badges) ? row.badges : [],
    stats: row.stats ?? {},
    settings: row.settings ?? {},
    settingsVersion:
      typeof row.settings_version === "number"
        ? row.settings_version
        : Number(row.settings_version) || 1,
    testPresets: Array.isArray(row.test_presets) ? row.test_presets : [],
    test_presets: Array.isArray(row.test_presets) ? row.test_presets : [],
    // Aliases for clients that still read snake_case from GET /users/:id
    avatar_url: avatarUrl,
    phone: (row.phone as string | undefined) || undefined,
    first_name: (row.first_name as string | undefined) || undefined,
    last_name: (row.last_name as string | undefined) || undefined,
    // Academic identity (20260822130000). Absent columns (migration not yet
    // applied) read as null so clients always see the keys.
    institutionId: (row.institution_id as string | null | undefined) ?? null,
    faculty: (row.faculty as string | null | undefined) ?? null,
    programme: (row.programme as string | null | undefined) ?? null,
    studyLevel: toNullableInt(row.study_level),
    // 20260830090000. Absent column (migration unapplied) reads as null.
    currentSemester: toNullableInt(row.current_semester),
    entryYear: toNullableInt(row.entry_year),
    expectedGraduationYear: toNullableInt(row.expected_graduation_year),
    // Creator identity (20260823123000). Read back so "Edit bio" can prefill
    // and the profile can render it; verification_level drives the Verified badge.
    bio: (row.bio as string | null | undefined) ?? null,
    verificationLevel: toNullableInt(row.verification_level) ?? 0,
    lastSeenAt: typeof row.last_seen_at === "string" ? row.last_seen_at : null,
  };
  return mapped as User;
}

function toNullableInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildProfileUpsertRow(
  profile: Partial<User> & {
    first_name?: string;
    last_name?: string;
    username?: string;
    phone?: string;
    avatar_url?: string;
  },
  options?: { allowGamificationFields?: boolean },
): Record<string, unknown> {
  const allowGamification = options?.allowGamificationFields === true;
  const row: Record<string, unknown> = {
    id: profile.id,
    name: profile.name,
    avatar_url: profile.avatarUrl ?? profile.avatar_url,
    phone: profile.phoneNumber ?? profile.phone,
    points: allowGamification ? (profile.points ?? 0) : 0,
    stats: allowGamification ? (profile.stats ?? {}) : {},
    badges: allowGamification ? (profile.badges ?? []) : [],
    settings: profile.settings ?? {},
    username: profile.username ?? undefined,
    first_name: profile.firstName ?? profile.first_name ?? undefined,
    last_name: profile.lastName ?? profile.last_name ?? undefined,
  };
  if (profile.email) {
    row.email = profile.email;
  }
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  );
}

export async function fetchUserProfile(
  supabase: DataClient,
  userId: string,
): Promise<User | null> {
  const cacheKey = `user:${userId}:profile`;

  return cacheService.cached(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) throw error;
      return data;
    },
    { ttl: 300 },
  ); // Cache for 5 minutes
}

export async function updateUserProfile(
  supabase: DataClient,
  userId: string,
  updates: Partial<User>,
): Promise<User> {
  const { data, error } = await supabase
    .from("profiles")
    .update({
      name: updates.name,
      avatar_url: updates.avatarUrl,
      phone: updates.phoneNumber,
      points: updates.points,
      stats: updates.stats,
      badges: updates.badges,
      settings: updates.settings,
      username: updates.username,
      first_name: updates.firstName,
      last_name: updates.lastName,
    })
    .eq("id", userId)
    .select()
    .single();

  if (error) throw error;

  // Invalidate cache
  await cacheService.invalidateUserCache(userId);

  return data;
}

export async function updateExpoPushToken(
  supabase: DataClient,
  userId: string,
  token: string,
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ expo_push_token: token })
    .eq("id", userId);

  if (error) throw error;
  await cacheService.invalidateUserCache(userId);
}

export async function clearExpoPushToken(
  supabase: DataClient,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ expo_push_token: null })
    .eq("id", userId);

  if (error) throw error;
  await cacheService.invalidateUserCache(userId);
}

export async function sendExpoPushForNotification(
  supabase: DataClient,
  userId: string,
  notification: {
    message: string;
    type?: string;
    link?: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  const pushTypes = new Set([
    "challenge_invite",
    "challenge_accepted",
    "challenge_result",
    "challenge_opponent_finished",
    "marketplace_inquiry",
    "marketplace_purchase",
    "marketplace_order_update",
    "marketplace_review_prompt",
    "saved_search_match",
    "job_alert",
    "job_application",
    "job_application_status",
    "job_interview",
    "job_interview_response",
    "job_offer",
    "job_offer_response",
    "job_interview_reminder",
    "job_offer_reminder",
    "group_invite",
    "group_message",
    "badge_unlock",
    "test_result",
    "srs_reminder",
    "dm_message",
    // Jobs-board alert family: saved-search matches and pipeline reminders.
    // Settings policy still applies per user (pushEnabled + marketplaceUpdates).
    "job_alert",
    "job_interview_reminder",
    "job_offer_reminder",
  ]);
  if (notification.type && !pushTypes.has(notification.type)) return;

  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("expo_push_token, settings")
      .eq("id", userId)
      .single();

    if (error || !profile?.expo_push_token) return;

    const { shouldSendExpoPush } =
      await import("../../utils/userSettingsPolicy");
    if (!shouldSendExpoPush(profile.settings, notification.type)) return;

    const token = profile.expo_push_token as string;
    if (!token.startsWith("ExponentPushToken")) return;

    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: token,
        title: "Lantern Study",
        body: notification.message,
        data: {
          type: notification.type,
          link: notification.link,
          ...(notification.data || {}),
        },
        sound: "default",
      }),
    });
  } catch (err) {
    logger.warn("Expo push notification failed", { userId, err });
  }
}

export async function createUserProfile(
  supabase: DataClient,
  profile: Partial<User> & {
    first_name?: string;
    last_name?: string;
    username?: string;
    phone?: string;
    avatar_url?: string;
  },
): Promise<User> {
  const row = buildProfileUpsertRow(profile);
  const { data, error } = await supabase
    .from("profiles")
    .upsert(row, { onConflict: "id" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// New User Methods for API Routes
export async function getUsers(
  supabase: DataClient,
  options: { page?: number; limit?: number; search?: string } = {},
): Promise<User[]> {
  const { page = 1, limit = 20, search } = options;
  const offset = (page - 1) * limit;

  let query = supabase
    .from("profiles")
    .select("*")
    .range(offset, offset + limit - 1);

  if (search) {
    // Search by name, email, or username
    const escaped = search.replace(/%/g, "\\%").replace(/_/g, "\\_");
    const pattern = `%${escaped}%`;
    query = query.or(
      `name.ilike.${pattern},email.ilike.${pattern},username.ilike.${pattern}`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  return data || [];
}

export async function getUserById(
  supabase: DataClient,
  userId: string,
): Promise<User | null> {
  const cacheKey = `user:${userId}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null; // Not found
        throw error;
      }

      return mapProfileRowToUser(data as Record<string, unknown>);
    },
    { ttl: 600 },
  ); // Cache for 10 minutes
}

export async function isProfileVisibleToViewer(
  supabase: DataClient,
  viewerId: string,
  targetId: string,
): Promise<boolean> {
  if (viewerId === targetId) return true;
  const { data, error } = await supabase.rpc("profile_visible_to_viewer", {
    viewer_id: viewerId,
    target_id: targetId,
  });
  if (error) throw error;
  return data === true;
}

export async function getUserByEmail(
  supabase: DataClient,
  email: string,
): Promise<User | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("email", email)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // Not found
    throw error;
  }

  return mapProfileRowToUser(data as Record<string, unknown>);
}

/**
 * Resolve a UUID, @username, email, or display name to a profile id.
 * SEC-06: resolution failures use one generic message (no email/ID existence leak).
 */
export async function resolveCollaboratorUserId(
  supabase: DataClient,
  identifier: string,
): Promise<string> {
  const trimmed = identifier.trim();
  const notFound = () => {
    const err = new Error(
      "Unable to add that collaborator. Check the @username and try again.",
    ) as Error & { code?: string };
    err.code = "collaborator_not_found";
    throw err;
  };

  if (!trimmed) {
    const err = new Error(
      "Enter a @username to add a collaborator.",
    ) as Error & { code?: string };
    err.code = "collaborator_invalid";
    throw err;
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(trimmed)) {
    const user = await getUserById(supabase, trimmed);
    if (!user) notFound();
    return user!.id;
  }

  // Email lookups must not reveal whether the address is registered (SEC-06).
  if (trimmed.includes("@") && trimmed.includes(".")) {
    const user = await getUserByEmail(supabase, trimmed);
    if (!user) notFound();
    return user!.id;
  }

  const username = trimmed.replace(/^@/, "").toLowerCase();
  const { data: byUsername, error: usernameError } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (usernameError) throw usernameError;
  if (byUsername?.id) return byUsername.id;

  const matches = await getUsers(supabase, { search: trimmed, limit: 5 });
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) {
    const err = new Error(
      "Multiple users match that name. Use an exact @username instead.",
    ) as Error & { code?: string };
    err.code = "collaborator_ambiguous";
    throw err;
  }

  notFound();
  return ""; // unreachable
}

export async function createUser(
  supabase: DataClient,
  userData: Partial<User> & {
    first_name?: string;
    last_name?: string;
    username?: string;
    phone?: string;
    avatar_url?: string;
  },
): Promise<User> {
  const row = buildProfileUpsertRow(userData);
  const { data, error } = await supabase
    .from("profiles")
    .upsert(row, { onConflict: "id" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function invalidateProfilePresentationCaches(
  supabase: DataClient,
  userId: string,
): Promise<void> {
  const { data: memberships, error } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)
    .eq("pending", false);

  if (error) {
    logger.warn(
      "Could not resolve profile group caches; invalidating globally",
      {
        userId,
        error,
      },
    );
    await Promise.all([
      cacheService.deletePattern("group:members:*"),
      cacheService.deletePattern("messages:group:*"),
      cacheService.deletePattern("group:*:messages"),
    ]);
    return;
  }

  const groupIds = [
    ...new Set(
      (memberships || [])
        .map((membership: { group_id?: string | null }) => membership.group_id)
        .filter((groupId): groupId is string => Boolean(groupId)),
    ),
  ];
  await Promise.all(
    groupIds.map((groupId) => cacheService.invalidateGroupCache(groupId)),
  );
}

export async function updateUser(
  supabase: DataClient,
  userId: string,
  updates: Partial<User> & {
    avatar_url?: string;
    phone?: string;
    first_name?: string;
    last_name?: string;
    test_presets?: any[];
  },
  options: { expectedSettingsVersion?: number } = {},
): Promise<User | null> {
  // Build update object, handling both camelCase and snake_case keys
  const updateData: any = {};

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.email !== undefined) updateData.email = updates.email;
  if (updates.avatarUrl !== undefined)
    updateData.avatar_url = updates.avatarUrl;
  if (updates.avatar_url !== undefined)
    updateData.avatar_url = updates.avatar_url;
  if (updates.phoneNumber !== undefined) updateData.phone = updates.phoneNumber;
  if (updates.phone !== undefined) updateData.phone = updates.phone;
  if (updates.username !== undefined) updateData.username = updates.username;
  if (updates.firstName !== undefined)
    updateData.first_name = updates.firstName;
  if (updates.first_name !== undefined)
    updateData.first_name = updates.first_name;
  if (updates.lastName !== undefined) updateData.last_name = updates.lastName;
  if (updates.last_name !== undefined) updateData.last_name = updates.last_name;
  if (updates.points !== undefined) updateData.points = updates.points;
  if (updates.stats !== undefined) updateData.stats = updates.stats;
  if (updates.badges !== undefined) updateData.badges = updates.badges;
  // Creator bio (Phase 2 · J); normalized + length-checked in routes/users.ts.
  if ((updates as { bio?: string | null }).bio !== undefined)
    updateData.bio = (updates as { bio?: string | null }).bio ?? null;
  // Academic identity columns (validated + institution-checked in routes/users.ts).
  if (updates.institutionId !== undefined)
    updateData.institution_id = updates.institutionId || null;
  if (updates.faculty !== undefined)
    updateData.faculty = updates.faculty || null;
  if (updates.programme !== undefined)
    updateData.programme = updates.programme || null;
  if (updates.studyLevel !== undefined)
    updateData.study_level = updates.studyLevel ?? null;
  if (updates.currentSemester !== undefined)
    updateData.current_semester = updates.currentSemester ?? null;
  if (updates.entryYear !== undefined)
    updateData.entry_year = updates.entryYear ?? null;
  if (updates.expectedGraduationYear !== undefined)
    updateData.expected_graduation_year =
      updates.expectedGraduationYear ?? null;
  if (updates.settings !== undefined) {
    // Never nest test_presets into the settings JSONB blob.
    const settingsPayload =
      updates.settings &&
      typeof updates.settings === "object" &&
      !Array.isArray(updates.settings)
        ? { ...(updates.settings as Record<string, unknown>) }
        : updates.settings;
    if (
      settingsPayload &&
      typeof settingsPayload === "object" &&
      !Array.isArray(settingsPayload)
    ) {
      delete (settingsPayload as { test_presets?: unknown }).test_presets;
    }
    updateData.settings = settingsPayload;
  }
  // Dedicated column — do not merge into settings JSONB (would wipe other categories).
  if (updates.test_presets !== undefined) {
    updateData.test_presets = Array.isArray(updates.test_presets)
      ? updates.test_presets
      : [];
  }

  let expectedSettingsVersion = options.expectedSettingsVersion;
  if (updateData.settings !== undefined && expectedSettingsVersion == null) {
    const { data: current, error: currentError } = await supabase
      .from("profiles")
      .select("settings_version")
      .eq("id", userId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return null;
    expectedSettingsVersion = Number(current.settings_version) || 1;
  }

  let query = supabase.from("profiles").update(updateData).eq("id", userId);
  if (updateData.settings !== undefined && expectedSettingsVersion != null) {
    query = query.eq("settings_version", expectedSettingsVersion);
  }

  const { data, error } = await query.select().maybeSingle();

  if (error) {
    if (error.code === "PGRST116") return null; // Not found
    throw error;
  }

  if (!data) {
    if (updateData.settings !== undefined) {
      const current = await getUserById(supabase, userId);
      throw new VersionConflictError(
        "Settings were updated on another device. Refresh and try again.",
        current,
      );
    }
    return null;
  }

  // Invalidate cache (exact user key + pattern)
  await cacheService.invalidateUserCache(userId);
  if (
    Object.prototype.hasOwnProperty.call(updateData, "avatar_url") ||
    Object.prototype.hasOwnProperty.call(updateData, "name") ||
    Object.prototype.hasOwnProperty.call(updateData, "username")
  ) {
    // Group member lists and message responses embed profile presentation fields.
    await invalidateProfilePresentationCaches(supabase, userId);
  }

  return mapProfileRowToUser(data as Record<string, unknown>);
}

/**
 * @deprecated Loses the deletion report. Call
 * `deleteUserAccountFully` directly — it returns `{ ok, found, purged,
 * failures }` and a caller that only sees this boolean cannot tell a complete
 * erasure from one that left files in a bucket. Kept for back-compat; `false`
 * means "no such account", never "partially deleted".
 */
export async function deleteUser(
  deps: DeleteAccountDeps,
  userId: string,
): Promise<boolean> {
  const result = await deps.deleteUserAccountFully(userId);
  return result.found;
}

export async function exportUserData(
  supabase: DataClient,
  deps: ExportAccountDeps,
  userId: string,
): Promise<Record<string, unknown>> {
  const { wrapSignedExport } = await import("../accountExportSign");
  const archive = await deps.exportUserDataArchive(userId);
  let sourceEmail: string | null = null;
  try {
    const { data: authUser } = await supabase.auth.admin.getUserById(userId);
    sourceEmail = authUser?.user?.email ?? null;
  } catch {
    sourceEmail = null;
  }
  return wrapSignedExport({
    sourceUserId: userId,
    sourceEmail,
    data: archive,
  }) as unknown as Record<string, unknown>;
}

/** @deprecated use deleteUser — kept for internal reference */
export async function deleteUserProfileOnly(
  supabase: DataClient,
  userId: string,
): Promise<boolean> {
  const { error } = await supabase.from("profiles").delete().eq("id", userId);

  if (error) throw error;

  // Invalidate cache
  await cacheService.invalidateUserCache(userId);

  return true;
}

export async function getUserStats(
  supabase: DataClient,
  userId: string,
): Promise<any> {
  const cacheKey = `user:stats:${userId}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      // Get user profile for basic stats
      const user = await getUserById(supabase, userId);
      if (!user) return null;

      // Get additional stats from related tables
      const { data: groupCount, error: groupError } = await supabase
        .from("group_members")
        .select("group_id", { count: "exact" })
        .eq("user_id", userId);

      const { data: messageCount, error: messageError } = await supabase
        .from("messages")
        .select("id", { count: "exact" })
        .eq("sender_id", userId);

      const { data: testResults, error: testError } = await supabase
        .from("test_sessions")
        .select("score")
        .eq("user_id", userId);

      if (groupError || messageError || testError) {
        throw groupError || messageError || testError;
      }

      const avgScore =
        testResults && testResults.length > 0
          ? testResults.reduce((sum, result) => sum + (result.score || 0), 0) /
            testResults.length
          : 0;

      return {
        userId,
        points: user.points || 0,
        groupsCount: groupCount?.length || 0,
        messagesCount: messageCount?.length || 0,
        testsTaken: testResults?.length || 0,
        averageScore: Math.round(avgScore * 100) / 100,
        badges: user.badges || [],
        stats: user.stats || {},
      };
    },
    { ttl: 300 },
  ); // Cache for 5 minutes
}

export async function getUserGroups(
  supabase: DataClient,
  userId: string,
  options: { page?: number; limit?: number } = {},
): Promise<Group[]> {
  const { page = 1, limit = 20 } = options;
  const offset = (page - 1) * limit;

  const cacheKey = `user:groups:${userId}:${page}:${limit}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from("group_members")
        .select(
          `
        groups (
          id,
          name,
          avatar_url,
          description,
          last_message,
          last_message_time,
          admin_ids,
          permissions,
          parent_id,
          is_archived,
          invite_id,
          course_id,
          created_at
        )
      `,
        )
        .eq("user_id", userId)
        .range(offset, offset + limit - 1);

      if (error) throw error;
      return data?.map((item: any) => item.groups).filter(Boolean) || [];
    },
    { ttl: 300 },
  ); // Cache for 5 minutes
}

// ============ ROUTE ESCAPES (lane R2, PR 2b) ============
//
// Moved verbatim from `routes/users.ts`, `routes/auth.ts` and the four
// marketplace checkout paths. Two profile chains, two RPCs and three GoTrue
// admin calls — which are service-role calls made from a route file, and belong
// behind the layer for the same reason a `.from()` does.
//
// The routes keep the decisions: the 409 on a taken username, the Expo-format
// check on a push token, the 400 when a buyer has no verified email, and the
// session cutoff that actually ends a session.

/**
 * The caller's raw profile row for the push-token diagnostic.
 *
 * Deliberately NOT `getUserById`: the mapped `User` shape drops
 * `expo_push_token` entirely, which made this endpoint answer "no token" for
 * every account, and a diagnostic must not be served from a ten-minute cache.
 */
export async function getPushTokenProfile(
  supabase: DataClient,
  userId: string,
): Promise<{ data: { expo_push_token?: unknown; settings?: unknown } | null; error: any }> {
  return await supabase
    .from("profiles")
    .select("expo_push_token, settings")
    .eq("id", userId)
    .maybeSingle();
}

/**
 * Patch a profile and return the whole row.
 *
 * The caller READS the error and branches on `23505` to answer 409 "username is
 * already taken" — the unique index is what actually decides the race between
 * two people claiming a name, so the pre-check above it is a courtesy, not the
 * guard. Returning `{ data, error }` is what keeps that branch possible; do not
 * reduce this to a bare await (issue #108).
 */
export async function updateProfileFields(
  supabase: DataClient,
  userId: string,
  patch: Record<string, unknown>,
): Promise<{ data: any | null; error: any }> {
  return await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select()
    .single();
}

/** Name and avatar for a set of users — labels for a list the caller already has. */
export async function listProfileCards(
  supabase: DataClient,
  userIds: string[],
): Promise<{ data: Array<{ id: string; name: string; avatar_url: string | null }> | null; error: any }> {
  return await supabase
    .from("profiles")
    .select("id, name, avatar_url")
    .in("id", userIds);
}

/**
 * The `search_users` database function. `viewer_id` is not decoration: the
 * function uses it to apply each result's privacy settings, so passing null
 * where a viewer exists would leak presence the viewer is not entitled to see.
 */
export async function searchUsersRpc(
  supabase: DataClient,
  searchQuery: string,
  viewerId: string | null,
  resultLimit: number,
): Promise<{ data: any[] | null; error: any }> {
  return await supabase.rpc("search_users", {
    search_query: searchQuery,
    exclude_user_id: viewerId || null,
    viewer_id: viewerId || null,
    result_limit: resultLimit,
  });
}

/** The `is_username_available` database function. */
export async function isUsernameAvailableRpc(
  supabase: DataClient,
  username: string,
): Promise<{ data: boolean | null; error: any }> {
  return await supabase.rpc("is_username_available", {
    check_username: username,
  });
}

// ---- GoTrue admin ---------------------------------------------------------

/**
 * The email GoTrue holds for a user, or `''`.
 *
 * ONE function for all four Paystack checkout paths (buy-now, offer accept,
 * cart checkout and the payments route), which each inlined the same
 * `(await getClient().auth.admin.getUserById(id)).data.user?.email || ''`. The
 * empty string is the contract the callers were written against: each treats it
 * as "no verified email" and answers 400 rather than starting a checkout that
 * can never be receipted.
 */
export async function getAuthUserEmail(
  supabase: DataClient,
  userId: string,
): Promise<string> {
  const { data } = await (supabase as any).auth.admin.getUserById(userId);
  return (data?.user?.email as string | undefined) || "";
}

/**
 * When GoTrue recorded the user confirming their email, or null. Feeds the
 * creator verification level — a DIFFERENT field from `getAuthUserEmail`, which
 * is why it is a second call rather than one shared shape.
 */
export async function getAuthUserEmailConfirmedAt(
  supabase: DataClient,
  userId: string,
): Promise<string | null> {
  const { data } = await (supabase as any).auth.admin.getUserById(userId);
  return (
    (data?.user as { email_confirmed_at?: string | null } | undefined)
      ?.email_confirmed_at ?? null
  );
}

/**
 * End every GoTrue session for a user.
 *
 * KNOWN ISSUE (tracked, #108): GoTrue RESOLVES with `{ error }` rather than
 * throwing, so the `try/catch` at both call sites cannot see a reported failure
 * and it is discarded. The error is returned here so a caller CAN check it; the
 * routes are left exactly as they were, because this lane moves calls and does
 * not fix them. It is not a session-integrity hole today only because both
 * callers set the session cutoff FIRST, and that is what actually invalidates
 * the outstanding tokens.
 */
export async function signOutUserGlobally(
  supabase: DataClient,
  userId: string,
): Promise<{ error: any }> {
  const { error } = await (supabase as any).auth.admin.signOut(userId, "global");
  return { error };
}
