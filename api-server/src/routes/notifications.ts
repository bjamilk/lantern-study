import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validateCreateNotification, validatePagination } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { Notification } from '../types/index';

const router = Router();

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeNotificationRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// GET /api/v1/notifications - Get user's notifications
router.get(
  '/',
  authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const authUserId = req.user.id;

    logger.debug('Fetching notifications', { page, limit, unreadOnly, userId: authUserId });

    const cacheKey = `notifications:${authUserId}:${page}:${limit}:${unreadOnly}`;
    let notifications = await cacheService.get(cacheKey) as Notification[];

    if (!notifications) {
      notifications = await supabaseService.getUserNotifications(authUserId, {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        unreadOnly: unreadOnly === 'true',
      });

      // Cache for 2 minutes (notifications change frequently)
      await cacheService.set(cacheKey, notifications, 120);
    }

    res.json({
      success: true,
      data: notifications,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: notifications.length,
      },
    });
  })
);

// GET /api/v1/notifications/stats - Get notification statistics
// NOTE: This MUST be before /:notificationId to avoid route matching issues
router.get(
  '/stats',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const authUserId = req.user.id;

    logger.debug('Fetching notification stats', { userId: authUserId });

    const cacheKey = `notifications:stats:${authUserId}`;
    let stats = await cacheService.get(cacheKey);

    if (!stats) {
      stats = await supabaseService.getNotificationStats(authUserId);

      // Cache for 1 minute (stats change frequently)
      await cacheService.set(cacheKey, stats, 60);
    }

    res.json({
      success: true,
      data: stats,
    });
  })
);

// GET /api/v1/notifications/:notificationId - Get notification by ID
router.get(
  '/:notificationId',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { notificationId } = req.params;
    const authUserId = req.user.id;

    logger.debug('Fetching notification', { notificationId, userId: authUserId });

    const cacheKey = `notification:${notificationId}`;
    let notification = await cacheService.get(cacheKey) as any;

    if (!notification) {
      notification = await supabaseService.getNotificationById(notificationId, authUserId);

      if (!notification) {
        return res.status(404).json({
          success: false,
          error: 'Notification not found or access denied',
        });
      }

      // Cache for 5 minutes
      await cacheService.set(cacheKey, notification, 300);
    }

    // Access check: must belong to the logged-in user
    if (notification.user_id !== authUserId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this notification',
      });
    }

    res.json({
      success: true,
      data: notification,
    });
  })
);

// POST /api/v1/notifications - Create notification
router.post(
  '/',
  authMiddleware,
  validateCreateNotification,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { userId, message, link, type = 'info' } = req.body;
    const authUserId = req.user.id;

    logger.debug('Creating notification', { userId, message, link, type, authUserId });

    // Allow user to create notifications for themselves. For others, must be admin.
    const targetUserId = userId || authUserId;
    if (targetUserId !== authUserId && !req.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: cannot create notifications for other users',
      });
    }

    const notification = await supabaseService.createNotification(targetUserId, {
      message,
      link,
      type,
    });

    // Invalidate user's notification cache
    await cacheService.deletePattern(`notifications:${targetUserId}:*`);

    res.status(201).json({
      success: true,
      data: notification,
    });
  })
);

// PUT /api/v1/notifications/:notificationId/read - Mark notification as read
router.put(
  '/:notificationId/read',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { notificationId } = req.params;
    const authUserId = req.user.id;

    logger.debug('Marking notification as read', { notificationId, userId: authUserId });

    const notification = await supabaseService.getNotificationById(notificationId, authUserId);
    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found or access denied',
      });
    }

    // Check if notification belongs to user
    if (notification.user_id !== authUserId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const updatedNotification = await supabaseService.markNotificationAsRead(notificationId);

    // Invalidate caches
    await cacheService.delete(`notification:${notificationId}`);
    await cacheService.deletePattern(`notifications:${authUserId}:*`);

    res.json({
      success: true,
      data: updatedNotification,
    });
  })
);

// PUT /api/v1/notifications/read-all - Mark all notifications as read
router.put(
  '/read-all',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const authUserId = req.user.id;

    logger.debug('Marking all notifications as read', { userId: authUserId });

    const updatedCount = await supabaseService.markAllNotificationsAsRead(authUserId);

    // Invalidate user's notification cache
    await cacheService.deletePattern(`notifications:${authUserId}:*`);

    res.json({
      success: true,
      message: `${updatedCount} notifications marked as read`,
      data: { updatedCount },
    });
  })
);

// DELETE /api/v1/notifications/:notificationId - Delete notification
router.delete(
  '/:notificationId',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { notificationId } = req.params;
    const authUserId = req.user.id;

    logger.debug('Deleting notification', { notificationId, userId: authUserId });

    const notification = await supabaseService.getNotificationById(notificationId, authUserId);
    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found or access denied',
      });
    }

    // Check if notification belongs to user
    if (notification.user_id !== authUserId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const deleted = await supabaseService.deleteNotification(notificationId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found',
      });
    }

    // Invalidate caches
    await cacheService.delete(`notification:${notificationId}`);
    await cacheService.deletePattern(`notifications:${authUserId}:*`);

    res.json({
      success: true,
      message: 'Notification deleted successfully',
    });
  })
);

// DELETE /api/v1/notifications - Delete all notifications for a user
router.delete(
  '/',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const authUserId = req.user.id;

    logger.debug('Deleting all notifications', { userId: authUserId });

    const deletedCount = await supabaseService.deleteAllNotifications(authUserId);

    // Invalidate caches
    await cacheService.deletePattern(`notifications:${authUserId}:*`);

    res.json({
      success: true,
      message: `${deletedCount} notifications deleted`,
      data: { deletedCount },
    });
  })
);

// POST /api/v1/notifications/bulk - Create bulk notifications
router.post(
  '/bulk',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { notifications } = req.body;
    const requestingUserId = req.user.id;

    logger.debug('Creating bulk notifications', { count: notifications?.length, requestingUserId });

    if (!notifications || !Array.isArray(notifications) || notifications.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Notifications array is required',
      });
    }

    if (notifications.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 100 notifications allowed in bulk operation',
      });
    }

    // Check permissions (only admins can create bulk notifications)
    if (!req.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const createdNotifications = await supabaseService.createBulkNotifications(notifications);

    // Invalidate notification caches for affected users
    const affectedUserIds = [...new Set(notifications.map(n => n.userId))];
    for (const userId of affectedUserIds) {
      await cacheService.deletePattern(`notifications:${userId}:*`);
    }

    res.status(201).json({
      success: true,
      data: createdNotifications,
      message: `${createdNotifications.length} notifications created`,
    });
  })
);

export default router;
export { router };