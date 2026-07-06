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
