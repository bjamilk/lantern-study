/**
 * The single definition of the session cookies and how they are set, read and
 * cleared.
 *
 * Exports `ACCESS_COOKIE` / `REFRESH_COOKIE` (the names), `setAuthCookies`,
 * `clearAuthCookies`, `readAccessCookie` and `readRefreshCookie`. Called by
 * routes/auth.ts on login, exchange, refresh and sign-out, by the auth
 * middleware when it reads a cookie-borne credential, and by server.ts's CORS
 * delegate to detect whether a request carries a cookie credential.
 *
 * Touches nothing but the HTTP response: the cookies carry Supabase gotrue
 * tokens. Both are httpOnly, and `secure` plus `SameSite=None` in production.
 *
 * The refresh cookie is scoped to `/api/v1/auth` so it is never attached to
 * ordinary API calls; only the auth routes can see it. `clearAuthCookies` must
 * clear each cookie with the same path it was set with, or the browser keeps
 * the old cookie and sign-out appears not to take.
 */
import type { CookieOptions, Response } from 'express';

export const ACCESS_COOKIE = 'lantern_access';
export const REFRESH_COOKIE = 'lantern_refresh';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Cookie SameSite:
 * - production defaults to 'none' so a direct cross-site API host can work when allowed
 * - Cloudflare same-origin proxy rewrites Set-Cookie to Lax for lanternstudy.com
 */
function baseCookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

// --- Write ---
// The access cookie's lifetime tracks the token's own expiry (floored at 60s so
// a short-lived token still produces a usable cookie); the refresh cookie lives
// 30 days and is path-scoped to the auth routes.
export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  expiresInSeconds: number
): void {
  const accessMaxAge = Math.max(60, expiresInSeconds) * 1000;
  const refreshMaxAge = 30 * 24 * 60 * 60 * 1000;
  res.cookie(ACCESS_COOKIE, accessToken, baseCookieOptions(accessMaxAge));
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookieOptions(refreshMaxAge),
    path: '/api/v1/auth',
  });
}

export function clearAuthCookies(res: Response): void {
  const clearOpts: CookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
  };
  res.clearCookie(ACCESS_COOKIE, { ...clearOpts, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...clearOpts, path: '/api/v1/auth' });
}

// --- Read ---
// Both readers return null for a blank or whitespace-only value so callers can
// treat "cookie present but empty" as "no credential" rather than sending an
// empty string on to the token verifier.
export function readAccessCookie(cookies: Record<string, string | undefined>): string | null {
  const value = cookies[ACCESS_COOKIE];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function readRefreshCookie(cookies: Record<string, string | undefined>): string | null {
  const value = cookies[REFRESH_COOKIE];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
