import {
  API_BASE,
  BOT_UA,
  SITE_BASE,
  botSeoHtml,
} from "../../_lib/seoHtml";

export async function onRequest(context: {
  request: Request;
  params: { id?: string };
  next: () => Promise<Response>;
}): Promise<Response> {
  const ua = context.request.headers.get("user-agent") || "";
  if (!BOT_UA.test(ua)) {
    return context.next();
  }

  const listingId = context.params.id;
  if (!listingId) {
    return context.next();
  }

  try {
    const res = await fetch(
      `${API_BASE}/api/v1/marketplace/listings/${listingId}/full`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) {
      return context.next();
    }
    const payload = await res.json();
    const listing = payload?.data?.listing;
    if (!listing?.title) {
      return context.next();
    }

    const campusName =
      listing.campus?.name || listing.location || "Nigeria campus";
    const price = listing.price
      ? `₦${Number(listing.price).toLocaleString()}`
      : "";
    const title = `${listing.title}${price ? ` — ${price}` : ""} — ${campusName} | Lantern Study`;
    const description =
      (listing.description || "").slice(0, 160) ||
      `Campus marketplace listing on Lantern Study — ${campusName}.`;
    const canonical = `${SITE_BASE}/marketplace/listing/${encodeURIComponent(listingId)}`;
    const image =
      Array.isArray(listing.images) && listing.images[0]
        ? String(listing.images[0])
        : `${SITE_BASE}/lantern-icon-v2.png`;

    return new Response(
      botSeoHtml({
        title,
        description,
        canonical,
        image,
        ogType: "product",
        linkText: listing.title,
      }),
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      },
    );
  } catch {
    return context.next();
  }
}
