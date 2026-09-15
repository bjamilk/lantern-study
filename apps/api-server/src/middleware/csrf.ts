/**
 * CSRF protection for cookie-authenticated mutations.
 *
 * Exports `csrfProtectionMiddleware`, mounted globally in server.ts right after
 * `cookieParser` and before every route, plus `CSRF_REQUEST_HEADER` /
 * `CSRF_REQUEST_VALUE` for the web and mobile clients to send.
 *
 * The model is header + origin, not a token: a mutating request that carries
 * ambient cookie authority must send `X-Requested-With: LanternStudy` AND an
 * Origin (or Referer origin) on the CORS allowlist. A cross-site form POST can
 * set neither; setting the custom header forces a preflight the allowlist
 * rejects.
 *
 * What it touches: the auth cookies via `utils/authCookies`, the allowlist via
 * `utils/corsOrigins` (the same list the CORS delegate uses).
 *
 * This matters because the auth cookies are `SameSite=None` in production — a
 * deliberate choice so the web app on Pages can talk to the API on Render — so
 * the browser does attach them to cross-site requests and SameSite provides no
 * protection here.
 */
import { Request, Response, NextFunction } from 'express';
import { readAccessCookie, readRefreshCookie } from '../utils/authCookies';
import { hasAuthCredential } from './rateLimit';
import { getAllowedCorsOrigins } from '../utils/corsOrigins';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// KNOWN ISSUE (tracked, deferred F10: product decision — a per-session token
// needs a mint-and-rotate endpoint plus a change to every client's fetch layer
// (web BFF interceptor, mobile, and any API-key caller), which is a
// cross-client release, not a middleware edit): one static, public header value
// for every user — there is no per-session CSRF token, so the header proves
// only "a preflight was survived", never "this request came from this session".
// The origin check below is what carries the real weight; on its own the header
// is not a secret. F10 narrowed the gap it was covering — the non-cookie
// credential bypass now checks the origin too — so the header is no longer the
// only thing standing between a bearer-bearing browser request and the handler.
const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'LanternStudy';

function hasAuthCookie(req: Request): boolean {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (!cookies) return false;
  return !!(readAccessCookie(cookies) || readRefreshCookie(cookies));
}

/**
 * Session-establishing routes. These set auth cookies from an unauthenticated
 * request, so the old "no credential yet → skip the CSRF check" shortcut made
 * them login-CSRF / session-fixation targets: an attacker page could POST
 * urlencoded credentials and plant its own session in the victim's browser.
 * The custom header is required here unconditionally — a cross-site form POST
 * cannot set one, and adding it forces a preflight the allowlist rejects.
 */
function isSessionRoute(req: Request): boolean {
  const path = (req.path || '').replace(/\/+$/, '') || '/';
  return (
    path.endsWith('/auth/login') ||
    path.endsWith('/auth/exchange') ||
    path.endsWith('/auth/refresh') ||
    path.endsWith('/auth/logout')
  );
}

function headerOk(req: Request): boolean {
  const header = req.headers[CSRF_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return value === CSRF_VALUE;
}

function firstHeader(req: Request, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Second factor for cookie-authenticated mutations: the request's Origin (or the
 * origin of its Referer) must be on the CORS allowlist. Requests with neither
 * header are left to the header check alone — non-browser clients omit both,
 * and browsers always send at least one on a cross-site mutation.
 */
function originOk(req: Request): boolean {
  const origin = firstHeader(req, 'origin');
  if (origin && origin !== 'null') {
    return getAllowedCorsOrigins().includes(origin);
  }
  if (origin === 'null') return false;

  const referer = firstHeader(req, 'referer');
  if (!referer) return true;
  try {
    return getAllowedCorsOrigins().includes(new URL(referer).origin);
  } catch {
    return false;
  }
}

function reject(res: Response): void {
  res.status(403).json({
    success: false,
    error: 'Forbidden',
    message: 'Missing or invalid CSRF protection header.',
    code: 'CSRF_VALIDATION_FAILED',
  });
}

/** Require a custom header on cookie-authenticated mutating requests (CSRF mitigation). */
export function csrfProtectionMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING.has(req.method)) {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'];
  const authHeader = req.headers.authorization;
  const hasNonCookieCredential =
    (typeof apiKey === 'string' && apiKey.trim().length > 0) ||
    (typeof authHeader === 'string' && authHeader.trim().length > 0);

  // A non-cookie credential is only a valid bypass when no cookie rode along.
  // A browser cannot attach Authorization / X-API-Key cross-site without a
  // preflight, so its presence (absent ambient cookie authority) rules out CSRF
  // — including on the session routes, which is what keeps the mobile client's
  // bearer-only POST /auth/logout working.
  // FIXED (F10): the bypass still cannot VALIDATE the credential — the token is
  // verified by `authMiddleware`, which runs after this and would have to be
  // duplicated here on every mutation — but it no longer rests entirely on the
  // preflight. When the request carries an Origin or Referer, that origin must
  // now be on the CORS allowlist before the bypass applies, so the property the
  // old comment could only assert ("a browser cannot get here cross-site") is
  // checked directly. Non-browser callers — the mobile client's bearer-only
  // POST /auth/logout, server-to-server API keys — send neither header and are
  // unaffected; `originOk` returns true for them.
  if (hasNonCookieCredential && !hasAuthCookie(req) && originOk(req)) {
    next();
    return;
  }

  if (isSessionRoute(req)) {
    if (!headerOk(req) || !originOk(req)) {
      reject(res);
      return;
    }
    next();
    return;
  }

  // A mutation with no credential at all has no authority to abuse, so it is
  // exempt. `/auth/login` and `/auth/exchange` are the exception handled above:
  // they arrive unauthenticated but MINT a session, so they are checked
  // unconditionally. The CORS delegate's `if (!origin) allow` branch pairs with
  // this — an origin-less caller passes both, and both rely on the same fact
  // that such a caller is not a browser acting for a logged-in victim.
  if (!hasAuthCookie(req) && !hasAuthCredential(req)) {
    next();
    return;
  }

  if (!headerOk(req) || !originOk(req)) {
    reject(res);
    return;
  }

  next();
}

export const CSRF_REQUEST_HEADER = CSRF_HEADER;
export const CSRF_REQUEST_VALUE = CSRF_VALUE;
