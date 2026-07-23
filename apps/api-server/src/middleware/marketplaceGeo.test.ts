import { marketplaceGeoMiddleware } from './marketplaceGeo';

function run(
  overrides: {
    method?: string;
    path?: string;
    originalUrl?: string;
    user?: { id: string; settings?: unknown } | null;
    cfIpCountry?: string;
    query?: Record<string, string>;
  } = {}
) {
  const req = {
    method: overrides.method || 'POST',
    baseUrl: '/api/v1/marketplace',
    path: overrides.path || '/upload-image',
    originalUrl: overrides.originalUrl || `/api/v1/marketplace${overrides.path || '/upload-image'}`,
    query: overrides.query || {},
    headers: overrides.cfIpCountry ? { 'cf-ipcountry': overrides.cfIpCountry } : {},
    user: overrides.user === null ? undefined : overrides.user || { id: 'user-1' },
  } as any;

  let statusCode = 200;
  let body: any = null;
  let nextCalled = false;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      body = payload;
      return this;
    },
  } as any;

  marketplaceGeoMiddleware(req, res, () => {
    nextCalled = true;
  });

  return { statusCode, body, nextCalled, query: req.query };
}

describe('marketplaceGeoMiddleware', () => {
  it('defaults GET country_code to NG', () => {
    const result = run({ method: 'GET', path: '/listings', user: null });
    expect(result.nextCalled).toBe(true);
    expect(result.query.country_code).toBe('NG');
  });

  it('leaves mutation authentication to route middleware', () => {
    const result = run({ user: null, path: '/upload-image', cfIpCountry: 'NG' });
    expect(result.nextCalled).toBe(true);
    expect(result.statusCode).toBe(200);
  });

  it('allows listing photo upload from outside NG', () => {
    const result = run({ path: '/upload-image', cfIpCountry: 'US' });
    expect(result.nextCalled).toBe(true);
    expect(result.statusCode).toBe(200);
  });

  it('allows listing create from outside NG', () => {
    const result = run({ path: '/listings', cfIpCountry: 'CA' });
    expect(result.nextCalled).toBe(true);
  });

  it('allows buy-now from outside NG', () => {
    const result = run({
      path: '/listings/abc/buy-now',
      originalUrl: '/api/v1/marketplace/listings/abc/buy-now',
      cfIpCountry: 'US',
    });
    expect(result.nextCalled).toBe(true);
    expect(result.statusCode).toBe(200);
  });

  it('allows buy-now from NG', () => {
    const result = run({
      path: '/listings/abc/buy-now',
      originalUrl: '/api/v1/marketplace/listings/abc/buy-now',
      cfIpCountry: 'NG',
    });
    expect(result.nextCalled).toBe(true);
  });

  it('does not use Tor/VPN markers as a transaction gate', () => {
    const result = run({
      path: '/offers',
      originalUrl: '/api/v1/marketplace/offers',
      cfIpCountry: 'T1',
    });
    expect(result.nextCalled).toBe(true);
  });
});
