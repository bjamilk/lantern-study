
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { SupabaseService } from '../services/supabase';

export function createOfflineBundleRouter(supabaseService: SupabaseService) {
  const router = Router();

  // GET /api/v1/offline-bundles?userId=...
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { userId } = req.query;
      if (!userId) return res.status(400).json({ success: false, message: 'Missing userId' });
      const bundles = await supabaseService.getUserOfflineBundles(userId as string);
      res.json({ success: true, data: bundles });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // POST /api/v1/offline-bundles
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { userId, bundle } = req.body;
      if (!userId || !bundle) return res.status(400).json({ success: false, message: 'Missing userId or bundle' });
      const result = await supabaseService.saveOfflineBundle(userId, bundle);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // DELETE /api/v1/offline-bundles
  router.delete('/', async (req: Request, res: Response) => {
    try {
      const { userId, bundleId } = req.query;
      if (!userId || !bundleId) return res.status(400).json({ success: false, message: 'Missing userId or bundleId' });
      const result = await supabaseService.deleteOfflineBundle(userId as string, bundleId as string);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  return router;
}
