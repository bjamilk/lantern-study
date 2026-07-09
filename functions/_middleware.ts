/**
 * Strip Cloudflare Pages' default Access-Control-Allow-Origin: * on HTML/assets.
 * The SPA is same-origin; permissive CORS is only appropriate on a public CDN API.
 */
export async function onRequest(context: {
  next: () => Promise<Response>;
}): Promise<Response> {
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
