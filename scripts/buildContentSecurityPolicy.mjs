/**
 * Build Content-Security-Policy for the web app (production _headers + dev server).
 * Keep connect-src in sync with third-party services the client actually uses.
 */
export function buildContentSecurityPolicy(env = {}) {
  const supabaseUrl = (env.VITE_SUPABASE_URL || 'http://127.0.0.1:55421').replace(/\/$/, '');
  const apiUrl = (env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
  const sentryDsn = env.VITE_SENTRY_DSN || '';

  const connectSrc = new Set([
    "'self'",
    supabaseUrl,
    // Keep Render host for mobile/direct clients; web prefers same-origin /api proxy.
    apiUrl,
    'https://lantern-study-api.onrender.com',
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'https://unpkg.com',
    'https://*.ingest.us.sentry.io',
    'https://*.ingest.sentry.io',
  ]);

  if (sentryDsn) {
    try {
      const host = new URL(sentryDsn);
      connectSrc.add(`${host.protocol}//${host.host}`);
    } catch {
      // ignore malformed DSN
    }
  }

  return [
    "default-src 'self'",
    "script-src 'self' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    `connect-src ${[...connectSrc].join(' ')}`,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
    "frame-src https://www.youtube-nocookie.com",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; ');
}

export function readDotEnvFile(filePath, fs) {
  if (!fs.existsSync(filePath)) return {};
  const vars = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

export function loadWebBuildEnv(rootDir, fs, path) {
  const fromFiles = {
    ...readDotEnvFile(path.join(rootDir, '.env'), fs),
    ...readDotEnvFile(path.join(rootDir, '.env.production'), fs),
    ...readDotEnvFile(path.join(rootDir, '.env.local'), fs),
  };
  return {
    ...fromFiles,
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || fromFiles.VITE_SUPABASE_URL,
    VITE_API_URL: process.env.VITE_API_URL || fromFiles.VITE_API_URL,
    VITE_SENTRY_DSN: process.env.VITE_SENTRY_DSN || fromFiles.VITE_SENTRY_DSN,
  };
}
