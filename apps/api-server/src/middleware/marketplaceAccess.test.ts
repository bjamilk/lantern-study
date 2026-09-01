/**
 * Private-pilot marketplace gate: only the allowlisted founder account may
 * reach marketplace routes; /access stays open for both clients to probe;
 * MARKETPLACE_PUBLIC=true reopens everything without a code change.
 */
import {
  isMarketplaceAllowedUser,
  jobsBoardAccessGate,
  marketplaceAccessGate,
  marketplaceIsPublic,
} from './marketplaceAccess';

const FOUNDER = '1e547f81-77c8-437a-8154-c84e8cf2045e';

function fakeRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: unknown) => {
    res.body = payload;
    return res;
  };
  return res;
}

const run = (path: string, userId?: string) => {
  const req: any = { path, user: userId ? { id: userId } : undefined };
  const res = fakeRes();
  let nexted = false;
  marketplaceAccessGate(req, res, () => {
    nexted = true;
  });
  return { nexted, res };
};

describe('marketplace private-pilot gate', () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => {
    process.env.MARKETPLACE_PUBLIC = OLD_ENV.MARKETPLACE_PUBLIC;
    process.env.MARKETPLACE_ALLOWED_USER_IDS = OLD_ENV.MARKETPLACE_ALLOWED_USER_IDS;
    if (OLD_ENV.MARKETPLACE_PUBLIC === undefined) delete process.env.MARKETPLACE_PUBLIC;
    if (OLD_ENV.MARKETPLACE_ALLOWED_USER_IDS === undefined) {
      delete process.env.MARKETPLACE_ALLOWED_USER_IDS;
    }
  });

  it('allows the founder account and nobody else', () => {
    expect(isMarketplaceAllowedUser(FOUNDER)).toBe(true);
    expect(isMarketplaceAllowedUser('someone-else')).toBe(false);
    expect(isMarketplaceAllowedUser(null)).toBe(false);
    expect(isMarketplaceAllowedUser(undefined)).toBe(false);
  });

  it('lets the founder through the gate on any route', () => {
    const { nexted } = run('/listings', FOUNDER);
    expect(nexted).toBe(true);
  });

  it('403s everyone else with the MARKETPLACE_PRIVATE code', () => {
    for (const userId of [undefined, 'stranger-1']) {
      const { nexted, res } = run('/listings', userId);
      expect(nexted).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.body).toMatchObject({ success: false, code: 'MARKETPLACE_PRIVATE' });
    }
  });

  it('keeps the /access probe open for anonymous viewers', () => {
    expect(run('/access').nexted).toBe(true);
    expect(run('/access/').nexted).toBe(true);
  });

  it('keeps reference data open: the institutions list feeds academic setup', () => {
    // GET /marketplace/campuses backs the institution pickers in the
    // academic-profile setup (web + mobile), settings and the jobs create
    // screen — gating it broke "Couldn't load institutions" app-wide.
    expect(run('/campuses').nexted).toBe(true);
    expect(run('/campuses/').nexted).toBe(true);
    expect(run('/campuses', 'stranger-1').nexted).toBe(true);
  });

  it('MARKETPLACE_PUBLIC=true reopens the marketplace for everyone', () => {
    process.env.MARKETPLACE_PUBLIC = 'true';
    expect(marketplaceIsPublic()).toBe(true);
    expect(isMarketplaceAllowedUser('anyone')).toBe(true);
    expect(run('/listings').nexted).toBe(true);
  });

  it('MARKETPLACE_ALLOWED_USER_IDS extends the allowlist', () => {
    process.env.MARKETPLACE_ALLOWED_USER_IDS = ' tester-1 , tester-2 ';
    expect(isMarketplaceAllowedUser('tester-1')).toBe(true);
    expect(isMarketplaceAllowedUser('tester-2')).toBe(true);
    expect(isMarketplaceAllowedUser('tester-3')).toBe(false);
  });
});

describe('jobsBoardAccessGate', () => {
  it('lets the allowlisted account through', () => {
    const res = fakeRes();
    let passed = false;
    jobsBoardAccessGate({ path: '/postings', user: { id: FOUNDER } } as any, res, () => {
      passed = true;
    });
    expect(passed).toBe(true);
    expect(res.statusCode).toBe(0);
  });

  it('refuses everyone else, including anonymous browsers', () => {
    for (const user of [undefined, { id: 'someone-else' }]) {
      const res = fakeRes();
      let passed = false;
      jobsBoardAccessGate({ path: '/postings', user } as any, res, () => {
        passed = true;
      });
      expect(passed).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.body).toMatchObject({ code: 'JOBS_PRIVATE' });
    }
  });

  it('exempts nothing — the jobs board serves no shared reference data', () => {
    // The marketplace has to keep /campuses open because the academic-profile
    // institution picker reads it. The jobs board has no such route, so an
    // exemption here would be a hole rather than a fix.
    for (const path of ['/postings', '/postings/abc', '/access', '/campuses']) {
      const res = fakeRes();
      jobsBoardAccessGate({ path, user: { id: 'someone-else' } } as any, res, () => {});
      expect(res.statusCode).toBe(403);
    }
  });

  it('reopens with MARKETPLACE_PUBLIC, like the marketplace', () => {
    const prev = process.env.MARKETPLACE_PUBLIC;
    process.env.MARKETPLACE_PUBLIC = 'true';
    try {
      expect(marketplaceIsPublic()).toBe(true);
      const res = fakeRes();
      let passed = false;
      jobsBoardAccessGate({ path: '/postings', user: undefined } as any, res, () => {
        passed = true;
      });
      expect(passed).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MARKETPLACE_PUBLIC;
      else process.env.MARKETPLACE_PUBLIC = prev;
    }
  });

  it('is mounted on the jobs-board router, never on a /api/v1/jobs prefix', () => {
    // /api/v1/jobs is the async job-queue status endpoint that note import, AI
    // and the companion poll. A prefix-based gate would catch it and break
    // uploads app-wide, so this asserts the mount stays router-scoped.
    const server = require('fs').readFileSync(
      require('path').join(__dirname, '../server.ts'),
      'utf8',
    );
    expect(server).toContain(
      "app.use('/api/v1/jobs-board', optionalAuthMiddleware, jobsBoardAccessGate",
    );
    expect(server).toContain("app.use('/api/v1/jobs', jobsRoutes);");
    expect(server).not.toContain("app.use('/api/v1/jobs', optionalAuthMiddleware, jobsBoardAccessGate");
  });
});
