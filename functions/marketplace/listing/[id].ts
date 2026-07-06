const BOT_UA =
  /googlebot|bingbot|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot/i;

const API_BASE = 'https://lantern-study-api.onrender.com';
const SITE_BASE = 'https://lanternstudy.com';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function onRequest(context: {
  request: Request;
  params: { id?: string };
  next: () => Promise<Response>;
}): Promise<Response> {
  const ua = context.request.headers.get('user-agent') || '';
  if (!BOT_UA.test(ua)) {
    return context.next();
  }

  const listingId = context.params.id;
  if (!listingId) {
    return context.next();
  }

  try {
    const res = await fetch(`${API_BASE}/api/v1/marketplace/listings/${listingId}/full`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return context.next();
    }
    const payload = await res.json();
    const listing = payload?.data?.listing;
    if (!listing?.title) {
      return context.next();
    }

    const campusName = listing.campus?.name || listing.location || 'Nigeria campus';
    const price = listing.price ? `₦${Number(listing.price).toLocaleString()}` : '';
    const title = `${listing.title}${price ? ` — ${price}` : ''} — ${campusName} | Lantern Study`;
    const description =
      (listing.description || '').slice(0, 160) ||
      `Campus marketplace listing on Lantern Study — ${campusName}.`;
    const canonical = `${SITE_BASE}/marketplace/listing/${encodeURIComponent(listingId)}`;
    const image =
      Array.isArray(listing.images) && listing.images[0]
        ? String(listing.images[0])
        : `${SITE_BASE}/lantern-icon.png`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <meta property="og:type" content="product" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta http-equiv="refresh" content="0;url=${escapeHtml(canonical)}" />
</head>
<body>
  <p><a href="${escapeHtml(canonical)}">${escapeHtml(listing.title)}</a></p>
</body>
</html>`;

    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    });
  } catch {
    return context.next();
  }
}
