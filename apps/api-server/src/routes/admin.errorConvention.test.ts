/**
 * The admin router's error convention, pinned route by route (M4 step 2).
 *
 * `routes/admin.ts` used to hand-roll a try/catch in all 47 route handlers —
 * the only big router in the API that opted out of `asyncHandler`. Step 2
 * removed those 47 catch blocks. Nothing about the responses was allowed to
 * change with them, and the route inventory cannot prove that: it records which
 * URLs answer, not what they answer WITH.
 *
 * So this test drives every registered route's handler into failure and asserts
 * the exact status and body it produces, against the mapping each route had
 * before the conversion:
 *
 *   legacy        the older routes — `{success:false, error:
 *                 clientErrorMessage(err)}` at 500, EXCEPT for a PublicError
 *                 that states a 4xx statusCode of its own, which keeps it.
 *                 Until #73 this was a flat 500 for EVERYTHING, a PublicError
 *                 included: an admin who sent a bad id or hit a validation
 *                 rule was told the server broke, and monitoring counted it as
 *                 a 5xx. Fixing it is a deliberate edit to this table — every
 *                 route marked `legacy` below now answers 404 rather than 500
 *                 in the PublicError case, and the commit that made the change
 *                 lists them.
 *   moderation    `respondModerationError` — a PublicError keeps its own
 *                 statusCode (or 400), everything else is a 500.
 *   dispute       `PATCH /marketplace/orders/:id/dispute` — the moderation
 *                 rule, reached by TYPE: `resolveDisputeAsAdmin` throws a
 *                 PublicError carrying its own statusCode (404 / 400). It used
 *                 to be picked by substring-matching the message text (#72).
 *   badge         `POST /users/:id/badge` — `err.statusCode` when it is a
 *                 client-side one, else 500.
 *
 * How the failure is induced: the handler is called with a `req` whose every
 * property access throws the error under test, and with `SupabaseService` /
 * `CacheService` stubs that throw too. Whichever the handler touches first, it
 * throws that error — so no handler needs to be special-cased, and a route
 * added later is covered the moment it is registered. `EXPECTED_MAPPING` lists
 * all 47 by name, so a route that stops failing (or starts) is a failing test
 * rather than a silent gap.
 *
 * The bodies asserted here are what the ADMIN CONSOLE reads. They are NOT the
 * global `errorHandler`'s shape (`{error, message, timestamp, path}`) — the
 * router-scoped `adminErrorHandler` exists precisely so admin failures never
 * reach the global one. A test that let them would go green while the console
 * broke.
 */
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/adminAudit', () => ({
  logAdminAction: jest.fn(async () => undefined),
  countPlatformAdmins: jest.fn(async () => 2),
  invalidateBanCache: jest.fn(async () => undefined),
  getUserBlockState: jest.fn(async () => ({ banned: false, suspendedUntil: null })),
}));

import type { Router } from 'express';
import router, { initializeAdminRoutes, adminErrorHandler } from './admin';
import { PublicError } from '../utils/safeError';

type Mapping = 'legacy' | 'moderation' | 'dispute' | 'badge';

/**
 * Every route in the surface and the error mapping it carried before the
 * conversion, read off the pre-M4 file's catch blocks. 47 entries: the route
 * inventory's count, asserted below so the two guards cannot drift apart.
 */
const EXPECTED_MAPPING: Record<string, Mapping> = {
  'GET /ai/provider-probe': 'legacy',
  'GET /stats': 'legacy',
  'GET /users': 'legacy',
  'PATCH /users/:id/status': 'legacy',
  'POST /users/:id/strikes': 'moderation',
  'GET /users/:id/strikes': 'moderation',
  'PATCH /users/:id/role': 'legacy',
  'GET /marketplace/listings': 'legacy',
  'DELETE /marketplace/listings/:id': 'legacy',
  'PATCH /marketplace/listings/:id': 'legacy',
  'GET /learning-connections': 'legacy',
  'GET /marketplace/orders': 'legacy',
  // #113: the read-only reconciliation findings. Registered with `adminRoute`
  // like its marketplace neighbours, so it takes the legacy mapping.
  'GET /marketplace/reconcile/findings': 'legacy',
  'PATCH /marketplace/orders/:id/dispute': 'dispute',
  'GET /reports': 'moderation',
  'PUT /reports/:id': 'moderation',
  'GET /appeals': 'moderation',
  'PUT /marketplace/listings/:id/appeal': 'moderation',
  'GET /analytics': 'legacy',
  'GET /ai-analytics': 'legacy',
  'GET /ai-tokens': 'legacy',
  'GET /events': 'legacy',
  'GET /ai-analytics/users': 'legacy',
  'GET /activity': 'legacy',
  'GET /audit': 'legacy',
  'GET /users/:id': 'legacy',
  'POST /notifications': 'legacy',
  'POST /notifications/bulk': 'legacy',
  'POST /users/:id/points': 'legacy',
  'POST /users/:id/badge': 'badge',
  'GET /groups': 'legacy',
  'PATCH /groups/:id': 'legacy',
  'GET /messages': 'legacy',
  'DELETE /messages/:id': 'legacy',
  'GET /decks': 'legacy',
  'DELETE /decks/:id': 'legacy',
  'GET /offline/summary': 'legacy',
  'POST /ai/quota/reset': 'legacy',
  'GET /ai/companion/:userId': 'legacy',
  'GET /ai/quota/:userId': 'legacy',
  'GET /jobs/postings': 'legacy',
  'PATCH /jobs/postings/:id': 'legacy',
  'DELETE /jobs/postings/:id': 'legacy',
  'GET /jobs/companies': 'legacy',
  'PATCH /jobs/companies/:id/verification': 'legacy',
  'GET /jobs/reports': 'moderation',
  'PATCH /jobs/reports/:id': 'moderation',
  'PATCH /jobs/postings/:id/school-approval': 'legacy',
};

/** The route family each key belongs to, so a failure names the console tab. */
const FAMILIES: Array<[string, RegExp]> = [
  ['dashboard / probe', /^GET \/(stats|ai\/provider-probe)$/],
  ['user administration', /^(GET|PATCH|POST) \/users(\/|$)/],
  ['marketplace moderation', /^(GET|PATCH|DELETE|PUT) \/marketplace\//],
  ['report queue and appeals', /^(GET|PUT) \/(reports|appeals)/],
  ['analytics and audit', /^GET \/(analytics|ai-analytics|ai-tokens|events|activity|audit|learning-connections)/],
  ['direct user tools', /^(POST|GET|PATCH|DELETE) \/(notifications|groups|messages|decks|offline)/],
  ['AI quota and companion', /^(POST|GET) \/ai\/(quota|companion)/],
  ['jobs board', /^(GET|PATCH|DELETE) \/jobs\//],
];

function familyOf(key: string): string {
  for (const [name, re] of FAMILIES) if (re.test(key)) return name;
  return 'unclassified';
}

type RouteEntry = { key: string; handler: Function };

function collectRoutes(r: Router, prefix = ''): RouteEntry[] {
  const out: RouteEntry[] = [];
  for (const layer of (r as any)?.stack ?? []) {
    if (layer.route) {
      const routePath = prefix + layer.route.path;
      const stack = layer.route.stack ?? [];
      const handler = stack[stack.length - 1].handle;
      for (const method of Object.keys(layer.route.methods || {})) {
        if (layer.route.methods[method]) {
          out.push({ key: `${method.toUpperCase()} ${routePath}`, handler });
        }
      }
      continue;
    }
    if (layer.name === 'router' && layer.handle?.stack) {
      out.push(...collectRoutes(layer.handle as Router, prefix));
    }
  }
  return out;
}

/** Everything the handlers reach for, rigged to throw whatever is under test. */
let thrown: unknown = new Error('boom');
const explode = () => {
  throw thrown;
};

beforeAll(() => {
  const service: any = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') return undefined;
        // The admin family is injected with the DATA LAYER now, and the
        // context reads `legacyService` off it at initialization — answer that
        // with the same exploding stand-in rather than throwing during setup.
        if (prop === 'legacyService') return service;
        return explode;
      },
    }
  );
  const cache: any = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') return undefined;
        return explode;
      },
    }
  );
  initializeAdminRoutes(service, cache);
});

/**
 * Run one route's handler the way Express does: `asyncHandler` forwards the
 * rejection to `next`, and `adminErrorHandler` — the router-scoped middleware
 * registered at the bottom of routes/admin.ts — writes the response.
 */
async function driveIntoFailure(handler: Function, err: unknown) {
  thrown = err;
  const req: any = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') return undefined;
        throw err;
      },
    }
  );
  const res: any = { statusCode: 200, body: undefined, locals: {}, headersSent: false };
  res.status = (code: number) => ((res.statusCode = code), res);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('handler never responded')), 5000);
    res.json = (body: unknown) => {
      res.body = body;
      res.headersSent = true;
      clearTimeout(timer);
      resolve();
      return res;
    };
    const next = (e?: unknown) => {
      if (e) adminErrorHandler(e, req, res, () => undefined);
    };
    void handler(req, res, next);
  });
  return res;
}

const routes = collectRoutes(router);

describe('admin router error convention', () => {
  it('covers every registered route, and only registered routes', () => {
    // 47 at the split (M4), plus the one route added since: #113's read-only
    // reconciliation findings. A route added without a line in EXPECTED_MAPPING
    // fails the assertion below, which is the point.
    expect(routes.length).toBe(48);
    expect(routes.map((r) => r.key).sort()).toEqual(Object.keys(EXPECTED_MAPPING).sort());
  });

  it('maps every route family to the responder it had before the conversion', () => {
    // Reading aid rather than an extra assertion: if this ever fails, the table
    // above is out of step with the families the console groups routes into.
    const unclassified = Object.keys(EXPECTED_MAPPING).filter((k) => familyOf(k) === 'unclassified');
    expect(unclassified).toEqual([]);
  });

  describe.each(
    Object.entries(EXPECTED_MAPPING).map(([key, mapping]) => [familyOf(key), key, mapping] as const)
  )('%s — %s', (_family, key, mapping) => {
    const route = () => routes.find((r) => r.key === key)!;

    it('answers a generic failure with the router body shape at 500', async () => {
      const res = await driveIntoFailure(route().handler, new Error('kaboom'));
      expect(res.statusCode).toBe(500);
      // Never the global handler's {error, message, timestamp, path}: the admin
      // console reads {success, error} and nothing else.
      expect(res.body).toEqual({ success: false, error: 'kaboom' });
    });

    it(`lets a PublicError keep the 4xx it states (${mapping})`, async () => {
      const err = Object.assign(new PublicError('Report not found'), { statusCode: 404 });
      const res = await driveIntoFailure(route().handler, err);
      // Every mapping now honours an explicit client-side status. Before #73
      // the `legacy` routes answered 500 here — 37 of the 47.
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ success: false, error: 'Report not found' });
    });
  });

  it('keeps the legacy mapping stricter than the moderation one (#73)', async () => {
    // `GET /users` stands in for the 37 routes on `adminRoute`: only a
    // PublicError that STATES a 4xx is believed. Everything else is still the
    // scrubbed 500, so the fix cannot turn an outage into a client error.
    const handler = routes.find((r) => r.key === 'GET /users')!.handler;

    const stated = await driveIntoFailure(
      handler,
      Object.assign(new PublicError('Role is not assignable'), { statusCode: 400 })
    );
    expect(stated.statusCode).toBe(400);
    expect(stated.body).toEqual({ success: false, error: 'Role is not assignable' });

    // No statusCode: still a 500 here (the moderation mapping would say 400).
    const untyped = await driveIntoFailure(handler, new PublicError('Order is closed'));
    expect(untyped.statusCode).toBe(500);

    // A statusCode on a plain Error is not a client-safe claim.
    const plain = await driveIntoFailure(
      handler,
      Object.assign(new Error('postgrest exploded'), { statusCode: 404 })
    );
    expect(plain.statusCode).toBe(500);

    // A service echoing an upstream 5xx never becomes this response's status.
    const upstream = await driveIntoFailure(
      handler,
      Object.assign(new PublicError('Payments provider unavailable'), { statusCode: 503 })
    );
    expect(upstream.statusCode).toBe(500);
  });

  it('gives the dispute resolver its statuses by error TYPE, not message text', async () => {
    const handler = routes.find((r) => r.key === 'PATCH /marketplace/orders/:id/dispute')!.handler;

    // The two the service raises, with the statuses it stamps on them.
    const notFound = await driveIntoFailure(
      handler,
      Object.assign(new PublicError('Order not found'), { statusCode: 404 })
    );
    expect(notFound.statusCode).toBe(404);
    expect(notFound.body).toEqual({ success: false, error: 'Order not found' });

    const notDisputed = await driveIntoFailure(
      handler,
      Object.assign(new PublicError('Only disputed orders can be resolved by admin'), {
        statusCode: 400,
      })
    );
    expect(notDisputed.statusCode).toBe(400);

    // A PublicError with no status of its own is still the caller's fault.
    const untyped = await driveIntoFailure(handler, new PublicError('Order is closed'));
    expect(untyped.statusCode).toBe(400);

    // A genuine outage stays a 500 with a scrubbed message.
    const other = await driveIntoFailure(handler, new Error('escrow write failed'));
    expect(other.statusCode).toBe(500);
  });

  it('no longer reads the status out of the words in a message', async () => {
    // The regression #72 describes: rewording 'Order not found' downgraded a
    // 404 to a 500. Message text now decides nothing — only the type does.
    const handler = routes.find((r) => r.key === 'PATCH /marketplace/orders/:id/dispute')!.handler;

    const reworded = await driveIntoFailure(
      handler,
      Object.assign(new PublicError('No such order'), { statusCode: 404 })
    );
    expect(reworded.statusCode).toBe(404);

    const soundsLike404 = await driveIntoFailure(handler, new Error('escrow ledger not found'));
    expect(soundsLike404.statusCode).toBe(500);
  });

  it('gives the badge route its own status, and refuses a 5xx from the service', async () => {
    const handler = routes.find((r) => r.key === 'POST /users/:id/badge')!.handler;

    const unknownBadge = await driveIntoFailure(
      handler,
      Object.assign(new PublicError('Unknown badge'), { statusCode: 400 })
    );
    expect(unknownBadge.statusCode).toBe(400);
    expect(unknownBadge.body).toEqual({ success: false, error: 'Unknown badge' });

    // A service-side 5xx must not be echoed back as the service's own status.
    const serverSide = await driveIntoFailure(
      handler,
      Object.assign(new Error('gamification down'), { statusCode: 503 })
    );
    expect(serverSide.statusCode).toBe(500);
  });

  it('forwards to the global handler instead of writing twice once headers are sent', async () => {
    const res: any = { statusCode: 200, headersSent: true, locals: {} };
    res.status = () => {
      throw new Error('must not write to a response that is already out');
    };
    const forwarded: unknown[] = [];
    adminErrorHandler(new Error('late failure'), {} as any, res, (e: unknown) => forwarded.push(e));
    expect(forwarded).toHaveLength(1);
  });

  it('falls back to the flat 500 for an error that reached it without a route mapping', async () => {
    // Belt and braces: a mapping is installed by the route wrapper, so this is
    // the path taken only if a future layer throws before any wrapper ran.
    const res: any = { statusCode: 200, body: undefined, locals: {}, headersSent: false };
    res.status = (code: number) => ((res.statusCode = code), res);
    res.json = (body: unknown) => ((res.body = body), res);
    adminErrorHandler(new Error('early failure'), {} as any, res, () => undefined);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'early failure' });
  });
});
