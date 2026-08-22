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
import { surfaceFromRequest } from '../services/learningEvents';
import { COURSE_FILTER_INVALID_MESSAGE, courseFilterKey, parseCourseFilter } from '../services/academicCourses';

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

      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const limit = Math.min(1000, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      // `courseId` (test_sessions.course_id) replaces the retired `subject`
      // filter, which keyed on config->>subject — a path no client ever wrote.
      // uuid, the literal "null" (unfiled) or absent; anything else is a 400.
      const courseFilter = parseCourseFilter(req.query.courseId);
      if (courseFilter.kind === 'invalid') {
        return res.status(400).json({ success: false, error: COURSE_FILTER_INVALID_MESSAGE });
      }
      const courseId = courseFilterKey(courseFilter) || undefined;
      const lean =
        req.query.lean === '1' ||
        req.query.lean === 'true' ||
        req.query.lean === true;
      const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
      const sort =
        sortRaw === 'oldest' || sortRaw === 'highestScore' ? sortRaw : 'newest';
      const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : undefined;

      logger.debug('Fetching tests', { page, limit, status, courseId, lean, sort, from, to, userId });

      try {
        if (!supabaseService) {
          res.json({
            success: true,
            data: [],
            pagination: { page, limit, total: 0, hasMore: false },
          });
          return;
        }

        const { tests, total } = await supabaseService.getUserTests(userId, {
          page,
          limit,
          status,
          courseFilter,
          lean,
          sort,
          from,
          to,
        });

        logger.debug('getUserTests returned', { testsCount: tests?.length, total });

        res.json({
          success: true,
          data: tests,
          pagination: {
            page,
            limit,
            total,
            hasMore: page * limit < total,
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

  // GET /api/v1/tests/sessions/:sessionId - One session with full detail.
  // The results list is served lean (no questions/user_answers) so it stays
  // cheap, which left clients with no per-question data at all: the results
  // screen showed Correct 0 / Incorrect 0, Question Review was empty, and the
  // time-per-question chart had no bars. This is the on-demand detail fetch.
  router.get(
    '/sessions/:sessionId',
    authMiddleware,
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { sessionId } = req.params;

      const { data, error } = await supabaseService.getClient()
        .from('test_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return res.status(404).json({
          success: false,
          error: 'Test session not found or access denied',
        });
      }

      // Same camelCase + coerced userAnswers map as GET /tests/:id so mobile
      // hydrate matches web (legacy array user_answers become a questionId map).
      const mapped = supabaseService.mapTestSessionRowToClient(data);
      res.json({
        success: true,
        data: {
          ...mapped,
          score: data.score,
          // Keep snake_case aliases — older mobile builders still read them.
          user_answers: mapped.userAnswers,
          start_time: data.start_time,
          end_time: data.end_time,
        },
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
        await cacheService.delete(`user:${userId}:test-results`);
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

  // POST /api/v1/tests/drafts - Create an in-progress test/study draft
  router.post(
    '/drafts',
    authMiddleware,
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const body = req.body || {};
      const questions = Array.isArray(body.questions) ? body.questions : [];
      if (!body.config || questions.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'config and questions are required',
        });
      }
      // Course rides in both the column and config.courseId (the shape clients
      // already persist/restore). Top-level courseId wins over config.courseId.
      const rawCourseId = body.courseId ?? body.config?.courseId ?? null;
      if (
        rawCourseId != null &&
        rawCourseId !== '' &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(rawCourseId))
      ) {
        return res.status(400).json({ success: false, error: 'courseId must be a valid UUID' });
      }
      const courseId = typeof rawCourseId === 'string' && rawCourseId ? rawCourseId : null;
      const config = courseId ? { ...body.config, courseId } : body.config;

      const draft = await supabaseService.createTestDraft(
        {
          config,
          courseId,
          questions,
          user_answers: body.user_answers || body.userAnswers || {},
          start_time: body.start_time || body.startTime,
          session_kind: body.session_kind || body.sessionKind || 'test',
          title: body.title,
          current_question_index:
            body.current_question_index ?? body.currentQuestionIndex ?? 0,
          remaining_time_seconds:
            body.remaining_time_seconds ?? body.remainingTime ?? null,
          is_offline: body.is_offline || body.isOffline || false,
          client_id: body.client_id || body.clientId,
        },
        userId,
      );

      await cacheService.deletePattern(`tests:${userId}:*`);
      res.status(201).json({ success: true, data: draft });
    })
  );

  // PATCH /api/v1/tests/drafts/:id - Autosave / pause progress
  router.patch(
    '/drafts/:id',
    authMiddleware,
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;
      const draftId = String(req.params.id || '');
      const body = req.body || {};

      try {
        const configBody = body.config && typeof body.config === 'object' ? body.config : null;
        const updated = await supabaseService.updateTestDraft(draftId, userId, {
          user_answers: body.user_answers ?? body.userAnswers,
          current_question_index:
            body.current_question_index ?? body.currentQuestionIndex,
          remaining_time_seconds:
            body.remaining_time_seconds ?? body.remainingTime,
          status: body.status,
          title: body.title,
          config: configBody
            ? {
                ...(typeof configBody.groupId === 'string' || configBody.groupId === null
                  ? { groupId: configBody.groupId }
                  : {}),
                ...(typeof configBody.groupName === 'string' || configBody.groupName === null
                  ? { groupName: configBody.groupName }
                  : {}),
              }
            : undefined,
        });
        if (!updated) {
          return res.status(404).json({
            success: false,
            error: 'Draft not found or access denied',
          });
        }
        res.json({ success: true, data: updated });
      } catch (error: any) {
        if (String(error?.message || '').includes('finished')) {
          return res.status(400).json({ success: false, error: error.message });
        }
        throw error;
      }
    })
  );

  // POST /api/v1/tests/drafts/:id/complete
  router.post(
    '/drafts/:id/complete',
    authMiddleware,
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;
      const draftId = String(req.params.id || '');
      const body = req.body || {};

      try {
        const configBody = body.config && typeof body.config === 'object' ? body.config : null;
        const completed = await supabaseService.completeTestDraft(draftId, userId, {
          user_answers: body.user_answers ?? body.userAnswers,
          activityDate: body.activityDate,
          score: body.score,
          correctAnswersCount: body.correct_answers_count ?? body.correctAnswersCount,
          totalQuestions: body.total_questions ?? body.totalQuestions,
          // Allow clients to correct study-group attribution on complete.
          // Mobile drafts historically wrote deckId/custom-* into config.groupId.
          config: configBody
            ? {
                ...(typeof configBody.groupId === 'string' || configBody.groupId === null
                  ? { groupId: configBody.groupId }
                  : {}),
                ...(typeof configBody.groupName === 'string' || configBody.groupName === null
                  ? { groupName: configBody.groupName }
                  : {}),
              }
            : undefined,
          surface: surfaceFromRequest(req),
        });

        // Group Performance chart reads lean completed history via
        // `/dashboard/summary` (`tests:${userId}:*`). Also drop the unused
        // stats:performance keys for older clients.
        try {
          await Promise.all([
            cacheService.deletePattern(`tests:${userId}:*`),
            cacheService.deletePattern(`tests:stats:performance:${userId}:*`),
            cacheService.delete(`tests:stats:subject:${userId}`),
          ]);
        } catch (cacheError) {
          logger.warn('Failed to invalidate test stats cache', { userId, cacheError });
        }

        let walletBalance: number | undefined;
        if (
          completed.sessionKind === 'test' &&
          typeof completed.score === 'number'
        ) {
          const award = await awardTestPassCoins(userId, draftId, completed.score);
          walletBalance = award.walletBalance;
        }

        res.json({
          success: true,
          data: {
            ...completed,
            walletBalance,
          },
        });
      } catch (error: any) {
        const msg = String(error?.message || '');
        if (msg.includes('not found')) {
          return res.status(404).json({ success: false, error: msg });
        }
        if (msg.includes('already') || msg.includes('abandoned')) {
          return res.status(400).json({ success: false, error: msg });
        }
        throw error;
      }
    })
  );

  // POST /api/v1/tests/drafts/:id/abandon
  router.post(
    '/drafts/:id/abandon',
    authMiddleware,
    handleValidationErrors,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;
      const draftId = String(req.params.id || '');
      const abandoned = await supabaseService.abandonTestDraft(draftId, userId);
      if (!abandoned) {
        return res.status(404).json({
          success: false,
          error: 'Draft not found or already finished',
        });
      }
      res.json({ success: true, abandoned: true });
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

      const mapped =
        test && typeof test === 'object' && 'user_id' in (test as object)
          ? supabaseService.mapTestSessionRowToClient(test)
          : test;

      res.json({
        success: true,
        data: mapped,
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
      }, userId, { surface: surfaceFromRequest(req) });

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