import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { MARKETPLACE_DEFAULT_COUNTRY } from '@lantern/shared/marketplace';

const router = Router();

let supabaseService: SupabaseService;
let cacheService: CacheService;

export const initializeSitemapRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

router.get(
  '/marketplace.xml',
  asyncHandler(async (_req: Request, res: Response) => {
    const cacheKey = 'sitemap:marketplace';
    const cached = await cacheService.get<string>(cacheKey);
    if (cached) {
      res.set('Content-Type', 'application/xml; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=3600');
      return res.send(cached);
    }

    const client = supabaseService.getClient();
    const { data, error } = await client
      .from('marketplace_listings')
      .select('id, updated_at')
      .eq('status', 'active')
      .eq('country_code', MARKETPLACE_DEFAULT_COUNTRY)
      .order('updated_at', { ascending: false })
      .limit(5000);

    if (error) {
      return res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><error />');
    }

    const base = 'https://lanternstudy.com';
    const urls = (data || [])
      .map((row) => {
        const lastmod = row.updated_at
          ? new Date(row.updated_at).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);
        return `  <url>
    <loc>${base}/marketplace/listing/${encodeURIComponent(row.id)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
      })
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${base}/marketplace</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
${urls}
</urlset>`;

    await cacheService.set(cacheKey, xml, 3600);
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  })
);

export default router;
