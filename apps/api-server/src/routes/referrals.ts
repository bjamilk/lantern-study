/**
 * Referrals + ambassadors (Phase 4 · Q). Mounted at /api/v1/referrals.
 *
 * Read-only to clients. There is deliberately no endpoint to claim a referral:
 * attribution happens server-side in `handle_new_user()` at signup, and the
 * reward is granted by the activation check — never by a client assertion.
 */
import { Router, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import type { SupabaseService } from '../services/supabase';
import type { DataLayer } from '../services/data';
import { getReferralsService } from '../services/referrals';
import { PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import { requireAuthUserId } from '../utils/requestAuth';

const router = Router();
let dataLayer: DataLayer;

// TRANSITIONAL (M2a): the services called below still take the `SupabaseService`
// facade whole, so a flipped route hands them `dataLayer.legacyService`. The seam
// disappears when the `services/` importers are flipped.
// `dataLayer?` because a route module can be imported before its injector
// runs (several suites drive a handler without calling it), exactly as the
// old module-level `supabaseService` read as undefined there.
const legacyService = () => dataLayer?.legacyService as SupabaseService;

export const initializeReferralRoutes = (layer: DataLayer): void => {
  dataLayer = layer;
};

// GET /api/v1/referrals — the caller's code, stats and referred users
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await getReferralsService(dataLayer).summary(userId);
    res.json({ success: true, data });
  })
);

// GET /api/v1/referrals/ambassadors?institutionId= — campus reps
router.get(
  '/ambassadors',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const institutionId =
        typeof req.query.institutionId === 'string' ? req.query.institutionId : '';
      const data = await getReferralsService(dataLayer).listAmbassadors(
        institutionId,
        req.query.limit ? Number(req.query.limit) : undefined
      );
      res.json({ success: true, data });
    } catch (err) {
      if (err instanceof PublicError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

export default router;
