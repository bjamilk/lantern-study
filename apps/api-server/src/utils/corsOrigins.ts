/**
 * Build the allowed CORS origin list for the API server.
 */
export function getAllowedCorsOrigins(): string[] {
  const origins = new Set<string>();

  const envOrigins = [
    process.env.FRONTEND_URL,
    process.env.WEB_APP_URL,
    process.env.MOBILE_APP_URL,
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
