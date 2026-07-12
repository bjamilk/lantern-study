import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, requirePlatformAdmin } from '../middleware/auth';
import { mergeUserSettings, isPushEnabledInSettings } from '../utils/sanitizeSettings';
import { parseUserSettings } from '../utils/userSettingsPolicy';
import { canViewStudyActivity, resolvePublicOnlineStatus } from '@lantern/shared/settings';
import { handleValidationErrors, validateUserId, validateCreateUser, validateUpdateUser, validatePagination, validateAccountPasswordBody, validateAccountImportBody } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
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
import { ACCOUNT_DELETION_GRACE_DAYS } from '@lantern/shared/accountLifecycle';

const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const NON_ADMIN_UPDATABLE_FIELDS = new Set([
  'name',
  'phoneNumber',
  'phone',
  'avatarUrl',
  'avatar_url',
  'settings',
  'test_presets',
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
    await supabaseService.clearExpoPushToken(userId);
  }
}

const toPublicUser = (user: User) => ({
  id: user.id,
  name: user.name,
  username: user.username,
  firstName: user.firstName,
  lastName: user.lastName,
  avatarUrl: user.avatarUrl,
  points: user.points,
  badges: user.badges,
});

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeUserRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

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
      users = await supabaseService.getUsers({
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

    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters',
      });
    }

    const searchQuery = q.trim().toLowerCase().replace(/^@+/, '');
    const resultLimit = Math.min(parseInt(limit as string) || 20, 50);

    logger.debug('Searching users', { query: searchQuery, limit: resultLimit, currentUserId });

    try {
      // Use the search_users database function
      const { data, error } = await supabaseService.getClient()
        .rpc('search_users', {
          search_query: searchQuery,
          exclude_user_id: currentUserId || null,
          viewer_id: currentUserId || null,
          result_limit: resultLimit,
        });

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

    const user = await supabaseService.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const isPlatformAdmin = await isLivePlatformAdmin(userId);

    res.json({
      success: true,
      data: {
        ...user,
        capabilities: {
          platformAdmin: isPlatformAdmin,
        },
      },
    });
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
      const visible = await supabaseService.isProfileVisibleToViewer(requestingUserId, userId);
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
      user = await supabaseService.getUserById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      // Cache for 10 minutes
      await cacheService.set(cacheKey, user, 600);
    }

    const responseUser = isOwner || isAdmin ? user : toPublicUser(user);

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

    const existingById = userData.id ? await supabaseService.getUserById(userData.id) : null;

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
        ? await supabaseService.createUser(profilePayload)
        : await supabaseService.createUserProfile(profilePayload);
      await cacheService.deletePattern('users:list:*');
      return res.status(200).json({
        success: true,
        data: updated,
      });
    }

    if (userData.email) {
      const existingUser = await supabaseService.getUserByEmail(userData.email);
      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'User with this email already exists',
        });
      }
    }

    const newUser = userData.email
      ? await supabaseService.createUser(profilePayload)
      : await supabaseService.createUserProfile(profilePayload);

    // Invalidate users list cache
    await cacheService.deletePattern('users:list:*');

    res.status(201).json({
      success: true,
      data: newUser,
    });
  })
);

// PUT /api/v1/users/settings - Update current user's settings (must be before /:userId)
router.put(
  '/settings',
  authMiddleware,
  handleValidationErrors,
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

    const existingUser = await supabaseService.getUserById(userId);
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
    const updatedUser = await supabaseService.updateUser(userId, { settings: mergedSettings });

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Invalidate settings cache
    await cacheService.delete(`user:settings:${userId}`);
    await cacheService.delete(`user:${userId}`);

    res.json({
      success: true,
      data: { settings: updatedUser.settings },
      message: 'Settings synced successfully',
    });
  })
);

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

    const uploaded = await supabaseService.uploadProfileAvatar({
      fileName,
      base64Data,
      contentType,
      userId,
    });

    const updatedUser = await supabaseService.updateUser(userId, { avatarUrl: uploaded.avatarUrl });
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

    logger.debug('Updating user', { userId, updateData, requestingUserId });

    const updatedUser = await supabaseService.updateUser(userId, updateData);

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Invalidate user cache
    await cacheService.delete(`user:${userId}`);
    await cacheService.deletePattern('users:list:*');

    res.json({
      success: true,
      data: updatedUser,
    });
  })
);

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

    const row = await getAccountLifecycle(supabaseService, userId);
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

    const row = await getAccountLifecycle(supabaseService, userId);
    if (!row) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    if (isAccountDeactivated(row)) {
      return res.status(409).json({ success: false, error: 'Account is already paused.' });
    }

    const scheduled = await scheduleAccountDeletion(supabaseService, userId);
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

    const ok = await reactivateAccount(supabaseService, userId);
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
      const row = await getAccountLifecycle(supabaseService, userId);
      const email = row?.email;
      if (!email) {
        return res.status(400).json({ success: false, error: 'Unable to verify password for this account.' });
      }
      const valid = await verifyUserPassword(email, password || '');
      if (!valid) {
        return res.status(401).json({ success: false, error: 'Incorrect password.' });
      }
    }

    const deleted = await supabaseService.deleteUser(userId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    await cacheService.delete(`user:${userId}`);
    await cacheService.deletePattern('users:list:*');

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

    const row = await getAccountLifecycle(supabaseService, userId);
    if (!row?.email) {
      return res.status(400).json({ success: false, error: 'Unable to verify password for this account.' });
    }

    const valid = await verifyUserPassword(row.email, password);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Incorrect password.' });
    }

    try {
      const result = await importAccountArchive(
        supabaseService,
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

    const deleted = await supabaseService.deleteUser(userId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    if (requestingUserId !== userId && (await isLivePlatformAdmin(requestingUserId))) {
      await logAdminAction(supabaseService, {
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
      async () => supabaseService.exportUserData(userId)
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
      stats = await supabaseService.getUserStats(userId);

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
      groups = await supabaseService.getUserGroups(userId, {
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
    let settings = await cacheService.get(cacheKey);

    if (!settings) {
      const user = await supabaseService.getUserById(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      settings = user.settings || null;

      if (settings) {
        settings = parseUserSettings(settings) as unknown as typeof settings;
        // Cache for 10 minutes
        await cacheService.set(cacheKey, settings, 600);
      }
    }

    res.json({
      success: true,
      data: { settings },
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

    const existingUser = await supabaseService.getUserById(userId);
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
    const updatedUser = await supabaseService.updateUser(userId, { settings: mergedSettings });

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Invalidate settings cache
    await cacheService.delete(`user:settings:${userId}`);
    await cacheService.delete(`user:${userId}`);

    res.json({
      success: true,
      data: { settings: updatedUser.settings },
      message: 'Settings updated successfully',
    });
  })
);

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
      const { data, error } = await supabaseService.getClient()
        .rpc('is_username_available', {
          check_username: normalizedUsername,
        });

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
      const { data: isAvailable, error: checkError } = await supabaseService.getClient()
        .rpc('is_username_available', {
          check_username: normalizedUsername,
        });

      if (checkError) {
        logger.error('Username availability check error', { error: checkError });
        return res.status(500).json({
          success: false,
          error: 'Failed to check username availability',
        });
      }

      // Check if the current user already has this username (allow keeping same username)
      const currentUser = await supabaseService.getUserById(userId);
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

      const { data, error } = await supabaseService.getClient()
        .from('profiles')
        .update(updateData)
        .eq('id', userId)
        .select()
        .single();

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

    const user = await supabaseService.getUserById(userId);
    if (!user || !isPushEnabledInSettings(user.settings as Record<string, unknown>)) {
      return res.status(403).json({
        success: false,
        error: 'Push notifications are disabled in your settings',
      });
    }

    await supabaseService.updateExpoPushToken(userId, token.trim());
    res.json({ success: true, message: 'Push token registered' });
  })
);

// DELETE /api/v1/users/push-token - Clear registered push token
router.delete(
  '/push-token',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    await supabaseService.clearExpoPushToken(userId);
    res.json({ success: true, message: 'Push token cleared' });
  })
);

// POST /api/v1/users/presence/heartbeat - Update last seen for online status
router.post(
  '/presence/heartbeat',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    await supabaseService.touchLastSeen(userId);
    res.json({ success: true });
  })
);

export default router;