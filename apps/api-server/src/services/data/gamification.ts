/**
 * data/gamification.ts — points, badges, achievements, levels, streaks and the
 * denormalised counters on `profiles` that every client reads as "my stats".
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1c, step 12):
 * the whole GAMIFICATION section, 23 methods.
 *
 * ## What it touches
 *
 * Tables: `points_transactions`, `achievements`, `user_achievements`, `levels`,
 * `user_streaks`, `study_activity`, `profiles`. No storage buckets, no RPCs.
 *
 * ## The rules are NOT here
 *
 * What earns what lives in `@lantern/shared/utils/gamification`
 * (`BADGE_DEFINITIONS`, `checkAndAwardBadges`) and
 * `@lantern/shared/utils/activity` (`computeStudyStreak`), so web, mobile and
 * the server agree. This module persists the outcome and nothing more.
 *
 * ## The gotchas
 *
 * 1. THE COUNTERS ON `profiles` ARE A CACHE OF THE EVENT TABLES, AND THEY
 *    DRIFT. `recomputeDerivedUserStats` and `recomputeUserStreak` rebuild them
 *    from the source rows and `syncGamificationProgress*` reconciles the two.
 *    Prefer `incrementUserStatsAndAwardBadges` over a bare column bump — it is
 *    what runs the badge check afterwards.
 *
 * 2. `applyTestCompletionGamification` is the SINGLE entry point the tests
 *    repository calls on submit, so scoring a test awards points, badges,
 *    streak and activity in one place. Adding a second path is how the two
 *    halves drift apart.
 *
 * 3. `awardBadge` writes `profiles.badges` with the service-role client
 *    because that is the only role the lockdown trigger lets write there —
 *    which also means no RLS policy will catch a missing actor check.
 *    The activity-feed write is deliberately AFTER the already-owned early
 *    return, so a re-award cannot spam a follower feed.
 *
 * ## Why the cross-method calls go back through `deps`
 *
 * Nine of these call a sibling (`syncGamificationProgress` →
 * `recomputeDerivedUserStats`, `recomputeUserStreak` → `getStudyActivity`, …)
 * or a profile method (`getUserById`, `updateUser`). None is wired as a local
 * call: `supabase.awardBadge.test.ts`, `badgeStatsRecompute.test.ts`,
 * `supabase.boardMessages.test.ts` and `learningEvents.test.ts` stub exactly
 * these on a `SupabaseService` stand-in and drive the entry point through
 * `SupabaseService.prototype.<m>.call(self, …)`, so a sibling call would step
 * around the stub. *
 * `deps` is built ONCE per domain in `data/index.ts`, as arrows that read
 * through the layer at CALL time. (It used to be built INLINE by the
 * `SupabaseService` facade, as arrows over `this`; the facade is deleted —
 * monolith lane M3 — and the property that matters, late binding, is the
 * same.)
 *
 * `deps.recordActivity` is the activity feed's `record`, narrowed (monolith
 * lane M3) from the whole `SupabaseService` the feed service takes. The lazy
 * `await import("../activityFeed")` that used to sit in the body below now
 * sits in the arrow `data/index.ts` builds, so the import still happens when
 * the dep is CALLED and the cycle stays out of the boot path.
 */
import { logger } from "../../utils/logger";
import { PublicError } from "../../utils/safeError";
import {
  BADGE_DEFINITIONS,
  createBadge,
} from "@lantern/shared/utils/gamification";
import {
  checkAndAwardBadges,
  initialUserStats,
} from "@lantern/shared/utils/testHelpers";
import { computeStudyStreak } from "@lantern/shared/utils/activity";
import { mapUserStatsFromApi } from "@lantern/shared/utils/apiMappers";

import { cacheService } from "../cache";
import type { ActivityInput } from "../activityFeed";
import { User } from "../../types";

import type { DataClient } from "./client";

/** Same alias the monolith uses: the shape of `profiles.stats`. */
type UserStats = typeof initialUserStats;

/**
 * What a reconcile answers with. Moved from `services/supabase.ts` module
 * scope with the section (monolith lane M1c, step 12): the three methods below
 * were its only users. `services/supabase.ts` type-imports it back for the
 * delegations' return types.
 */
export type GamificationSyncResult = {
  points: number;
  badges: User["badges"];
  stats: UserStats;
  awardedBadges: User["badges"];
};

/**
 * Everything a moved body used to reach through `this`.
 *
 * Build this literal INLINE at each delegating call site, with arrows that
 * read `this.<method>` at CALL time. Hoisting it to an instance field compiles
 * and passes the surface freeze, but breaks every suite that invokes these
 * methods on a bare `{ supabase }` stand-in that never ran a constructor, and
 * bypasses every `jest.spyOn`.
 */
export type GamificationDeps = {
  /** The activity feed's `record`; see the banner. Never throws. */
  recordActivity: (input: ActivityInput) => Promise<void>;
  getUserById: (userId: string) => Promise<User | null>;
  updateUser: (
    userId: string,
    updates: Partial<User> & Record<string, unknown>,
    options?: { expectedSettingsVersion?: number },
  ) => Promise<User | null>;
  profileToGamificationUser: (
    profile: Record<string, unknown>,
    statsOverride?: Partial<UserStats>,
  ) => User;
  parseStreakReferenceDate: (referenceDate?: string) => Date;
  awardPoints: (
    userId: string,
    points: number,
    reason: string,
    source?: string,
  ) => Promise<any>;
  getLevels: () => Promise<any[]>;
  getUserLevel: (userId: string) => Promise<any>;
  getStudyActivity: (userId: string, days?: number) => Promise<any[]>;
  recordStudyActivity: (
    userId: string,
    type: string,
    amount?: number,
    activityDate?: string,
  ) => Promise<any>;
  recomputeDerivedUserStats: (userId: string) => Promise<Partial<UserStats>>;
  recomputeUserStreak: (
    userId: string,
    referenceDate?: string,
  ) => Promise<{
    user_id: string;
    current_streak: number;
    longest_streak: number;
    last_login_date: string | null;
    streak_freezes: number;
    updated_at: string;
  }>;
  syncGamificationProgressWithStats: (
    userId: string,
    options?: any,
  ) => Promise<GamificationSyncResult>;
};

export async function getLeaderboard(
  supabase: DataClient,
  options: {
    page?: number;
    limit?: number;
    timeframe?: string;
    metric?: string;
    institutionId?: string;
    ambassador?: boolean;
  } = {},
): Promise<any[]> {
  const {
    page = 1,
    limit = 50,
    timeframe = "all",
    metric = "points",
    institutionId,
    ambassador,
  } = options;
  const offset = (page - 1) * limit;

  const cacheKey = `gamification:leaderboard:${page}:${limit}:${timeframe}:${metric}:${institutionId || ""}:${ambassador ? "1" : "0"}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      let query = supabase
        .from("profiles")
        .select("id, name, avatar_url, points, stats, is_ambassador, institution_id")
        .order("points", { ascending: false });

      if (ambassador) {
        query = query.eq("is_ambassador", true);
      }
      if (institutionId) {
        query = query.eq("institution_id", institutionId);
      }

      // Apply timeframe filtering if needed (simplified)
      if (timeframe !== "all") {
        // In a real implementation, you'd filter based on recent activity
        // For now, just return all users
      }

      const { data, error } = await query.range(offset, offset + limit - 1);

      if (error) throw error;

      return (data || []).map((user: any, index: number) => ({
        rank: offset + index + 1,
        user: {
          id: user.id,
          name: user.name,
          avatarUrl: user.avatar_url,
          points: user.points || 0,
          stats: user.stats || {},
          campusAmbassador: user.is_ambassador ? 1 : 0,
        },
      }));
    },
    { ttl: 300 },
  ); // Cache for 5 minutes
}

export async function getAchievements(
  supabase: DataClient,
  options: {
    page?: number;
    limit?: number;
    category?: string;
  } = {},
): Promise<any[]> {
  const { page = 1, limit = 20, category } = options;
  const offset = (page - 1) * limit;

  const cacheKey = `gamification:achievements:${page}:${limit}:${category || ""}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      let query = supabase.from("achievements").select("*");

      if (category) {
        query = query.eq("category", category);
      }

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return data || [];
    },
    { ttl: 1800 },
  ); // Cache for 30 minutes
}

export async function getUserAchievements(
  supabase: DataClient,
  userId: string,
  options: {
    page?: number;
    limit?: number;
  } = {},
): Promise<any[]> {
  const { page = 1, limit = 20 } = options;
  const offset = (page - 1) * limit;

  const cacheKey = `gamification:user:achievements:${userId}:${page}:${limit}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from("user_achievements")
        .select(
          `
        *,
        achievements (*)
      `,
        )
        .eq("user_id", userId)
        .order("unlocked_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return (
        data?.map((ua: any) => ({
          ...ua.achievements,
          unlockedAt: ua.unlocked_at,
          progress: ua.progress,
        })) || []
      );
    },
    { ttl: 600 },
  ); // Cache for 10 minutes
}

export async function awardPoints(
  supabase: DataClient,
  userId: string,
  points: number,
  reason: string,
  source?: string,
): Promise<any> {
  // Get current points
  const { data: user, error: userError } = await supabase
    .from("profiles")
    .select("points")
    .eq("id", userId)
    .single();

  if (userError) throw userError;

  const currentPoints = user?.points || 0;
  const newPoints = currentPoints + points;

  // Update user points
  const { data, error } = await supabase
    .from("profiles")
    .update({ points: newPoints })
    .eq("id", userId)
    .select()
    .single();

  if (error) throw error;

  // Optional audit log — table may not exist on older deployments
  const { error: logError } = await supabase
    .from("points_transactions")
    .insert({
      user_id: userId,
      points,
      reason,
      source: source || "manual",
    });

  if (logError) {
    logger.warn("points_transactions insert skipped", {
      userId,
      code: logError.code,
      message: logError.message,
    });
  }

  // Invalidate caches
  await cacheService.deletePattern(`gamification:leaderboard:*`);
  await cacheService.delete(`user:stats:${userId}`);
  await cacheService.deletePattern(
    `gamification:user:achievements:${userId}:*`,
  );

  return {
    userId,
    pointsAwarded: points,
    newTotal: newPoints,
    reason,
    source,
  };
}

export async function awardAchievement(
  supabase: DataClient,
  deps: GamificationDeps,
  userId: string,
  achievementId: string,
): Promise<any> {
  // Check if user already has this achievement
  const { data: existing, error: checkError } = await supabase
    .from("user_achievements")
    .select("id")
    .eq("user_id", userId)
    .eq("achievement_id", achievementId)
    .single();

  if (checkError && checkError.code !== "PGRST116") throw checkError;

  if (existing) {
    throw new Error("User already has this achievement");
  }

  // Award the achievement
  const { data, error } = await supabase
    .from("user_achievements")
    .insert({
      user_id: userId,
      achievement_id: achievementId,
      unlocked_at: new Date().toISOString(),
      progress: 100,
    })
    .select(
      `
      *,
      achievements (*)
    `,
    )
    .single();

  if (error) throw error;

  // Award points for achievement if configured
  const achievement = data.achievements;
  if (achievement.points_reward) {
    await deps.awardPoints(
      userId,
      achievement.points_reward,
      `Achievement unlocked: ${achievement.name}`,
      "achievement",
    );
  }

  // Invalidate caches
  await cacheService.deletePattern(
    `gamification:user:achievements:${userId}:*`,
  );

  return {
    ...achievement,
    unlockedAt: data.unlocked_at,
    progress: data.progress,
  };
}

export async function getUserProgress(
  supabase: DataClient,
  deps: GamificationDeps,
  userId: string
): Promise<any> {
  const cacheKey = `gamification:user:progress:${userId}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      // Get user stats
      const user = await deps.getUserById(userId);
      if (!user) throw new Error("User not found");

      // Get achievements progress
      const { data: achievements, error: achError } = await supabase
        .from("user_achievements")
        .select("achievement_id, progress")
        .eq("user_id", userId);

      if (achError) throw achError;

      // Get level info
      const level = await deps.getUserLevel(userId);

      return {
        userId,
        points: user.points || 0,
        level: level.currentLevel,
        achievementsUnlocked: achievements?.length || 0,
        nextLevelPoints: level.nextLevelPoints,
        progressToNextLevel: level.progressToNextLevel,
        stats: user.stats || {},
      };
    },
    { ttl: 300 },
  ); // Cache for 5 minutes
}

export async function getGamificationStats(
  supabase: DataClient,
): Promise<any> {
  const cacheKey = "gamification:stats";

  return cacheService.cached(
    cacheKey,
    async () => {
      // Get total users
      const { count: totalUsers, error: usersError } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true });

      // Get total achievements unlocked
      const { count: totalAchievements, error: achError } =
        await supabase
          .from("user_achievements")
          .select("id", { count: "exact", head: true });

      // Get total points awarded
      const { data: pointsData, error: pointsError } = await supabase
        .from("profiles")
        .select("points");

      if (usersError || achError || pointsError) {
        throw usersError || achError || pointsError;
      }

      const totalPoints =
        pointsData?.reduce((sum, user) => sum + (user.points || 0), 0) || 0;

      return {
        totalUsers: totalUsers || 0,
        totalAchievements: totalAchievements || 0,
        totalPoints,
        averagePointsPerUser: totalUsers ? totalPoints / totalUsers : 0,
      };
    },
    { ttl: 600 },
  ); // Cache for 10 minutes
}

// ---------------------------------------------------------------------------
// Badges
//
// There is no `badges` / `user_badges` table — no migration ever created one.
// Badges live in profiles.badges (JSONB array of Badge objects, the shape
// checkAndAwardBadges writes) and the gamification lockdown trigger
// (supabase/migrations/20260704100100_gamification_lockdown.sql) only lets the
// service role change that column, which is exactly the client this service
// holds. Everything below reads and writes that column directly.
// ---------------------------------------------------------------------------

/**
 * The badge catalogue. Static — it is BADGE_DEFINITIONS, not a table — so the
 * pagination args are honoured only to keep the route's contract. `category`
 * was a column on the table that never existed; badges have no categories, so
 * any non-empty category matches nothing.
 */
export async function getBadges(
  supabase: DataClient,
  options: {
    page?: number;
    limit?: number;
    category?: string;
  } = {},
): Promise<any[]> {
  const { page = 1, limit = 20, category } = options;
  if (category) return [];
  const offset = (Math.max(1, page) - 1) * Math.max(1, limit);
  return Object.values(BADGE_DEFINITIONS)
    .map((def) => ({
      id: def.id,
      name: def.baseName,
      description: def.baseDescription(def.levels[0]?.threshold ?? 0),
      icon: def.icon,
      metric: def.metric,
      levels: def.levels,
    }))
    .slice(offset, offset + Math.max(1, limit));
}

/** Badges the user holds, newest first, straight from profiles.badges. */
export async function getUserBadges(
  supabase: DataClient,
  userId: string,
  options: {
    page?: number;
    limit?: number;
  } = {},
): Promise<any[]> {
  const { page = 1, limit = 20 } = options;
  const offset = (Math.max(1, page) - 1) * Math.max(1, limit);

  const { data, error } = await supabase
    .from("profiles")
    .select("badges")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;

  const badges = Array.isArray(data?.badges) ? [...data.badges] : [];
  badges.sort(
    (a: any, b: any) =>
      Date.parse(String(b?.dateAwarded ?? "")) -
        Date.parse(String(a?.dateAwarded ?? "")) || 0,
  );
  return badges.slice(offset, offset + Math.max(1, limit));
}

/**
 * Manually grant a badge (admin console). Appends a level-1 Badge object in
 * the exact shape checkAndAwardBadges writes, so the dashboards and the
 * automatic levelling (which looks for `currentLevel + 1`) treat it as any
 * earned badge. Idempotent: a badge the user already holds — at any level —
 * is left untouched and reported as `awarded: false`. Points are not changed;
 * the console has a separate control for that.
 */
export async function awardBadge(
  supabase: DataClient,
  deps: GamificationDeps,
  userId: string,
  badgeId: string,
  actorId?: string,
): Promise<{
  awarded: boolean;
  badge: ReturnType<typeof createBadge> | null;
  badges: ReturnType<typeof createBadge>[];
}> {
  if (
    typeof badgeId !== "string" ||
    !Object.prototype.hasOwnProperty.call(BADGE_DEFINITIONS, badgeId)
  ) {
    throw Object.assign(
      new PublicError(
        `Unknown badge id: ${String(badgeId)}. Known ids: ${Object.keys(BADGE_DEFINITIONS).join(", ")}`,
      ),
      { statusCode: 400 },
    );
  }
  const knownId = badgeId as keyof typeof BADGE_DEFINITIONS;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, badges")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!profile) {
    throw Object.assign(new PublicError("User not found"), {
      statusCode: 404,
    });
  }

  const current: ReturnType<typeof createBadge>[] = Array.isArray(
    profile.badges,
  )
    ? [...profile.badges]
    : [];
  const existing = current.find((b: any) => b?.id === knownId);
  if (existing) {
    return { awarded: false, badge: existing, badges: current };
  }

  const badge = createBadge(knownId, 1);
  const next = [...current, badge];

  // Service-role client: the only role the lockdown trigger lets write here.
  const { error: writeError } = await supabase
    .from("profiles")
    .update({ badges: next })
    .eq("id", userId);
  if (writeError) throw writeError;

  await cacheService.invalidateUserCache(userId);
  await cacheService.deletePattern(`gamification:user:badges:${userId}:*`);
  logger.info("Badge granted manually", { userId, badgeId: knownId, actorId });

  // Phase 3 M: unlocked_badge had no writer. Only the FIRST award reaches
  // here (the already-owned case returns above), so this cannot spam a feed.
  void (async () => {
    await deps.recordActivity({
      actorId: userId,
      verb: "unlocked_badge",
      objectType: "badge",
      objectId: badgeId,
      audienceType: "followers",
      payload: { title: (badge as { name?: string } | null)?.name ?? null },
    });
  })();

  return { awarded: true, badge, badges: next };
}

export async function getLevels(
  supabase: DataClient,
): Promise<any[]> {
  const cacheKey = "gamification:levels";

  return cacheService.cached(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from("levels")
        .select("*")
        .order("level_number", { ascending: true });

      if (error) throw error;

      return data || [];
    },
    { ttl: 3600 },
  ); // Cache for 1 hour
}

export async function getUserLevel(
  supabase: DataClient,
  deps: GamificationDeps,
  userId: string
): Promise<any> {
  const cacheKey = `gamification:user:level:${userId}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      const user = await deps.getUserById(userId);
      if (!user) throw new Error("User not found");

      const points = user.points || 0;
      const levels = await deps.getLevels();

      // Find current level
      let currentLevel = levels[0]; // Default to first level
      let nextLevel = null;

      for (let i = 0; i < levels.length; i++) {
        if (points >= levels[i].points_required) {
          currentLevel = levels[i];
          nextLevel = levels[i + 1] || null;
        } else {
          break;
        }
      }

      const progressToNextLevel = nextLevel
        ? ((points - currentLevel.points_required) /
            (nextLevel.points_required - currentLevel.points_required)) *
          100
        : 100;

      return {
        currentLevel: currentLevel.level_number,
        levelName: currentLevel.name,
        currentPoints: points,
        pointsRequired: currentLevel.points_required,
        nextLevelPoints:
          nextLevel?.points_required || currentLevel.points_required,
        progressToNextLevel: Math.min(100, Math.max(0, progressToNextLevel)),
        rewards: currentLevel.rewards || [],
      };
    },
    { ttl: 300 },
  ); // Cache for 5 minutes
}

export async function recordStudyActivity(
  supabase: DataClient,
  userId: string,
  type: string,
  amount = 1,
  activityDate?: string,
): Promise<any> {
  const vAmount = Math.max(Math.floor(Number(amount) || 1), 0);
  const activityDateStr =
    activityDate && /^\d{4}-\d{2}-\d{2}$/.test(activityDate)
      ? activityDate
      : new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase.rpc("record_study_activity", {
    p_user_id: userId,
    p_type: type,
    p_amount: vAmount,
    p_activity_date: activityDateStr,
  });

  if (error) throw error;
  return data;
}

export function profileToGamificationUser(
  supabase: DataClient,
  profile: Record<string, unknown>,
  statsOverride?: Partial<UserStats>,
): User {
  const normalizedStats = mapUserStatsFromApi(profile.stats || {});
  return {
    id: String(profile.id),
    name: String(profile.name || ""),
    email: String(profile.email || ""),
    password: "",
    phoneNumber: String(profile.phone || ""),
    avatarUrl: String(profile.avatar_url || profile.avatarUrl || ""),
    points: Number(profile.points) || 0,
    badges: (profile.badges as User["badges"]) || [],
    stats: {
      ...initialUserStats,
      ...normalizedStats,
      ...(statsOverride || {}),
    },
  } as User;
}

export async function incrementUserStatsAndAwardBadges(
  supabase: DataClient,
  deps: GamificationDeps,
  userId: string,
  increments: Partial<UserStats>,
): Promise<GamificationSyncResult> {
  const profile = await deps.getUserById(userId);
  if (!profile) {
    throw new Error("User not found");
  }

  const base = deps.profileToGamificationUser(
    profile as unknown as Record<string, unknown>,
  );
  const stats = { ...base.stats };
  for (const key of Object.keys(increments) as (keyof UserStats)[]) {
    const delta = increments[key];
    if (typeof delta === "number" && delta !== 0) {
      stats[key] = (stats[key] || 0) + delta;
    }
  }

  const { updatedUser, awardedBadges } = checkAndAwardBadges({
    ...base,
    stats,
  });
  await deps.updateUser(userId, {
    points: updatedUser.points,
    badges: updatedUser.badges,
    stats: updatedUser.stats,
  });
  await cacheService.delete(`user:${userId}`);

  return {
    points: updatedUser.points,
    badges: updatedUser.badges,
    stats: updatedUser.stats,
    awardedBadges,
  };
}

/**
 * Recount the badge stats that can be derived from source tables.
 *
 * These were previously only ever incremented on events, so they drifted in
 * both directions and no client agreed with the dashboard: a failed increment
 * is swallowed and silently undercounts, while re-submitting a result re-ran
 * the increment and overcounted. Counting from the rows themselves is
 * self-healing — whatever the history, the answer converges on the truth.
 *
 * Only derivable metrics are returned. gamesWon has no reliable source query
 * yet, so it is deliberately absent and the caller must preserve the stored
 * value rather than treat it as zero. The marketplace counters are derived:
 *   listingsCreated  — every marketplace_listings row the user owns
 *   listingsSold     — distinct listings that are either status 'sold' (manual
 *                      mark-as-sold, or flipped by order completion) or have a
 *                      completed marketplace_orders row for this seller. The
 *                      union catches multi-quantity listings that stay active
 *                      after a sale and sold listings later relisted/archived,
 *                      while never counting one listing twice.
 *   fiveStarReviews  — marketplace_reviews with rating 5 on the user's listings
 *                      (reviews have no seller column; joined via the listing)
 *   offersMade       — marketplace_offers rows where the user is buyer_id. Only
 *                      buyers create offer rows; seller counters update the row
 *                      in place, so buyer_id = "who made the offer".
 */
export async function recomputeDerivedUserStats(
  supabase: DataClient,
  userId: string
): Promise<Partial<UserStats>> {
  const [
    sessions,
    questionCount,
    topQuestion,
    groupCount,
    listingCount,
    soldListings,
    completedOrders,
    fiveStarReviewCount,
    offerCount,
    ambassadorFlag,
  ] = await Promise.all(
    [
      supabase
        .from("test_sessions")
        .select("start_time, test_results (score)")
        .eq("user_id", userId)
        .eq("status", "completed"),
      supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("sender_id", userId)
        .eq("type", "QUESTION"),
      supabase
        .from("messages")
        .select("upvotes")
        .eq("sender_id", userId)
        .eq("type", "QUESTION")
        .order("upvotes", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // createGroup writes `admin_ids: [userId]`, so element 0 is the creator;
      // later admins are appended, leaving that entry intact. Filtering on
      // `admin_ids->>0` directly would be neater, but supabase-js URL-encodes
      // column names and PostgREST then fails to read it as a JSON path — so
      // match on containment, which encodes safely, and check position here.
      supabase
        .from("groups")
        .select("admin_ids")
        .contains("admin_ids", [userId]),
      supabase
        .from("marketplace_listings")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("marketplace_listings")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "sold"),
      supabase
        .from("marketplace_orders")
        .select("listing_id")
        .eq("seller_id", userId)
        .eq("status", "completed"),
      // Reviews carry no seller column, so filter through an inner join on the
      // listing: `!inner` makes the embedded filter drop parent rows too, and
      // the exact count is taken over that joined result.
      supabase
        .from("marketplace_reviews")
        .select("id, marketplace_listings!inner(user_id)", {
          count: "exact",
          head: true,
        })
        .eq("rating", 5)
        .eq("marketplace_listings.user_id", userId),
      supabase
        .from("marketplace_offers")
        .select("id", { count: "exact", head: true })
        .eq("buyer_id", userId),
      supabase
        .from("profiles")
        .select("is_ambassador")
        .eq("id", userId)
        .maybeSingle(),
    ],
  );

  // Deduplicate by start-time, matching how the dashboard counts. A genuine
  // double-submit can leave two session rows for one sitting, and the badge
  // count has to agree with the number the user is shown.
  const seenStartTimes = new Set<string>();
  let testsCompleted = 0;
  let highScoreTests = 0;
  let perfectScoreTests = 0;

  for (const row of (sessions.data || []) as any[]) {
    const startTime = String(row.start_time ?? "");
    if (startTime && seenStartTimes.has(startTime)) continue;
    if (startTime) seenStartTimes.add(startTime);

    testsCompleted++;
    const result = Array.isArray(row.test_results)
      ? row.test_results[0]
      : row.test_results;
    const score = Number(result?.score);
    if (!Number.isFinite(score)) continue;
    if (score >= 80) highScoreTests++;
    if (score >= 100) perfectScoreTests++;
  }

  const derived: Partial<UserStats> = {
    testsCompleted,
    highScoreTests,
    perfectScoreTests,
  };

  // A failed count must not be mistaken for "zero of them" — leaving the key
  // out preserves whatever is already stored.
  if (!questionCount.error && typeof questionCount.count === "number") {
    derived.questionsCreated = questionCount.count;
  }
  if (!groupCount.error && Array.isArray(groupCount.data)) {
    derived.groupsCreated = (groupCount.data as any[]).filter((row) => {
      const admins = row?.admin_ids;
      const first = Array.isArray(admins) ? admins[0] : undefined;
      return String(first ?? "") === userId;
    }).length;
  }
  if (!topQuestion.error) {
    derived.questionUpvotesMax = Number(topQuestion.data?.upvotes) || 0;
  }
  if (sessions.error) {
    delete derived.testsCompleted;
    delete derived.highScoreTests;
    delete derived.perfectScoreTests;
    logger.warn("Could not recount test stats; keeping stored values", {
      userId,
      error: sessions.error.message,
    });
  }

  // Marketplace counters — same rule: a failed read leaves the key out.
  if (!listingCount.error && typeof listingCount.count === "number") {
    derived.listingsCreated = listingCount.count;
  }
  if (soldListings.error || completedOrders.error) {
    logger.warn("Could not recount listings sold; keeping stored value", {
      userId,
      error:
        soldListings.error?.message ?? completedOrders.error?.message,
    });
  } else {
    const soldIds = new Set<string>();
    for (const row of (soldListings.data || []) as any[]) {
      if (row?.id) soldIds.add(String(row.id));
    }
    for (const row of (completedOrders.data || []) as any[]) {
      if (row?.listing_id) soldIds.add(String(row.listing_id));
    }
    derived.listingsSold = soldIds.size;
  }
  if (
    !fiveStarReviewCount.error &&
    typeof fiveStarReviewCount.count === "number"
  ) {
    derived.fiveStarReviews = fiveStarReviewCount.count;
  }
  if (!offerCount.error && typeof offerCount.count === "number") {
    derived.offersMade = offerCount.count;
  }
  if (!ambassadorFlag.error) {
    derived.campusAmbassador =
      (ambassadorFlag.data as { is_ambassador?: boolean } | null)?.is_ambassador === true
        ? 1
        : 0;
  }

  return derived;
}

export async function syncGamificationProgress(
  supabase: DataClient,
  deps: GamificationDeps,
  userId: string,
): Promise<GamificationSyncResult> {
  // Reconcile against source data before re-evaluating. checkAndAwardBadges
  // only ever looks for currentLevel + 1, so a corrected-downwards count can
  // never revoke a badge the user already holds.
  const derived = await deps.recomputeDerivedUserStats(userId).catch((err) => {
    logger.warn("Stat recompute failed; evaluating against stored stats", {
      userId,
      err,
    });
    return {} as Partial<UserStats>;
  });
  return deps.syncGamificationProgressWithStats(userId, { stats: derived });
}

/** Server-only: apply trusted stats before badge evaluation (e.g. after test completion). */
export async function syncGamificationProgressWithStats(
  supabase: DataClient,
  deps: GamificationDeps,
  userId: string,
  options: {
    stats?: Partial<UserStats>;
    activityDate?: string;
  } = {},
): Promise<GamificationSyncResult> {
  const profile = await deps.getUserById(userId);
  if (!profile) {
    throw new Error("User not found");
  }

  // What the profile holds now, before any recomputed stats are layered on —
  // the baseline for deciding whether this sync actually changed anything.
  const stored = deps.profileToGamificationUser(
    profile as unknown as Record<string, unknown>,
  );
  const user = deps.profileToGamificationUser(
    profile as unknown as Record<string, unknown>,
    options.stats,
  );
  const { updatedUser, awardedBadges } = checkAndAwardBadges(user);

  // Both clients call this on every dashboard load, so writing unconditionally
  // would mean a profile UPDATE per screen open for no reason. Only persist
  // when the reconciliation or an award genuinely moved something.
  const changed =
    updatedUser.points !== stored.points ||
    JSON.stringify(updatedUser.stats) !== JSON.stringify(stored.stats) ||
    JSON.stringify(updatedUser.badges) !== JSON.stringify(stored.badges);

  if (changed) {
    await deps.updateUser(userId, {
      points: updatedUser.points,
      badges: updatedUser.badges,
      stats: updatedUser.stats,
    });
    await cacheService.delete(`user:${userId}`);
  }

  return {
    points: updatedUser.points,
    badges: updatedUser.badges,
    stats: updatedUser.stats,
    awardedBadges,
  };
}

// No `score` parameter: the score of the test that triggered this is read back
// from the saved rows along with every other test, rather than trusted from
// the caller and added to a running total.
export async function applyTestCompletionGamification(
  supabase: DataClient,
  deps: GamificationDeps,
  userId: string,
  activityDate?: string,
): Promise<{
  points: number;
  badges: User["badges"];
  stats: UserStats;
  awardedBadges: User["badges"];
}> {
  const profile = await deps.getUserById(userId);
  if (!profile) {
    throw new Error("User not found");
  }

  // Recount from the saved rows instead of incrementing. The result row is
  // upserted on session_id, so it is idempotent — but the old increment was
  // not, and re-submitting a test inflated these counters permanently. The
  // session is marked completed before its result is written, so the test that
  // triggered this is already included; if that ever changes, the count is one
  // low until the next sync rather than wrong forever.
  const stats = {
    ...deps.profileToGamificationUser(
      profile as unknown as Record<string, unknown>,
    ).stats,
    ...(await deps.recomputeDerivedUserStats(userId).catch((err) => {
      logger.warn("Stat recompute failed after test completion", {
        userId,
        err,
      });
      return {} as Partial<UserStats>;
    })),
  };

  const result = await deps.syncGamificationProgressWithStats(userId, {
    stats,
  });
  await deps.recordStudyActivity(userId, "test", 1, activityDate).catch(
    (err) => {
      logger.warn("Failed to record study activity after test", {
        userId,
        err,
      });
    },
  );
  await deps.recomputeUserStreak(userId, activityDate).catch((err) => {
    logger.warn("Failed to recompute streak after test", { userId, err });
  });
  return result;
}

export async function touchLastSeen(
  supabase: DataClient,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
}

export async function getStudyActivity(
  supabase: DataClient,
  userId: string,
  days = 112,
): Promise<
  Array<{
    date: string;
    count: number;
    breakdown: Partial<Record<string, number>>;
  }>
> {
  const since = new Date();
  since.setDate(since.getDate() - Math.max(1, days) + 1);
  const sinceDate = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("study_activity")
    .select(
      "activity_date, count, test_count, flashcard_count, new_flashcard_count, question_count, game_count, daily_quiz_count",
    )
    .eq("user_id", userId)
    .gte("activity_date", sinceDate)
    .order("activity_date", { ascending: true });

  if (error) throw error;

  return (data || []).map((row: any) => ({
    date: row.activity_date,
    count: row.count ?? 0,
    breakdown: {
      test: row.test_count ?? 0,
      flashcard: row.flashcard_count ?? 0,
      flashcard_new: row.new_flashcard_count ?? 0,
      study_question: row.question_count ?? 0,
      game: row.game_count ?? 0,
      daily_quiz: row.daily_quiz_count ?? 0,
    },
  }));
}

export function parseStreakReferenceDate(
  supabase: DataClient,
  referenceDate?: string
): Date {
  if (referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
    const [y, m, d] = referenceDate.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date();
}

/** Recompute streak from study_activity (heatmap-aligned, client-local dates). */
export async function recomputeUserStreak(
  supabase: DataClient,
  deps: GamificationDeps,
  userId: string,
  referenceDate?: string,
): Promise<{
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_login_date: string | null;
  streak_freezes: number;
  updated_at: string;
}> {
  const STREAK_LOOKBACK_DAYS = 400;
  const activityDays = await deps.getStudyActivity(
    userId,
    STREAK_LOOKBACK_DAYS,
  );
  const ref = deps.parseStreakReferenceDate(referenceDate);
  const { current, longest, lastActiveDate } = computeStudyStreak(
    activityDays,
    ref,
  );

  const { data: existing } = await supabase
    .from("user_streaks")
    .select("streak_freezes, longest_streak")
    .eq("user_id", userId)
    .maybeSingle();

  const streakFreezes = existing?.streak_freezes ?? 0;
  const longestStreak = Math.max(existing?.longest_streak ?? 0, longest);

  const { data, error } = await supabase
    .from("user_streaks")
    .upsert(
      {
        user_id: userId,
        current_streak: current,
        longest_streak: longestStreak,
        last_login_date: lastActiveDate,
        streak_freezes: streakFreezes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ============ STREAK FREEZES AND DAILY QUESTS ============
//
// Moved VERBATIM out of `routes/gamification.ts` (monolith lane R2, PR 2a).
// They were built inline in the handlers, which is the layering violation the
// lane closes. The DECISIONS stay in the route: whether a caller has a freeze to
// spend, what the new progress count is, whether the wallet debit is refunded,
// and every status code. These own the query and nothing else, returning
// PostgREST's `{data, error}` exactly as the inline code consumed it.
//
// `userId` is a REQUIRED parameter on all but one of them, and each applies the
// predicate itself: the service role BYPASSES RLS, so it is the access control.
// The exception is `updateDailyQuestProgress` — see its own comment.

/** The caller's whole streak row, or none if they have never studied. */
export async function getUserStreakRow(
  supabase: DataClient,
  userId: string,
): Promise<{ data: any | null; error: any }> {
  return await supabase
    .from("user_streaks")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
}

/**
 * Spend one freeze: the caller has already checked they have one, and passes
 * the count that should remain. Returns the updated row for the response.
 */
export async function spendStreakFreeze(
  supabase: DataClient,
  userId: string,
  remainingFreezes: number,
  lastLoginDate: string,
): Promise<{ data: any | null; error: any }> {
  return await supabase
    .from("user_streaks")
    .update({
      streak_freezes: remainingFreezes,
      last_login_date: lastLoginDate,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .select()
    .single();
}

/**
 * Write the caller's streak row back with one more freeze on it. An upsert
 * rather than an update because a student can buy a freeze before they have
 * ever had a streak row; the caller supplies the carried-over counters it read.
 */
export async function grantStreakFreeze(
  supabase: DataClient,
  userId: string,
  carried: {
    current_streak: number;
    longest_streak: number;
    last_login_date: string | null;
    streak_freezes: number;
  },
): Promise<{ data: any | null; error: any }> {
  return await supabase
    .from("user_streaks")
    .upsert(
      {
        user_id: userId,
        ...carried,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select()
    .single();
}

/**
 * Seed one day's quests for the caller. `ignoreDuplicates` on the composite key
 * makes it safe to call on every read; the caller ALSO tolerates a `23505` on
 * top of that, because two tabs opening the quest rail at once is the ordinary
 * case, not the exception. Both halves of that race handling are load-bearing.
 */
export async function seedDailyQuests(
  supabase: DataClient,
  userId: string,
  questDate: string,
  templates: ReadonlyArray<Record<string, unknown>>,
): Promise<{ error: any }> {
  const { error } = await supabase
    .from("daily_quests")
    .upsert(
      templates.map((t) => ({ ...t, user_id: userId, quest_date: questDate })),
      { onConflict: "user_id,quest_date,quest_type", ignoreDuplicates: true },
    );
  return { error };
}

/** Every quest the caller has for one day. */
export async function listDailyQuests(
  supabase: DataClient,
  userId: string,
  questDate: string,
): Promise<{ data: any[] | null; error: any }> {
  return await supabase
    .from("daily_quests")
    .select("*")
    .eq("user_id", userId)
    .eq("quest_date", questDate);
}

/** One quest of the caller's, by day and type. */
export async function getDailyQuest(
  supabase: DataClient,
  userId: string,
  questDate: string,
  questType: string,
): Promise<{ data: any | null; error: any }> {
  return await supabase
    .from("daily_quests")
    .select("*")
    .eq("user_id", userId)
    .eq("quest_date", questDate)
    .eq("quest_type", questType)
    .maybeSingle();
}

/**
 * Advance one quest, BY ID ALONE — the only function here without an owner
 * predicate. It is safe as the route calls it, because `questId` comes from
 * `getDailyQuest` three lines above, which IS owner-scoped. It is kept verbatim
 * (monolith lane R2 moves queries, it does not harden them) and named as an
 * unscoped write in the pull request, so a future caller knows what it must
 * guarantee: never pass an id the caller has not been proven to own.
 */
export async function updateDailyQuestProgress(
  supabase: DataClient,
  questId: string,
  progressCount: number,
  completed: boolean,
): Promise<{ data: any | null; error: any }> {
  return await supabase
    .from("daily_quests")
    .update({ progress_count: progressCount, completed })
    .eq("id", questId)
    .select()
    .single();
}
