const API_SITEMAP =
  'https://lantern-study-api.onrender.com/api/v1/sitemap/campuses.xml';

/** Proxy dynamic campus sitemap (Phase 4 R) onto lanternstudy.com for Google Search Console. */
export async function onRequest(): Promise<Response> {
  try {
    const res = await fetch(API_SITEMAP, {
      headers: { Accept: 'application/xml' },
    });
    if (!res.ok) {
      return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" />', {
        status: 502,
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      });
    }
    const xml = await res.text();
    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" />', {
      status: 502,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    });
  }
}
