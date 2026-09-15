/**
 * Build the allowed CORS origin list for the API server.
 */

/** Production web origins — always allowed when NODE_ENV=production. */
export const PRODUCTION_WEB_ORIGINS = [
  'https://lanternstudy.com',
  'https://www.lanternstudy.com',
  'https://lantern-study.pages.dev',
] as const;

function parseExtraOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Build the allowed CORS origin list for the API server.
 */
export function getAllowedCorsOrigins(): string[] {
  const origins = new Set<string>();

  if (process.env.NODE_ENV === 'production') {
    for (const o of PRODUCTION_WEB_ORIGINS) origins.add(o);
  }

  const envOrigins = [
    process.env.FRONTEND_URL,
    process.env.WEB_APP_URL,
    process.env.MOBILE_APP_URL,
    ...parseExtraOrigins(process.env.ALLOWED_ORIGINS),
  ].filter(Boolean) as string[];

  for (const o of envOrigins) origins.add(o);

  if (process.env.NODE_ENV !== 'production') {
    for (const port of ['3000', '5173', '5174', '5175', '5176', '8081']) {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    }
  }

  return Array.from(origins);
}

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // mobile apps, curl, server-to-server
  return getAllowedCorsOrigins().includes(origin);
}

/**
 * Paths whose responses SET auth cookies. A request to one of these must never
 * be granted credentialed CORS access on a missing Origin: sandboxed iframes and
 * cross-origin 307 redirects send `Origin: null`/no Origin, which used to be
 * blanket-allowed with `credentials: true` and made /auth/login and
 * /auth/exchange login-CSRF / session-fixation targets.
 */
export function isCookieSettingPath(pathname: string): boolean {
  const path = (pathname || '').split('?')[0].replace(/\/+$/, '') || '/';
  return (
    path.endsWith('/auth/login') ||
    path.endsWith('/auth/exchange') ||
    path.endsWith('/auth/refresh') ||
    path.endsWith('/auth/logout') ||
    path.endsWith('/auth/session')
  );
}

export interface CorsOriginDecisionInput {
  origin: string | undefined;
  /** Authorization / X-API-Key present — a credential the browser cannot attach cross-site without a preflight. */
  hasNonCookieCredential: boolean;
  /** An auth cookie rode along; ambient authority, never trust a missing Origin with it. */
  hasAuthCookie: boolean;
  /** Request targets a path that sets auth cookies. */
  isCookieSetting: boolean;
}

/**
 * Decide whether to emit credentialed CORS headers.
 * `false` means "no Access-Control-Allow-Origin header" — NOT an error; non-browser
 * clients (curl, mobile, server-to-server) are unaffected because they ignore CORS.
 */
export function decideCorsOrigin(input: CorsOriginDecisionInput): boolean {
  const { origin, hasNonCookieCredential, hasAuthCookie, isCookieSetting } = input;

  if (origin) {
    if (getAllowedCorsOrigins().includes(origin)) return true;
    if (process.env.ALLOW_ALL_CORS === 'true' && process.env.NODE_ENV !== 'production') {
      return true;
    }
    return false;
  }

  // Missing/opaque Origin: only a non-cookie credential earns credentialed access.
  if (hasAuthCookie || isCookieSetting) return false;
  return hasNonCookieCredential;
}
