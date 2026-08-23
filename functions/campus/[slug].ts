import { API_BASE, BOT_UA, SITE_BASE, botSeoHtml } from "../_lib/seoHtml";

/**
 * Prerender for /campus/:slug (Phase 4 · R).
 *
 * Same contract as functions/marketplace/listing/[id].ts: only bots get the
 * server-rendered HTML, and EVERY failure path falls through to the SPA shell
 * via context.next() rather than showing an error page — a crawler seeing a 500
 * is worse than a crawler seeing the normal app.
 *
 * The summary endpoint it calls is public and returns aggregate counts only.
 */
export async function onRequest(context: {
  request: Request;
  params: { slug?: string };
  next: () => Promise<Response>;
}): Promise<Response> {
  const ua = context.request.headers.get("user-agent") || "";
  if (!BOT_UA.test(ua)) {
    return context.next();
  }

  const slug = (context.params.slug || "").toLowerCase();
  // Mirror the server's slug rule so a junk path never becomes a fetch.
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) {
    return context.next();
  }

  try {
    const res = await fetch(
      `${API_BASE}/api/v1/campuses/${encodeURIComponent(slug)}/summary`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) {
      return context.next();
    }
    const payload = await res.json();
    const campus = payload?.data;
    if (!campus?.name) {
      return context.next();
    }

    const counts = campus.counts || {};
    const parts: string[] = [];
    if (counts.students) parts.push(`${counts.students} students`);
    if (counts.courses) parts.push(`${counts.courses} courses`);
    if (counts.listings) parts.push(`${counts.listings} listings`);
    const activity = parts.length ? parts.join(" · ") : "Study groups, notes and past questions";

    const title = `${campus.name} — study groups, past questions & notes | Lantern Study`;
    const description = (
      `Study at ${campus.name}${campus.city ? `, ${campus.city}` : ""}. ` +
      `${activity}. Flashcards, past questions, study groups and a student marketplace.`
    ).slice(0, 160);

    return new Response(
      botSeoHtml({
        title,
        description,
        canonical: `${SITE_BASE}/campus/${encodeURIComponent(slug)}`,
        image: `${SITE_BASE}/lantern-icon-v2.png`,
        ogType: "website",
        linkText: campus.name,
      }),
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=600",
        },
      },
    );
  } catch {
    return context.next();
  }
}
