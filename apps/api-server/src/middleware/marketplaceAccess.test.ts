/**
 * Private-pilot marketplace gate: only the allowlisted founder account may
 * reach marketplace routes; /access stays open for both clients to probe;
 * MARKETPLACE_PUBLIC=true reopens everything without a code change.
 */
import {
  isMarketplaceAllowedUser,
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
