import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { uploadBurstRateLimit } from '../middleware/rateLimit';
import { handleValidationErrors, validateGroupId, validateSendMessage, validateMessageId, validatePagination } from '../middleware/validation';
import { ChatMessageMutationResult, SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { clientErrorMessage } from '../utils/safeError';
import { requireAuthUserId } from '../utils/requestAuth';
import { enforceResourceOwner, userScopedCacheKey } from '../utils/resourceAccess';
import { CacheKeys, CacheTTL } from '../services/cachePolicy';
import { AuthenticatedRequest, Message } from '../types';
import {
  mutedUntilFromMinutes,
  resolveChatMuteDurationMinutes,
} from '@lantern/shared/utils/chatMute';
import { readDmHistoryClearedAt } from '@lantern/shared/utils/dmHistoryCutoff';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/jpg'];
const ALLOWED_AUDIO_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-m4a',
];

const router = Router();
const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const MAX_MESSAGE_PAGE_SIZE = 100;
const resolveResponseProfile = (profile: unknown): 'compact' | 'full' =>
  profile === 'compact' ? 'compact' : 'full';

const sendChatMutationResult = (
  res: any,
  result: ChatMessageMutationResult,
  action: 'edited' | 'removed'
) => {
  if (result.status === 'ok') {
    return res.json({
      success: true,
      data: result.message,
      message: `Message ${action}`,
    });
  }

  const errors: Record<
    Exclude<ChatMessageMutationResult['status'], 'ok'>,
    { status: number; message: string }
  > = {
    invalid_content: { status: 400, message: 'Message content must be 1-50000 characters' },
    invalid_kind: { status: 400, message: 'Invalid message type' },
    not_found: { status: 404, message: 'Message not found' },
    forbidden: { status: 403, message: 'Only the sender can change this message' },
    not_editable: { status: 422, message: 'This message cannot be edited' },
    not_removable: { status: 422, message: 'This message cannot be removed' },
    removed: { status: 409, message: 'This message has already been removed' },
    expired: {
      status: 409,
      message: 'Messages can only be edited or removed within 30 minutes of sending',
    },
  };
  const resolved = errors[result.status] || {
    status: 500,
    message: `Failed to ${action === 'edited' ? 'edit' : 'remove'} message`,
  };
  return res.status(resolved.status).json({ success: false, error: resolved.message });
};

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeMessageRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// POST /api/v1/messages/upload-image — SEC-07 chat image upload with magic-byte checks
router.post(
  '/upload-image',
  authMiddleware,
  uploadBurstRateLimit,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { fileName, base64Data, contentType, groupId } = req.body || {};
    if (!fileName || !base64Data) {
      return res.status(400).json({ success: false, error: 'fileName and base64Data are required' });
    }
    const normalizedType = contentType === 'image/jpg' ? 'image/jpeg' : contentType;
    if (!normalizedType || !ALLOWED_IMAGE_TYPES.includes(normalizedType)) {
      return res.status(400).json({
        success: false,
        error: 'contentType is required. Only JPEG, PNG, GIF, and WebP are allowed.',
      });
    }
    const estimatedBytes = Math.ceil((String(base64Data).length * 3) / 4);
    if (estimatedBytes > 10 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Image exceeds 10 MB limit' });
    }

    try {
      const result = await supabaseService.uploadChatImage({
        fileName,
        base64Data,
        contentType: normalizedType,
        userId,
        groupId: typeof groupId === 'string' ? groupId : undefined,
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Failed to upload chat image', { error, userId });
      res.status(400).json({
        success: false,
        error: clientErrorMessage(error, 'Failed to upload image'),
      });
    }
  })
);

// POST /api/v1/messages/upload-audio — chat voice notes (group or DM)
router.post(
  '/upload-audio',
  authMiddleware,
  uploadBurstRateLimit,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { fileName, base64Data, contentType, groupId, threadId } = req.body || {};
    if (!fileName || !base64Data) {
      return res.status(400).json({ success: false, error: 'fileName and base64Data are required' });
    }
    // Browsers often send MediaRecorder types with codec params (audio/webm;codecs=opus).
    const normalizedType = String(contentType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const resolvedType = normalizedType === 'audio/x-m4a' ? 'audio/mp4' : normalizedType;
    if (!resolvedType || !ALLOWED_AUDIO_TYPES.includes(resolvedType)) {
      return res.status(400).json({
        success: false,
        error: 'contentType is required. Use webm, mp4/m4a, ogg, or wav.',
      });
    }
    const estimatedBytes = Math.ceil((String(base64Data).length * 3) / 4);
    if (estimatedBytes > 8 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Audio exceeds 8 MB limit' });
    }

    try {
      const result = await supabaseService.uploadChatAudio({
        fileName,
        base64Data,
        contentType: resolvedType,
        userId,
        groupId: typeof groupId === 'string' ? groupId : undefined,
        threadId: typeof threadId === 'string' ? threadId : undefined,
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Failed to upload chat audio', { error, userId });
      res.status(400).json({
        success: false,
        error: clientErrorMessage(error, 'Failed to upload audio'),
      });
    }
  })
);

// POST /api/v1/messages/upload-question-image — SEC-07 question image upload
router.post(
  '/upload-question-image',
  authMiddleware,
  uploadBurstRateLimit,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { fileName, base64Data, contentType } = req.body || {};
    if (!fileName || !base64Data) {
      return res.status(400).json({ success: false, error: 'fileName and base64Data are required' });
    }
    const normalizedType = contentType === 'image/jpg' ? 'image/jpeg' : contentType;
    if (!normalizedType || !ALLOWED_IMAGE_TYPES.includes(normalizedType)) {
      return res.status(400).json({
        success: false,
        error: 'contentType is required. Only JPEG, PNG, GIF, and WebP are allowed.',
      });
    }
    const estimatedBytes = Math.ceil((String(base64Data).length * 3) / 4);
    if (estimatedBytes > 10 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Image exceeds 10 MB limit' });
    }

    try {
      const result = await supabaseService.uploadQuestionImage({
        fileName,
        base64Data,
        contentType: normalizedType,
        userId,
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Failed to upload question image', { error, userId });
      res.status(400).json({
        success: false,
        error: clientErrorMessage(error, 'Failed to upload image'),
      });
    }
  })
);

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

    // Service-layer cache holds unenriched rows; receipts are viewer-specific.
    const messages = await supabaseService.getGroupMessages(groupId, {
      page: parsedPage,
      limit: parsedLimit,
      before: before as string,
      after: after as string,
      responseProfile: profile,
      viewerUserId: userId,
    });

    res.json({
      success: true,
      data: messages,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total: messages.length,
        hasMore: messages.length === parsedLimit,
      },
      responseProfile: profile,
    });
  })
);

// GET /api/v1/messages/group/:groupId/thread/:rootId - Nested reply thread
router.get(
  '/group/:groupId/thread/:rootId',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId, rootId } = req.params;
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    const messages = await supabaseService.getGroupThread(groupId, rootId, userId);
    res.json({
      success: true,
      data: messages,
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
    const { content, clientMessageId, replyToMessageId, mentionedUserIds } = req.body;

    logger.debug('Sending message to group', { groupId, content: content.substring(0, 100), userId, clientMessageId });

    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    const message = await supabaseService.sendMessage(groupId, userId, content, clientMessageId, {
      replyToMessageId: typeof replyToMessageId === 'string' ? replyToMessageId : undefined,
      mentionedUserIds: Array.isArray(mentionedUserIds)
        ? mentionedUserIds.filter((id: unknown): id is string => typeof id === 'string')
        : undefined,
    });

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
      // participant_ids is jsonb — pass a JSON string so PostgREST uses cs.["uuid"]
      // (a JS array becomes Postgres {uuid} and fails with 22P02 invalid json).
      const { data: threads, error } = await supabaseService.getClient()
        .from('dm_threads')
        .select('id, participant_ids, participants, last_message, last_message_time, archived_by, hidden_by, history_cleared_at, status, requested_by')
        .contains('participant_ids', JSON.stringify([userId]))
        .order('last_message_time', { ascending: false, nullsFirst: false });

      if (error) {
        logger.error('Error fetching DM threads', {
          userId,
          code: error.code,
          message: error.message,
          details: error.details,
        });
        return res.status(500).json({ success: false, error: 'Failed to fetch DM threads' });
      }

      // Keep only threads that include this user and were not "deleted" by them
      const userThreads = (threads || []).filter((t: any) => {
        const pids = t.participant_ids;
        if (!Array.isArray(pids) || !pids.includes(userId)) return false;
        const hiddenBy = Array.isArray(t.hidden_by) ? t.hidden_by : [];
        return !hiddenBy.includes(userId);
      });

      // Look up other participant profiles (current user label is local "You").
      const otherUserIds = [
        ...new Set(
          userThreads
            .map((t: any) => {
              const pids = Array.isArray(t.participant_ids) ? t.participant_ids : [];
              return pids.find((id: string) => id !== userId);
            })
            .filter(Boolean),
        ),
      ] as string[];

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

      // Prefer stored participants JSON when profile lookup misses.
      const result = userThreads.map((t: any) => {
        const pids = Array.isArray(t.participant_ids) ? t.participant_ids : [];
        const otherUserId = pids.find((id: string) => id !== userId);
        const otherProfile = otherUserId ? profilesMap[otherUserId] : null;
        const storedParticipants =
          t.participants && typeof t.participants === 'object' ? t.participants : {};

        const status =
          t.status === 'pending' || t.status === 'declined' || t.status === 'open'
            ? t.status
            : 'open';
        return {
          id: t.id,
          participantIds: pids,
          participants: {
            [userId]: {
              name: storedParticipants[userId]?.name || 'You',
              avatarUrl:
                storedParticipants[userId]?.avatarUrl ||
                storedParticipants[userId]?.avatar_url,
            },
            ...(otherUserId
              ? {
                  [otherUserId]: {
                    name:
                      otherProfile?.name ||
                      storedParticipants[otherUserId]?.name ||
                      'Unknown',
                    avatarUrl:
                      otherProfile?.avatar_url ||
                      storedParticipants[otherUserId]?.avatarUrl ||
                      storedParticipants[otherUserId]?.avatar_url,
                  },
                }
              : {}),
          },
          lastMessage: t.last_message,
          lastMessageTimestamp: t.last_message_time,
          isArchived: Array.isArray(t.archived_by) && t.archived_by.includes(userId),
          historyClearedAt: readDmHistoryClearedAt(t.history_cleared_at, userId),
          status,
          requestedBy: typeof t.requested_by === 'string' ? t.requested_by : null,
        };
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Error in DM threads endpoint', { error: error.message, userId });
      res.status(500).json({ success: false, error: 'Failed to fetch DM threads' });
    }
  })
);

// POST /api/v1/messages/dm/:threadId/accept - Accept a pending message request
router.post(
  '/dm/:threadId/accept',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { threadId } = req.params;
    try {
      const data = await supabaseService.acceptDmMessageRequest(threadId, userId);
      res.json({ success: true, data });
    } catch (error: any) {
      const msg = error?.message || 'Failed to accept message request';
      const status =
        msg === 'Thread not found' ? 404 : msg === 'Access denied' ? 403 : 400;
      res.status(status).json({ success: false, error: msg });
    }
  })
);

// POST /api/v1/messages/dm/:threadId/decline - Decline a pending message request
router.post(
  '/dm/:threadId/decline',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { threadId } = req.params;
    try {
      const data = await supabaseService.declineDmMessageRequest(threadId, userId);
      res.json({ success: true, data });
    } catch (error: any) {
      const msg = error?.message || 'Failed to decline message request';
      const status =
        msg === 'Thread not found' ? 404 : msg === 'Access denied' ? 403 : 400;
      res.status(status).json({ success: false, error: msg });
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
      });
    }
  })
);

// GET /api/v1/messages/dm/:threadId/thread/:rootId - Nested reply thread in a DM
// IMPORTANT: This must be defined BEFORE /:messageId to avoid being caught by that route
router.get(
  '/dm/:threadId/thread/:rootId',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { threadId, rootId } = req.params;
    try {
      const messages = await supabaseService.getDmThread(threadId, rootId, userId);
      res.json({
        success: true,
        data: messages,
      });
    } catch (error: any) {
      if (error?.message === 'Access denied') {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
      throw error;
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

      const result = await supabaseService.markDMAsRead(threadId, userId);

      res.json({
        success: result.success,
        previousLastReadAt: result.previousLastReadAt,
        data: { previousLastReadAt: result.previousLastReadAt },
        message: result.success ? 'DM marked as read' : 'Failed to mark DM as read',
      });
    } catch (error) {
      console.error('Error marking DM as read:', error);
      res.status(500).json({
        success: false,
        previousLastReadAt: null,
        error: 'Failed to mark DM as read',
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
      res.status(500).json({ success: false, error: 'Failed to archive DM thread' });
    }
  })
);

// GET /api/v1/messages/dm/:threadId/mute - Current mute status for a DM
router.get(
  '/dm/:threadId/mute',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { threadId } = req.params;
    const status = await supabaseService.getChatMute(userId, 'dm', threadId);
    res.json({ success: true, data: status });
  })
);

// PUT /api/v1/messages/dm/:threadId/mute - Mute DM notifications for a duration
router.put(
  '/dm/:threadId/mute',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { threadId } = req.params;
    const minutes = resolveChatMuteDurationMinutes(req.body?.duration, req.body?.durationMinutes);
    if (!minutes) {
      return res.status(400).json({
        success: false,
        error: 'Provide duration (1h|8h|24h|7d) or durationMinutes (1-43200)',
      });
    }
    const result = await supabaseService.setChatMute(
      userId,
      'dm',
      threadId,
      mutedUntilFromMinutes(minutes)
    );
    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'DM thread not found or you are not a participant',
      });
    }
    res.json({ success: true, data: result, message: 'DM notifications muted' });
  })
);

// DELETE /api/v1/messages/dm/:threadId/mute - Unmute DM notifications
router.delete(
  '/dm/:threadId/mute',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { threadId } = req.params;
    const success = await supabaseService.clearChatMute(userId, 'dm', threadId);
    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'DM thread not found or you are not a participant',
      });
    }
    res.json({ success: true, data: { muted: false, mutedUntil: null }, message: 'DM notifications unmuted' });
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
      res.status(500).json({ success: false, error: 'Failed to unarchive DM thread' });
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
      });
    }
  })
);

// PUT /api/v1/messages/dm-message/:messageId - Edit an owned DM message
router.put(
  '/dm-message/:messageId',
  authMiddleware,
  validateMessageId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;
    const { content } = req.body || {};
    if (typeof content !== 'string' || !content.trim() || content.length > 50000) {
      return res.status(400).json({
        success: false,
        error: 'Message content must be 1-50000 characters',
      });
    }

    const result = await supabaseService.editChatMessage('dm', messageId, userId, content);
    return sendChatMutationResult(res, result, 'edited');
  })
);

// DELETE /api/v1/messages/dm-message/:messageId - Soft-remove an owned DM message
router.delete(
  '/dm-message/:messageId',
  authMiddleware,
  validateMessageId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const result = await supabaseService.removeChatMessage(
      'dm',
      req.params.messageId,
      userId
    );
    return sendChatMutationResult(res, result, 'removed');
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

// PUT /api/v1/messages/:messageId - Edit an owned group text message
router.put(
  '/:messageId',
  authMiddleware,
  validateMessageId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;
    const { content } = req.body || {};
    if (typeof content !== 'string' || !content.trim() || content.length > 50000) {
      return res.status(400).json({
        success: false,
        error: 'Message content must be 1-50000 characters',
      });
    }

    const result = await supabaseService.editChatMessage('group', messageId, userId, content);
    return sendChatMutationResult(res, result, 'edited');
  })
);

// DELETE /api/v1/messages/:messageId - Soft-remove an owned group text/voice message
router.delete(
  '/:messageId',
  authMiddleware,
  validateMessageId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const result = await supabaseService.removeChatMessage(
      'group',
      req.params.messageId,
      userId
    );
    return sendChatMutationResult(res, result, 'removed');
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
      // Receipts are viewer-specific; do not serve a shared cache of enriched DMs.
      const messages = await supabaseService.getDirectMessages(
        authUserId,
        otherUserId as string,
        {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
        }
      );

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
    const { content, recipientId, clientMessageId, replyToMessageId } = req.body;

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
      const message = await supabaseService.sendDirectMessage(senderId, recipientId, content, {
        clientMessageId,
        replyToMessageId: typeof replyToMessageId === 'string' ? replyToMessageId : undefined,
      });

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
        error.message?.includes('only accepts direct messages') ||
        error.message?.includes('message request was declined') ||
        error.message?.includes('You cannot message this user');
      logger.error('Error sending direct message:', { error: error.message, senderId, recipientId });
      res.status(blocked ? 403 : 500).json({
        success: false,
        error: blocked
          ? error.message?.includes('declined')
            ? 'This message request was declined'
            : error.message?.includes('cannot message')
              ? 'You cannot message this user'
              : 'This user does not accept direct messages from you'
          : clientErrorMessage(error, 'Failed to send direct message'),
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

    const authorized = await supabaseService.getAuthorizedGroupMessage(messageId, userId);
    if (!authorized) {
      return res.status(404).json({ success: false, error: 'Message not found' });
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

    const authorized = await supabaseService.getAuthorizedGroupMessage(messageId, userId);
    if (!authorized) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

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

    const authorized = await supabaseService.getAuthorizedGroupMessage(messageId, userId);
    if (!authorized) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    const isSender = authorized.sender_id === userId;
    const isAdmin = await supabaseService.isGroupAdmin(authorized.group_id, userId);
    if (!isSender && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Only the question author or a group admin can update question status',
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

    const authorized = await supabaseService.getAuthorizedGroupMessage(messageId, userId);
    if (!authorized) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    if (!Array.isArray(flagIds)) {
      return res.status(400).json({
        success: false,
        error: 'flagged_as_similar_user_ids must be an array',
      });
    }

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