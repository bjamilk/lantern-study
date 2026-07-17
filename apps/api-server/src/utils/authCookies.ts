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

export function readAccessCookie(cookies: Record<string, string | undefined>): string | null {
  const value = cookies[ACCESS_COOKIE];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function readRefreshCookie(cookies: Record<string, string | undefined>): string | null {
  const value = cookies[REFRESH_COOKIE];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
