import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { requireAuthUserId } from '../utils/requestAuth';
import { AuthenticatedRequest } from '../types';
import type { DataLayer } from '../services/data';
import { CacheService } from '../services/cache';
import { clientErrorMessage } from '../utils/safeError';
import { COURSE_FILTER_INVALID_MESSAGE, parseCourseFilter } from '../services/academicCourses';

const router = Router();

let dataLayer: DataLayer;
let cacheService: CacheService;

export const initializeOfflineBundlesRoutes = (layer: DataLayer, cache: CacheService) => {
  dataLayer = layer;
  cacheService = cache;
};

router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    // ?courseId= — uuid, the literal "null" (unfiled) or absent; anything else is a 400.
    const courseFilter = parseCourseFilter(req.query.courseId);
    if (courseFilter.kind === 'invalid') {
      return res.status(400).json({ success: false, error: COURSE_FILTER_INVALID_MESSAGE });
    }
    const bundles = await dataLayer.offlineBundles.getOfflineBundles(userId, { courseFilter });
    res.json({ success: true, data: bundles });
  })
);

router.post(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { bundle } = req.body;
    if (!bundle || !bundle.bundleId) {
      return res.status(400).json({ success: false, error: 'bundle.bundleId is required' });
    }
    // Course reference (column + config.courseId): top-level wins, config falls back.
    const courseCandidate = bundle.courseId ?? bundle.config?.courseId;
    if (
      courseCandidate != null &&
      courseCandidate !== '' &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(courseCandidate))
    ) {
      return res.status(400).json({ success: false, error: 'courseId must be a valid UUID' });
    }

    try {
      await dataLayer.offlineBundles.saveOfflineBundle(userId, bundle);
      res.json({ success: true });
    } catch (err: any) {
      res.status(err.statusCode || 400).json({
        success: false,
        error: clientErrorMessage(err, 'Failed to save offline bundle'),
      });
    }
  })
);

router.delete(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { bundleId } = req.query;
    if (!bundleId) {
      return res.status(400).json({ success: false, error: 'bundleId is required' });
    }

    await dataLayer.offlineBundles.deleteOfflineBundle(userId, bundleId as string);
    res.json({ success: true });
  })
);

export default router;
