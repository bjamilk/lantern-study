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

/** Allow http://192.168.x.x:5173 (etc.) when developing against a local API. */
function isPrivateLanHttpOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:') return false;
    const host = url.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
    const parts = host.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  } catch {
    return false;
  }
}

/** Cloudflare Pages PR previews: https://<hash>.lantern-study.pages.dev */
function isLanternPagesPreviewOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === 'lantern-study.pages.dev' || host.endsWith('.lantern-study.pages.dev');
  } catch {
    return false;
  }
}

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // mobile apps, curl, server-to-server
  if (getAllowedCorsOrigins().includes(origin)) return true;
  if (isLanternPagesPreviewOrigin(origin)) return true;
  // Local/LAN Vite origins are not enumerable up front; allow in non-production.
  if (process.env.NODE_ENV !== 'production' && isPrivateLanHttpOrigin(origin)) return true;
  return false;
}
