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
import { SupabaseService } from '../services/supabase';
import { getCourseTopicsService } from '../services/courseTopics';
import { PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import { requireAuthUserId } from '../utils/requestAuth';

// mergeParams so :courseId from the mount path is visible here.
const router = Router({ mergeParams: true });
let supabaseService: SupabaseService;

export const initializeCourseTopicRoutes = (supabase: SupabaseService): void => {
  supabaseService = supabase;
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
      const data = await getCourseTopicsService(supabaseService).list(String(req.params.courseId));
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
      const data = await getCourseTopicsService(supabaseService).findOrCreate(
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
      const data = await getCourseTopicsService(supabaseService).seedFromTags(
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
      const data = await getCourseTopicsService(supabaseService).reorder(
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
      const data = await getCourseTopicsService(supabaseService).rename(
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
      await getCourseTopicsService(supabaseService).remove(String(req.params.topicId));
      res.json({ success: true });
    } catch (err) {
      handle(err, res);
    }
  })
);

export default router;
