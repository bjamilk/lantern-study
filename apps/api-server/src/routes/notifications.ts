import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validateCreateNotification, validatePagination } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { assertLivePlatformAdmin, isLivePlatformAdmin } from '../utils/platformAdminAuth';
import { enforceResourceOwner, userScopedCacheKey } from '../utils/resourceAccess';
import type { DataLayer } from '../services/data';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { Notification } from '../types/index';

const router = Router();

// Initialize services (will be injected in main server)
let dataLayer: DataLayer;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeNotificationRoutes = (layer: DataLayer, cache: CacheService) => {
  dataLayer = layer;
  cacheService = cache;
};

async function invalidateNotificationCaches(userId: string, notificationId?: string) {
  if (notificationId) {
    await cacheService.delete(userScopedCacheKey('notification', userId, notificationId));
    // Legacy key cleanup
    await cacheService.delete(`notification:${notificationId}`);
  }
  await cacheService.deletePattern(`notifications:${userId}:*`);
  await cacheService.delete(`notifications:stats:${userId}`);
}

// GET /api/v1/notifications - Get user's notifications
router.get(
  '/',
  authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { page = 1, limit = 20, unreadOnly = false } = req.query;

    logger.debug('Fetching notifications', { page, limit, unreadOnly, userId });

    const cacheKey = `notifications:${userId}:${page}:${limit}:${unreadOnly}`;
    let notifications = await cacheService.get(cacheKey) as Notification[];

    if (!notifications) {
      notifications = await dataLayer.notifications.getUserNotifications(userId, {
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
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    logger.debug('Fetching notification stats', { userId });

    const cacheKey = `notifications:stats:${userId}`;
    let stats = await cacheService.get(cacheKey);

    if (!stats) {
      stats = await dataLayer.notifications.getNotificationStats(userId);

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
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { notificationId } = req.params;

    logger.debug('Fetching notification', { notificationId, userId });

    const cacheKey = userScopedCacheKey('notification', userId, notificationId);
    let notification = await cacheService.get(cacheKey);

    if (!notification) {
      notification = await dataLayer.notifications.getNotificationById(notificationId, userId);

      if (!notification) {
        return res.status(404).json({
          success: false,
          error: 'Notification not found or access denied',
        });
      }

      // Cache for 5 minutes
      await cacheService.set(cacheKey, notification, 300);
    } else if (!enforceResourceOwner(res, notification as Record<string, unknown>, userId)) {
      return;
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
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { userId: targetUserId, message, link, type = 'info' } = req.body;

    logger.debug('Creating notification', { targetUserId, message, link, type, requestingUserId });

    let finalUserId = requestingUserId;
    if (targetUserId && targetUserId !== requestingUserId) {
      if (await isLivePlatformAdmin(requestingUserId)) {
        finalUserId = targetUserId;
      } else if (await dataLayer.groups.canNotifyUser(requestingUserId, targetUserId, link)) {
        finalUserId = targetUserId;
      } else {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }
    }

    const notification = await dataLayer.notifications.createNotification(finalUserId, {
      message,
      link,
      type,
    });

    // Invalidate user's notification cache
    await invalidateNotificationCaches(finalUserId);

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
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { notificationId } = req.params;

    logger.debug('Marking notification as read', { notificationId, userId });

    const notification = await dataLayer.notifications.getNotificationById(notificationId, userId);
    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found or access denied',
      });
    }

    // Check if notification belongs to user
    if (notification.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const updatedNotification = await dataLayer.notifications.markNotificationAsRead(notificationId);

    // Invalidate caches
    await invalidateNotificationCaches(userId, notificationId);

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
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    logger.debug('Marking all notifications as read', { userId });

    const updatedCount = await dataLayer.notifications.markAllNotificationsAsRead(userId);

    // Invalidate user's notification cache
    await invalidateNotificationCaches(userId);

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
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { notificationId } = req.params;

    logger.debug('Deleting notification', { notificationId, userId });

    const notification = await dataLayer.notifications.getNotificationById(notificationId, userId);
    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found or access denied',
      });
    }

    // Check if notification belongs to user
    if (notification.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const deleted = await dataLayer.notifications.deleteNotification(notificationId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found',
      });
    }

    // Invalidate caches
    await invalidateNotificationCaches(userId, notificationId);

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
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    logger.debug('Deleting all notifications', { userId });

    const deletedCount = await dataLayer.notifications.deleteAllNotifications(userId);

    // Invalidate caches
    await invalidateNotificationCaches(userId);

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
  asyncHandler(async (req: any, res: any) => {
    const requestingUserId = requireAuthUserId(req, res);
    if (!requestingUserId) return;

    const { notifications } = req.body;

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

    if (!(await assertLivePlatformAdmin(req, res))) return;

    const createdNotifications = await dataLayer.notifications.createBulkNotifications(notifications);

    // Invalidate notification caches for affected users
    const affectedUserIds = [...new Set(notifications.map(n => n.userId))];
    for (const affectedUserId of affectedUserIds) {
      await invalidateNotificationCaches(affectedUserId);
    }

    res.status(201).json({
      success: true,
      data: createdNotifications,
      message: `${createdNotifications.length} notifications created`,
    });
  })
);

export default router;
