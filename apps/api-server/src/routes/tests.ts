import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors, validateTestConfig, validatePagination, validateUserId } from '../middleware/validation';
import { buildAttemptTally } from '../services/supabase';
import type { DataLayer } from '../services/data';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import { requireAuthUserId } from '../utils/requestAuth';
import { requireTestOwner } from '../middleware/authorizeResource';
import { idempotencyMiddleware, type IdempotentRequest } from '../middleware/idempotency';
import { enforceResourceOwner, userScopedCacheKey } from '../utils/resourceAccess';
import { getWalletService } from '../services/walletService';
import { WALLET_COINS, WALLET_TEST_PASS_THRESHOLD, testAwardKey } from '@lantern/shared/utils/walletCoins';
import { surfaceFromRequest } from '../services/learningEvents';
import {
  COURSE_FILTER_INVALID_MESSAGE,
  TOPIC_FILTER_INVALID_MESSAGE,
  courseFilterKey,
  parseCourseFilter,
  parseTopicFilter,
} from '../services/academicCourses';
import { getTopicMasteryService } from '../services/topicMastery';
import { PublicError } from '../utils/safeError';
import { attachJobResultRef } from '../queue/jobStatus';
import { normalizeQuestionExplanation } from '@lantern/shared/utils/testHelpers';

/** A rejected topic (wrong course, no course, unusable id) is the caller's mistake — 400, not 500. */
const respondPublicError = (err: unknown, res: any): boolean => {
  if (!(err instanceof PublicError)) return false;
  res.status(400).json({ success: false, error: err.message });
  return true;
};

/** A quiz saved as a launchable test must actually contain askable questions. */
export const MAX_PERSONAL_TEST_QUESTIONS = 500;

export type PersonalTestRejection = { code: string; error: string; field?: string; index?: number };

/**
 * Validate + normalise the questions of a personal test. Returns the rows to
 * store, or a structured rejection. Kept pure so the rules are unit-testable.
 */
export function normalizePersonalTestQuestions(
  input: unknown
): { ok: true; questions: any[] } | { ok: false; rejection: PersonalTestRejection } {
  if (!Array.isArray(input) || input.length === 0) {
    return {
      ok: false,
      rejection: {
        code: 'EMPTY_QUESTIONS',
        error: 'A test needs at least one question. Nothing was saved.',
        field: 'questions',
      },
    };
  }
  if (input.length > MAX_PERSONAL_TEST_QUESTIONS) {
    return {
      ok: false,
      rejection: {
        code: 'TOO_MANY_QUESTIONS',
        error: `A test can hold at most ${MAX_PERSONAL_TEST_QUESTIONS} questions.`,
        field: 'questions',
      },
    };
  }

  const questions: any[] = [];
  for (let index = 0; index < input.length; index++) {
    const raw = input[index] as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        ok: false,
        rejection: { code: 'INVALID_QUESTION', error: 'Each question must be an object.', index },
      };
    }
    const prompt = ['question', 'text', 'prompt']
      .map((key) => (typeof raw[key] === 'string' ? (raw[key] as string).trim() : ''))
      .find((value) => value.length > 0);
    if (!prompt) {
      return {
        ok: false,
        rejection: {
          code: 'INVALID_QUESTION',
          error: 'Each question needs question text.',
          index,
          field: 'question',
        },
      };
    }
    // The rationale, under whichever key the generator used. Review reads it
    // straight off the stored question — there is no second AI call — so a
    // question saved with only `rationale` left review permanently blank.
    const explanation = normalizeQuestionExplanation(raw);

    const stored: Record<string, unknown> = {
      ...raw,
      // A stable id per question: answers are keyed by it, so a missing one
      // would make the attempt unscoreable.
      id: typeof raw.id === 'string' && raw.id ? raw.id : `q${index + 1}`,
      question: prompt,
    };
    // Written or removed, never left as the generator's placeholder: review
    // decides what to say when there is no rationale, and "No explanation
    // available." printed as if it were one is worse than nothing.
    if (explanation) stored.explanation = explanation;
    else delete stored.explanation;
    questions.push(stored);
  }
  return { ok: true, questions };
}

/**
 * The default title for a personal test built from a note or a deck.
 *
 * "Test · <source>", never "Quiz · <source>": the thing being created is a
 * test session that lands under Available Tests, and calling it a quiz there
 * made students look for it somewhere else.
 */
export function defaultPersonalTestTitle(sourceTitle: string | null | undefined): string | null {
  const title = typeof sourceTitle === 'string' ? sourceTitle.trim() : '';
  if (!title) return null;
  return `Test · ${title}`.slice(0, 200);
}

/**
 * The source a personal test is being created from, accepted in both the
 * nested (`source: { deckId, noteId }`) and flat (`sourceDeckId`) shapes so a
 * client that already sends one does not have to change.
 */
export function readPersonalTestSource(body: any): { noteId: string | null; deckId: string | null } {
  const nested = body?.source && typeof body.source === 'object' && !Array.isArray(body.source)
    ? body.source
    : {};
  const pick = (...values: unknown[]) => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  };
  return {
    noteId: pick(nested.noteId, body?.sourceNoteId),
    deckId: pick(nested.deckId, body?.sourceDeckId),
  };
}

/**
 * The only config keys a client may write while COMPLETING a session.
 *
 * A whitelist, not a merge: `config` also carries the questions' own settings
 * and a completing client has no business rewriting those. What it legitimately
 * knows at the end is
 *
 *  - the study group the sitting belongs to (mobile drafts historically wrote
 *    a deckId or a `custom-*` id into `config.groupId`),
 *  - how the sitting was actually taken, and against what pass mark, and
 *  - for a PRACTICE sitting only, its tally.
 *
 * The tally is here because a study session never writes a `test_results` row
 * (see completeTestDraft: it returns before createTestResult), so the score on
 * every list read was 0 and History printed "0% · 0/0 pts · NOT PASSED" for a
 * sitting the student had just answered. Config is returned by the lean list;
 * the result row is not, and does not exist.
 *
 * Anything else in the body is dropped silently, as it always was.
 */
export function completionConfigPatch(body: any): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const str = (value: unknown) => typeof value === 'string' || value === null;
  const nonNegative = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;

  if (str(body.groupId)) patch.groupId = body.groupId;
  if (str(body.groupName)) patch.groupName = body.groupName;
  if (body.mode === 'study' || body.mode === 'test') patch.mode = body.mode;
  if (nonNegative(body.passingScore)) patch.passingScore = body.passingScore;
  if (nonNegative(body.practiceScore)) patch.practiceScore = body.practiceScore;
  if (nonNegative(body.practiceCorrectCount)) patch.practiceCorrectCount = body.practiceCorrectCount;
  if (nonNegative(body.practiceTotalQuestions)) {
    patch.practiceTotalQuestions = body.practiceTotalQuestions;
  }
  return patch;
}

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
let dataLayer: DataLayer;

let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeTestRoutes = (layer: DataLayer, cache: CacheService) => {
  dataLayer = layer;
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
      // ?topicId= — same grammar one level down; "null" is "in this course, under no topic".
      const topicFilter = parseTopicFilter(req.query.topicId);
      if (topicFilter.kind === 'invalid') {
        return res.status(400).json({ success: false, error: TOPIC_FILTER_INVALID_MESSAGE });
      }
      const courseId = courseFilterKey(courseFilter) || undefined;
      const topicId = courseFilterKey(topicFilter) || undefined;
      const lean =
        req.query.lean === '1' ||
        req.query.lean === 'true' ||
        req.query.lean === true;
      const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
      const sort =
        sortRaw === 'oldest' || sortRaw === 'highestScore' ? sortRaw : 'newest';
      const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : undefined;
      const studySetId =
        typeof req.query.studySetId === 'string' && req.query.studySetId ? req.query.studySetId : undefined;

      logger.debug('Fetching tests', { page, limit, status, courseId, topicId, lean, sort, from, to, userId });

      try {
        if (!dataLayer) {
          res.json({
            success: true,
            data: [],
            pagination: { page, limit, total: 0, hasMore: false },
          });
          return;
        }

        const { tests, total } = await dataLayer.tests.getUserTests(userId, {
          page,
          limit,
          status,
          courseFilter,
          topicFilter,
          lean,
          sort,
          from,
          to,
          // In the query, not in a post-filter here. Filtering the page after
          // the fact meant `total` counted only the rows that happened to land
          // on it and `hasMore` was hard-coded false, so a set with more tests
          // than one page silently lost the older ones with no way to reach
          // them.
          studySetId,
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

  /**
   * POST /api/v1/tests/personal — save a set of questions as a launchable
   * personal test (a quiz generated from a note, most often).
   *
   * POST /tests cannot do this: any payload carrying questions is stored as a
   * COMPLETED session there, so a generated quiz had nowhere to live and never
   * appeared under "Available Tests". This writes the shape that list reads —
   * questions present, no end_time, status in_progress.
   *
   * Retries are safe: an `Idempotency-Key` header — or `clientKey`, or the
   * generating `sourceJobId` — replays the FIRST test instead of creating a
   * second one. The client saves BEFORE it writes anything locally, so a
   * process that dies after the response and re-saves on the next launch
   * must get the same test back, not a duplicate under Available.
   */
  router.post(
    '/personal',
    authMiddleware,
    idempotencyMiddleware({
      operation: 'test_create_personal',
      fallbackKey: (req: any) =>
        (typeof req.body?.clientKey === 'string' && req.body.clientKey) ||
        (typeof req.body?.sourceJobId === 'string' && `job:${req.body.sourceJobId}`) ||
        null,
    }),
    asyncHandler(async (req: IdempotentRequest & any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { title, questions, sourceJobId, courseId, topicId, studySetId, config } = req.body || {};
      // Accepts `source: { deckId }` / `source: { noteId }` as well as the flat
      // `sourceNoteId` older clients send.
      const source = readPersonalTestSource(req.body);

      let cleanTitle = typeof title === 'string' ? title.trim().slice(0, 200) : '';
      if (!cleanTitle && (source.noteId || source.deckId)) {
        // No title, but a source we can name: default to "Test · <source>"
        // rather than 400. A deck→test with nothing typed is a normal save,
        // not a client bug, and this is the only place that can resolve the
        // source's real title. A titleless save with NO source still 400s —
        // there is nothing to name it after.
        const sourceTitle = await dataLayer.tests.resolvePersonalTestSourceTitle(source, userId);
        cleanTitle = defaultPersonalTestTitle(sourceTitle) || '';
      }
      if (!cleanTitle) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_TITLE',
          field: 'title',
          error: 'A title is required.',
          retryable: false,
        });
      }

      const normalized = normalizePersonalTestQuestions(questions);
      if (!normalized.ok) {
        return res.status(400).json({
          success: false,
          retryable: false,
          ...normalized.rejection,
        });
      }

      const run = req.runIdempotent || ((handler: () => Promise<any>) => handler());

      let payload: any;
      try {
        payload = await run(async () => {
          const test = await dataLayer.tests.createPersonalTest(
            {
              title: cleanTitle,
              questions: normalized.questions,
              sourceNoteId: source.noteId,
              sourceDeckId: source.deckId,
              sourceJobId: typeof sourceJobId === 'string' ? sourceJobId : null,
              courseId: typeof courseId === 'string' ? courseId : null,
              topicId: typeof topicId === 'string' ? topicId : null,
              studySetId: typeof studySetId === 'string' ? studySetId : null,
              config: config && typeof config === 'object' ? config : null,
            },
            userId
          );
          await cacheService.deletePattern(`tests:${userId}:*`);
          return dataLayer.tests.mapTestSessionRowToClient(test);
        });
      } catch (err) {
        if (respondPublicError(err, res)) return;
        throw err;
      }

      // The generating job knew it had made a quiz but not WHERE it landed:
      // a note quiz is written as a launchable test only here, by the client,
      // minutes after the job went terminal. Stamping the ref now makes the
      // job record resolvable — `lanternstudy://test/<id>` instead of the
      // `jobs/<id>` fallback the notification had to fall back to, which is
      // what a student tapping a stale notification (or a second device) gets.
      // Never fails the save: the test exists either way.
      if (typeof sourceJobId === 'string' && sourceJobId && payload?.id) {
        try {
          await attachJobResultRef(sourceJobId, {
            type: 'test',
            id: String(payload.id),
            route: `/tests/${payload.id}`,
          });
        } catch (err) {
          logger.warn('Could not stamp personal test onto its job record', { err });
        }
      }

      res.status(201).json({ success: true, data: payload });
    })
  );

  // DELETE /api/v1/tests/history - Clear all completed test sessions for user
  router.delete(
    '/history',
    authMiddleware,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      logger.debug('Clearing completed test history', { userId });

      const deletedCount = await dataLayer.tests.clearCompletedTestHistory(userId);

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
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { sessionId } = req.params;

      const { data, error } = await dataLayer.getClient()
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
      const mapped = dataLayer.tests.mapTestSessionRowToClient(data);
      await dataLayer.tests.attachSourceNoteTitles([mapped as any], userId);
      res.json({
        success: true,
        data: {
          ...mapped,
          score: data.score,
          // Correct / incorrect / unanswered split three ways, plus the
          // confidence the student reported. Review must not present a
          // question they never reached as one they got wrong.
          tally: buildAttemptTally(data),
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
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { sessionId } = req.params;

      logger.debug('Deleting completed test session', { sessionId, userId });

      try {
        const deleted = await dataLayer.tests.deleteCompletedTestSession(sessionId, userId);
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
      // The topic rides in the column only — unlike courseId there are no older
      // sessions carrying it in config, and createTestDraft validates it against
      // the course before it gets there. Left absent (not null) when the client
      // sends none, so the insert never names topic_id before the migration adds it.
      const topicId = body.topicId ?? body.config?.topicId;

      let draft;
      try {
        draft = await dataLayer.tests.createTestDraft(
          {
            config,
            courseId,
            topicId,
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
            // The room the session was started in. Read off the body OR the
            // config by the service, so a client that carries the set either
            // way files the draft in the same place.
            studySetId: body.studySetId ?? body.study_set_id ?? null,
          },
          userId,
        );
      } catch (err) {
        if (respondPublicError(err, res)) return;
        throw err;
      }

      await cacheService.deletePattern(`tests:${userId}:*`);
      res.status(201).json({ success: true, data: draft });
    })
  );

  // PATCH /api/v1/tests/drafts/:id - Autosave / pause progress
  router.patch(
    '/drafts/:id',
    authMiddleware,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;
      const draftId = String(req.params.id || '');
      const body = req.body || {};

      try {
        const configBody = body.config && typeof body.config === 'object' ? body.config : null;
        const updated = await dataLayer.tests.updateTestDraft(draftId, userId, {
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
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;
      const draftId = String(req.params.id || '');
      const body = req.body || {};

      try {
        const configBody = body.config && typeof body.config === 'object' ? body.config : null;
        const completed = await dataLayer.tests.completeTestDraft(draftId, userId, {
          user_answers: body.user_answers ?? body.userAnswers,
          activityDate: body.activityDate,
          score: body.score,
          correctAnswersCount: body.correct_answers_count ?? body.correctAnswersCount,
          totalQuestions: body.total_questions ?? body.totalQuestions,
          // Allow clients to correct study-group attribution on complete.
          // Mobile drafts historically wrote deckId/custom-* into config.groupId.
          config: configBody ? completionConfigPatch(configBody) : undefined,
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
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;
      const draftId = String(req.params.id || '');
      const abandoned = await dataLayer.tests.abandonTestDraft(draftId, userId);
      if (!abandoned) {
        return res.status(404).json({
          success: false,
          error: 'Draft not found or already finished',
        });
      }
      res.json({ success: true, abandoned: true });
    })
  );

  /**
   * GET /api/v1/tests/:testId — the FULL session, whatever its status.
   *
   * This is the one endpoint a client can always fall back to for a session's
   * questions. The list is served without them on completed rows (a page of
   * history would otherwise carry every question twice), which is why a retake
   * launched straight off a history row had nothing to launch and could only
   * say "question data is no longer available". Retake fetches this first.
   *
   * Response `data` (all fields always present, never undefined):
   *   id, title, status, sessionKind, config, courseId, topicId
   *   questions[]     — full question objects, each carrying `explanation`
   *                     when the generator produced one
   *   userAnswers     — questionId → answer (may carry `confidence`)
   *   questionCount, currentQuestionIndex, startTime, endTime, remainingTime
   *   provenance      — { noteId, deckId, groupId, title }, each string|null
   *   tally           — { total, answered, correct, incorrect, unanswered,
   *                       byConfidence } — unanswered is NEVER folded into
   *                       incorrect
   *   access          — 'owner' | 'group'
   *
   * Access: the owner, or — for a session built from a group's question bank —
   * any member of that group. A group peer gets the questions to launch, never
   * the owner's attempt: `userAnswers` comes back empty and `tally` is null.
   */
  router.get(
    '/:testId',
    authMiddleware,
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { testId } = req.params;

      logger.debug('Fetching test', { testId, userId });

      const cacheKey = userScopedCacheKey('test', userId, testId);
      let test = await cacheService.get(cacheKey);
      let access: 'owner' | 'group' = 'owner';

      if (!test) {
        const resolved = await dataLayer.tests.resolveTestSessionForCaller(testId, userId);

        if (!resolved) {
          return res.status(404).json({
            success: false,
            error: 'Test not found or access denied',
          });
        }

        test = resolved.session;
        access = resolved.access;
        // Only the owner's own read is cached under their key. A group peer's
        // view is derived (answers stripped) and must not be able to land in
        // a cache the owner then reads back.
        if (access === 'owner') {
          await cacheService.set(cacheKey, test, 600);
        }
      } else if (!enforceResourceOwner(res, test as Record<string, unknown>, userId)) {
        return;
      }

      const mapped =
        test && typeof test === 'object' && 'user_id' in (test as object)
          ? dataLayer.tests.mapTestSessionRowToClient(test)
          : test;

      // Same contract as the list: a note quiz names the note it came from,
      // even if it was saved before that title was persisted into config.
      if (mapped && typeof mapped === 'object' && access === 'owner') {
        await dataLayer.tests.attachSourceNoteTitles([mapped as any], userId);
      }

      if (access === 'group' && mapped && typeof mapped === 'object') {
        const peerView: any = { ...(mapped as any) };
        peerView.userAnswers = {};
        peerView.currentQuestionIndex = 0;
        peerView.score = undefined;
        return res.json({
          success: true,
          data: { ...peerView, access, tally: null },
        });
      }

      res.json({
        success: true,
        data: {
          ...(mapped as any),
          access,
          tally: test && typeof test === 'object' ? buildAttemptTally(test) : null,
        },
      });
    })
  );

  // POST /api/v1/tests - Create new test
  //
  // FIXED (F2 · E3 C6/H11): this is the create half of the offline result
  // replay (`saveTestResult` with no sessionId), and it was unkeyed — a submit
  // that reached the server but failed on the way back was retried and wrote a
  // SECOND session for one sitting: duplicate attempts in History, points and
  // badges awarded twice. Clients now send the attempt's `Idempotency-Key`
  // (minted once at enqueue by `@lantern/shared/offlineQueue`, re-read on every
  // retry); web's raw-fetch data layer sends the same value in the body, which
  // `fallbackKey` reads. With no key at all the wrapper is a passthrough, so
  // nothing here depends on a client having been updated.
  router.post(
    '/',
    authMiddleware,
    idempotencyMiddleware({
      operation: 'test_session_create',
      fallbackKey: (req: any) =>
        (typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey) ||
        (typeof req.body?.clientKey === 'string' && req.body.clientKey) ||
        null,
    }),
    validateTestConfig,
    handleValidationErrors,
    asyncHandler(async (req: IdempotentRequest & any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const testConfig = req.body;

      logger.debug('Creating test', { testConfig, userId });

      const run = req.runIdempotent || ((handler: () => Promise<any>) => handler());

      let test;
      try {
        test = await run(async () => {
          const created = await dataLayer.tests.createTest(testConfig, userId);
          // Inside the wrapper: a replay must not re-run the invalidation for
          // a write that did not happen.
          await cacheService.deletePattern(`tests:${userId}:*`);
          return created;
        });
      } catch (err) {
        if (respondPublicError(err, res)) return;
        throw err;
      }

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
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { testId } = req.params;

      logger.debug('Starting test', { testId, userId });

      const test = await dataLayer.tests.getTestById(testId, userId);
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

      const startedTest = await dataLayer.tests.startTest(testId, userId);

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

      const test = await dataLayer.tests.getTestById(testId, userId);
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

      const result = await dataLayer.tests.submitTest(testId, userId, answers);

      // Invalidate caches
      await cacheService.delete(userScopedCacheKey('test', userId, testId));
      await cacheService.deletePattern(`tests:${userId}:*`);
      await cacheService.delete(`user:stats:${userId}`);

      const wallet = await awardTestPassCoins(userId, testId, Number(result.score) || 0);

      // Mastery Graph (Phase 3 · P): a finished test is the single richest
      // signal we get about topic strength. Fire-and-forget and debounced in
      // the service — a 40-question submission must not wait on a recompute,
      // and finishing three tests in a row must not run it three times.
      getTopicMasteryService(dataLayer).refreshAsync(userId);

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
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { testId } = req.params;

      logger.debug('Fetching test results', { testId, userId });

      const test = await dataLayer.tests.getTestById(testId, userId);
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
        results = await dataLayer.tests.getTestResults(testId, userId);

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
  // FIXED (F2 · E3 C6/H11): the submit half of the replay was unkeyed too, so a
  // retry after a lost response wrote a second result row against the same
  // session. A session has exactly ONE result, so the fallback key is derived
  // from the session id — every client, updated or not, is covered — and a
  // client-sent `Idempotency-Key` (the attempt key from
  // `@lantern/shared/offlineQueue`) still wins.
  router.post(
    '/:testId/results',
    authMiddleware,
    requireTestOwner(),
    idempotencyMiddleware({
      operation: 'test_result_create',
      fallbackKey: (req: any) =>
        typeof req.params?.testId === 'string' && req.params.testId
          ? `test-result:${req.params.testId}`
          : null,
    }),
    asyncHandler(async (req: IdempotentRequest & any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { testId } = req.params;
      const { score, correctAnswersCount, totalQuestions, activityDate } = req.body;

      logger.debug('Creating test result', { testId, score, correctAnswersCount, totalQuestions, userId });

      const run = req.runIdempotent || ((handler: () => Promise<any>) => handler());

      const payload = await run(async () => {
        const result = await dataLayer.tests.createTestResult(testId, {
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

        return { ...result, walletBalance: wallet.walletBalance, awarded: wallet.awarded };
      });

      res.status(201).json({
        success: true,
        data: payload,
      });
    })
  );

  // GET /api/v1/tests/:testId/questions - Get test questions
  router.get(
    '/:testId/questions',
    authMiddleware,
    requireTestOwner(),
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { testId } = req.params;

      logger.debug('Fetching test questions', { testId, userId });

      const test = await dataLayer.tests.getTestById(testId, userId);
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
        questions = await dataLayer.tests.getTestQuestions(testId, userId);

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
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { testId } = req.params;

      logger.debug('Deleting test', { testId, userId });

      const test = await dataLayer.tests.getTestById(testId, userId);
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

      const deleted = await dataLayer.tests.deleteTest(testId);

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
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      logger.debug('Fetching subject stats', { userId });

      const cacheKey = `tests:stats:subject:${userId}`;
      let stats = await cacheService.get(cacheKey);

      if (!stats) {
        stats = await dataLayer.tests.getSubjectStats(userId);

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
    asyncHandler(async (req: any, res: any) => {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { period = 'month' } = req.query;

      logger.debug('Fetching performance stats', { period, userId });

      const cacheKey = `tests:stats:performance:${userId}:${period}`;
      let stats = await cacheService.get(cacheKey);

      if (!stats) {
        stats = await dataLayer.tests.getPerformanceStats(userId, period as string);

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
        templates = await dataLayer.tests.getTestTemplates({
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