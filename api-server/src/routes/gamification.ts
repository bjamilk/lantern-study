import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validateUserId, validatePagination } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';

const router = Router();

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeGamificationRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// GET /api/v1/gamification/leaderboard - Get leaderboard
router.get(
  '/leaderboard',
  authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { page = 1, limit = 50, timeframe = 'all', metric = 'points' } = req.query;

    logger.debug('Fetching leaderboard', { page, limit, timeframe, metric });

    const cacheKey = `gamification:leaderboard:${page}:${limit}:${timeframe}:${metric}`;
    let leaderboard = await cacheService.get(cacheKey) as any[];

    if (!leaderboard) {
      leaderboard = await supabaseService.getLeaderboard({
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        timeframe: timeframe as string,
        metric: metric as string,
      });

      // Cache for 5 minutes
      await cacheService.set(cacheKey, leaderboard, 300);
    }

    res.json({
      success: true,
      data: leaderboard,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: leaderboard.length,
      },
    });
  })
);

// GET /api/v1/gamification/achievements - Get available achievements
router.get(
  '/achievements',
  authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { page = 1, limit = 20, category } = req.query;

    logger.debug('Fetching achievements', { page, limit, category });

    const cacheKey = `gamification:achievements:${page}:${limit}:${category || ''}`;
    let achievements = await cacheService.get(cacheKey) as any[];

    if (!achievements) {
      achievements = await supabaseService.getAchievements({
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        category: category as string,
      });

      // Cache for 30 minutes (achievements don't change often)
      await cacheService.set(cacheKey, achievements, 1800);
    }

    res.json({
      success: true,
      data: achievements,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: achievements.length,
      },
    });
  })
);

// GET /api/v1/gamification/user/:userId/achievements - Get user's achievements
router.get(
  '/user/:userId/achievements',
  authMiddleware,
  validateUserId,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { userId } = req.params;
    const { page = 1, limit = 20, providedUserId } = req.query;
    const requestingUserId = req.user?.id;

    logger.debug('Fetching user achievements', { userId: userId || providedUserId, page, limit, requestingUserId });

    const finalUserId = providedUserId as string || userId;

    // Check permissions (users can view their own achievements, admins can view anyone's)
    if (requestingUserId && requestingUserId !== finalUserId && !req.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const cacheKey = `gamification:user:achievements:${finalUserId}:${page}:${limit}`;
    let achievements = await cacheService.get(cacheKey) as any[];

    if (!achievements) {
      achievements = await supabaseService.getUserAchievements(finalUserId, {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
      });

      // Cache for 10 minutes
      await cacheService.set(cacheKey, achievements, 600);
    }

    res.json({
      success: true,
      data: achievements,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: achievements.length,
      },
    });
  })
);

// POST /api/v1/gamification/user/:userId/points - Award points to user
router.post(
  '/user/:userId/points',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { userId } = req.params;
    const { points, reason, source } = req.body;
    const requestingUserId = req.user?.id;

    logger.debug('Awarding points', { userId, points, reason, source, requestingUserId });

    if (!points || typeof points !== 'number' || points <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid points amount is required',
      });
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Reason is required',
      });
    }

    // Check permissions (only admins can award points)
    if (!req.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const result = await supabaseService.awardPoints(userId, points, reason, source);

    // Invalidate caches
    await cacheService.deletePattern(`gamification:leaderboard:*`);
    await cacheService.delete(`user:stats:${userId}`);
    await cacheService.deletePattern(`gamification:user:achievements:${userId}:*`);

    res.status(201).json({
      success: true,
      data: result,
    });
  })
);

// POST /api/v1/gamification/user/:userId/achievement - Award achievement to user
router.post(
  '/user/:userId/achievement',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { userId } = req.params;
    const { achievementId } = req.body;
    const requestingUserId = req.user?.id;

    logger.debug('Awarding achievement', { userId, achievementId, requestingUserId });

    if (!achievementId) {
      return res.status(400).json({
        success: false,
        error: 'Achievement ID is required',
      });
    }

    // Check permissions (only admins can award achievements)
    if (!req.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const result = await supabaseService.awardAchievement(userId, achievementId);

    // Invalidate caches
    await cacheService.deletePattern(`gamification:user:achievements:${userId}:*`);

    res.status(201).json({
      success: true,
      data: result,
    });
  })
);

// GET /api/v1/gamification/user/:userId/progress - Get user's gamification progress
router.get(
  '/user/:userId/progress',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { userId } = req.params;
    const requestingUserId = req.user?.id;

    logger.debug('Fetching user progress', { userId, requestingUserId });

    // Check permissions (users can view their own progress, admins can view anyone's)
    if (requestingUserId !== userId && !req.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const cacheKey = `gamification:user:progress:${userId}`;
    let progress = await cacheService.get(cacheKey);

    if (!progress) {
      progress = await supabaseService.getUserProgress(userId);

      // Cache for 5 minutes
      await cacheService.set(cacheKey, progress, 300);
    }

    res.json({
      success: true,
      data: progress,
    });
  })
);

// GET /api/v1/gamification/stats - Get gamification statistics
router.get(
  '/stats',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    logger.debug('Fetching gamification stats');

    const cacheKey = 'gamification:stats';
    let stats = await cacheService.get(cacheKey);

    if (!stats) {
      stats = await supabaseService.getGamificationStats();

      // Cache for 10 minutes
      await cacheService.set(cacheKey, stats, 600);
    }

    res.json({
      success: true,
      data: stats,
    });
  })
);

// GET /api/v1/gamification/badges - Get available badges
router.get(
  '/badges',
  authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { page = 1, limit = 20, category } = req.query;

    logger.debug('Fetching badges', { page, limit, category });

    const cacheKey = `gamification:badges:${page}:${limit}:${category || ''}`;
    let badges = await cacheService.get(cacheKey) as any[];

    if (!badges) {
      badges = await supabaseService.getBadges({
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        category: category as string,
      });

      // Cache for 30 minutes
      await cacheService.set(cacheKey, badges, 1800);
    }

    res.json({
      success: true,
      data: badges,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: badges.length,
      },
    });
  })
);

// GET /api/v1/gamification/user/:userId/badges - Get user's badges
router.get(
  '/user/:userId/badges',
  authMiddleware,
  validateUserId,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const requestingUserId = req.user?.id;

    logger.debug('Fetching user badges', { userId, page, limit, requestingUserId });

    // Check permissions (users can view their own badges, admins can view anyone's)
    if (requestingUserId !== userId && !req.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const cacheKey = `gamification:user:badges:${userId}:${page}:${limit}`;
    let badges = await cacheService.get(cacheKey) as any[];

    if (!badges) {
      badges = await supabaseService.getUserBadges(userId, {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
      });

      // Cache for 10 minutes
      await cacheService.set(cacheKey, badges, 600);
    }

    res.json({
      success: true,
      data: badges,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: badges.length,
      },
    });
  })
);

// POST /api/v1/gamification/user/:userId/badge - Award badge to user
router.post(
  '/user/:userId/badge',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { userId } = req.params;
    const { badgeId } = req.body;
    const requestingUserId = req.user?.id;

    logger.debug('Awarding badge', { userId, badgeId, requestingUserId });

    if (!badgeId) {
      return res.status(400).json({
        success: false,
        error: 'Badge ID is required',
      });
    }

    // Check permissions (only admins can award badges)
    if (!req.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const result = await supabaseService.awardBadge(userId, badgeId);

    // Invalidate caches
    await cacheService.deletePattern(`gamification:user:badges:${userId}:*`);

    res.status(201).json({
      success: true,
      data: result,
    });
  })
);

// GET /api/v1/gamification/levels - Get level system
router.get(
  '/levels',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    logger.debug('Fetching levels');

    const cacheKey = 'gamification:levels';
    let levels = await cacheService.get(cacheKey);

    if (!levels) {
      levels = await supabaseService.getLevels();

      // Cache for 60 minutes (levels don't change often)
      await cacheService.set(cacheKey, levels, 3600);
    }

    res.json({
      success: true,
      data: levels,
    });
  })
);

// GET /api/v1/gamification/user/:userId/level - Get user's current level
router.get(
  '/user/:userId/level',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { userId } = req.params;
    const requestingUserId = req.user?.id;

    logger.debug('Fetching user level', { userId, requestingUserId });

    // Check permissions (users can view their own level, admins can view anyone's)
    if (requestingUserId !== userId && !req.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const cacheKey = `gamification:user:level:${userId}`;
    let level = await cacheService.get(cacheKey);

    if (!level) {
      level = await supabaseService.getUserLevel(userId);

      // Cache for 5 minutes
      await cacheService.set(cacheKey, level, 300);
    }

    res.json({
      success: true,
      data: level,
    });
  })
);

export default router;