import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validateUserId, validateCreateUser, validateUpdateUser, validatePagination } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { AuthenticatedRequest, User, Group } from '../types';

const router = Router();

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeUserRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// GET /api/v1/users - Get all users with pagination
router.get(
  '/',
  // authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const { page = 1, limit = 20, search } = req.query;
    const userId = req.user?.id;

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

// GET /api/v1/users/:userId - Get user by ID
router.get(
  '/:userId',
  // authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const { userId } = req.params;
    const requestingUserId = req.user?.id;

    logger.debug('Fetching user', { userId, requestingUserId });

    const cacheKey = `user:${userId}`;
    let user = await cacheService.get(cacheKey);

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

    res.json({
      success: true,
      data: user,
    });
  })
);

// POST /api/v1/users - Create new user
router.post(
  '/',
  // authMiddleware,
  validateCreateUser,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userData = req.body;
    const requestingUserId = req.user?.id;

    logger.debug('Creating user', { userData, requestingUserId });

    // Check if user already exists
    const existingUser = await supabaseService.getUserByEmail(userData.email);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'User with this email already exists',
      });
    }

    const newUser = await supabaseService.createUser(userData);

    // Invalidate users list cache
    await cacheService.deletePattern('users:list:*');

    res.status(201).json({
      success: true,
      data: newUser,
    });
  })
);

// PUT /api/v1/users/:userId - Update user
router.put(
  '/:userId',
  // authMiddleware,
  validateUserId,
  validateUpdateUser,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const { userId } = req.params;
    const updateData = req.body;
    const requestingUserId = req.user?.id;

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

// DELETE /api/v1/users/:userId - Delete user
router.delete(
  '/:userId',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const { userId } = req.params;
    const requestingUserId = req.user?.id;

    logger.debug('Deleting user', { userId, requestingUserId });

    // Check permissions (users can only delete themselves or admins can delete anyone)
    if (requestingUserId !== userId && !req.user?.isAdmin) {
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

// GET /api/v1/users/:userId/stats - Get user statistics
router.get(
  '/:userId/stats',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const { userId } = req.params;
    const requestingUserId = req.user?.id;

    logger.debug('Fetching user stats', { userId, requestingUserId });

    // Check permissions (users can only view their own stats or admins can view anyone's)
    if (requestingUserId !== userId && !req.user?.isAdmin) {
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
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const requestingUserId = req.user?.id;

    logger.debug('Fetching user groups', { userId, page, limit, requestingUserId });

    // Check permissions (users can only view their own groups or admins can view anyone's)
    if (requestingUserId !== userId && !req.user?.isAdmin) {
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
    const { userId } = req.params;
    const requestingUserId = req.user?.id;

    logger.debug('Fetching user settings', { userId, requestingUserId });

    // Users can only view their own settings
    if (requestingUserId !== userId && !req.user?.isAdmin) {
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
    const { userId } = req.params;
    const { settings } = req.body;
    const requestingUserId = req.user?.id;

    logger.debug('Updating user settings', { userId, requestingUserId });

    // Users can only update their own settings
    if (requestingUserId !== userId && !req.user?.isAdmin) {
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

    const updatedUser = await supabaseService.updateUser(userId, { settings });

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

// PUT /api/v1/users/settings - Update current user's settings (convenience endpoint)
router.put(
  '/settings',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const { settings } = req.body;
    const userId = req.user?.id;

    logger.debug('Updating current user settings', { userId });

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    if (!settings) {
      return res.status(400).json({
        success: false,
        error: 'Settings object is required',
      });
    }

    const updatedUser = await supabaseService.updateUser(userId, { settings });

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

// GET /api/v1/users/search - Search users by username or name
router.get(
  '/search',
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const { q, limit = 20 } = req.query;
    const currentUserId = req.user?.id;

    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters',
      });
    }

    const searchQuery = q.trim().toLowerCase();
    const resultLimit = Math.min(parseInt(limit as string) || 20, 50);

    logger.debug('Searching users', { query: searchQuery, limit: resultLimit, currentUserId });

    try {
      // Use the search_users database function
      const { data, error } = await supabaseService.getClient()
        .rpc('search_users', {
          search_query: searchQuery,
          exclude_user_id: currentUserId || null,
          result_limit: resultLimit,
        });

      if (error) {
        logger.error('User search error', { error });
        return res.status(500).json({
          success: false,
          error: 'Failed to search users',
        });
      }

      // Format response with @username display
      const users = (data || []).map((user: any) => ({
        id: user.id,
        username: user.username,
        displayUsername: user.username ? `@${user.username}` : null,
        firstName: user.first_name,
        lastName: user.last_name,
        name: user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        avatarUrl: user.avatar_url,
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

// GET /api/v1/users/check-username/:username - Check if username is available
router.get(
  '/check-username/:username',
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
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const { userId } = req.params;
    const { username, firstName, lastName } = req.body;

    // Basic auth check - user can only update their own username
    // In production, use proper auth middleware
    const requestingUserId = req.user?.id;
    if (requestingUserId && requestingUserId !== userId) {
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

export default router;