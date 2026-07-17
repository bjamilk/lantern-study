/**
 * Strip Cloudflare Pages' default Access-Control-Allow-Origin: * on HTML/assets.
 * The SPA is same-origin; permissive CORS is only appropriate on a public CDN API.
 * Leave /api/* alone — the same-origin proxy owns those responses (incl. Set-Cookie).
 */
export async function onRequest(context: {
  request: Request;
  next: () => Promise<Response>;
}): Promise<Response> {
  const pathname = new URL(context.request.url).pathname;
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return context.next();
  }

  const response = await context.next();
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
