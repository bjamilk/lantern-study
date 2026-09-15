/**
 * Campus and the Marketplace are open to every student (V1, 2026-09-15).
 *
 * This replaces `middleware/marketplaceAccess.test.ts`, which pinned the
 * opposite: a founder-only allowlist in front of /api/v1/marketplace and
 * /api/v1/jobs-board that answered 403 MARKETPLACE_PRIVATE / JOBS_PRIVATE to
 * everyone else. The gate is gone, and these assertions exist so it cannot
 * quietly come back — a browse that works only for one account is invisible in
 * a diff and obvious only to the students who cannot see the shop.
 *
 * What it pins:
 *   1. No access-gate module exists, and neither commerce mount in server.ts
 *      references one. Asserted against the SOURCE, because the mount chain is
 *      the thing that used to 403 and it is built at boot, not at import.
 *   2. GET /marketplace/access answers `enabled: true` for a signed-out
 *      viewer and for any signed-in student. Shipped mobile builds up to
 *      1.0.60 probe it and wall off every commerce screen without a true
 *      answer, so this is what opens an installed app with no update.
 *   3. The admin mount is UNCHANGED: /api/v1/admin still stacks
 *      authMiddleware + requirePlatformAdmin, so moderation and the admin
 *      console stay admin-only.
 */
import fs from 'fs';
import path from 'path';
import router, { initializeMarketplaceRoutes } from './marketplace';
import { routeLayers } from './marketplace/routeLayers';

const SERVER_SRC = fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');

function handlerFor(routePath: string, method = 'get') {
  const layer = routeLayers(router).find(
    (l: any) => l.route?.path === routePath && l.route?.methods?.[method]
  );
  if (!layer) throw new Error(`No ${method.toUpperCase()} ${routePath} route registered`);
  const stack = (layer as any).route.stack;
  return stack[stack.length - 1].handle;
}

function fakeRes() {
  const out: any = { statusCode: 200, body: undefined };
  out.status = (code: number) => {
    out.statusCode = code;
    return out;
  };
  out.set = () => out;
  out.json = (body: unknown) => {
    out.body = body;
    return out;
  };
  return out;
}

/** asyncHandler swallows its promise, so drain the queue rather than await it. */
async function invoke(handler: any, req: any, res: any) {
  let failure: unknown;
  handler(req, res, (err?: unknown) => {
    if (err) failure = err;
  });
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (failure) throw failure;
}

beforeAll(() => {
  initializeMarketplaceRoutes(
    { getClient: () => ({ from: () => ({}) }) } as any,
    {
      get: jest.fn(async () => null),
      set: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
      deletePattern: jest.fn(async () => undefined),
    } as any
  );
});

describe('the private-pilot allowlist is gone', () => {
  it('has no access-gate middleware module left to mount', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'middleware', 'marketplaceAccess.ts'))).toBe(
      false
    );
    expect(SERVER_SRC).not.toContain('marketplaceAccessGate');
    expect(SERVER_SRC).not.toContain('jobsBoardAccessGate');
  });

  it('mounts /api/v1/marketplace with no membership gate in the chain', () => {
    const mount = SERVER_SRC.split('\n').find((line) =>
      line.includes("app.use('/api/v1/marketplace'")
    );
    expect(mount).toBeDefined();
    // optionalAuthMiddleware populates req.user when a credential is present;
    // it never refuses. Geo and rate limits shape the response, not who may ask.
    expect(mount).toContain('optionalAuthMiddleware');
    expect(mount).not.toMatch(/Gate|Allowlist|requirePlatformAdmin/);
  });

  it('mounts /api/v1/jobs-board with no membership gate in the chain', () => {
    const mount = SERVER_SRC.split('\n').find((line) =>
      line.includes("app.use('/api/v1/jobs-board'")
    );
    expect(mount).toBeDefined();
    expect(mount).toContain('optionalAuthMiddleware');
    expect(mount).not.toMatch(/Gate|Allowlist|requirePlatformAdmin/);
  });

  it('reads no MARKETPLACE_PUBLIC / MARKETPLACE_ALLOWED_USER_IDS flag anywhere in the API', () => {
    // A flag that must be set correctly before students can see the shop is
    // the same outage with an extra step, so the pilot env vars are not
    // "defaulted on" — nothing reads them at all.
    const src = path.join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts') && !full.endsWith('marketplace.openAccess.test.ts')) {
          const text = fs.readFileSync(full, 'utf8');
          if (text.includes('MARKETPLACE_PUBLIC') || text.includes('MARKETPLACE_ALLOWED_USER_IDS')) {
            offenders.push(path.relative(src, full));
          }
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});

describe('GET /marketplace/access', () => {
  it('answers enabled:true to a signed-out viewer', async () => {
    const res = fakeRes();
    await invoke(handlerFor('/access'), { user: undefined, query: {} }, res);
    expect(res.body).toEqual({
      success: true,
      data: { enabled: true, authenticated: false },
    });
  });

  it('answers enabled:true to an ordinary signed-in student, not just the founder', async () => {
    const res = fakeRes();
    await invoke(
      handlerFor('/access'),
      { user: { id: 'a-plain-student-uuid' }, query: {} },
      res
    );
    expect(res.body).toEqual({
      success: true,
      data: { enabled: true, authenticated: true },
    });
  });

  it('does not depend on WHICH account is asking', async () => {
    const answers = await Promise.all(
      [undefined, { id: 'student-1' }, { id: 'student-2' }, { id: '1e547f81-77c8-437a-8154-c84e8cf2045e' }].map(
        async (user) => {
          const res = fakeRes();
          await invoke(handlerFor('/access'), { user, query: {} }, res);
          return res.body.data.enabled;
        }
      )
    );
    expect(answers).toEqual([true, true, true, true]);
  });
});

describe('admin-only surfaces are untouched', () => {
  it('still stacks authMiddleware + requirePlatformAdmin on /api/v1/admin', () => {
    const mount = SERVER_SRC.split('\n').find((line) => line.includes("app.use('/api/v1/admin'"));
    expect(mount).toBeDefined();
    expect(mount).toContain('authMiddleware');
    expect(mount).toContain('requirePlatformAdmin');
  });
});
