import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { handleValidationErrors, validateGroupId, validateCreateGroup, validateUpdateGroup, validatePagination, validateSearch } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { Group, User } from '../types/index';

const router = Router();

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeGroupRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// GET /api/v1/groups - Get all groups with pagination and search
router.get(
  '/',
  // authMiddleware,
  // validatePagination,
  // validateSearch,
  // handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    try {
      const { page = 1, limit = 20, search, userId } = req.query;
      const pageNum = parseInt(page as string) || 1;
      const limitNum = parseInt(limit as string) || 20;

      // Cache key is per-user so each user gets their own groups list
      const cacheKey = userId
        ? `groups:user:${userId}:p${pageNum}:l${limitNum}${search ? `:s${search}` : ''}`
        : null;

      if (cacheKey) {
        const cached = await cacheService.get<any[]>(cacheKey);
        if (cached) {
          return res.json({
            success: true,
            data: cached,
            pagination: { page: pageNum, limit: limitNum, total: cached.length },
          });
        }
      }

      const groups = await supabaseService.getGroups({
        page: pageNum,
        limit: limitNum,
        search: search as string,
        userId: userId as string,
      });

      // Cache for 30 seconds — short enough for near-real-time feel, long enough to
      // absorb duplicate/StrictMode requests that fire within milliseconds of each other
      if (cacheKey) {
        await cacheService.set(cacheKey, groups, 30);
      }

      res.json({
        success: true,
        data: groups,
        pagination: { page: pageNum, limit: limitNum, total: groups.length },
      });
    } catch (error) {
      console.error('Error in groups route:', error);
      res.status(500).json({ error: 'Internal server error', details: (error as Error).message });
    }
  })
);

// GET /api/v1/groups/unread/all - Get unread counts for all groups
// NOTE: This MUST be before /:groupId to avoid route matching issues
router.get(
  '/unread/all',
  asyncHandler(async (req: any, res: any) => {
    try {
      const { userId } = req.query;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId query parameter is required',
        });
      }

      const unreadCounts = await supabaseService.getAllGroupUnreadCounts(userId as string);

      res.json({
        success: true,
        data: unreadCounts,
      });
    } catch (error) {
      console.error('Error getting unread counts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get unread counts',
        message: (error as Error).message,
      });
    }
  })
);

// GET /api/v1/groups/:groupId - Get group by ID
router.get(
  '/:groupId',
  // authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { groupId } = req.params;
    const userId = req.user?.id;

    logger.debug('Fetching group', { groupId, userId });

    const cacheKey = `group:${groupId}`;
    let group = await cacheService.get(cacheKey);

    if (!group) {
      group = await supabaseService.getGroupById(groupId, userId);

      if (!group) {
        return res.status(404).json({
          success: false,
          error: 'Group not found or access denied',
        });
      }

      // Cache for 10 minutes
      await cacheService.set(cacheKey, group, 600);
    }

    res.json({
      success: true,
      data: group,
    });
  })
);

// POST /api/v1/groups - Create new group
router.post(
  '/',
  // authMiddleware,
  validateCreateGroup,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { name, description, avatar_url, permissions, invite_id, parent_id, userId, memberIds } = req.body;
    const groupData = { name, description, avatarUrl: avatar_url, permissions, inviteId: invite_id, parentId: parent_id };

    logger.debug('Creating group', { groupData, userId, memberIds });

    const newGroup = await supabaseService.createGroup(groupData, userId, memberIds);

    // Invalidate groups list cache
    await cacheService.deletePattern('groups:list:*');

    res.status(201).json({
      success: true,
      data: newGroup,
    });
  })
);

// PUT /api/v1/groups/:groupId - Update group
router.put(
  '/:groupId',
  authMiddleware,
  validateGroupId,
  validateUpdateGroup,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { groupId } = req.params;
    const updateData = req.body;
    const userId = req.user?.id;

    logger.debug('Updating group', { groupId, updateData, userId });

    // Check if user has permission to update this group
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    // Check if user is admin or owner
    if (!(group.permissions && group.permissions[userId]?.admin) && !(group.adminIds && group.adminIds.includes(userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const updatedGroup = await supabaseService.updateGroup(groupId, updateData);

    // Invalidate group cache
    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern('groups:list:*');

    res.json({
      success: true,
      data: updatedGroup,
    });
  })
);

// DELETE /api/v1/groups/:groupId - Delete group
router.delete(
  '/:groupId',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { groupId } = req.params;
    const userId = req.user?.id;

    logger.debug('Deleting group', { groupId, userId });

    // Check if user has permission to delete this group
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    // Check if user is admin or owner
    if (!(group.permissions && group.permissions[userId]?.admin) && !(group.adminIds && group.adminIds.includes(userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    await supabaseService.deleteGroup(groupId);

    // Invalidate caches
    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern(`messages:group:${groupId}:*`);
    await cacheService.deletePattern(`user:groups:*`);

    res.json({
      success: true,
      message: 'Group deleted successfully',
    });
  })
);

// POST /api/v1/groups/:groupId/members - Add member to group
router.post(
  '/:groupId/members',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { groupId } = req.params;
    const { userId: memberId } = req.body;
    const userId = req.user?.id;

    logger.debug('Adding member to group', { groupId, memberId, userId });

    if (!memberId) {
      return res.status(400).json({
        success: false,
        error: 'Member ID is required',
      });
    }

    // Check if user has permission to add members
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    if (!(group.permissions && group.permissions[userId]?.admin) && !(group.adminIds && group.adminIds.includes(userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const updatedGroup = await supabaseService.addGroupMember(groupId, memberId);

    // Invalidate caches
    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern(`user:groups:${memberId}:*`);

    res.json({
      success: true,
      data: updatedGroup,
    });
  })
);

// POST /api/v1/groups/:groupId/members/batch - Add multiple members to group
router.post(
  '/:groupId/members/batch',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { groupId } = req.params;
    const { userIds } = req.body;
    const userId = req.user?.id;

    logger.debug('Batch adding members to group', { groupId, count: userIds?.length, userId });

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'userIds array is required and must not be empty',
      });
    }

    if (userIds.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'Cannot add more than 50 members at once',
      });
    }

    // Check if user has permission to add members
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    if (!(group.permissions && group.permissions[userId]?.admin) && !(group.adminIds && group.adminIds.includes(userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const results = { added: [] as string[], alreadyMembers: [] as string[], failed: [] as string[] };

    for (const memberId of userIds) {
      try {
        await supabaseService.addGroupMember(groupId, memberId);
        results.added.push(memberId);
      } catch (error) {
        logger.error('Failed to add member', { groupId, memberId, error });
        results.failed.push(memberId);
      }
    }

    // Invalidate caches
    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern('groups:list:*');
    for (const memberId of results.added) {
      await cacheService.deletePattern(`user:groups:${memberId}:*`);
    }

    res.json({
      success: true,
      data: results,
      message: `${results.added.length} member(s) added successfully`,
    });
  })
);

// POST /api/v1/groups/join - Join a group via invite link
router.post(
  '/join',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { inviteId } = req.body;
    const userId = req.user?.id;

    logger.debug('Joining group via invite link', { inviteId, userId });

    if (!inviteId || typeof inviteId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'inviteId is required',
      });
    }

    // Look up group by invite_id
    const group = await supabaseService.getGroupByInviteId(inviteId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Invalid or expired invite link',
      });
    }

    if (group.isArchived) {
      return res.status(400).json({
        success: false,
        error: 'This group has been archived',
      });
    }

    // Add user to group (addGroupMember handles duplicate check)
    const updatedGroup = await supabaseService.addGroupMember(group.id, userId);

    // Invalidate caches
    await cacheService.delete(`group:${group.id}`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern(`user:groups:${userId}:*`);

    res.json({
      success: true,
      data: updatedGroup,
      message: `Successfully joined group "${group.name}"`,
    });
  })
);

// DELETE /api/v1/groups/:groupId/members/:memberId - Remove member from group
router.delete(
  '/:groupId/members/:memberId',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { groupId, memberId } = req.params;
    const userId = req.user?.id;

    logger.debug('Removing member from group', { groupId, memberId, userId });

    // Check if user has permission to remove members
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    // Users can remove themselves, admins can remove anyone
    if (userId !== memberId && !(group.permissions && group.permissions[userId]?.admin) && !(group.adminIds && group.adminIds.includes(userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const updatedGroup = await supabaseService.removeGroupMember(groupId, memberId);

    // Invalidate caches
    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern(`user:groups:${memberId}:*`);

    res.json({
      success: true,
      data: updatedGroup,
    });
  })
);

// GET /api/v1/groups/:groupId/members - Get group members
router.get(
  '/:groupId/members',
  optionalAuthMiddleware,
  validateGroupId,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { groupId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user?.id;

    logger.debug('Fetching group members', { groupId, page, limit, userId });

    // Check if group exists (without strict access check for dev)
    const group = await supabaseService.getGroupById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found',
      });
    }

    const cacheKey = `group:members:${groupId}:${page}:${limit}`;
    let members = await cacheService.get(cacheKey) as User[];

    if (!members) {
      members = await supabaseService.getGroupMembers(groupId, {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
      });

      // Cache for 5 minutes
      await cacheService.set(cacheKey, members, 300);
    }

    res.json({
      success: true,
      data: members,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: members.length,
      },
    });
  })
);

// GET /api/v1/groups/:groupId/stats - Get group statistics
router.get(
  '/:groupId/stats',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { groupId } = req.params;
    const userId = req.user?.id;

    logger.debug('Fetching group stats', { groupId, userId });

    // Check if user has access to this group
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    const cacheKey = `group:stats:${groupId}`;
    let stats = await cacheService.get(cacheKey);

    if (!stats) {
      stats = await supabaseService.getGroupStats(groupId);

      // Cache for 5 minutes
      await cacheService.set(cacheKey, stats, 300);
    }

    res.json({
      success: true,
      data: stats,
    });
  })
);

// POST /api/v1/groups/:groupId/read - Mark group as read
router.post(
  '/:groupId/read',
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    try {
      const { groupId } = req.params;
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required in request body',
        });
      }

      const success = await supabaseService.markGroupAsRead(groupId, userId);

      res.json({
        success,
        message: success ? 'Group marked as read' : 'Failed to mark group as read',
      });
    } catch (error) {
      console.error('Error marking group as read:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to mark group as read',
        message: (error as Error).message,
      });
    }
  })
);

export default router;