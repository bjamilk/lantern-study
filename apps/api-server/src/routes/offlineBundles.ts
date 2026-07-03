import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { handleValidationErrors } from '../middleware/validation';
import { authMiddleware } from '../middleware/auth';
import { requireAuthUserId } from '../utils/requestAuth';
import { AuthenticatedRequest } from '../types';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { clientErrorMessage } from '../utils/safeError';

const router = Router();

let supabaseService: SupabaseService;
let cacheService: CacheService;

export const initializeOfflineBundlesRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

router.get(
  '/',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const bundles = await supabaseService.getOfflineBundles(userId);
    res.json({ success: true, data: bundles });
  })
);

router.post(
  '/',
  authMiddleware,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { bundle } = req.body;
    if (!bundle || !bundle.bundleId) {
      return res.status(400).json({ success: false, error: 'bundle.bundleId is required' });
    }

    try {
      await supabaseService.saveOfflineBundle(userId, bundle);
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
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { bundleId } = req.query;
    if (!bundleId) {
      return res.status(400).json({ success: false, error: 'bundleId is required' });
    }

    await supabaseService.deleteOfflineBundle(userId, bundleId as string);
    res.json({ success: true });
  })
);

export default router;
