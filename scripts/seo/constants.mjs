/** Shared SEO / indexing constants for lanternstudy.com */
export const SITE_URL = 'https://lanternstudy.com';

/** IndexNow key — must match public/{key}.txt on the live site */
export const INDEXNOW_KEY = 'lanternstudyindex2026';

export const SITEMAP_URLS = [
  `${SITE_URL}/sitemap.xml`,
  `${SITE_URL}/sitemap/marketplace.xml`,
  `${SITE_URL}/sitemap/jobs.xml`,
  // Phase 4 R — campus landing pages. The sitemap shipped but was never
  // registered here, so nothing told a crawler it existed.
  `${SITE_URL}/sitemap/campuses.xml`,
];

/** Public URLs to notify after deploy (homepage + key landing pages) */
export const PRIORITY_URLS = [
  `${SITE_URL}/`,
  `${SITE_URL}/welcome`,
  `${SITE_URL}/marketplace`,
  `${SITE_URL}/marketplace/jobs`,
  `${SITE_URL}/privacy`,
  `${SITE_URL}/terms`,
  `${SITE_URL}/cookies`,
];
