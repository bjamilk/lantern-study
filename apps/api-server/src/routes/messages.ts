import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validateGroupId, validateSendMessage, validateMessageId, validatePagination } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { clientErrorMessage } from '../utils/safeError';
import { requireAuthUserId } from '../utils/requestAuth';
import { enforceResourceOwner, userScopedCacheKey } from '../utils/resourceAccess';
import { CacheKeys, CacheTTL } from '../services/cachePolicy';
import { AuthenticatedRequest, Message } from '../types';

const router = Router();
const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const MAX_MESSAGE_PAGE_SIZE = 100;
const resolveResponseProfile = (profile: unknown): 'compact' | 'full' =>
  profile === 'compact' ? 'compact' : 'full';

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeMessageRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// GET /api/v1/messages/group/:groupId/user-votes - Get user votes for a group
// This route MUST be defined before /group/:groupId to avoid being caught by that route
router.get(
  '/group/:groupId/user-votes',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;

    logger.debug('Fetching user votes for group', { groupId, userId });

    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    const votes = await supabaseService.getUserVotesForGroup(groupId, userId);

    res.json({
      success: true,
      data: votes,
    });
  })
);

// GET /api/v1/messages/group/:groupId - Get messages for a group
router.get(
  '/group/:groupId',
  authMiddleware,
  validateGroupId,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    const { page = 1, limit, before, after, responseProfile } = req.query;
    const profile = resolveResponseProfile(responseProfile);
    const parsedPage = Math.max(1, parseInt(page as string, 10) || 1);
    const requestedLimit = parseInt((limit as string) || `${DEFAULT_MESSAGE_PAGE_SIZE}`, 10);
    const parsedLimit = Math.min(MAX_MESSAGE_PAGE_SIZE, Math.max(1, requestedLimit || DEFAULT_MESSAGE_PAGE_SIZE));

    logger.debug('Fetching group messages', { groupId, page: parsedPage, limit: parsedLimit, before, after, userId, profile });

    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    const cacheKey = `messages:group:${groupId}:${parsedPage}:${parsedLimit}:${before || ''}:${after || ''}:profile:${profile}`;
    let messages = await cacheService.get(cacheKey) as Message[] | null;

    if (!messages) {
      messages = await supabaseService.getGroupMessages(groupId, {
        page: parsedPage,
        limit: parsedLimit,
        before: before as string,
        after: after as string,
        responseProfile: profile,
      });

      // Cache for 2 minutes (messages change frequently)
      await cacheService.set(cacheKey, messages, 120);
    }

    res.json({
      success: true,
      data: messages,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total: messages.length,
      },
      responseProfile: profile,
    });
  })
);

// GET /api/v1/messages/group/:groupId/votes - Get user's votes for all messages in a group
router.get(
  '/group/:groupId/votes',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;

    logger.debug('Fetching user votes for group', { groupId, userId });

    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    const votes = await supabaseService.getUserVotesForGroup(groupId, userId);

    res.json({
      success: true,
      data: votes,
    });
  })
);

// POST /api/v1/messages/group/:groupId - Send message to group
router.post(
  '/group/:groupId',
  authMiddleware,
  validateSendMessage,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    const { content } = req.body;

    logger.debug('Sending message to group', { groupId, content: content.substring(0, 100), userId });

    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    const message = await supabaseService.sendMessage(groupId, userId, content);

    // Invalidate message caches for this group
    await cacheService.deletePattern(`messages:group:${groupId}:*`);

    // Also invalidate group stats cache
    await cacheService.delete(`group:stats:${groupId}`);

    res.status(201).json({
      success: true,
      data: message,
    });
  })
);

// GET /api/v1/messages/dm/threads - List DM threads for current user
router.get(
  '/dm/threads',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      // Get all threads where user is a participant
      const { data: threads, error } = await supabaseService.getClient()
        .from('dm_threads')
        .select('id, participant_ids, participants, last_message, last_message_time, archived_by')
        .order('last_message_time', { ascending: false });

      if (error) {
        logger.error('Error fetching DM threads', { error, userId });
        return res.status(500).json({ success: false, error: 'Failed to fetch DM threads' });
      }

      // Filter to threads that include this user
      const userThreads = (threads || []).filter((t: any) => {
        const pids = t.participant_ids;
        return Array.isArray(pids) && pids.includes(userId);
      });

      // Look up participant profiles
      const otherUserIds = userThreads.map((t: any) => {
        const pids = Array.isArray(t.participant_ids) ? t.participant_ids : [];
        return pids.find((id: string) => id !== userId);
      }).filter(Boolean);

      let profilesMap: Record<string, any> = {};
      if (otherUserIds.length > 0) {
        const { data: profiles } = await supabaseService.getClient()
          .from('profiles')
          .select('id, name, avatar_url')
          .in('id', otherUserIds);
        if (profiles) {
          profilesMap = Object.fromEntries(profiles.map((p: any) => [p.id, p]));
        }
      }

      // Also get current user profile for participants map
      const { data: currentProfile } = await supabaseService.getClient()
        .from('profiles')
        .select('id, name, avatar_url')
        .eq('id', userId)
        .single();

      const result = userThreads.map((t: any) => {
        const pids = Array.isArray(t.participant_ids) ? t.participant_ids : [];
        const otherUserId = pids.find((id: string) => id !== userId);
        const otherProfile = otherUserId ? profilesMap[otherUserId] : null;

        return {
          id: t.id,
          participantIds: pids,
          participants: {
            [userId]: {
              name: currentProfile?.name || 'You',
              avatarUrl: currentProfile?.avatar_url,
            },
            ...(otherUserId && otherProfile ? {
              [otherUserId]: {
                name: otherProfile.name || 'Unknown',
                avatarUrl: otherProfile.avatar_url,
              }
            } : {}),
          },
          lastMessage: t.last_message,
          lastMessageTimestamp: t.last_message_time,
          isArchived: Array.isArray(t.archived_by) && t.archived_by.includes(userId),
        };
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Error in DM threads endpoint', { error: error.message, userId });
      res.status(500).json({ success: false, error: 'Failed to fetch DM threads' });
    }
  })
);

// GET /api/v1/messages/dm/unread/all - Get unread counts for all DM threads
// IMPORTANT: This must be defined BEFORE /:messageId to avoid being caught by that route
router.get(
  '/dm/unread/all',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const cacheKey = CacheKeys.unreadDm(userId);
      const cached = await cacheService.get<Record<string, number>>(cacheKey);
      if (cached) {
        return res.json({ success: true, data: cached });
      }

      const unreadCounts = await supabaseService.getAllDMUnreadCounts(userId);
      await cacheService.set(cacheKey, unreadCounts, CacheTTL.unreadCounts);

      res.json({
        success: true,
        data: unreadCounts,
      });
    } catch (error) {
      console.error('Error getting DM unread counts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get DM unread counts',
        message: (error as Error).message,
      });
    }
  })
);

// POST /api/v1/messages/dm/:threadId/read - Mark DM thread as read
// IMPORTANT: This must be defined BEFORE /:messageId to avoid being caught by that route
router.post(
  '/dm/:threadId/read',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { threadId } = req.params;

      const success = await supabaseService.markDMAsRead(threadId, userId);

      res.json({
        success,
        message: success ? 'DM marked as read' : 'Failed to mark DM as read',
      });
    } catch (error) {
      console.error('Error marking DM as read:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to mark DM as read',
        message: (error as Error).message,
      });
    }
  })
);

// PUT /api/v1/messages/dm/:threadId/archive - Archive a DM thread for a user
router.put(
  '/dm/:threadId/archive',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { threadId } = req.params;

      const success = await supabaseService.archiveDmThread(threadId, userId);
      if (!success) {
        return res.status(404).json({ success: false, error: 'DM thread not found or you are not a participant' });
      }

      res.json({ success: true, message: 'DM thread archived' });
    } catch (error) {
      console.error('Error archiving DM thread:', error);
      res.status(500).json({ success: false, error: 'Failed to archive DM thread', message: (error as Error).message });
    }
  })
);

// PUT /api/v1/messages/dm/:threadId/unarchive - Unarchive a DM thread for a user
router.put(
  '/dm/:threadId/unarchive',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { threadId } = req.params;

      const success = await supabaseService.unarchiveDmThread(threadId, userId);
      if (!success) {
        return res.status(404).json({ success: false, error: 'DM thread not found' });
      }

      res.json({ success: true, message: 'DM thread unarchived' });
    } catch (error) {
      console.error('Error unarchiving DM thread:', error);
      res.status(500).json({ success: false, error: 'Failed to unarchive DM thread', message: (error as Error).message });
    }
  })
);

// DELETE /api/v1/messages/dm/:threadId - Delete a DM thread and all its messages
router.delete(
  '/dm/:threadId',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { threadId } = req.params;

      const success = await supabaseService.deleteDmThread(threadId, userId);

      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'DM thread not found or you are not a participant',
        });
      }

      res.json({
        success: true,
        message: 'DM thread deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting DM thread:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete DM thread',
        message: (error as Error).message,
      });
    }
  })
);

// GET /api/v1/messages/:messageId - Get message by ID
router.get(
  '/:messageId',
  authMiddleware,
  validateMessageId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;

    logger.debug('Fetching message', { messageId, userId });

    const cacheKey = userScopedCacheKey('message', userId, messageId);
    let message = await cacheService.get(cacheKey);

    if (!message) {
      message = await supabaseService.getMessageById(messageId, userId);

      if (!message) {
        return res.status(404).json({
          success: false,
          error: 'Message not found or access denied',
        });
      }

      // Cache for 10 minutes
      await cacheService.set(cacheKey, message, 600);
    } else {
      const msg = message as Record<string, unknown>;
      const senderId = msg.senderId ?? msg.sender_id;
      if (senderId !== userId) {
        const groupId = msg.groupId ?? msg.group_id;
        if (groupId) {
          const group = await supabaseService.getGroupById(String(groupId), userId);
          if (!group) {
            return res.status(403).json({ success: false, error: 'Access denied' });
          }
        } else if (!enforceResourceOwner(res, msg, userId)) {
          return;
        }
      }
    }

    res.json({
      success: true,
      data: message,
    });
  })
);

// PUT /api/v1/messages/:messageId - Update message
router.put(
  '/:messageId',
  authMiddleware,
  validateMessageId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;
    const { content } = req.body;

    logger.debug('Updating message', { messageId, content: content?.substring(0, 100), userId });

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message content is required',
      });
    }

    // Get the message first to check ownership
    const existingMessage = await supabaseService.getMessageById(messageId, userId);
    if (!existingMessage) {
      return res.status(404).json({
        success: false,
        error: 'Message not found or access denied',
      });
    }

    // Check if user owns this message
    if (existingMessage.senderId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const updatedMessage = await supabaseService.updateMessage(messageId, content);

    // Invalidate message caches
    await cacheService.delete(`message:${messageId}`);
    await cacheService.deletePattern(`messages:group:${existingMessage.groupId}:*`);

    res.json({
      success: true,
      data: updatedMessage,
    });
  })
);

// DELETE /api/v1/messages/:messageId - Delete message
router.delete(
  '/:messageId',
  authMiddleware,
  validateMessageId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;

    logger.debug('Deleting message', { messageId, userId });

    // Get the message first to check ownership and get group ID
    const message = await supabaseService.getMessageById(messageId, userId);
    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'Message not found or access denied',
      });
    }

    // Check if user owns this message or is group admin (for group messages)
    let canDelete = message.senderId === userId;
    
    if (message.groupId) {
      const group = await supabaseService.getGroupById(message.groupId, userId);
      canDelete = canDelete || group?.permissions[userId]?.admin || group?.adminIds?.includes(userId);
    }

    if (!canDelete) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const deleted = await supabaseService.deleteMessage(messageId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Message not found',
      });
    }

    // Invalidate caches
    await cacheService.delete(`message:${messageId}`);
    if (message.groupId) {
      await cacheService.deletePattern(`messages:group:${message.groupId}:*`);
      await cacheService.delete(`group:stats:${message.groupId}`);
    }

    res.json({
      success: true,
      message: 'Message deleted successfully',
    });
  })
);

// GET /api/v1/messages/user/:userId - Get direct messages for user
router.get(
  '/user/:userId',
  authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const authUserId = requireAuthUserId(req, res);
    if (!authUserId) return;

    const { userId } = req.params;
    const { page = 1, limit = 50, otherUserId } = req.query;

    if (authUserId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    logger.debug('Fetching direct messages', { userId: authUserId, otherUserId, page, limit });

    if (!otherUserId) {
      return res.status(400).json({
        success: false,
        error: 'otherUserId parameter is required for direct messages',
      });
    }

    try {
      const cacheKey = `messages:direct:${authUserId}:${otherUserId}:${page}:${limit}`;
      let messages = await cacheService.get(cacheKey) as Message[] | null;

      if (!messages) {
        messages = await supabaseService.getDirectMessages(authUserId, otherUserId as string, {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
        });

        // Cache for 2 minutes
        await cacheService.set(cacheKey, messages, 120);
      }

      res.json({
        success: true,
        data: messages || [],
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total: (messages || []).length,
        },
      });
    } catch (error: any) {
      logger.error('Error fetching direct messages:', { error: error.message, userId, otherUserId });
      res.status(500).json({
        success: false,
        error: clientErrorMessage(error, 'Failed to fetch direct messages'),
      });
    }
  })
);

// POST /api/v1/messages/user/:userId - Send direct message
router.post(
  '/user/:userId',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const senderId = requireAuthUserId(req, res);
    if (!senderId) return;

    const { userId } = req.params;
    const { content, recipientId } = req.body;

    if (senderId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    logger.debug('Sending direct message', {
      senderId,
      recipientId,
      content: content?.substring(0, 100)
    });

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message content is required',
      });
    }

    if (!recipientId) {
      return res.status(400).json({
        success: false,
        error: 'Recipient ID is required',
      });
    }

    try {
      const message = await supabaseService.sendDirectMessage(senderId, recipientId, content);

      // Invalidate direct message caches
      await cacheService.deletePattern(`messages:direct:${senderId}:${recipientId}:*`);
      await cacheService.deletePattern(`messages:direct:${recipientId}:${senderId}:*`);

      res.status(201).json({
        success: true,
        data: message,
      });
    } catch (error: any) {
      const blocked =
        error.message?.includes('does not accept direct messages') ||
        error.message?.includes('only accepts direct messages');
      logger.error('Error sending direct message:', { error: error.message, senderId, recipientId });
      res.status(blocked ? 403 : 500).json({
        success: false,
        error: blocked ? error.message : clientErrorMessage(error, 'Failed to send direct message'),
      });
    }
  })
);

// POST /api/v1/messages/:messageId/vote - Vote on message
router.post(
  '/:messageId/vote',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;
    const { voteType } = req.body;

    logger.debug('Voting on message', { messageId, voteType, userId });

    if (!voteType || !['up', 'down'].includes(voteType)) {
      return res.status(400).json({
        success: false,
        error: 'Valid vote type (up or down) is required',
      });
    }

    const result = await supabaseService.voteQuestion(messageId, userId, voteType);

    // Invalidate message cache
    await cacheService.delete(`message:${messageId}`);

    res.json({
      success: true,
      data: result,
    });
  })
);

// DELETE /api/v1/messages/:messageId/vote - Remove vote from message
router.delete(
  '/:messageId/vote',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;

    logger.debug('Removing vote from message', { messageId, userId });

    const result = await supabaseService.removeVote(messageId, userId);

    // Invalidate message cache
    await cacheService.delete(`message:${messageId}`);

    res.json({
      success: true,
      data: result,
    });
  })
);

// PUT /api/v1/messages/:messageId/status - Update question status
router.put(
  '/:messageId/status',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;
    const { questionStatus } = req.body;

    logger.debug('Updating question status', { messageId, questionStatus, userId });

    if (!questionStatus || !['PENDING', 'VERIFIED', 'REJECTED'].includes(questionStatus)) {
      return res.status(400).json({
        success: false,
        error: 'Valid question status (PENDING, VERIFIED, REJECTED) is required',
      });
    }

    const result = await supabaseService.updateQuestionStatus(messageId, questionStatus);

    // Invalidate message cache
    await cacheService.delete(`message:${messageId}`);

    res.json({
      success: true,
      data: result,
    });
  })
);

// PUT /api/v1/messages/:messageId/update - Update message (flagged status)
router.put(
  '/:messageId/update',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;
    const { flagged_as_similar_user_ids, flaggedUserIds } = req.body;
    const flagIds = flagged_as_similar_user_ids ?? flaggedUserIds;

    logger.debug('Updating message', { messageId, userId });

    const result = await supabaseService.updateMessageFlagged(messageId, flagIds);

    // Invalidate message cache
    await cacheService.delete(`message:${messageId}`);

    res.json({
      success: true,
      data: result,
    });
  })
);

export default router;