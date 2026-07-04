import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validateTestConfig, validatePagination, validateUserId } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { requireAuthUserId } from '../utils/requestAuth';
import { requireTestOwner } from '../middleware/authorizeResource';
import { enforceResourceOwner, userScopedCacheKey } from '../utils/resourceAccess';
import { getWalletService } from '../services/walletService';
import { WALLET_COINS, WALLET_TEST_PASS_THRESHOLD, testAwardKey } from '@lantern/shared/utils/walletCoins';

async function awardTestPassCoins(userId: string, testId: string, score: number) {
  if (score < WALLET_TEST_PASS_THRESHOLD) {
    const walletBalance = await getWalletService().getWalletBalance(userId);
    return { walletBalance, awarded: 0 };
  }
  const award = await getWalletService().awardWalletOnce(
    userId,
    testAwardKey(testId),
    WALLET_COINS.TEST_PASS,
    'test_pass'
  );
  if (award.awarded > 0) {
    await cacheService.delete(`user:preferences:${userId}`);
  }
  return { walletBalance: award.walletBalance, awarded: award.awarded };
}

console.log('Loading tests.ts');

const router = Router();

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeTestRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;

  // GET /api/v1/tests - Get user's tests
  router.get(
    '/',
    authMiddleware,
    validatePagination,
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { page = 1, limit = 20, status, subject } = req.query;

      logger.debug('Fetching tests', { page, limit, status, subject, userId });

      try {
        const cacheKey = `tests:${userId}:${page}:${limit}:${status || ''}:${subject || ''}`;
        let tests = await cacheService.get(cacheKey) as any[];

        if (!tests) {
          if (supabaseService) {
            logger.debug('Calling supabaseService.getUserTests', { userId, page, limit, status, subject });
            tests = await supabaseService.getUserTests(userId, {
              page: parseInt(page as string),
              limit: parseInt(limit as string),
              status: status as string,
              subject: subject as string,
            });
            logger.debug('getUserTests returned', { testsCount: tests?.length });
          } else {
            logger.debug('No supabaseService', { supabaseService: !!supabaseService });
            tests = [];
          }

          // Cache for 5 minutes
          await cacheService.set(cacheKey, tests, 300);
        }

        res.json({
          success: true,
          data: tests,
          pagination: {
            page: parseInt(page as string),
            limit: parseInt(limit as string),
            total: tests.length,
          },
        });
      } catch (error) {
        logger.error('Error in tests route:', error);
        throw error;
      }
    })
  );

  // DELETE /api/v1/tests/history - Clear all completed test sessions for user
  router.delete(
    '/history',
    authMiddleware,
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      logger.debug('Clearing completed test history', { userId });

      const deletedCount = await supabaseService.clearCompletedTestHistory(userId);

      res.json({
        success: true,
        deletedCount,
        message: 'Test history cleared',
      });
    })
  );

  // DELETE /api/v1/tests/sessions/:sessionId - Delete one completed test session
  router.delete(
    '/sessions/:sessionId',
    authMiddleware,
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { sessionId } = req.params;

      logger.debug('Deleting completed test session', { sessionId, userId });

      try {
        const deleted = await supabaseService.deleteCompletedTestSession(sessionId, userId);
        if (!deleted) {
          return res.status(404).json({
            success: false,
            error: 'Test session not found or access denied',
          });
        }

        await cacheService.deletePattern(`tests:${userId}:*`);
        await cacheService.delete(`user:stats:${userId}`);

        res.json({
          success: true,
          deleted: true,
          message: 'Test session deleted',
        });
      } catch (error: any) {
        if (error?.message?.includes('in-progress')) {
          return res.status(400).json({
            success: false,
            error: 'Cannot delete an in-progress test session',
          });
        }
        throw error;
      }
    })
  );

  // GET /api/v1/tests/:testId - Get test by ID
  router.get(
    '/:testId',
    authMiddleware,
    requireTestOwner(),
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { testId } = req.params;

      logger.debug('Fetching test', { testId, userId });

      const cacheKey = userScopedCacheKey('test', userId, testId);
      let test = await cacheService.get(cacheKey);

      if (!test) {
        test = await supabaseService.getTestById(testId, userId);

        if (!test) {
          return res.status(404).json({
            success: false,
            error: 'Test not found or access denied',
          });
        }

        // Cache for 10 minutes
        await cacheService.set(cacheKey, test, 600);
      } else if (!enforceResourceOwner(res, test as Record<string, unknown>, userId)) {
        return;
      }

      res.json({
        success: true,
        data: test,
      });
    })
  );

  // POST /api/v1/tests - Create new test
  router.post(
    '/',
    authMiddleware,
    validateTestConfig,
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const testConfig = req.body;

      logger.debug('Creating test', { testConfig, userId });

      const test = await supabaseService.createTest(testConfig, userId);

      // Invalidate user's tests cache
      await cacheService.deletePattern(`tests:${userId}:*`);

      res.status(201).json({
        success: true,
        data: test,
      });
    })
  );

  // PUT /api/v1/tests/:testId/start - Start test
  router.put(
    '/:testId/start',
    authMiddleware,
    requireTestOwner(),
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { testId } = req.params;

      logger.debug('Starting test', { testId, userId });

      const test = await supabaseService.getTestById(testId, userId);
      if (!test) {
        return res.status(404).json({
          success: false,
          error: 'Test not found or access denied',
        });
      }

      // Check if test has already been started (has questions)
      if (test.questions && test.questions.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Test has already been started',
        });
      }

      const startedTest = await supabaseService.startTest(testId, userId);

      // Invalidate caches
      await cacheService.delete(userScopedCacheKey('test', userId, testId));
      await cacheService.deletePattern(`tests:${userId}:*`);

      res.json({
        success: true,
        data: startedTest,
      });
    })
  );

  // PUT /api/v1/tests/:testId/submit - Submit test answers
  router.put(
    '/:testId/submit',
    authMiddleware,
    requireTestOwner(),
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { testId } = req.params;
      const { answers } = req.body;

      logger.debug('Submitting test', { testId, answersCount: answers?.length, userId });

      if (!answers || !Array.isArray(answers)) {
        return res.status(400).json({
          success: false,
          error: 'Answers array is required',
        });
      }

      const test = await supabaseService.getTestById(testId, userId);
      if (!test) {
        return res.status(404).json({
          success: false,
          error: 'Test not found or access denied',
        });
      }

      // Check if test has already been completed
      if (test.end_time) {
        return res.status(400).json({
          success: false,
          error: 'Test has already been completed',
        });
      }

      const result = await supabaseService.submitTest(testId, userId, answers);

      // Invalidate caches
      await cacheService.delete(userScopedCacheKey('test', userId, testId));
      await cacheService.deletePattern(`tests:${userId}:*`);
      await cacheService.delete(`user:stats:${userId}`);

      const wallet = await awardTestPassCoins(userId, testId, Number(result.score) || 0);

      res.json({
        success: true,
        data: { ...result, walletBalance: wallet.walletBalance, awarded: wallet.awarded },
      });
    })
  );

  // GET /api/v1/tests/:testId/results - Get test results
  router.get(
    '/:testId/results',
    authMiddleware,
    requireTestOwner(),
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { testId } = req.params;

      logger.debug('Fetching test results', { testId, userId });

      const test = await supabaseService.getTestById(testId, userId);
      if (!test) {
        return res.status(404).json({
          success: false,
          error: 'Test not found or access denied',
        });
      }

      // Check if test has been completed
      if (!test.end_time) {
        return res.status(400).json({
          success: false,
          error: 'Test is not completed yet',
        });
      }

      const cacheKey = userScopedCacheKey('test:results', userId, testId);
      let results = await cacheService.get(cacheKey);

      if (!results) {
        results = await supabaseService.getTestResults(testId, userId);

        // Cache for 30 minutes (results don't change)
        await cacheService.set(cacheKey, results, 1800);
      }

      res.json({
        success: true,
        data: results,
      });
    })
  );

  // POST /api/v1/tests/:testId/results - Create test result
  router.post(
    '/:testId/results',
    authMiddleware,
    requireTestOwner(),
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { testId } = req.params;
      const { score, correctAnswersCount, totalQuestions, activityDate } = req.body;

      logger.debug('Creating test result', { testId, score, correctAnswersCount, totalQuestions, userId });

      const result = await supabaseService.createTestResult(testId, {
        score,
        correctAnswersCount,
        totalQuestions,
        activityDate: typeof activityDate === 'string' ? activityDate : undefined,
      }, userId);

      // Invalidate caches
      await cacheService.delete(userScopedCacheKey('test:results', userId, testId));
      await cacheService.deletePattern(`tests:${userId}:*`);

      const finalScore = Number(result?.score ?? score) || 0;
      const wallet = await awardTestPassCoins(userId, testId, finalScore);

      res.status(201).json({
        success: true,
        data: { ...result, walletBalance: wallet.walletBalance, awarded: wallet.awarded },
      });
    })
  );

  // GET /api/v1/tests/:testId/questions - Get test questions
  router.get(
    '/:testId/questions',
    authMiddleware,
    requireTestOwner(),
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { testId } = req.params;

      logger.debug('Fetching test questions', { testId, userId });

      const test = await supabaseService.getTestById(testId, userId);
      if (!test) {
        return res.status(404).json({
          success: false,
          error: 'Test not found or access denied',
        });
      }

      // Check if test has been started (has questions)
      if (!test.questions || test.questions.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Test has not been started yet',
        });
      }

      const cacheKey = userScopedCacheKey('test:questions', userId, testId);
      let questions = await cacheService.get(cacheKey);

      if (!questions) {
        questions = await supabaseService.getTestQuestions(testId, userId);

        // Cache for 30 minutes
        await cacheService.set(cacheKey, questions, 1800);
      }

      res.json({
        success: true,
        data: questions,
      });
    })
  );

  // DELETE /api/v1/tests/:testId - Delete test
  router.delete(
    '/:testId',
    authMiddleware,
    requireTestOwner(),
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { testId } = req.params;

      logger.debug('Deleting test', { testId, userId });

      const test = await supabaseService.getTestById(testId, userId);
      if (!test) {
        return res.status(404).json({
          success: false,
          error: 'Test not found or access denied',
        });
      }

      // Only allow deletion of tests that haven't been started (no questions)
      if (test.questions && test.questions.length > 0) {
        return res.status(403).json({
          success: false,
          error: 'Cannot delete a test that has been started',
        });
      }

      const deleted = await supabaseService.deleteTest(testId);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Test not found',
        });
      }

      // Invalidate caches
      await cacheService.delete(userScopedCacheKey('test', userId, testId));
      await cacheService.delete(userScopedCacheKey('test:results', userId, testId));
      await cacheService.delete(userScopedCacheKey('test:questions', userId, testId));
      await cacheService.deletePattern(`tests:${userId}:*`);

      res.json({
        success: true,
        message: 'Test deleted successfully',
      });
    })
  );

  // GET /api/v1/tests/stats/subject - Get subject-wise statistics
  router.get(
    '/stats/subject',
    authMiddleware,
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      logger.debug('Fetching subject stats', { userId });

      const cacheKey = `tests:stats:subject:${userId}`;
      let stats = await cacheService.get(cacheKey);

      if (!stats) {
        stats = await supabaseService.getSubjectStats(userId);

        // Cache for 10 minutes
        await cacheService.set(cacheKey, stats, 600);
      }

      res.json({
        success: true,
        data: stats,
      });
    })
  );

  // GET /api/v1/tests/stats/performance - Get performance statistics
  router.get(
    '/stats/performance',
    authMiddleware,
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { period = 'month' } = req.query;

      logger.debug('Fetching performance stats', { period, userId });

      const cacheKey = `tests:stats:performance:${userId}:${period}`;
      let stats = await cacheService.get(cacheKey);

      if (!stats) {
        stats = await supabaseService.getPerformanceStats(userId, period as string);

        // Cache for 5 minutes
        await cacheService.set(cacheKey, stats, 300);
      }

      res.json({
        success: true,
        data: stats,
      });
    })
  );

  // GET /api/v1/tests/templates - Get test templates
  router.get(
    '/templates',
    authMiddleware,
    validatePagination,
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { page = 1, limit = 20, subject, difficulty } = req.query;

      logger.debug('Fetching test templates', { page, limit, subject, difficulty, userId });

      const cacheKey = `tests:templates:${page}:${limit}:${subject || ''}:${difficulty || ''}`;
      let templates = await cacheService.get(cacheKey) as any[];

      if (!templates) {
        templates = await supabaseService.getTestTemplates({
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          subject: subject as string,
          difficulty: difficulty as string,
        });

        // Cache for 30 minutes (templates don't change often)
        await cacheService.set(cacheKey, templates, 1800);
      }

      res.json({
        success: true,
        data: templates,
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total: templates.length,
        },
      });
    })
  );
};

export default router;