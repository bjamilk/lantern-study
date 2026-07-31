/**
 * Strip Cloudflare Pages' default Access-Control-Allow-Origin: * on HTML/assets.
 * The SPA is same-origin; permissive CORS is only appropriate on a public CDN API.
 * Leave /api/* alone — the same-origin proxy owns those responses (incl. Set-Cookie).
 *
 * Also refuse HTML bodies for hashed module/style assets so a SPA rewrite cannot
 * be executed as JavaScript (strict MIME checking).
 */
function isHashedStaticAsset(pathname: string): boolean {
  if (!pathname.startsWith('/assets/')) return false;
  return /\.(?:js|mjs|cjs|css|wasm|map)$/i.test(pathname);
}

function isHtmlContentType(contentType: string | null): boolean {
  return (contentType || '').toLowerCase().includes('text/html');
}

export async function onRequest(context: {
  request: Request;
  next: () => Promise<Response>;
}): Promise<Response> {
  const pathname = new URL(context.request.url).pathname;
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return context.next();
  }

  const response = await context.next();

  if (isHashedStaticAsset(pathname) && isHtmlContentType(response.headers.get('content-type'))) {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const headers = new Headers(response.headers);
  headers.delete('Access-Control-Allow-Origin');
  headers.delete('Access-Control-Allow-Credentials');
  headers.delete('Access-Control-Allow-Methods');
  headers.delete('Access-Control-Allow-Headers');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
