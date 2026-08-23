import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { MARKETPLACE_DEFAULT_COUNTRY } from '@lantern/shared/marketplace';
import { JOBS_DEFAULT_COUNTRY } from '@lantern/shared/jobs';

const router = Router();

let supabaseService: SupabaseService;
let cacheService: CacheService;

export const initializeSitemapRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

function sitemapXmlResponse(res: Response, xml: string) {
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(xml);
}

router.get(
  '/campuses.xml',
  asyncHandler(async (_req: Request, res: Response) => {
    const cacheKey = 'sitemap:campuses';
    const cached = await cacheService.get<string>(cacheKey);
    if (cached) {
      return sitemapXmlResponse(res, cached);
    }

    // Phase 4 R. Active, non-'other' campuses only — the same visibility rule
    // the summary endpoint hand-writes, because the API bypasses RLS.
    const client = supabaseService.getClient();
    const { data, error } = await client
      .from('marketplace_campuses')
      .select('slug')
      .eq('active', true)
      .neq('kind', 'other')
      .order('name', { ascending: true })
      .limit(5000);

    if (error) {
      return res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><error />');
    }

    const urls = (data || [])
      .map((row: { slug: string }) => row.slug)
      .filter(Boolean)
      .map(
        (slug: string) =>
          `<url><loc>https://lanternstudy.com/campus/${encodeURIComponent(slug)}</loc>` +
          `<changefreq>weekly</changefreq><priority>0.6</priority></url>`
      )
      .join('');

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      urls +
      '</urlset>';
    await cacheService.set(cacheKey, xml, 3600);
    sitemapXmlResponse(res, xml);
  })
);

router.get(
  '/marketplace.xml',
  asyncHandler(async (_req: Request, res: Response) => {
    const cacheKey = 'sitemap:marketplace';
    const cached = await cacheService.get<string>(cacheKey);
    if (cached) {
      return sitemapXmlResponse(res, cached);
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
    sitemapXmlResponse(res, xml);
  })
);

/** Active job postings + verified companies for public indexing. */
router.get(
  '/jobs.xml',
  asyncHandler(async (_req: Request, res: Response) => {
    const cacheKey = 'sitemap:jobs';
    const cached = await cacheService.get<string>(cacheKey);
    if (cached) {
      return sitemapXmlResponse(res, cached);
    }

    const client = supabaseService.getClient();
    const [postings, companies] = await Promise.all([
      client
        .from('job_postings')
        .select('id, updated_at')
        .eq('status', 'active')
        .eq('country_code', JOBS_DEFAULT_COUNTRY)
        .order('updated_at', { ascending: false })
        .limit(5000),
      client
        .from('job_companies')
        .select('id, updated_at')
        .eq('verification_status', 'verified')
        .order('updated_at', { ascending: false })
        .limit(2000),
    ]);

    if (postings.error || companies.error) {
      return res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><error />');
    }

    const base = 'https://lanternstudy.com';
    const today = new Date().toISOString().slice(0, 10);
    const jobUrls = (postings.data || [])
      .map((row) => {
        const lastmod = row.updated_at
          ? new Date(row.updated_at).toISOString().slice(0, 10)
          : today;
        return `  <url>
    <loc>${base}/marketplace/jobs/${encodeURIComponent(row.id)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>`;
      })
      .join('\n');
    const companyUrls = (companies.data || [])
      .map((row) => {
        const lastmod = row.updated_at
          ? new Date(row.updated_at).toISOString().slice(0, 10)
          : today;
        return `  <url>
    <loc>${base}/marketplace/companies/${encodeURIComponent(row.id)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.65</priority>
  </url>`;
      })
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${base}/marketplace/jobs</loc>
    <changefreq>daily</changefreq>
    <priority>0.85</priority>
  </url>
${jobUrls}
${companyUrls}
</urlset>`;

    await cacheService.set(cacheKey, xml, 3600);
    sitemapXmlResponse(res, xml);
  })
);

export default router;
