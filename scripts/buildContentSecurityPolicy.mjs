/**
 * Build Content-Security-Policy for the web app (production _headers + dev server).
 * Keep connect-src / media-src in sync with third-party services the client actually uses.
 */
/**
 * Turnstile needs three directives, not one: the api.js loader (script-src),
 * the challenge iframe it injects (frame-src), and the calls that script makes
 * while solving (connect-src). Miss any and the widget fails silently — it
 * renders nothing and the form simply never gets a token.
 */
const TURNSTILE_HOST = 'https://challenges.cloudflare.com';

export function buildContentSecurityPolicy(env = {}) {
  const supabaseUrl = (env.VITE_SUPABASE_URL || 'http://127.0.0.1:55421').replace(/\/$/, '');
  const apiUrl = (env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
  const sentryDsn = env.VITE_SENTRY_DSN || '';

  const connectSrc = new Set([
    "'self'",
    supabaseUrl,
    // Keep Render host for mobile/direct clients; web prefers same-origin /api proxy.
    // Only when it is an absolute origin: VITE_API_URL is often the same-origin
    // proxy path '/__lantern_api', and a relative path is not a legal CSP
    // source — the browser logs "contains an invalid source" and drops the
    // entry. Same-origin requests are already covered by 'self'.
    ...(/^https?:\/\//.test(apiUrl) ? [apiUrl] : []),
    'https://lantern-study-api.onrender.com',
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'https://*.ingest.us.sentry.io',
    'https://*.ingest.sentry.io',
    // Cloudflare Web Analytics. The beacon is injected by Cloudflare into every
    // Pages response — we do not add the tag ourselves and cannot remove it
    // without turning the feature off in the dashboard — so it is deliberate
    // first-party traffic. script-src already allowed the loader; without the
    // matching connect-src entries the beacon's own fetch was blocked and
    // filed a CSP violation on every page view (Sentry WEB-1V).
    'https://static.cloudflareinsights.com',
    'https://cloudflareinsights.com',
    // Turnstile: the widget script calls home while solving the challenge.
    TURNSTILE_HOST,
  ]);

  // Chat voice notes / lecture audio use <audio src> against private Supabase signed URLs.
  // Without media-src, browsers fall back to default-src 'self' and block playback.
  const mediaSrc = new Set(["'self'", 'blob:', 'data:', supabaseUrl, 'https://*.supabase.co']);

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
    // 'wasm-unsafe-eval' (SW) [Sentry WEB-1A, violations at /login]: Turnstile's
    // challenge compiles a WebAssembly module in the PAGE, not only in its
    // iframe, so without this the widget fails the way it always fails —
    // silently, rendering nothing, and the sign-in form simply never gets a
    // token. It is the narrow keyword on purpose: it permits WebAssembly
    // compilation and NOTHING else. 'unsafe-eval' (which would also re-enable
    // eval() and Function() for the whole app) must not be used here.
    `script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com ${TURNSTILE_HOST}`,
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    `connect-src ${[...connectSrc].join(' ')}`,
    "img-src 'self' data: blob: https:",
    `media-src ${[...mediaSrc].join(' ')}`,
    "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
    `frame-src https://www.youtube-nocookie.com ${TURNSTILE_HOST}`,
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
