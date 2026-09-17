/**
 * Course topics (Phase 1 · A). Mounted at /api/v1/courses/:courseId/topics.
 *
 * Topics are shared course data, like courses themselves: any signed-in student
 * may read them, and any signed-in student may extend the outline. A syllabus
 * only one person can edit goes stale the first time a lecturer reorders it.
 */
import { Router, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import type { DataLayer } from '../services/data';
import { getCourseTopicsService } from '../services/courseTopics';
import { PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import { requireAuthUserId } from '../utils/requestAuth';

// mergeParams so :courseId from the mount path is visible here.
const router = Router({ mergeParams: true });
let dataLayer: DataLayer;

// TRANSITIONAL (M2a): the services called below still take the `SupabaseService`
// facade whole, so a flipped route hands them `dataLayer.legacyService`. The seam
// disappears when the `services/` importers are flipped.
const legacyService = () => dataLayer.legacyService;

export const initializeCourseTopicRoutes = (layer: DataLayer): void => {
  dataLayer = layer;
};

function handle(err: unknown, res: Response): void {
  if (err instanceof PublicError) {
    const code = typeof (err as unknown as { statusCode?: number }).statusCode === 'number'
      ? (err as unknown as { statusCode: number }).statusCode
      : 400;
    res.status(code).json({ success: false, error: err.message });
    return;
  }
  throw err;
}

// GET /api/v1/courses/:courseId/topics
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCourseTopicsService(legacyService()).list(String(req.params.courseId));
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// POST /api/v1/courses/:courseId/topics — find-or-create by title
router.post(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCourseTopicsService(legacyService()).findOrCreate(
        String(req.params.courseId),
        String((req.body ?? {}).title ?? ''),
        userId
      );
      res.status(201).json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// POST /api/v1/courses/:courseId/topics/seed — bootstrap from existing tags
router.post(
  '/seed',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCourseTopicsService(legacyService()).seedFromTags(
        String(req.params.courseId),
        userId
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// PUT /api/v1/courses/:courseId/topics/order
router.put(
  '/order',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCourseTopicsService(legacyService()).reorder(
        String(req.params.courseId),
        (req.body ?? {}).topicIds
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// PATCH /api/v1/courses/:courseId/topics/:topicId
router.patch(
  '/:topicId',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      // Both ids travel: the service refuses a topic that is not in THIS course,
      // so a client holding another course's outline cannot rename it.
      const data = await getCourseTopicsService(legacyService()).rename(
        String(req.params.courseId),
        String(req.params.topicId),
        String((req.body ?? {}).title ?? '')
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// DELETE /api/v1/courses/:courseId/topics/:topicId
router.delete(
  '/:topicId',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      // Scoped by course for the same reason as PATCH: deleting a topic unfiles
      // every student's artefacts under it, so it must be a topic of THIS course.
      await getCourseTopicsService(legacyService()).remove(
        String(req.params.courseId),
        String(req.params.topicId)
      );
      res.json({ success: true });
    } catch (err) {
      handle(err, res);
    }
  })
);

export default router;
