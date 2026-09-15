import { getAllowedCorsOrigins, isOriginAllowed, decideCorsOrigin, isCookieSettingPath } from './corsOrigins';

describe('corsOrigins', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('allows canonical production web origins in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FRONTEND_URL;
    delete process.env.WEB_APP_URL;

    expect(isOriginAllowed('https://lanternstudy.com')).toBe(true);
    expect(isOriginAllowed('https://www.lanternstudy.com')).toBe(true);
    expect(isOriginAllowed('https://lantern-study.pages.dev')).toBe(true);
    expect(isOriginAllowed('https://evil.example.com')).toBe(false);
  });

  it('merges env and ALLOWED_ORIGINS', () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://preview.example.com';
    process.env.ALLOWED_ORIGINS = 'https://extra.example.com';

    const origins = getAllowedCorsOrigins();
    expect(origins).toContain('https://lanternstudy.com');
    expect(origins).toContain('https://preview.example.com');
    expect(origins).toContain('https://extra.example.com');
  });
});

describe('decideCorsOrigin — a missing Origin is not a free pass', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevAllowed = process.env.ALLOWED_ORIGINS;

  beforeEach(() => {
    process.env.ALLOWED_ORIGINS = 'https://lanternstudy.com';
  });
  afterEach(() => {
    process.env.NODE_ENV = prevEnv;
    if (prevAllowed === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = prevAllowed;
    delete process.env.ALLOW_ALL_CORS;
  });

  const base = {
    origin: undefined as string | undefined,
    hasNonCookieCredential: false,
    hasAuthCookie: false,
    isCookieSetting: false,
  };

  it('refuses credentialed access to a cookie-bearing request with no Origin', () => {
    expect(decideCorsOrigin({ ...base, hasAuthCookie: true })).toBe(false);
  });

  it('refuses a no-Origin request to a cookie-SETTING path even with a bearer token', () => {
    expect(
      decideCorsOrigin({ ...base, hasNonCookieCredential: true, isCookieSetting: true })
    ).toBe(false);
  });

  it('allows a no-Origin request carrying only a non-cookie credential', () => {
    expect(decideCorsOrigin({ ...base, hasNonCookieCredential: true })).toBe(true);
  });

  it('emits no CORS headers for a bare no-Origin, no-credential request', () => {
    expect(decideCorsOrigin(base)).toBe(false);
  });

  it('still allows an allowlisted origin and refuses an unlisted one', () => {
    expect(decideCorsOrigin({ ...base, origin: 'https://lanternstudy.com' })).toBe(true);
    expect(decideCorsOrigin({ ...base, origin: 'https://evil.example' })).toBe(false);
  });
});

describe('isCookieSettingPath', () => {
  it.each([
    '/api/v1/auth/login',
    '/api/v1/auth/exchange',
    '/api/v1/auth/refresh',
    '/api/v1/auth/logout',
    '/api/v1/auth/session',
    '/api/v1/auth/login/',
    '/api/v1/auth/login?next=/x',
  ])('flags %s', (p) => {
    expect(isCookieSettingPath(p)).toBe(true);
  });

  it('does not flag ordinary routes', () => {
    expect(isCookieSettingPath('/api/v1/notes')).toBe(false);
  });
});
