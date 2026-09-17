/**
 * The Academic Feed and the Mastery Graph reads (Phase 3 · M and P).
 *
 * Mounted at /api/v1/feed and /api/v1/mastery.
 */
import { Router, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import type { SupabaseService } from '../services/supabase';
import type { DataLayer } from '../services/data';
import { getActivityFeedService } from '../services/activityFeed';
import { getTopicMasteryService } from '../services/topicMastery';
import { getLearningConnectionsService } from '../services/learningConnections';
import { AuthenticatedRequest } from '../types';
import { requireAuthUserId } from '../utils/requestAuth';

const router = Router();
export const masteryRouter = Router();

let dataLayer: DataLayer;

// TRANSITIONAL (M2a): the services called below still take the `SupabaseService`
// facade whole, so a flipped route hands them `dataLayer.legacyService`. The seam
// disappears when the `services/` importers are flipped.
// `dataLayer?` because a route module can be imported before its injector
// runs (several suites drive a handler without calling it), exactly as the
// old module-level `supabaseService` read as undefined there.
const legacyService = () => dataLayer?.legacyService as SupabaseService;

export const initializeFeedRoutes = (layer: DataLayer): void => {
  dataLayer = layer;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

// GET /api/v1/feed?limit&before
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await getActivityFeedService(legacyService()).getFeed(userId, {
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      before: str(req.query.before),
    });
    res.json({ success: true, data });
  })
);

// GET /api/v1/feed/connections — "you helped 12 people learn this week"
router.get(
  '/connections',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await getLearningConnectionsService(legacyService()).summaryForUser(userId);
    res.json({ success: true, data });
  })
);

// ---------------------------------------------------------------------------
// /api/v1/mastery — the Mastery Graph
// ---------------------------------------------------------------------------

// GET /api/v1/mastery?courseId&limit
masteryRouter.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const service = getTopicMasteryService(dataLayer);
    const [topics, weak, strong] = await Promise.all([
      service.listForUser(userId, {
        courseId: str(req.query.courseId) ?? null,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }),
      service.weakTopics(userId),
      service.strongTopics(userId),
    ]);
    res.json({ success: true, data: { topics, weak, strong } });
  })
);

// POST /api/v1/mastery/refresh — explicit recompute (debounced in the service)
masteryRouter.post(
  '/refresh',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    await getTopicMasteryService(dataLayer).refresh(userId, { force: true });
    const topics = await getTopicMasteryService(dataLayer).listForUser(userId);
    res.json({ success: true, data: { topics } });
  })
);

// GET /api/v1/mastery/exam-readiness
masteryRouter.get(
  '/exam-readiness',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await getTopicMasteryService(dataLayer).examReadiness(userId);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/v1/mastery/readiness?courseId= — syllabus-aware readiness for every
 * active enrolled course (no exam date required, unlike /exam-readiness).
 * With a courseId it also attaches the class-population signal (classSignal),
 * cohort-floored by the RPC — that is the "what past/other students found
 * hard" context, only ever shown when the cohort is big enough to be
 * anonymous. classSignal failures never block the personal payload.
 */
masteryRouter.get(
  '/readiness',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const courseId = str(req.query.courseId) ?? null;
    const service = getTopicMasteryService(dataLayer);
    const courses = await service.courseReadiness(userId, { courseId });

    let classSignal: Record<string, unknown> | undefined;
    if (courseId) {
      try {
        classSignal = await service.courseAggregate(courseId);
      } catch {
        classSignal = { available: false };
      }
    }

    res.json({ success: true, data: { courses, ...(classSignal ? { classSignal } : {}) } });
  })
);

/**
 * GET /api/v1/mastery/unmatched-tags?courseId= — the tags this student uses on
 * a course that match no topic in its shared outline.
 *
 * The inline outline edit itself is already PATCH
 * /api/v1/courses/:courseId/topics/:topicId (rename), with POST for a new
 * topic — this endpoint is what tells the student WHICH edits are worth making
 * rather than leaving them to diff two lists by eye.
 */
masteryRouter.get(
  '/unmatched-tags',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const courseId = str(req.query.courseId);
    if (!courseId) {
      res.status(400).json({ success: false, error: 'courseId is required' });
      return;
    }
    const data = await getTopicMasteryService(dataLayer).unmatchedTags(userId, courseId);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/v1/mastery/course/:courseId — population aggregate.
 * Refused below a 20-student cohort; the RPC enforces the same floor so this
 * endpoint is not the only thing protecting a small class from a
 * re-identifiable per-topic breakdown.
 */
masteryRouter.get(
  '/course/:courseId',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await getTopicMasteryService(dataLayer).courseAggregate(req.params.courseId);
    res.json({ success: true, data });
  })
);

export default router;
