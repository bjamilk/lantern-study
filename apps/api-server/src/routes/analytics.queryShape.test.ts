/**
 * Query shape AND responses for the product-events write (lane R2, PR 2b).
 *
 * `routes/analytics.ts` held one inline chain and had no test suite. Lane R2
 * moves it into `services/data/productEvents.ts`.
 *
 * Written and committed against the UNTOUCHED route.
 *
 * ## Issue #108: this write DOES read its error
 *
 * supabase-js resolves with `{error}` on a failed write rather than throwing, and
 * 87 sites in the API drop it. This is not one of them: the route destructures
 * `{ error }` and answers 500. The case below pins that, so the behaviour cannot
 * quietly regress into the bare-await shape while the query moves.
 */
jest.mock('../middleware/auth', () => ({
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import router, { initializeAnalyticsRoutes } from './analytics';
import { createQueryRecorder, runRouteHandler, type ResolveResult } from '../testSupport/queryRecorder';

function initWith(resolve?: ResolveResult) {
  const rec = createQueryRecorder(resolve);
  initializeAnalyticsRoutes({ getClient: () => rec.client } as any);
  return rec;
}

const EVENTS = [{ event: 'page_view', surface: 'web' }];

describe('POST /analytics/events', () => {
  it('inserts the accepted batch and reports how many it took', async () => {
    const rec = initWith({ data: null, error: null });

    const res = await runRouteHandler(router, 'post', '/events', {
      body: { events: EVENTS },
      user: { id: 'user-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, accepted: 1 });

    expect(rec.trace[0]).toBe('from("product_events")');
    expect(rec.trace[1]).toMatch(/^insert\(\[/);
    const rows = JSON.parse(rec.trace[1].slice('insert('.length, -1));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: 'user-1', event: 'page_view', surface: 'web' });
  });

  it('answers 500 when the insert fails — the error is READ, not discarded (#108)', async () => {
    const rec = initWith({ data: null, error: { code: '42P01', message: 'no relation' } });

    const res = await runRouteHandler(router, 'post', '/events', {
      body: { events: EVENTS },
      user: { id: 'user-1' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to record events.' });
    expect(rec.tables()).toEqual(['from("product_events")']);
  });

  it('rejects an empty batch with 400 before touching the database', async () => {
    const rec = initWith();

    const res = await runRouteHandler(router, 'post', '/events', {
      body: { events: [] },
      user: { id: 'user-1' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'events array is required.' });
    expect(rec.tables()).toEqual([]);
  });

  it('writes nothing when every event in a non-empty batch is filtered out', async () => {
    const rec = initWith();

    const res = await runRouteHandler(router, 'post', '/events', {
      // Not on the shared allowlist, so the loop drops it and no row is built.
      body: { events: [{ event: 'not_a_real_event' }] },
      user: { id: 'user-1' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'No valid events in batch.' });
    expect(rec.tables()).toEqual([]);
  });

  it('drops a guest event with no anon id, rather than writing a row with none', async () => {
    const rec = initWith();

    const res = await runRouteHandler(router, 'post', '/events', {
      body: { events: [{ event: 'page_view' }] },
      user: undefined,
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'No valid events in batch.' });
    expect(rec.tables()).toEqual([]);
  });
});
