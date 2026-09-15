/**
 * The CSRF middleware used to wave through any mutating request that carried no
 * auth cookie yet — which is exactly the shape of a login-CSRF / session-fixation
 * attack against /auth/login and /auth/exchange, since the global urlencoded
 * parser makes a plain cross-site <form> POST a valid request body.
 */
import { Request, Response } from 'express';
import { csrfProtectionMiddleware, CSRF_REQUEST_VALUE } from './csrf';

const ALLOWED = 'https://lanternstudy.com';

function run(overrides: Partial<Request> & { cookies?: Record<string, string> }) {
  const req = {
    method: 'POST',
    path: '/api/v1/notes',
    headers: {},
    cookies: {},
    ...overrides,
  } as unknown as Request;

  let status = 200;
  let body: any = null;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;

  let nextCalled = false;
  csrfProtectionMiddleware(req, res, () => {
    nextCalled = true;
  });
  return { status, body, nextCalled };
}

describe('csrfProtectionMiddleware — session routes', () => {
  beforeEach(() => {
    process.env.ALLOWED_ORIGINS = ALLOWED;
  });
  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  it('rejects POST /auth/login with no CSRF header even though no cookie is present', () => {
    const r = run({ path: '/api/v1/auth/login' });
    expect(r.nextCalled).toBe(false);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CSRF_VALIDATION_FAILED');
  });

  it.each(['/api/v1/auth/exchange', '/api/v1/auth/refresh', '/api/v1/auth/logout'])(
    'rejects %s with no CSRF header',
    (path) => {
      expect(run({ path }).status).toBe(403);
    }
  );

  it('allows POST /auth/login with the header from an allowlisted origin', () => {
    const r = run({
      path: '/api/v1/auth/login',
      headers: { 'x-requested-with': CSRF_REQUEST_VALUE, origin: ALLOWED },
    });
    expect(r.nextCalled).toBe(true);
  });

  it('rejects a session route from an unlisted origin even with the header', () => {
    const r = run({
      path: '/api/v1/auth/login',
      headers: { 'x-requested-with': CSRF_REQUEST_VALUE, origin: 'https://evil.example' },
    });
    expect(r.status).toBe(403);
  });

  it('rejects an opaque (sandboxed-iframe) Origin: null on a session route', () => {
    const r = run({
      path: '/api/v1/auth/login',
      headers: { 'x-requested-with': CSRF_REQUEST_VALUE, origin: 'null' },
    });
    expect(r.status).toBe(403);
  });
});

describe('csrfProtectionMiddleware — cookie-authenticated mutations', () => {
  beforeEach(() => {
    process.env.ALLOWED_ORIGINS = ALLOWED;
  });
  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  it('still rejects a cookie mutation with no header', () => {
    expect(run({ cookies: { lantern_access: 'tok' } }).status).toBe(403);
  });

  it('rejects a cookie mutation whose Referer is off-allowlist', () => {
    const r = run({
      cookies: { lantern_access: 'tok' },
      headers: { 'x-requested-with': CSRF_REQUEST_VALUE, referer: 'https://evil.example/x' },
    });
    expect(r.status).toBe(403);
  });

  it('accepts a cookie mutation with header + allowlisted origin', () => {
    const r = run({
      cookies: { lantern_access: 'tok' },
      headers: { 'x-requested-with': CSRF_REQUEST_VALUE, origin: ALLOWED },
    });
    expect(r.nextCalled).toBe(true);
  });

  it('does NOT let an Authorization header bypass the check when a cookie also rode along', () => {
    const r = run({
      cookies: { lantern_access: 'tok' },
      headers: { authorization: 'Bearer x' },
    });
    expect(r.status).toBe(403);
  });

  it('allows a pure bearer mutation (cross-site cannot set that header without a preflight)', () => {
    expect(run({ headers: { authorization: 'Bearer x' } }).nextCalled).toBe(true);
  });

  it('leaves unauthenticated non-session mutations alone', () => {
    expect(run({}).nextCalled).toBe(true);
  });

  it('never touches GET', () => {
    expect(run({ method: 'GET', cookies: { lantern_access: 'tok' } }).nextCalled).toBe(true);
  });
});

describe('csrfProtectionMiddleware — bearer-only session routes', () => {
  it('lets the mobile bearer-only POST /auth/logout through (no cookie, no forgeable header)', () => {
    const r = run({ path: '/api/v1/auth/logout', headers: { authorization: 'Bearer x' } });
    expect(r.nextCalled).toBe(true);
  });

  it('but a cookie-bearing /auth/logout still needs the header', () => {
    const r = run({
      path: '/api/v1/auth/logout',
      cookies: { lantern_access: 'tok' },
      headers: { authorization: 'Bearer x' },
    });
    expect(r.status).toBe(403);
  });
});

/**
 * F10. The non-cookie-credential bypass used to be unconditional: any non-empty
 * `Authorization` / `x-api-key` skipped the whole check. It was safe only
 * because a browser cannot attach either header cross-site without a preflight
 * the CORS allowlist rejects — a property asserted in a comment and enforced
 * nowhere. The bypass now checks the origin itself, so it no longer depends on
 * the CORS layer staying exactly as strict as it is today.
 */
describe('csrfProtectionMiddleware — the non-cookie-credential bypass checks the origin', () => {
  beforeEach(() => {
    process.env.ALLOWED_ORIGINS = ALLOWED;
  });
  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  it('rejects a bearer mutation carrying an off-allowlist Origin', () => {
    const r = run({
      headers: { authorization: 'Bearer x', origin: 'https://evil.example' },
    });
    expect(r.nextCalled).toBe(false);
    expect(r.status).toBe(403);
  });

  it('rejects a bearer mutation carrying an off-allowlist Referer', () => {
    const r = run({
      headers: { authorization: 'Bearer x', referer: 'https://evil.example/page' },
    });
    expect(r.status).toBe(403);
  });

  it('rejects an x-api-key mutation from an off-allowlist origin', () => {
    const r = run({
      headers: { 'x-api-key': 'lantern_live_x', origin: 'https://evil.example' },
    });
    expect(r.status).toBe(403);
  });

  it('rejects a bearer mutation on a SESSION route from an off-allowlist origin', () => {
    const r = run({
      path: '/api/v1/auth/logout',
      headers: { authorization: 'Bearer x', origin: 'https://evil.example' },
    });
    expect(r.status).toBe(403);
  });

  it('still allows a bearer mutation from the real web app', () => {
    const r = run({ headers: { authorization: 'Bearer x', origin: ALLOWED } });
    expect(r.nextCalled).toBe(true);
  });

  it('still allows a non-browser bearer caller, which sends no Origin at all', () => {
    // The mobile client and server-to-server API-key callers live here.
    expect(run({ headers: { authorization: 'Bearer x' } }).nextCalled).toBe(true);
    expect(run({ headers: { 'x-api-key': 'lantern_live_x' } }).nextCalled).toBe(true);
    expect(
      run({ path: '/api/v1/auth/logout', headers: { authorization: 'Bearer x' } }).nextCalled
    ).toBe(true);
  });
});
