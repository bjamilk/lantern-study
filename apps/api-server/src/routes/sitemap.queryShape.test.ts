/**
 * Query shapes AND responses for `routes/sitemap.ts` (lane R2, PR 2b).
 *
 * The three sitemaps built four PostgREST chains inline across three
 * `dataLayer.getClient()` escapes, and had NO test suite. Lane R2 moves them
 * into `services/data/sitemap.ts`.
 *
 * Written and committed against the UNTOUCHED routes, so it freezes what they
 * did rather than describing what the extraction produced. Each case pins both
 * the trace and what a crawler receives — status, `Content-Type`, and whether
 * the body is a urlset or the error stub.
 *
 * ## These filters ARE the visibility rule
 *
 * Nothing here is owner-scoped: a sitemap is public by definition. What keeps it
 * honest is the opposite predicate — which rows may be PUBLISHED. The API runs
 * as the service role and bypasses RLS, so `eq("active", true)`,
 * `neq("kind", "other")`, `eq("status", "active")`,
 * `eq("verification_status", "verified")` and the two country filters are the
 * only thing standing between a draft, a withdrawn posting or an unverified
 * company and Google's index. Each is asserted literally.
 *
 * The `limit(5000)` / `limit(2000)` caps matter too: a sitemap has a size
 * ceiling, and dropping the cap turns a page into a full table read.
 */
jest.mock('@lantern/shared/marketplace', () => ({ MARKETPLACE_DEFAULT_COUNTRY: 'NG' }));
jest.mock('@lantern/shared/jobs', () => ({ JOBS_DEFAULT_COUNTRY: 'NG' }));

import router, { initializeSitemapRoutes } from './sitemap';
import { createQueryRecorder, runRouteHandler, bindDataModule, type QueryResult, type ResolveResult } from '../testSupport/queryRecorder';
import * as sitemapData from '../services/data/sitemap';

const emptyCache = () => ({ get: jest.fn(async () => null), set: jest.fn(async () => {}) });

/**
 * The namespace is the REAL data module bound to the recording client, exactly
 * the way `data/index.ts` binds it to the live one: the route calls
 * `dataLayer.<ns>.<fn>(…)`, the real module builds the chain, the recorder
 * captures it. The trace is still the query the database would see, end to end.
 */
function initWith(resolve?: ResolveResult) {
  const rec = createQueryRecorder(resolve);
  initializeSitemapRoutes(
    { getClient: () => rec.client, sitemap: bindDataModule(sitemapData, rec.client) } as any,
    emptyCache() as any,
  );
  return rec;
}

const ok = (data: unknown): QueryResult => ({ data, error: null });
const failed: QueryResult = { data: null, error: { code: '42P01', message: 'no relation' } };

describe('GET /campuses.xml', () => {
  it('lists active, non-other campuses by name, capped at 5000', async () => {
    const rec = initWith(ok([{ slug: 'unilag' }, { slug: 'ui' }]));

    const res = await runRouteHandler(router, 'get', '/campuses.xml', {});

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/xml; charset=utf-8');
    expect(res.sent).toContain('https://lanternstudy.com/campus/unilag');
    expect(res.sent).toContain('https://lanternstudy.com/campus/ui');

    expect(rec.trace).toEqual([
      'from("marketplace_campuses")',
      'select("slug")',
      'eq("active", true)',
      'neq("kind", "other")',
      'order("name", {"ascending":true})',
      'limit(5000)',
    ]);
  });

  it('answers 500 with the error stub when the read fails', async () => {
    initWith(failed);

    const res = await runRouteHandler(router, 'get', '/campuses.xml', {});

    expect(res.statusCode).toBe(500);
    expect(res.sent).toBe('<?xml version="1.0" encoding="UTF-8"?><error />');
  });
});

describe('GET /marketplace.xml', () => {
  it('lists active listings in the default country, newest first, capped at 5000', async () => {
    const rec = initWith(ok([{ id: 'l1', updated_at: '2026-09-01T00:00:00.000Z' }]));

    const res = await runRouteHandler(router, 'get', '/marketplace.xml', {});

    expect(res.statusCode).toBe(200);
    expect(res.sent).toContain('https://lanternstudy.com/marketplace/listing/l1');
    expect(res.sent).toContain('<lastmod>2026-09-01</lastmod>');
    // The section landing page is always published, listings or not.
    expect(res.sent).toContain('<loc>https://lanternstudy.com/marketplace</loc>');

    expect(rec.trace).toEqual([
      'from("marketplace_listings")',
      'select("id, updated_at")',
      'eq("status", "active")',
      'eq("country_code", "NG")',
      'order("updated_at", {"ascending":false})',
      'limit(5000)',
    ]);
  });

  it('answers 500 with the error stub when the read fails', async () => {
    initWith(failed);

    const res = await runRouteHandler(router, 'get', '/marketplace.xml', {});

    expect(res.statusCode).toBe(500);
    expect(res.sent).toBe('<?xml version="1.0" encoding="UTF-8"?><error />');
  });
});

describe('GET /jobs.xml', () => {
  const byTable = (table: string) =>
    table === 'job_postings' ? ok([{ id: 'j1', updated_at: null }]) : ok([{ id: 'c1', updated_at: null }]);

  it('reads active postings and VERIFIED companies, each chain built in full', async () => {
    const rec = initWith(byTable);

    const res = await runRouteHandler(router, 'get', '/jobs.xml', {});

    expect(res.statusCode).toBe(200);
    expect(res.sent).toContain('https://lanternstudy.com/marketplace/jobs/j1');

    // Both are awaited together, but the array literal builds each chain in
    // full before the next, so the trace is sequential.
    expect(rec.trace).toEqual([
      'from("job_postings")',
      'select("id, updated_at")',
      'eq("status", "active")',
      'eq("country_code", "NG")',
      'order("updated_at", {"ascending":false})',
      'limit(5000)',
      'from("job_companies")',
      'select("id, updated_at")',
      // Unverified companies must never reach the index.
      'eq("verification_status", "verified")',
      'order("updated_at", {"ascending":false})',
      'limit(2000)',
    ]);
  });

  it('answers 500 when EITHER read fails', async () => {
    initWith((table) => (table === 'job_companies' ? failed : ok([])));

    const res = await runRouteHandler(router, 'get', '/jobs.xml', {});

    expect(res.statusCode).toBe(500);
    expect(res.sent).toBe('<?xml version="1.0" encoding="UTF-8"?><error />');
  });
});
