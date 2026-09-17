/**
 * User routes — profiles, settings, account lifecycle, presence, blocks,
 * budgets and creator follows for the signed-in student.
 *
 * Mount: `/api/v1/users` (server.ts). Two sibling routers are mounted BEFORE
 * this one — `/api/v1/users/me/courses` and `/api/v1/users/me/study-sets` —
 * because Express matches in registration order and `/:userId` would otherwise
 * capture the literal `me` segment. The same rule applies inside this file:
 * `/search`, `/me`, `/settings`, `/check-username/:username`, `/push-token`
 * and `/presence/*` are all declared before the `/:userId` routes that would
 * swallow them.
 *
 * Auth: every route runs `authMiddleware` except
 * `GET /check-username/:username`, which is public so the sign-up form can
 * check availability before an account exists.
 *
 * Rate limits: `authMiddleware` applies the shared `authenticatedRateLimit`
 * tier. Three routes add a stricter tier on top — `searchRateLimit` on
 * `/search`, `usernameCheckRateLimit` on `/check-username/:username`, and
 * `dataExportRateLimit` on `/:userId/export` and `/:userId/import`.
 *
 * Ownership predicate: this router uses the service-role Supabase client, so
 * RLS never applies and each handler carries its own predicate. There are two,
 * and the difference is deliberate:
 *
 *   `isSelfOrLivePlatformAdmin(req, userId)` — self, or a platform admin
 *       re-resolved live from `platform_admins` (never a JWT claim). Used for
 *       profile reads and writes, settings, stats, groups, avatar, export and
 *       delete, so support can act on a user's behalf.
 *   `requestingUserId !== userId` → 403 — SELF ONLY, no admin escape hatch.
 *       Used for deactivate/reactivate, import, blocks, username and budget.
 *       Nothing in support needs to read a student's finances or block list.
 *
 * Error mapping: handlers return `{ success: false, error }` with an explicit
 * status. A `version_conflict` from `updateUser` becomes a 409 carrying the
 * current server state so the client can rebase; `PublicError` from a service
 * becomes its `statusCode` (4xx only) and anything else rethrows to the global
 * handler, so a real fault is never masked as the caller's mistake.
 *
 * What it touches: Supabase tables `profiles`, `user_budgets`,
 * `marketplace_campuses` (via `academicCourses`), and — through the services
 * it delegates to — creator follows, communities, moderation, study presence
 * and study sets. Storage bucket `profile-avatars` (avatar upload). Redis via
 * `cacheService` (`user:*`, `user:settings:*`, `users:list:*`,
 * `institution:*`, `creator:verification:*`, `referral:activation:*`) and via
 * `getRedisClient` for the push-token registration stamp. No external HTTP API
 * is called directly; Expo push tokens are only stored here.
 *
 * The profile model: `profiles` is the private row (phone, settings, push
 * token, academic identity). Its RLS policy `profiles_select_own` is
 * OWNER-ONLY SELECT — the single most important policy in the schema. Every
 * other viewer reads the `member_profiles` view, a security_invoker projection
 * of the privacy-safe columns gated by `profile_visible_to(id)`. This router
 * bypasses both (service role), so `toPublicUser` is the code-side equivalent:
 * non-owner, non-admin responses go through it and drop phone, settings,
 * entryYear and expectedGraduationYear. Widening `toPublicUser` widens the
 * whole platform.
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, requirePlatformAdmin } from '../middleware/auth';
import { mergeUserSettings, isPushEnabledInSettings } from '../utils/sanitizeSettings';
import { parseUserSettings } from '../utils/userSettingsPolicy';
import { canViewStudyActivity, getPrivacySafeProfileFields, resolvePublicOnlineStatus } from '@lantern/shared/settings';
import { handleValidationErrors, validateUserId, validateCreateUser, validateUpdateUser, validatePagination, validateAccountPasswordBody, validateAccountImportBody } from '../middleware/validation';
import type { DataLayer } from '../services/data';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { requireAuthUserId } from '../utils/requestAuth';
import {
  isLivePlatformAdmin,
  isSelfOrLivePlatformAdmin,
} from '../utils/platformAdminAuth';
import { AuthenticatedRequest, User, Group } from '../types';
import { dataExportRateLimit, searchRateLimit, usernameCheckRateLimit } from '../middleware/rateLimit';
import { runSyncOrEnqueue } from '../queue/enqueue';
import { sendAsyncJobAccepted } from '../queue/respondAsync';
import { logAdminAction } from '../services/adminAudit';
import {
  getAccountLifecycle,
  isAccountDeactivated,
  reactivateAccount,
  scheduleAccountDeletion,
  verifyUserPassword,
} from '../services/accountLifecycle';
import { importAccountArchive } from '../services/accountImport';
import { deleteUserAccountFully } from '../services/userDataLifecycle';
import { getStudyPresenceService } from '../services/studyPresence';
import { ACCOUNT_DELETION_GRACE_DAYS } from '@lantern/shared/accountLifecycle';
import { getAcademicCoursesService } from '../services/academicCourses';
import { PublicError } from '../utils/safeError';
import { getRedisClient, redisKey } from '../services/redisStore';
import { withUpstreamTimeout, PRESENCE_UPSTREAM_TIMEOUT_MS } from '../utils/upstreamTimeout';

const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** Academic identity fields a user may set on their own profile (PUT /users/:userId). */
export const ACADEMIC_PROFILE_FIELDS = [
  'institutionId',
  'faculty',
  'programme',
  'studyLevel',
  'currentSemester',
  'entryYear',
  'expectedGraduationYear',
] as const;

export const NON_ADMIN_UPDATABLE_FIELDS = new Set([
  'name',
  'phoneNumber',
  'phone',
  'avatarUrl',
  'avatar_url',
  // Creator bio (Phase 2 · J) — ≤ 280 chars, enforced by a DB CHECK and by
  // CreatorsService.normalizeBio on the way in.
  'bio',
  // settings must go through PUT /users/settings (merge + CAS).
  'test_presets',
  ...ACADEMIC_PROFILE_FIELDS,
]);

const ADMIN_ONLY_USER_FIELDS = ['points', 'badges', 'isAdmin'] as const;

const router = Router();

async function applySettingsSideEffects(
  userId: string,
  previousSettings: Record<string, unknown> | null | undefined,
  mergedSettings: Record<string, unknown>
): Promise<void> {
  const wasPushEnabled = isPushEnabledInSettings(previousSettings);
  const isPushEnabled = isPushEnabledInSettings(mergedSettings);
  if (wasPushEnabled && !isPushEnabled) {
    await dataLayer.users.clearExpoPushToken(userId);
  }
}

/**
 * Normalize DB snake_case or API camelCase profile rows for clients.
 * Public academic projection: institution + faculty/programme/level only —
 * entryYear / expectedGraduationYear stay owner/admin-only.
 */
export const toPublicUser = (
  user: User & {
    avatar_url?: string;
    first_name?: string;
    last_name?: string;
    institution_id?: string | null;
    study_level?: number | null;
    current_semester?: number | null;
  }
) => ({
  id: user.id,
  name: user.name,
  username: user.username,
  firstName: user.firstName ?? user.first_name,
  lastName: user.lastName ?? user.last_name,
  avatarUrl: user.avatarUrl ?? user.avatar_url ?? null,
  avatar_url: user.avatarUrl ?? user.avatar_url ?? null,
  points: user.points,
  badges: user.badges,
  institutionId: user.institutionId ?? user.institution_id ?? null,
  institution: user.institution ?? null,
  faculty: user.faculty ?? null,
  programme: user.programme ?? null,
  studyLevel: user.studyLevel ?? user.study_level ?? null,
  currentSemester: user.currentSemester ?? user.current_semester ?? null,
  ...presenceFields(user),
});

function presenceFields(user: { settings?: unknown; lastSeenAt?: string | null }) {
  const privacy = getPrivacySafeProfileFields(user.settings, user.lastSeenAt ?? null);
  return {
    onlineStatus: privacy.onlineStatus,
    lastSeenAt: privacy.onlineStatus === 'hidden' ? null : user.lastSeenAt ?? null,
  };
}

/**
 * Attach `institution: {id,name,slug} | null` resolved from marketplace_campuses
 * (10-minute cache per institution; the user row itself is cached separately).
 */
async function withInstitution<T extends { institutionId?: string | null }>(user: T): Promise<T & { institution: { id: string; name: string; slug: string } | null }> {
  const institutionId = user.institutionId ?? null;
  if (!institutionId) return { ...user, institution: null };
  const cacheKey = `institution:${institutionId}`;
  let institution = (await cacheService.get(cacheKey)) as { id: string; name: string; slug: string } | null;
  if (!institution) {
    institution = await getAcademicCoursesService(dataLayer).resolveInstitution(institutionId);
    if (institution) await cacheService.set(cacheKey, institution, 600);
  }
  return { ...user, institution: institution ?? null };
}

// Initialize services (will be injected in main server)
let dataLayer: DataLayer;

let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeUserRoutes = (layer: DataLayer, cache: CacheService) => {
  dataLayer = layer;
  cacheService = cache;
};

// ===========================================================================
// Directory and lookup
//
// Three tiers of visibility: `GET /` is the unfiltered admin directory,
// `/search` runs the `search_users` RPC (which applies its own viewer-aware
// filter), and `GET /:userId` falls back to `isProfileVisibleToViewer` and
// answers 404 — not 403 — when a stranger may not see the profile, so the
// endpoint cannot be used to prove an account exists.
// ===========================================================================

// GET /api/v1/users - Platform admin only (use /search for scoped lookup)
router.get(
  '/',
  authMiddleware,
  requirePlatformAdmin,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { page = 1, limit = 20, search } = req.query;

    logger.debug('Fetching users', { page, limit, search, userId });

    const cacheKey = `users:list:${page}:${limit}:${search || ''}`;
    let users = await cacheService.get(cacheKey) as User[] | null;

    if (!users) {
      users = await dataLayer.users.getUsers({
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        search: search as string | undefined,
      });

      // Cache for 5 minutes
      await cacheService.set(cacheKey, users, 300);
    }

    res.json({
      success: true,
      data: users,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: users.length, // This should be improved with actual count
      },
    });
  })
);

// GET /api/v1/users/search - Search users by username
router.get(
  '/search',
  authMiddleware,
  searchRateLimit,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const currentUserId = requireAuthUserId(req, res);
    if (!currentUserId) return;

    const { q, limit = 20 } = req.query;

    // Keep leading @ in the RPC arg so search_users can prefer username matches.
    const searchQuery = typeof q === 'string' ? q.trim() : '';
    if (searchQuery.replace(/^@+/, '').length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters (use name or @username)',
      });
    }
    const resultLimit = Math.min(parseInt(limit as string) || 20, 50);

    logger.debug('Searching users', { query: searchQuery, limit: resultLimit, currentUserId });

    try {
      // Use the search_users database function
      const { data, error } = await dataLayer.users.searchUsersRpc(
        searchQuery,
        currentUserId,
        resultLimit
      );

      if (error) {
        logger.error('User search error', { error });
        return res.status(500).json({
          success: false,
          error: 'Failed to search users',
        });
      }

      // Format response with @username display and privacy-safe online status
      const users = (data || []).map((user: any) => ({
        id: user.id,
        username: user.username,
        displayUsername: user.username ? `@${user.username}` : null,
        firstName: user.first_name,
        lastName: user.last_name,
        name: user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        avatarUrl: user.avatar_url,
        onlineStatus: resolvePublicOnlineStatus(
          user.show_online_status === false
            ? { privacy: { showOnlineStatus: false } }
            : null,
          user.last_seen_at
        ),
      }));

      res.json({
        success: true,
        data: users,
        query: searchQuery,
        count: users.length,
      });
    } catch (error) {
      logger.error('User search error', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to search users',
      });
    }
  })
);

// GET /api/v1/users/me - Current user profile + capability flags for UI RBAC
router.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const user = await dataLayer.users.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const isPlatformAdmin = await isLivePlatformAdmin(userId);

    // Verified v1 (Phase 2 · J): keep verification_level in step with the
    // account's email confirmation + payout profile. Cached for an hour — the
    // auth lookup is the expensive part and neither input changes often.
    const verificationCacheKey = `creator:verification:${userId}`;
    if (!(await cacheService.get(verificationCacheKey))) {
      try {
        const { getCreatorsService } = await import('../services/creators');
        await getCreatorsService(dataLayer).syncVerificationLevel(
          userId,
          await dataLayer.users.getAuthUserEmailConfirmedAt(userId)
        );
        await cacheService.set(verificationCacheKey, '1', 3600);
      } catch (err) {
        logger.warn('verification level sync failed', { userId });
      }
    }

    // Phase 4 Q: if this user was referred and has now genuinely activated, pay
    // both sides. GET /users/me is the right trigger — it fires when the REFEREE
    // is actually using the app, which is precisely the condition being
    // rewarded, and it needs no new probe on a hot path. Cached like the
    // verification sync so it is at most one check an hour per user, and
    // fire-and-forget so the reward never delays the profile response.
    const referralCacheKey = `referral:activation:${userId}`;
    if (!(await cacheService.get(referralCacheKey))) {
      await cacheService.set(referralCacheKey, '1', 3600);
      void import('../services/referrals')
        .then(({ getReferralsService }) => getReferralsService(dataLayer).checkActivation(userId))
        .catch(() => {});
    }

    res.json({
      success: true,
      data: {
        ...(await withInstitution(user)),
        capabilities: {
          platformAdmin: isPlatformAdmin,
        },
      },
    });
  })
);

// GET /api/v1/users/me/study-resume — Home resume index for study sets
router.get(
  '/me/study-resume',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { getStudySetsService } = await import('../services/studySets');
    const data = await getStudySetsService(dataLayer).resume(userId);
    res.json({ success: true, data });
  })
);

// GET /api/v1/users/me/moderation — caller's active strikes + suspension
// (Phase 1 · E). Suspended accounts are blocked by authMiddleware before they
// get here, so this mainly powers the strikes hint in settings.
router.get(
  '/me/moderation',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { getModerationService } = await import('../services/moderation');
    const state = await getModerationService(dataLayer).getModerationState(userId);
    res.json({ success: true, data: state });
  })
);

// GET /api/v1/users/:userId - Get user by ID
router.get(
  '/:userId',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    const isOwner = requestingUserId === userId;
    const isAdmin = await isLivePlatformAdmin(requestingUserId);

    if (!isOwner && !isAdmin) {
      const visible = await dataLayer.users.isProfileVisibleToViewer(requestingUserId, userId);
      if (!visible) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }
    }

    logger.debug('Fetching user', { userId, requestingUserId, isOwner, isAdmin });

    const cacheKey = `user:${userId}`;
    let user = await cacheService.get(cacheKey) as User | null;

    if (!user) {
      user = await dataLayer.users.getUserById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      // Cache for 10 minutes
      await cacheService.set(cacheKey, user, 600);
    }

    const userWithInstitution = await withInstitution(user);
    const responseUser = isOwner || isAdmin
      ? { ...userWithInstitution, ...presenceFields(userWithInstitution) }
      : toPublicUser(userWithInstitution);

    res.json({
      success: true,
      data: responseUser,
    });
  })
);

// POST /api/v1/users - Create new user
router.post(
  '/',
  authMiddleware,
  validateCreateUser,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const userData = req.body;

    logger.debug('Creating user', { userData, requestingUserId });

    if (!(await isSelfOrLivePlatformAdmin(req, userData.id))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: cannot create profile for another user',
      });
    }

    const existingById = userData.id ? await dataLayer.users.getUserById(userData.id) : null;

    const profilePayload = {
      id: userData.id || requestingUserId,
      name: userData.name,
      avatarUrl: userData.avatarUrl || userData.avatar_url,
      phoneNumber: userData.phoneNumber || userData.phone,
      settings: userData.settings,
      username: userData.username,
      first_name: userData.first_name ?? userData.firstName,
      last_name: userData.last_name ?? userData.lastName,
      email: userData.email,
    };

    if (existingById) {
      const updated = userData.email
        ? await dataLayer.users.createUser(profilePayload)
        : await dataLayer.users.createUserProfile(profilePayload);
      await cacheService.deletePattern('users:list:*');
      return res.status(200).json({
        success: true,
        data: updated,
      });
    }

    if (userData.email) {
      const existingUser = await dataLayer.users.getUserByEmail(userData.email);
      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'User with this email already exists',
        });
      }
    }

    const newUser = userData.email
      ? await dataLayer.users.createUser(profilePayload)
      : await dataLayer.users.createUserProfile(profilePayload);

    // Invalidate users list cache
    await cacheService.deletePattern('users:list:*');

    res.status(201).json({
      success: true,
      data: newUser,
    });
  })
);

// ===========================================================================
// Settings
//
// Settings are never replaced wholesale. `mergeUserSettings` deep-merges the
// patch onto the stored object and `sanitizeSettings` strips the privileged
// keys (`is_banned`, `account_status`, `is_platform_admin`, `ban_reason`,
// `banned_at`, `banned_by`, `suspended_until`, `moderation_flags`) from the
// incoming patch while preserving whatever the admin routes wrote — a user
// cannot unban or promote themselves through a settings save.
//
// Writes are compare-and-swap on `settingsVersion`; a stale version answers
// 409 with the authoritative settings attached so the client can rebase
// instead of clobbering another device. `PUT /:userId/settings` below is the
// same handler under an explicit id.
// ===========================================================================

// PUT /api/v1/users/settings - Update current user's settings (must be before /:userId)
router.put(
  '/settings',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { settings } = req.body;

    logger.debug('Updating current user settings', { userId });

    if (!settings) {
      return res.status(400).json({
        success: false,
        error: 'Settings object is required',
      });
    }

    const existingUser = await dataLayer.users.getUserById(userId);
    if (!existingUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const mergedSettings = mergeUserSettings(
      existingUser.settings as Record<string, unknown>,
      settings as Record<string, unknown>
    );
    await applySettingsSideEffects(
      userId,
      existingUser.settings as Record<string, unknown>,
      mergedSettings
    );

    let updatedUser;
    try {
      updatedUser = await dataLayer.users.updateUser(
        userId,
        { settings: mergedSettings },
        {
          expectedSettingsVersion:
            req.body?.expectedSettingsVersion != null
              ? Number(req.body.expectedSettingsVersion)
              : (existingUser as { settingsVersion?: number }).settingsVersion,
        }
      );
    } catch (error: any) {
      if (error?.code === 'version_conflict' || error?.status === 409) {
        const current = error.current as
          | { settings?: unknown; settingsVersion?: number }
          | null;
        return res.status(409).json({
          success: false,
          error: error.message || 'Settings were updated elsewhere',
          code: 'version_conflict',
          data: current
            ? {
                settings: parseUserSettings(current.settings || null),
                settingsVersion: current.settingsVersion ?? 1,
              }
            : null,
        });
      }
      throw error;
    }

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const settingsVersion =
      (updatedUser as { settingsVersion?: number }).settingsVersion ?? 1;
    const authoritativeSettings = parseUserSettings(updatedUser.settings || null);

    await cacheService.invalidateUserCache(userId);
    await cacheService.set(
      `user:settings:${userId}`,
      { settings: authoritativeSettings, settingsVersion },
      600
    );

    res.json({
      success: true,
      data: {
        settings: authoritativeSettings,
        settingsVersion,
      },
      message: 'Settings synced successfully',
    });
  })
);

// ===========================================================================
// Avatar upload
//
// The only storage write in this router. The body carries base64, not
// multipart; the handler enforces the content-type allowlist
// (JPEG/PNG/GIF/WebP) and a ~2 MB decoded ceiling before decoding, then
// `SupabaseService.uploadProfileAvatar` re-checks the real type by magic bytes
// (web clients compress to WebP but send the original MIME), normalises the
// image and writes it to the `profile-avatars` bucket at
// `<userId>/avatar-<timestamp>.<ext>`, deleting the user's older avatar
// objects afterwards. The response carries a signed `url`; the value stored on
// `profiles.avatarUrl` is the unsigned object path, which readers sign on
// demand. The timestamp in the path is what stops a CDN serving a replaced
// avatar forever.
//
// `PUT /:userId` rejects a `data:` avatar value outright so nobody can route
// around this endpoint and inline an image into the profile row.
// ===========================================================================

// POST /api/v1/users/:userId/avatar - Upload profile avatar to private storage
router.post(
  '/:userId/avatar',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    if (!(await isSelfOrLivePlatformAdmin(req, userId))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { fileName, base64Data, contentType } = req.body || {};
    if (!fileName || !base64Data) {
      return res.status(400).json({ success: false, error: 'fileName and base64Data are required' });
    }
    if (!contentType || !ALLOWED_AVATAR_TYPES.includes(contentType)) {
      return res.status(400).json({
        success: false,
        error: 'contentType is required. Only JPEG, PNG, GIF, and WebP are allowed.',
      });
    }

    const estimatedBytes = Math.ceil((base64Data.length * 3) / 4);
    if (estimatedBytes > 2 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Avatar exceeds 2 MB limit' });
    }

    const uploaded = await dataLayer.uploads.uploadProfileAvatar({
      fileName,
      base64Data,
      contentType,
      userId,
    });

    const updatedUser = await dataLayer.users.updateUser(userId, { avatarUrl: uploaded.avatarUrl });
    await cacheService.delete(`user:${userId}`);
    await cacheService.deletePattern('users:list:*');

    res.json({
      success: true,
      data: {
        ...uploaded,
        user: updatedUser,
      },
    });
  })
);

// ===========================================================================
// Profile update — the mass-assignment defence
//
// `req.body` is spread into `updateData` and then reduced to a POSITIVE
// ALLOWLIST: for any caller who is not a live platform admin, every key not in
// `NON_ADMIN_UPDATABLE_FIELDS` is dropped, after `ADMIN_ONLY_USER_FIELDS`
// (`points`, `badges`, `isAdmin`) are deleted outright. An allowlist, not a
// denylist — a new column added to `profiles` is NOT user-writable until
// someone adds it to that set on purpose. Do not flip this to a denylist and
// do not add a privileged column to the set.
//
// Three writes are refused here rather than being silently accepted: a `data:`
// avatar (use POST /:userId/avatar), any `settings` key (use PUT
// /users/settings, which merges and CAS-checks), and an out-of-range semester.
// Free-text and numeric academic fields are normalised so a bad value becomes
// a 400 rather than a DB CHECK violation surfacing as a 500.
//
// Two follow-on effects fire only when they should: auto community memberships
// are recomputed only if an `ACADEMIC_PROFILE_FIELDS` value actually changed,
// and a newly chosen institution seeds the marketplace campus preference only
// when that preference is still unset. Both are best-effort — neither may fail
// the profile save.
// ===========================================================================

// PUT /api/v1/users/:userId - Update user
router.put(
  '/:userId',
  authMiddleware,
  validateUserId,
  validateUpdateUser,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;

    if (!(await isSelfOrLivePlatformAdmin(req, userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    let updateData = { ...req.body };
    if (!(await isLivePlatformAdmin(requestingUserId))) {
      for (const field of ADMIN_ONLY_USER_FIELDS) {
        delete updateData[field];
      }
      updateData = Object.fromEntries(
        Object.entries(updateData).filter(([key]) => NON_ADMIN_UPDATABLE_FIELDS.has(key))
      );
    }

    const avatarField = updateData.avatarUrl ?? updateData.avatar_url;
    if (typeof avatarField === 'string' && avatarField.startsWith('data:')) {
      return res.status(400).json({
        success: false,
        error: 'Upload avatars via POST /users/:userId/avatar instead of embedding base64.',
      });
    }

    // Reject settings writes on the profile path — use PUT /users/settings.
    if (updateData.settings !== undefined) {
      return res.status(400).json({
        success: false,
        error: 'Update settings via PUT /api/v1/users/settings',
      });
    }

    // Academic identity: institutionId must be a real, non-"Other" institution.
    // Strings are trimmed; empty strings clear (null) like an explicit null.
    let selectedInstitutionId: string | null = null;
    if (updateData.institutionId !== undefined) {
      if (updateData.institutionId === null || updateData.institutionId === '') {
        updateData.institutionId = null;
      } else {
        try {
          selectedInstitutionId = (
            await getAcademicCoursesService(dataLayer).assertSelectableInstitution(
              String(updateData.institutionId)
            )
          ).id;
          updateData.institutionId = selectedInstitutionId;
        } catch (error) {
          if (error instanceof PublicError) {
            return res.status(400).json({ success: false, error: error.message });
          }
          throw error;
        }
      }
    }
    for (const textField of ['faculty', 'programme'] as const) {
      if (typeof updateData[textField] === 'string') {
        const trimmed = updateData[textField].trim().replace(/\s+/g, ' ');
        updateData[textField] = trimmed ? trimmed : null;
      }
    }
    for (const intField of ['studyLevel', 'entryYear', 'expectedGraduationYear'] as const) {
      if (updateData[intField] !== undefined && updateData[intField] !== null) {
        updateData[intField] = Number(updateData[intField]);
      }
    }
    // Semester is a two-value enum, not a free int: reject anything else with a
    // 400 rather than letting the DB CHECK turn it into a 500.
    if (updateData.currentSemester !== undefined && updateData.currentSemester !== null) {
      const semester = Number(updateData.currentSemester);
      if (semester !== 1 && semester !== 2) {
        return res.status(400).json({
          success: false,
          error: 'Semester must be 1 (first) or 2 (second)',
        });
      }
      updateData.currentSemester = semester;
    }
    // Creator bio: trimmed, ≤ 280 chars (400 rather than a DB CHECK violation).
    if (updateData.bio !== undefined) {
      const { getCreatorsService } = await import('../services/creators');
      try {
        updateData.bio = getCreatorsService(dataLayer).normalizeBio(updateData.bio);
      } catch (error) {
        if (error instanceof PublicError) {
          return res.status(400).json({ success: false, error: error.message });
        }
        throw error;
      }
    }

    logger.debug('Updating user', { userId, updateData, requestingUserId });

    let updatedUser;
    try {
      updatedUser = await dataLayer.users.updateUser(userId, updateData);
    } catch (error: any) {
      if (error?.code === 'version_conflict' || error?.status === 409) {
        return res.status(409).json({
          success: false,
          error: error.message || 'Profile was updated elsewhere',
          code: 'version_conflict',
          data: error.current ?? null,
        });
      }
      throw error;
    }

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Phase 3 L: the academic profile IS the community derivation. Recompute
    // auto memberships only when one of those fields actually changed —
    // running the RPC on every profile save would fire it on an avatar change.
    // Best-effort inside the service; a stale membership must not fail a save.
    if (ACADEMIC_PROFILE_FIELDS.some((field) => updateData[field] !== undefined)) {
      const { getCommunitiesService } = await import('../services/communities');
      await getCommunitiesService(dataLayer).refreshAutoMemberships(userId);
    }

    // Write-through: a chosen institution also seeds the marketplace campus
    // preference when that preference is still unset (never the other way,
    // and never overwriting a campus the user already picked). Best-effort —
    // a concurrent settings write must not fail the profile update.
    if (selectedInstitutionId) {
      try {
        const currentSettings = (updatedUser.settings ?? {}) as Record<string, unknown>;
        const marketplaceSettings = (currentSettings.marketplace ?? {}) as Record<string, unknown>;
        if (marketplaceSettings.campus_id == null) {
          const mergedSettings = mergeUserSettings(currentSettings, {
            marketplace: { campus_id: selectedInstitutionId },
          });
          const settingsUser = await dataLayer.users.updateUser(
            userId,
            { settings: mergedSettings },
            { expectedSettingsVersion: (updatedUser as { settingsVersion?: number }).settingsVersion }
          );
          if (settingsUser) updatedUser = settingsUser;
        }
      } catch (error) {
        logger.warn('Institution → marketplace campus write-through skipped', { userId, error });
      }
    }

    // Invalidate user + settings caches
    await cacheService.invalidateUserCache(userId);
    await cacheService.deletePattern('users:list:*');

    res.json({
      success: true,
      data: await withInstitution(updatedUser),
    });
  })
);

// ===========================================================================
// Account lifecycle — pause, delete, export, import
//
// Entry points, in the order a user meets them:
//   GET  /:userId/lifecycle        status + days left in the grace period
//   POST /:userId/deactivate       pause now, schedule deletion in
//                                  ACCOUNT_DELETION_GRACE_DAYS (self only)
//   POST /:userId/reactivate       cancel that schedule (self only)
//   POST /:userId/delete-immediate skip the grace period; self must re-enter
//                                  their password (`verifyUserPassword`)
//   DELETE /:userId                the same destructive path, admin-reachable
//                                  and audited via `logAdminAction`
//   GET  /:userId/export           signed GDPR portability archive
//   POST /:userId/import           restore an archive (self only, password +
//                                  a signature and source-email check)
//
// These routes are only the doors. The actual work lives in
// `services/userDataLifecycle.ts` — `deleteUserAccountFully` (called directly;
// `SupabaseService.deleteUser` is the deprecated boolean wrapper that hides the
// deletion report) and `exportUserDataArchive` — with the export signed by
// `services/accountExportSign.ts` so `importAccountArchive` can reject a
// hand-edited archive.
//
// Both delete paths answer 207 with `code: 'PARTIAL_DELETION'` when the account
// row is gone but storage could not be fully purged, and log the failing
// buckets, so nobody reads a green 200 as "every file is erased".
//
// Export is heavy, so it goes through `runSyncOrEnqueue`: a large account is
// answered 202 with a job id instead of blocking the request.
// ===========================================================================

// GET /api/v1/users/:userId/lifecycle - Account pause / deletion schedule status
router.get(
  '/:userId/lifecycle',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    if (!(await isSelfOrLivePlatformAdmin(req, userId))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const row = await getAccountLifecycle(dataLayer, userId);
    if (!row) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const deactivated = isAccountDeactivated(row);
    let graceDaysRemaining: number | null = null;
    if (row.deletion_scheduled_at) {
      const ms = new Date(row.deletion_scheduled_at).getTime() - Date.now();
      graceDaysRemaining = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
    }

    res.json({
      success: true,
      data: {
        status: deactivated ? 'deactivated' : 'active',
        deactivatedAt: row.deactivated_at ?? null,
        deletionScheduledAt: row.deletion_scheduled_at ?? null,
        graceDaysRemaining,
        gracePeriodDays: ACCOUNT_DELETION_GRACE_DAYS,
      },
    });
  })
);

// POST /api/v1/users/:userId/deactivate - Pause account; permanent delete after grace period
router.post(
  '/:userId/deactivate',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    if (requestingUserId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const row = await getAccountLifecycle(dataLayer, userId);
    if (!row) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    if (isAccountDeactivated(row)) {
      return res.status(409).json({ success: false, error: 'Account is already paused.' });
    }

    const scheduled = await scheduleAccountDeletion(dataLayer, userId);
    res.json({
      success: true,
      data: {
        ...scheduled,
        gracePeriodDays: ACCOUNT_DELETION_GRACE_DAYS,
        message: `Account paused. It will be permanently deleted in ${ACCOUNT_DELETION_GRACE_DAYS} days unless you reactivate.`,
      },
    });
  })
);

// POST /api/v1/users/:userId/reactivate - Cancel scheduled deletion
router.post(
  '/:userId/reactivate',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    if (requestingUserId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const ok = await reactivateAccount(dataLayer, userId);
    if (!ok) {
      return res.status(409).json({ success: false, error: 'Account is not paused.' });
    }

    res.json({
      success: true,
      message: 'Account reactivated. Welcome back!',
    });
  })
);

// POST /api/v1/users/:userId/delete-immediate - Permanently delete now (requires password)
router.post(
  '/:userId/delete-immediate',
  authMiddleware,
  validateUserId,
  validateAccountPasswordBody,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    if (!(await isSelfOrLivePlatformAdmin(req, userId))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { password } = req.body as { password?: string };
    if (requestingUserId === userId) {
      const row = await getAccountLifecycle(dataLayer, userId);
      const email = row?.email;
      if (!email) {
        return res.status(400).json({ success: false, error: 'Unable to verify password for this account.' });
      }
      const valid = await verifyUserPassword(email, password || '');
      if (!valid) {
        return res.status(401).json({ success: false, error: 'Incorrect password.' });
      }
    }

    // FIXED (F6): the storage purge behind this route walked each bucket
    // non-recursively and skipped `job-resumes`, `job-company-logos` and
    // `cover-images`, so an uploaded CV outlived the account — and the route
    // reported success anyway. The purge is now a paginated recursive walk, and
    // `deleteUserAccountFully` returns what it actually managed to erase.
    const result = await deleteUserAccountFully(dataLayer, userId);
    if (!result.found) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    await cacheService.delete(`user:${userId}`);
    await cacheService.deletePattern('users:list:*');

    if (!result.ok) {
      logger.error('Account deletion partially completed', {
        userId,
        code: 'PARTIAL_DELETION',
        purged: result.purged,
        failures: result.failures,
      });
      return res.status(207).json({
        success: false,
        code: 'PARTIAL_DELETION',
        error:
          'Your account is deleted, but some uploaded files could not be removed. Support has been notified to finish the cleanup.',
        data: { purged: result.purged, failures: result.failures, skipped: result.skipped },
      });
    }

    res.json({ success: true, message: 'Account permanently deleted.' });
  })
);

// POST /api/v1/users/:userId/import - Restore backup into current account
router.post(
  '/:userId/import',
  authMiddleware,
  dataExportRateLimit,
  validateUserId,
  validateAccountImportBody,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    if (requestingUserId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { password, export: exportPayload, confirmEmailMismatch } = req.body as {
      password: string;
      export: Record<string, unknown>;
      confirmEmailMismatch?: boolean;
    };

    const row = await getAccountLifecycle(dataLayer, userId);
    if (!row?.email) {
      return res.status(400).json({ success: false, error: 'Unable to verify password for this account.' });
    }

    const valid = await verifyUserPassword(row.email, password);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Incorrect password.' });
    }

    try {
      const result = await importAccountArchive(
        dataLayer,
        userId,
        exportPayload as {
          format: string;
          sourceUserId: string;
          sourceEmail?: string | null;
          exportedAt: string;
          signature: string;
          data: Record<string, unknown>;
        },
        { confirmEmailMismatch: !!confirmEmailMismatch }
      );

      res.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      const status = message.includes('email does not match') ? 409 : 400;
      res.status(status).json({ success: false, error: message });
    }
  })
);

// DELETE /api/v1/users/:userId - Delete user
router.delete(
  '/:userId',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;

    logger.debug('Deleting user', { userId, requestingUserId });

    // Check permissions (users can only delete themselves or admins can delete anyone)
    if (!(await isSelfOrLivePlatformAdmin(req, userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    // FIXED (F6): same purge as /:userId/delete-immediate — now recursive,
    // paginated, covering `job-resumes`, `cover-images` and solely-owned
    // `job-company-logos`, and reporting what it could not remove instead of
    // returning a bare success.
    const result = await deleteUserAccountFully(dataLayer, userId);
    const deleted = result.found;

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    if (requestingUserId !== userId && (await isLivePlatformAdmin(requestingUserId))) {
      await logAdminAction(dataLayer, {
        actorId: requestingUserId,
        action: 'user_delete',
        targetType: 'user',
        targetId: userId,
      });
    }

    // Invalidate caches
    await cacheService.delete(`user:${userId}`);
    await cacheService.deletePattern('users:list:*');
    await cacheService.deletePattern(`groups:*`);
    await cacheService.deletePattern(`messages:*`);

    if (!result.ok) {
      logger.error('Account deletion partially completed', {
        userId,
        code: 'PARTIAL_DELETION',
        purged: result.purged,
        failures: result.failures,
      });
      return res.status(207).json({
        success: false,
        code: 'PARTIAL_DELETION',
        error:
          'The account is deleted, but some uploaded files could not be removed. Support must finish the storage cleanup.',
        data: { purged: result.purged, failures: result.failures, skipped: result.skipped },
      });
    }

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  })
);

// GET /api/v1/users/:userId/export - GDPR data portability export
router.get(
  '/:userId/export',
  authMiddleware,
  dataExportRateLimit,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;

    if (!(await isSelfOrLivePlatformAdmin(req, userId))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    logger.info('Exporting user data', { userId, requestingUserId });

    const outcome = await runSyncOrEnqueue(
      'export.userData',
      { userId },
      requestingUserId,
      async () => dataLayer.users.exportUserData(userId)
    );

    if (outcome.mode === 'async') {
      sendAsyncJobAccepted(res, outcome.jobId);
      return;
    }

    const archive = outcome.result;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="lantern-study-export-${userId}-${Date.now()}.json"`
    );
    res.json({ success: true, data: archive });
  })
);

// GET /api/v1/users/:userId/stats - Get user statistics
router.get(
  '/:userId/stats',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;

    logger.debug('Fetching user stats', { userId, requestingUserId });

    // Check permissions (users can only view their own stats or admins can view anyone's)
    if (!(await isSelfOrLivePlatformAdmin(req, userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const cacheKey = `user:stats:${userId}`;
    let stats = await cacheService.get(cacheKey);

    if (!stats) {
      stats = await dataLayer.users.getUserStats(userId);

      // Cache for 5 minutes
      await cacheService.set(cacheKey, stats, 300);
    }

    res.json({
      success: true,
      data: stats,
    });
  })
);

// GET /api/v1/users/:userId/groups - Get user's groups
router.get(
  '/:userId/groups',
  authMiddleware,
  validateUserId,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    logger.debug('Fetching user groups', { userId, page, limit, requestingUserId });

    // Check permissions (users can only view their own groups or admins can view anyone's)
    if (!(await isSelfOrLivePlatformAdmin(req, userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const cacheKey = `user:groups:${userId}:${page}:${limit}`;
    let groups = await cacheService.get(cacheKey) as Group[] | null;

    if (!groups) {
      groups = await dataLayer.users.getUserGroups(userId, {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
      });

      // Cache for 5 minutes
      await cacheService.set(cacheKey, groups, 300);
    }

    res.json({
      success: true,
      data: groups,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: groups.length,
      },
    });
  })
);

// GET /api/v1/users/:userId/settings - Get user's settings
router.get(
  '/:userId/settings',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;

    logger.debug('Fetching user settings', { userId, requestingUserId });

    // Users can only view their own settings
    if (!(await isSelfOrLivePlatformAdmin(req, userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const cacheKey = `user:settings:${userId}`;
    const cached = await cacheService.get(cacheKey) as
      | { settings: unknown; settingsVersion: number }
      | null;

    if (
      cached &&
      typeof cached === 'object' &&
      'settings' in cached &&
      typeof cached.settingsVersion === 'number'
    ) {
      return res.json({
        success: true,
        data: {
          settings: cached.settings,
          settingsVersion: cached.settingsVersion,
        },
      });
    }

    const user = await dataLayer.users.getUserById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const settings = parseUserSettings(user.settings || null);
    const settingsVersion =
      (user as { settingsVersion?: number }).settingsVersion ?? 1;

    await cacheService.set(
      cacheKey,
      { settings, settingsVersion },
      600
    );

    res.json({
      success: true,
      data: {
        settings,
        settingsVersion,
      },
    });
  })
);

// PUT /api/v1/users/:userId/settings - Update user's settings
router.put(
  '/:userId/settings',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    const { settings } = req.body;

    logger.debug('Updating user settings', { userId, requestingUserId });

    // Users can only update their own settings
    if (!(await isSelfOrLivePlatformAdmin(req, userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    if (!settings) {
      return res.status(400).json({
        success: false,
        error: 'Settings object is required',
      });
    }

    const existingUser = await dataLayer.users.getUserById(userId);
    if (!existingUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const mergedSettings = mergeUserSettings(
      existingUser.settings as Record<string, unknown>,
      settings as Record<string, unknown>
    );
    await applySettingsSideEffects(
      userId,
      existingUser.settings as Record<string, unknown>,
      mergedSettings
    );

    let updatedUser;
    try {
      updatedUser = await dataLayer.users.updateUser(
        userId,
        { settings: mergedSettings },
        {
          expectedSettingsVersion:
            req.body?.expectedSettingsVersion != null
              ? Number(req.body.expectedSettingsVersion)
              : (existingUser as { settingsVersion?: number }).settingsVersion,
        }
      );
    } catch (error: any) {
      if (error?.code === 'version_conflict' || error?.status === 409) {
        const current = error.current as
          | { settings?: unknown; settingsVersion?: number }
          | null;
        return res.status(409).json({
          success: false,
          error: error.message || 'Settings were updated elsewhere',
          code: 'version_conflict',
          data: current
            ? {
                settings: parseUserSettings(current.settings || null),
                settingsVersion: current.settingsVersion ?? 1,
              }
            : null,
        });
      }
      throw error;
    }

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const settingsVersion =
      (updatedUser as { settingsVersion?: number }).settingsVersion ?? 1;
    const authoritativeSettings = parseUserSettings(updatedUser.settings || null);

    await cacheService.invalidateUserCache(userId);
    await cacheService.set(
      `user:settings:${userId}`,
      { settings: authoritativeSettings, settingsVersion },
      600
    );

    res.json({
      success: true,
      data: {
        settings: authoritativeSettings,
        settingsVersion,
      },
      message: 'Settings updated successfully',
    });
  })
);

// ===========================================================================
// Usernames
//
// `/check-username/:username` is the one PUBLIC route in this router — the
// sign-up form needs it before a session exists — which is why it carries the
// tight `usernameCheckRateLimit` tier and why it answers 200 with
// `available: false` for a malformed name rather than 400: the client renders
// one message either way, and an enumeration probe learns nothing from the
// status code.
//
// Setting a username is SELF ONLY (no admin override) and is checked twice:
// `is_username_available` first, then the unique constraint on `profiles`,
// whose 23505 maps to 409. The pre-check alone would race.
// ===========================================================================

// GET /api/v1/users/check-username/:username - Check if username is available
router.get(
  '/check-username/:username',
  usernameCheckRateLimit,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const { username } = req.params;

    if (!username || typeof username !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Username is required',
      });
    }

    const normalizedUsername = username.toLowerCase().trim();

    // Validate format: alphanumeric + underscore, 3-20 characters
    const usernameRegex = /^[a-z0-9_]{3,20}$/;
    if (!usernameRegex.test(normalizedUsername)) {
      return res.json({
        success: true,
        available: false,
        error: 'Username must be 3-20 characters, using only lowercase letters, numbers, and underscores',
      });
    }

    logger.debug('Checking username availability', { username: normalizedUsername });

    try {
      // Use the is_username_available database function
      const { data, error } = await dataLayer.users.isUsernameAvailableRpc(normalizedUsername);

      if (error) {
        logger.error('Username check error', { error });
        return res.status(500).json({
          success: false,
          error: 'Failed to check username',
        });
      }

      res.json({
        success: true,
        username: normalizedUsername,
        displayUsername: `@${normalizedUsername}`,
        available: data === true,
      });
    } catch (error) {
      logger.error('Username check error', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to check username',
      });
    }
  })
);

// PUT /api/v1/users/:userId/username - Set or update username
router.put(
  '/:userId/username',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    const { username, firstName, lastName } = req.body;

    if (requestingUserId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You can only update your own username',
      });
    }

    if (!username || typeof username !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Username is required',
      });
    }

    const normalizedUsername = username.toLowerCase().trim();

    // Validate format
    const usernameRegex = /^[a-z0-9_]{3,20}$/;
    if (!usernameRegex.test(normalizedUsername)) {
      return res.status(400).json({
        success: false,
        error: 'Username must be 3-20 characters, using only lowercase letters, numbers, and underscores',
      });
    }

    logger.debug('Setting username', { userId, username: normalizedUsername });

    try {
      // Check availability first
      const { data: isAvailable, error: checkError } =
        await dataLayer.users.isUsernameAvailableRpc(normalizedUsername);

      if (checkError) {
        logger.error('Username availability check error', { error: checkError });
        return res.status(500).json({
          success: false,
          error: 'Failed to check username availability',
        });
      }

      // Check if the current user already has this username (allow keeping same username)
      const currentUser = await dataLayer.users.getUserById(userId);
      const isSameUsername = currentUser?.username === normalizedUsername;

      if (!isAvailable && !isSameUsername) {
        return res.status(409).json({
          success: false,
          error: 'Username is already taken',
        });
      }

      // Update profile with username and optional name fields
      const updateData: any = {
        username: normalizedUsername,
      };

      if (firstName !== undefined) {
        updateData.first_name = firstName.trim();
      }
      if (lastName !== undefined) {
        updateData.last_name = lastName.trim();
      }
      
      // Update full name if first/last provided
      if (firstName !== undefined || lastName !== undefined) {
        const newFirstName = firstName?.trim() || currentUser?.firstName || '';
        const newLastName = lastName?.trim() || currentUser?.lastName || '';
        updateData.name = `${newFirstName} ${newLastName}`.trim();
      }

      const { data, error } = await dataLayer.users.updateProfileFields(userId, updateData);

      if (error) {
        logger.error('Username update error', { error });
        if (error.code === '23505') { // Unique constraint violation
          return res.status(409).json({
            success: false,
            error: 'Username is already taken',
          });
        }
        return res.status(500).json({
          success: false,
          error: 'Failed to update username',
        });
      }

      // Invalidate cache
      await cacheService.delete(`user:${userId}`);

      res.json({
        success: true,
        data: {
          id: data.id,
          username: data.username,
          displayUsername: `@${data.username}`,
          firstName: data.first_name,
          lastName: data.last_name,
          name: data.name,
        },
        message: 'Username updated successfully',
      });
    } catch (error) {
      logger.error('Username update error', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to update username',
      });
    }
  })
);

// ===========================================================================
// Push tokens
//
// The Expo token lives on `profiles.expo_push_token`; the "when was it
// registered" stamp lives in Redis only (see below). Registration is refused
// when push is switched off in the user's settings, and turning push off in
// settings clears the stored token through `applySettingsSideEffects`, so the
// toggle and the token can never disagree.
// ===========================================================================

/**
 * When this account last registered a push token.
 *
 * `profiles` has no `expo_push_token_updated_at` column and adding one is a
 * migration this fix does not need: the stamp is a diagnostic, so it lives in
 * Redis and simply reads back null when Redis (or the stamp) is absent.
 */
const PUSH_TOKEN_STAMP_TTL_SECONDS = 60 * 60 * 24 * 400;

/** Expo only delivers to its own token format; anything else on file is dead. */
function isExpoPushTokenFormat(token: string): boolean {
  return token.startsWith('ExponentPushToken') || token.startsWith('ExpoPushToken');
}

function pushTokenStampKey(userId: string): string {
  return redisKey(`user:${userId}:push-token:registeredAt`);
}

async function rememberPushTokenRegistration(userId: string): Promise<void> {
  try {
    const client = await getRedisClient();
    if (!client) return;
    await client.set(pushTokenStampKey(userId), new Date().toISOString(), {
      EX: PUSH_TOKEN_STAMP_TTL_SECONDS,
    });
  } catch (error) {
    // A diagnostic stamp must never fail the registration it describes.
    logger.warn('Push token stamp write failed', { error });
  }
}

async function readPushTokenRegistration(userId: string): Promise<string | null> {
  try {
    const client = await getRedisClient();
    if (!client) return null;
    return (await client.get(pushTokenStampKey(userId))) ?? null;
  } catch {
    return null;
  }
}

async function forgetPushTokenRegistration(userId: string): Promise<void> {
  try {
    const client = await getRedisClient();
    if (!client) return;
    await client.del(pushTokenStampKey(userId));
  } catch {
    // Nothing to do: a stale stamp is only ever reported alongside hasToken.
  }
}

// POST /api/v1/users/push-token - Register Expo push token for mobile notifications
router.post(
  '/push-token',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { token } = req.body;
    if (!token || typeof token !== 'string' || token.length > 512) {
      return res.status(400).json({ success: false, error: 'Valid push token required' });
    }

    const user = await dataLayer.users.getUserById(userId);
    if (!user || !isPushEnabledInSettings(user.settings as Record<string, unknown>)) {
      return res.status(403).json({
        success: false,
        error: 'Push notifications are disabled in your settings',
      });
    }

    await dataLayer.users.updateExpoPushToken(userId, token.trim());
    await rememberPushTokenRegistration(userId);
    res.json({ success: true, message: 'Push token registered' });
  })
);

/**
 * GET /api/v1/users/push-token/status — can this account actually be pushed?
 *
 * On device a generation finished and no notification ever arrived, and the
 * app had no way to tell "the server never sent one" from "this phone was
 * never registered". This is that answer, for the signed-in user only:
 *
 *   hasToken   — a usable Expo token is on file for this account
 *   pushEnabled — the master notification toggle in their settings
 *   updatedAt  — when the token was last registered (null when unknown: the
 *                registration stamp lives in Redis, which is optional, and
 *                tokens registered before this endpoint shipped have none)
 *
 * With both true and a job whose `push` audit says `sent`, the failure is
 * downstream (Expo/OS) rather than something the app can fix by re-asking for
 * permission — so the client can say something true either way.
 */
router.get(
  '/push-token/status',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    // Read the profile row directly rather than through getUserById: the
    // mapped User shape drops `expo_push_token` entirely (it would have made
    // this endpoint answer "no token" for every account), and a diagnostic
    // should not be served from a ten-minute cache.
    const { data, error } = await dataLayer.users.getPushTokenProfile(userId);
    if (error) throw error;

    const rawToken = (data as { expo_push_token?: unknown } | null)?.expo_push_token;
    const token = typeof rawToken === 'string' ? rawToken.trim() : '';
    // Only an Expo-format token can be delivered to; anything else on file is
    // dead weight and must not be reported as "set up".
    const hasToken = isExpoPushTokenFormat(token);

    res.json({
      success: true,
      data: {
        hasToken,
        /** Alias: what the mobile client asks for. Same answer, older name. */
        registered: hasToken,
        updatedAt: await readPushTokenRegistration(userId),
        pushEnabled: isPushEnabledInSettings(
          ((data as { settings?: unknown } | null)?.settings ?? null) as Record<string, unknown> | null
        ),
      },
    });
  })
);

// DELETE /api/v1/users/push-token - Clear registered push token
router.delete(
  '/push-token',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    await dataLayer.users.clearExpoPushToken(userId);
    await forgetPushTokenRegistration(userId);
    res.json({ success: true, message: 'Push token cleared' });
  })
);

// ===========================================================================
// Presence
//
// Two independent things travel on one timer: `profiles.last_seen_at` (the
// online dot, filtered for the viewer by `resolvePublicOnlineStatus` and the
// user's `privacy.showOnlineStatus`) and the optional study-intent row owned
// by `services/studyPresence`. The study write is wrapped in its own
// try/catch: presence is a nicety and must never fail the heartbeat that
// keeps the online indicator alive.
// ===========================================================================

// POST /api/v1/users/presence/heartbeat - Update last seen for online status.
// Phase 3 M: the same beat optionally carries study INTENT ({context, courseId,
// topic}) so "23 people studying cardiology tonight" needs no second timer.
// A body-less beat keeps the old behaviour exactly.
router.post(
  '/presence/heartbeat',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    // FIXED (SW) [Sentry LANTERN-STUDY-API-2, 25 events]: `touchLastSeen` was
    // unbounded and unguarded, so a PostgREST "Gateway Timeout" propagated out
    // of the handler as a STATUS-LESS Error. @sentry/node's express handler
    // defaults a status-less error to 500, so every upstream blip filed as a
    // server crash — and the client saw a hard failure on a beat that is, by
    // design, a nicety. Presence is now best-effort on BOTH sides of the wire:
    // bounded, and answered with a status (504) that keeps it out of Sentry and
    // tells the client "later", not "you are signed out".
    const touched = await withUpstreamTimeout(
      dataLayer.gamification.touchLastSeen(userId),
      PRESENCE_UPSTREAM_TIMEOUT_MS
    );
    if (!touched.ok) {
      logger.warn('presence heartbeat upstream unavailable', {
        userId,
        reason: touched.reason,
      });
      res.status(504).json({
        success: false,
        error: 'Gateway Timeout',
        message: 'Could not update presence right now.',
        code: 'PRESENCE_UNAVAILABLE',
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    let studySharing: boolean | undefined;
    if (body.context || body.courseId || body.topic) {
      // Presence is a nicety; never fail the heartbeat (and therefore the
      // online indicator) because the study row could not be written.
      // Bounded for the same reason as touchLastSeen above: the catch handled a
      // rejection but nothing handled a hang, so a stalled study-presence write
      // held the whole beat open until the client's fetch timeout.
      const study = await withUpstreamTimeout(
        getStudyPresenceService(dataLayer).heartbeat(userId, {
          context: typeof body.context === 'string' ? body.context : undefined,
          courseId: typeof body.courseId === 'string' ? body.courseId : null,
          topic: typeof body.topic === 'string' ? body.topic : null,
        }),
        PRESENCE_UPSTREAM_TIMEOUT_MS
      );
      if (study.ok) {
        studySharing = study.value.shared;
      } else {
        logger.warn('study presence heartbeat failed', {
          reason: study.reason,
          error: study.error instanceof Error ? study.error.message : String(study.error ?? ''),
        });
      }
    }

    res.json({ success: true, ...(studySharing === undefined ? {} : { studySharing }) });
  })
);

// DELETE /api/v1/users/presence/study - stop appearing in "studying now"
router.delete(
  '/presence/study',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    await getStudyPresenceService(dataLayer).clear(userId);
    res.json({ success: true });
  })
);

// ===========================================================================
// DM blocks
//
// All four routes are SELF ONLY — a platform admin cannot read or edit
// someone's block list. `/blocks/status/:otherUserId` answers two separate
// questions because the UI needs both: `blocked` is true if EITHER side
// blocked (the DM is closed), `iBlockedThem` says whether the caller can undo
// it. Collapsing them would tell A that B blocked them.
// ===========================================================================

// GET /api/v1/users/:userId/blocks - List users blocked by the caller
router.get(
  '/:userId/blocks',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const authUserId = requireAuthUserId(req, res);
    if (!authUserId) return;
    const { userId } = req.params;
    if (authUserId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const blockedUserIds = await dataLayer.directMessages.listBlockedUserIds(userId);
    res.json({ success: true, data: { blockedUserIds } });
  })
);

// GET /api/v1/users/:userId/blocks/status/:otherUserId - Whether a DM pair is blocked either way
router.get(
  '/:userId/blocks/status/:otherUserId',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const authUserId = requireAuthUserId(req, res);
    if (!authUserId) return;
    const { userId, otherUserId } = req.params;
    if (authUserId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    if (!otherUserId) {
      return res.status(400).json({ success: false, error: 'otherUserId is required' });
    }
    const [blocked, iBlockedThem] = await Promise.all([
      dataLayer.directMessages.isDmBlockedBetween(userId, otherUserId),
      dataLayer.directMessages.didUserBlock(userId, otherUserId),
    ]);
    res.json({
      success: true,
      data: { blocked, iBlockedThem },
    });
  })
);

// POST /api/v1/users/:userId/blocks - Block a user for DMs
router.post(
  '/:userId/blocks',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const authUserId = requireAuthUserId(req, res);
    if (!authUserId) return;
    const { userId } = req.params;
    if (authUserId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const blockedUserId =
      typeof req.body?.blockedUserId === 'string' ? req.body.blockedUserId.trim() : '';
    if (!blockedUserId) {
      return res.status(400).json({ success: false, error: 'blockedUserId is required' });
    }
    if (blockedUserId === userId) {
      return res.status(400).json({ success: false, error: 'Cannot block yourself' });
    }
    try {
      await dataLayer.directMessages.blockUser(userId, blockedUserId);
      res.status(201).json({ success: true, data: { blockedUserId } });
    } catch (error: any) {
      logger.error('Failed to block user', { error: error?.message, userId, blockedUserId });
      res.status(400).json({
        success: false,
        error: error?.message || 'Failed to block user',
      });
    }
  })
);

// DELETE /api/v1/users/:userId/blocks/:blockedUserId - Unblock a user
router.delete(
  '/:userId/blocks/:blockedUserId',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const authUserId = requireAuthUserId(req, res);
    if (!authUserId) return;
    const { userId, blockedUserId } = req.params;
    if (authUserId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    if (!blockedUserId) {
      return res.status(400).json({ success: false, error: 'blockedUserId is required' });
    }
    await dataLayer.directMessages.unblockUser(userId, blockedUserId);
    res.json({ success: true, data: { blockedUserId } });
  })
);

// ---------------------------------------------------------------------------
// Monthly budget (user_budgets)
//
// The mobile client has always called these two paths, but nothing served them:
// both returned 404 and both clients swallow the failure (fetch catches to null,
// save logs a warning). The web client sidesteps the API and writes user_budgets
// through Supabase directly, so a budget set on web was invisible on mobile and
// a budget set on mobile never left the device. Serving them here puts both
// clients on one source of truth.
// ---------------------------------------------------------------------------

export const MONTH_YEAR_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Current month as `yyyy-mm` (UTC — callers should pass their own month). */
export function currentMonthYear(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// GET /api/v1/users/:userId/budget?monthYear=YYYY-MM
router.get(
  '/:userId/budget',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    // Self only — deliberately stricter than the settings routes above. Nothing
    // in support needs to read someone's finances, so do not grant it.
    if (requestingUserId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const requested = typeof req.query.monthYear === 'string' ? req.query.monthYear : '';
    if (requested && !MONTH_YEAR_RE.test(requested)) {
      return res.status(400).json({ success: false, error: 'monthYear must be YYYY-MM' });
    }
    const monthYear = requested || currentMonthYear();

    const { data, error } = await dataLayer.budget.getMonthlyBudgetForMonth(userId, monthYear);

    if (error) throw error;

    // No budget for the month is a normal state, not an error — the clients
    // treat a null payload as "keep what you have".
    res.json({
      success: true,
      data: data
        ? { monthly_limit: Number(data.monthly_limit) || 0, month_year: data.month_year }
        : null,
    });
  })
);

// PUT /api/v1/users/:userId/budget
router.put(
  '/:userId/budget',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId } = req.params;
    // Self only. An admin silently rewriting someone's budget is not a feature.
    if (requestingUserId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { monthlyLimit, monthYear } = req.body ?? {};
    const limit = Number(monthlyLimit);
    if (!Number.isFinite(limit) || limit < 0) {
      return res
        .status(400)
        .json({ success: false, error: 'monthlyLimit must be a non-negative number' });
    }
    if (typeof monthYear !== 'string' || !MONTH_YEAR_RE.test(monthYear)) {
      return res.status(400).json({ success: false, error: 'monthYear must be YYYY-MM' });
    }

    logger.debug('Saving user budget', { userId, monthYear, requestingUserId });

    const { data, error } = await dataLayer.budget.upsertMonthlyBudget(
      userId,
      monthYear,
      limit
    );

    if (error) throw error;

    res.json({
      success: true,
      data: {
        monthly_limit: Number(data?.monthly_limit ?? limit) || 0,
        month_year: data?.month_year ?? monthYear,
      },
    });
  })
);

// ============================================================
// CREATOR FOLLOWS (Phase 2 · J)
// ============================================================

// POST /api/v1/users/:userId/follow
router.post(
  '/:userId/follow',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { getCreatorsService } = await import('../services/creators');
    try {
      const data = await getCreatorsService(dataLayer).follow(userId, req.params.userId);
      res.json({ success: true, data });
    } catch (err: any) {
      // Only user-facing PublicErrors become 4xx; DB/internal errors must keep
      // escaping to the global handler (masking them as 400 hides real faults).
      if (err instanceof PublicError) {
        const raw = (err as { statusCode?: number }).statusCode;
        const code = typeof raw === 'number' && raw >= 400 && raw < 500 ? raw : 400;
        return res.status(code).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

// DELETE /api/v1/users/:userId/follow
router.delete(
  '/:userId/follow',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { getCreatorsService } = await import('../services/creators');
    const data = await getCreatorsService(dataLayer).unfollow(userId, req.params.userId);
    res.json({ success: true, data });
  })
);

// GET /api/v1/users/:userId/followers
router.get(
  '/:userId/followers',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const viewerId = requireAuthUserId(req, res);
    if (!viewerId) return;
    const { getCreatorsService } = await import('../services/creators');
    const page = req.query?.page ? Number(req.query.page) : 1;
    const data = await getCreatorsService(dataLayer).listFollowers(
      req.params.userId,
      page,
      30,
      viewerId
    );
    res.json({ success: true, data });
  })
);

// GET /api/v1/users/:userId/following
router.get(
  '/:userId/following',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const viewerId = requireAuthUserId(req, res);
    if (!viewerId) return;
    const { getCreatorsService } = await import('../services/creators');
    const page = req.query?.page ? Number(req.query.page) : 1;
    const data = await getCreatorsService(dataLayer).listFollowing(
      req.params.userId,
      page,
      30,
      viewerId
    );
    res.json({ success: true, data });
  })
);

export default router;
