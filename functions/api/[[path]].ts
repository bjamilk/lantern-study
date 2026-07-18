/**
 * Same-origin API proxy for Cloudflare Pages.
 *
 * Browser → https://lanternstudy.com/api/... → https://lantern-study-api.onrender.com/api/...
 * Preview → https://*.lantern-study.pages.dev/api/... → staging (LANTERN_API_UPSTREAM)
 *
 * Auth cookies must be first-party. Cross-site cookies from *.onrender.com are blocked by
 * modern browsers when the SPA runs on lanternstudy.com, which caused 401 on every refresh.
 *
 * Set LANTERN_API_UPSTREAM in Cloudflare Pages env (Production vs Preview).
 */

const DEFAULT_UPSTREAM = 'https://lantern-study-api.onrender.com';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'cdn-loop',
]);

function joinPath(pathParam: string | string[] | undefined): string {
  if (!pathParam) return '';
  if (Array.isArray(pathParam)) return pathParam.join('/');
  return pathParam;
}

function resolveUpstream(env: { LANTERN_API_UPSTREAM?: string } | undefined): string {
  const raw = env?.LANTERN_API_UPSTREAM?.trim();
  if (!raw) return DEFAULT_UPSTREAM;
  return raw.replace(/\/+$/, '');
}

/** Prefer Lax on first-party responses; keep Path/HttpOnly/Secure intact. */
function rewriteSetCookie(value: string): string {
  let next = value;
  // First-party cookies do not need SameSite=None (and Lax is stricter against CSRF).
  if (/;\s*samesite=none/i.test(next)) {
    next = next.replace(/;\s*samesite=none/i, '; SameSite=Lax');
  } else if (!/;\s*samesite=/i.test(next)) {
    next = `${next}; SameSite=Lax`;
  }
  return next;
}

export async function onRequest(context: {
  request: Request;
  params: { path?: string | string[] };
  env?: { LANTERN_API_UPSTREAM?: string };
}): Promise<Response> {
  const { request, params, env } = context;
  const UPSTREAM = resolveUpstream(env);
  const incoming = new URL(request.url);
  const suffix = joinPath(params.path);
  const targetUrl = `${UPSTREAM}/api/${suffix}${incoming.search}`;

  if (request.method === 'OPTIONS') {
    // Same-origin callers do not need CORS; still answer preflights cheaply.
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': incoming.origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers':
          request.headers.get('Access-Control-Request-Headers') ||
          'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    headers.set(key, value);
  });
  headers.set('X-Forwarded-Host', incoming.host);
  headers.set('X-Forwarded-Proto', 'https');
  headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') || '');

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    // Required by undici/Workers when streaming a request body.
    (init as RequestInit & { duplex?: string }).duplex = 'half';
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream unreachable';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'set-cookie') return; // handled below
    if (HOP_BY_HOP.has(lower)) return;
    // Avoid advertising cross-origin CORS on a same-origin proxy response.
    if (lower.startsWith('access-control-')) return;
    outHeaders.append(key, value);
  });

  const getSetCookie = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const setCookies =
    typeof getSetCookie === 'function'
      ? getSetCookie.call(upstream.headers)
      : upstream.headers.get('set-cookie')
        ? [upstream.headers.get('set-cookie') as string]
        : [];

  for (const cookie of setCookies) {
    if (cookie) outHeaders.append('Set-Cookie', rewriteSetCookie(cookie));
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
