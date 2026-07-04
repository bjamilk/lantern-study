import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { allowDevAuthBypass, requireGroupMember } from '../middleware/authorizeResource';
import { handleValidationErrors, validateGroupId, validateCreateGroup, validateUpdateGroup, validatePagination, validateSearch } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { CacheKeys, CacheTTL } from '../services/cachePolicy';
import { logger } from '../utils/logger';
import { requireAuthUserId } from '../utils/requestAuth';
import { clientErrorMessage } from '../utils/safeError';
import { User } from '../types/index';

const router = Router();
const DEFAULT_GROUP_PAGE_SIZE = 20;
const MAX_GROUP_PAGE_SIZE = 50;
const resolveResponseProfile = (profile: unknown): 'compact' | 'full' =>
  profile === 'compact' ? 'compact' : 'full';

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
  authMiddleware,
  validatePagination,
  validateSearch,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { page = 1, limit, search, responseProfile } = req.query;
      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const requestedLimit = parseInt((limit as string) || `${DEFAULT_GROUP_PAGE_SIZE}`, 10);
      const limitNum = Math.min(MAX_GROUP_PAGE_SIZE, Math.max(1, requestedLimit || DEFAULT_GROUP_PAGE_SIZE));
      const profile = resolveResponseProfile(responseProfile);

      // Cache key is per-user so each user gets their own groups list
      const cacheKey = userId
        ? `groups:user:${userId}:p${pageNum}:l${limitNum}${search ? `:s${search}` : ''}:profile:${profile}`
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
        userId,
        responseProfile: profile,
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
        responseProfile: profile,
      });
    } catch (error) {
      console.error('Error in groups route:', error);
      res.status(500).json({ error: clientErrorMessage(error, 'Internal server error') });
    }
  })
);

// GET /api/v1/groups/unread/all - Get unread counts for all groups
// NOTE: This MUST be before /:groupId to avoid route matching issues
router.get(
  '/unread/all',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const cacheKey = CacheKeys.unreadGroups(userId);
      const cached = await cacheService.get<Record<string, number>>(cacheKey);
      if (cached) {
        return res.json({ success: true, data: cached });
      }

      const unreadCounts = await supabaseService.getAllGroupUnreadCounts(userId);
      await cacheService.set(cacheKey, unreadCounts, CacheTTL.unreadCounts);

      res.json({
        success: true,
        data: unreadCounts,
      });
    } catch (error) {
      console.error('Error getting unread counts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get unread counts',
      });
    }
  })
);

// GET /api/v1/groups/:groupId - Get group by ID
router.get(
  '/:groupId',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;

    logger.debug('Fetching group', { groupId, userId });

    const group = await supabaseService.getGroupById(groupId, userId);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
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
  authMiddleware,
  validateCreateGroup,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { name, description, avatar_url, permissions, invite_id, parent_id, memberIds } = req.body;
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
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    const updateData = req.body;

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
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;

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
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    const { userId: memberId } = req.body;

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
    await cacheService.deletePattern(`group:members:${groupId}:*`);
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
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    const { userIds } = req.body;

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

    try {
      const batchResult = await supabaseService.addGroupMembersBatch(groupId, userIds);
      results.added = batchResult.added;
      results.alreadyMembers = batchResult.alreadyMembers;
    } catch (error) {
      logger.error('Batch add members failed', { groupId, error });
      results.failed = userIds;
    }

    // Invalidate caches (batch method already invalidates on success)
    if (results.added.length === 0 && results.alreadyMembers.length > 0) {
      await cacheService.delete(`group:${groupId}`);
      await cacheService.deletePattern(`group:members:${groupId}:*`);
    }

    res.json({
      success: true,
      data: results,
      message: `${results.added.length} member(s) added successfully`,
    });
  })
);

// GET /api/v1/groups/invite/:inviteId - Preview group for invite (no join)
router.get(
  '/invite/:inviteId',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { inviteId } = req.params;
    if (!inviteId) {
      return res.status(400).json({ success: false, error: 'inviteId is required' });
    }

    const group = await supabaseService.getGroupByInviteId(inviteId);
    if (!group) {
      return res.status(404).json({ success: false, error: 'Invalid or expired invite link' });
    }
    if (group.isArchived) {
      return res.status(400).json({ success: false, error: 'This group has been archived' });
    }

    const { count } = await supabaseService.getClient()
      .from('group_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('group_id', group.id);

    const { data: membership } = await supabaseService.getClient()
      .from('group_members')
      .select('user_id, pending')
      .eq('group_id', group.id)
      .eq('user_id', userId)
      .maybeSingle();

    const isPending = membership?.pending === true;

    res.json({
      success: true,
      data: {
        id: group.id,
        name: group.name,
        description: group.description || '',
        avatarUrl: group.avatarUrl,
        memberCount: count ?? 0,
        alreadyMember: !!membership && !isPending,
        pending: isPending,
      },
    });
  })
);

// POST /api/v1/groups/join - Join a group via invite link
router.post(
  '/join',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { inviteId } = req.body;

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
    await cacheService.deletePattern(`group:members:${group.id}:*`);
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
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId, memberId } = req.params;

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
    await cacheService.deletePattern(`group:members:${groupId}:*`);
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
  allowDevAuthBypass() ? optionalAuthMiddleware : authMiddleware,
  requireGroupMember('groupId'),
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
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;

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
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { groupId } = req.params;

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
      });
    }
  })
);

// POST /api/v1/groups/:groupId/admins/:memberId - Promote member to admin
router.post(
  '/:groupId/admins/:memberId',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId, memberId } = req.params;
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({ success: false, error: 'Group not found or access denied' });
    }

    const isAdmin = (group.permissions && group.permissions[userId]?.admin) || group.adminIds?.includes(userId);
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Only group admins can promote members' });
    }

    if (group.adminIds?.includes(memberId)) {
      return res.json({ success: true, data: group });
    }

    const updatedGroup = await supabaseService.updateGroup(groupId, {
      adminIds: [...(group.adminIds || []), memberId],
    });

    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern('groups:list:*');

    res.json({ success: true, data: updatedGroup });
  })
);

// DELETE /api/v1/groups/:groupId/admins/:memberId - Demote admin
router.delete(
  '/:groupId/admins/:memberId',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId, memberId } = req.params;
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({ success: false, error: 'Group not found or access denied' });
    }

    const isAdmin = (group.permissions && group.permissions[userId]?.admin) || group.adminIds?.includes(userId);
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Only group admins can demote members' });
    }

    if ((group.adminIds?.length || 0) <= 1 && group.adminIds?.includes(memberId)) {
      return res.status(400).json({ success: false, error: 'Cannot demote the only admin' });
    }

    const updatedGroup = await supabaseService.updateGroup(groupId, {
      adminIds: (group.adminIds || []).filter((id: string) => id !== memberId),
    });

    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern('groups:list:*');

    res.json({ success: true, data: updatedGroup });
  })
);

export default router;