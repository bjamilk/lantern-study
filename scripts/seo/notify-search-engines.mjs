#!/usr/bin/env node
/**
 * Notify search engines after deploy:
 * - Ping Google and Bing sitemap endpoints
 * - Submit priority URLs via IndexNow (Bing, Yandex, and participating engines)
 *
 * Usage: node scripts/seo/notify-search-engines.mjs
 * Optional: SITE_URL=https://preview.example.com node scripts/seo/notify-search-engines.mjs
 */
import {
  INDEXNOW_KEY,
  PRIORITY_URLS,
  SITE_URL,
  SITEMAP_URLS,
} from './constants.mjs';

const siteUrl = (process.env.SITE_URL || SITE_URL).replace(/\/$/, '');
const sitemapUrls = SITEMAP_URLS.map((url) =>
  url.replace(SITE_URL, siteUrl),
);
const priorityUrls = PRIORITY_URLS.map((url) =>
  url.replace(SITE_URL, siteUrl),
);

const host = new URL(siteUrl).host;

async function pingSitemap(pingBase, sitemapUrl) {
  const pingUrl = `${pingBase}${encodeURIComponent(sitemapUrl)}`;
  try {
    const res = await fetch(pingUrl, { method: 'GET', redirect: 'follow' });
    // Google/Bing deprecated sitemap ping (404/410). GSC sitemap submit + IndexNow are primary.
    const deprecated = res.status === 404 || res.status === 410;
    return {
      pingUrl,
      status: res.status,
      ok: res.ok,
      deprecated,
    };
  } catch (err) {
    return {
      pingUrl,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function submitIndexNow(urlList) {
  const keyLocation = `${siteUrl}/${INDEXNOW_KEY}.txt`;
  const body = {
    host,
    key: INDEXNOW_KEY,
    keyLocation,
    urlList,
  };

  const endpoints = [
    'https://api.indexnow.org/indexnow',
    'https://www.bing.com/indexnow',
  ];

  const results = [];
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      });
      results.push({
        endpoint,
        status: res.status,
        ok: res.ok || res.status === 200 || res.status === 202,
      });
    } catch (err) {
      results.push({
        endpoint,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

function logResult(label, result) {
  if (result.ok) {
    console.log(`  ✓ ${label} (${result.status ?? 'ok'})`);
  } else if (result.deprecated) {
    console.log(`  · ${label} (${result.status}) — ping deprecated; use Search Console sitemaps`);
  } else {
    console.warn(
      `  ✗ ${label}${result.status ? ` (${result.status})` : ''}${result.error ? `: ${result.error}` : ''}`,
    );
  }
}

async function main() {
  console.log(`Notifying search engines for ${siteUrl}\n`);

  const pingSitemaps = process.env.PING_SITEMAP === 'true';
  if (pingSitemaps) {
    console.log('Sitemap pings (deprecated — set PING_SITEMAP=true to enable):');
    for (const sitemapUrl of sitemapUrls) {
      const google = await pingSitemap(
        'https://www.google.com/ping?sitemap=',
        sitemapUrl,
      );
      logResult(`Google ← ${sitemapUrl}`, google);

      const bing = await pingSitemap(
        'https://www.bing.com/ping?sitemap=',
        sitemapUrl,
      );
      logResult(`Bing ← ${sitemapUrl}`, bing);
    }
  } else {
    console.log('Sitemap pings skipped (deprecated). Submit sitemaps in Google Search Console.');
    console.log(`  ${siteUrl}/sitemap.xml`);
    console.log(`  ${siteUrl}/sitemap/marketplace.xml`);
    console.log(`  ${siteUrl}/sitemap/jobs.xml`);
  }

  console.log('\nIndexNow (priority URLs):');
  const indexResults = await submitIndexNow(priorityUrls);
  for (const r of indexResults) {
    logResult(r.endpoint, r);
  }
  console.log(`  URLs submitted: ${priorityUrls.length}`);

  console.log('\nManual step (Google Search Console):');
  console.log('  1. https://search.google.com/search-console');
  console.log(`  2. URL Inspection → ${siteUrl}/ → Request indexing`);
  console.log(`  3. Repeat for ${siteUrl}/marketplace if needed`);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
