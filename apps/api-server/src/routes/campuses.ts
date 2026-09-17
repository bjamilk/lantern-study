/**
 * Public campus pages (Phase 4 · R). Mounted at /api/v1/campuses.
 *
 * GUEST-READABLE by design — it backs search-indexed pages. Mounted with the
 * public rate limits, and it returns aggregate counts only: never a name, an id
 * or any user content.
 */
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import type { SupabaseService } from '../services/supabase';
import type { DataLayer } from '../services/data';
import { CacheService } from '../services/cache';
import { getCampusSummaryService } from '../services/campusSummary';

const router = Router();
let dataLayer: DataLayer;

// TRANSITIONAL (M2a): the services called below still take the `SupabaseService`
// facade whole, so a flipped route hands them `dataLayer.legacyService`. The seam
// disappears when the `services/` importers are flipped.
// `dataLayer?` because a route module can be imported before its injector
// runs (several suites drive a handler without calling it), exactly as the
// old module-level `supabaseService` read as undefined there.
const legacyService = () => dataLayer?.legacyService as SupabaseService;
let cacheService: CacheService;

export const initializeCampusRoutes = (layer: DataLayer, cache: CacheService): void => {
  dataLayer = layer;
  cacheService = cache;
};

// GET /api/v1/campuses/:slug/summary(?programme=)
router.get(
  '/:slug/summary',
  asyncHandler(async (req: Request, res: Response) => {
    const programme = typeof req.query.programme === 'string' ? req.query.programme : null;
    const cacheKey = `campus:summary:${String(req.params.slug).toLowerCase()}:${programme || '-'}`;

    const cached = await cacheService.get<unknown>(cacheKey);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=600');
      return res.json({ success: true, data: cached });
    }

    const data = await getCampusSummaryService(dataLayer).getBySlug(req.params.slug, programme);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Campus not found' });
    }

    // Counts move slowly and this is a public, crawled endpoint — cache hard.
    await cacheService.set(cacheKey, data, 600);
    res.set('Cache-Control', 'public, max-age=600');
    res.json({ success: true, data });
  })
);

// GET /api/v1/campuses — the index behind the sitemap and /campus
router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const cacheKey = 'campus:slugs';
    const cached = await cacheService.get<unknown>(cacheKey);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=3600');
      return res.json({ success: true, data: cached });
    }
    const data = await getCampusSummaryService(dataLayer).listSlugs();
    await cacheService.set(cacheKey, data, 3600);
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ success: true, data });
  })
);

export default router;
