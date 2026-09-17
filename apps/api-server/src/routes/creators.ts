/**
 * Creator profiles + discovery (Phase 2 · J). Public-facing reads: a creator's
 * academic line, bio, stats, trust level and their active study products.
 * Never exposes earnings (SEC-08).
 */
import { Router, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { optionalAuthMiddleware } from '../middleware/auth';
import { validateUserId, handleValidationErrors } from '../middleware/validation';
import type { SupabaseService } from '../services/supabase';
import type { DataLayer } from '../services/data';
import { getCreatorsService } from '../services/creators';
import { PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';

const router = Router();
let dataLayer: DataLayer;

// TRANSITIONAL (M2a): the services called below still take the `SupabaseService`
// facade whole, so a flipped route hands them `dataLayer.legacyService`. The seam
// disappears when the `services/` importers are flipped.
// `dataLayer?` because a route module can be imported before its injector
// runs (several suites drive a handler without calling it), exactly as the
// old module-level `supabaseService` read as undefined there.
const legacyService = () => dataLayer?.legacyService as SupabaseService;

export const initializeCreatorRoutes = (layer: DataLayer): void => {
  dataLayer = layer;
};

// GET /api/v1/creators/discover?institutionId&courseId&limit
router.get(
  '/discover',
  optionalAuthMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await getCreatorsService(legacyService()).discoverCreators({
      institutionId: typeof req.query.institutionId === 'string' ? req.query.institutionId : undefined,
      courseId: typeof req.query.courseId === 'string' ? req.query.courseId : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, data });
  })
);

// GET /api/v1/creators/:userId
router.get(
  '/:userId',
  optionalAuthMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const data = await getCreatorsService(legacyService()).getCreatorProfile(
        req.params.userId,
        req.user?.id
      );
      res.json({ success: true, data });
    } catch (err: any) {
      if (err instanceof PublicError) {
        const code = typeof (err as any).statusCode === 'number' ? (err as any).statusCode : 404;
        return res.status(code).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

export default router;
