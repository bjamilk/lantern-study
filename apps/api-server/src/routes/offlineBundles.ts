import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { handleValidationErrors } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';

const router = Router();

let supabaseService: SupabaseService;
let cacheService: CacheService;

export const initializeOfflineBundlesRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// GET /api/v1/offline-bundles?userId=...
router.get(
  '/',
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    try {
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId is required' });
      }

      const bundles = await supabaseService.getOfflineBundles(userId);
      res.json({ success: true, data: bundles });
    } catch (error: any) {
      console.error('Offline bundles GET error:', error);
      res.status(500).json({ success: false, error: error?.message || String(error) });
    }
  })
);

// POST /api/v1/offline-bundles
router.post(
  '/',
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    try {
      const { userId, bundle } = req.body;
      if (!userId || !bundle || !bundle.bundleId) {
        return res.status(400).json({ success: false, error: 'userId and bundle.bundleId are required' });
      }

      await supabaseService.saveOfflineBundle(userId, bundle);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Offline bundles POST error:', error);
      res.status(500).json({ success: false, error: error?.message || String(error) });
    }
  })
);

// DELETE /api/v1/offline-bundles?userId=...&bundleId=...
router.delete(
  '/',
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    try {
      const { userId, bundleId } = req.query;
      if (!userId || !bundleId) {
        return res.status(400).json({ success: false, error: 'userId and bundleId are required' });
      }

      await supabaseService.deleteOfflineBundle(userId, bundleId);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Offline bundles DELETE error:', error);
      res.status(500).json({ success: false, error: error?.message || String(error) });
    }
  })
);

export default router;
