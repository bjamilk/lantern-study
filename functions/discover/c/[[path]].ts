import { API_BASE, BOT_UA, SITE_BASE, botSeoHtml } from "../../_lib/seoHtml";

/**
 * Crawler unfurl for community links — the URL a class rep pastes into a
 * course WhatsApp group.
 *
 * WHY A CATCH-ALL AND NOT `[slug].ts`: utils/appRoutes.ts mints two shapes,
 * `/discover/c/:slug` and the board deep link
 * `/discover/c/:slug/ch/:groupId/p/:postId`. A single-segment function would
 * leave the deep link — the one people actually share — unfurling as nothing.
 * Everything after the slug is deliberately IGNORED: the post is never fetched
 * and never rendered.
 *
 * WHAT IT MAY SAY: communities are members-only. A non-member gets a JOIN CARD
 * (name, kind, institution, member count, a call to open the app) and never a
 * member identity or a line of post content. The endpoint behind it returns
 * exactly five fields for the same reason.
 *
 * Contract shared with functions/invite/[id].ts and functions/campus/[slug].ts:
 * only bots get server-rendered HTML; everyone else falls through to the SPA,
 * so a signed-in member still lands on the real community screen. A transport
 * failure also falls through — a crawler seeing the app beats a crawler seeing
 * a 500. The ONE non-fallthrough case is a slug the API says does not exist (or
 * is private): that answers a 404 card, so junk links are not indexed and a
 * private room is never confirmed to exist.
 */

/** Machine-minted community slugs: `campus-unilag`, `course-<32 hex>`, `topic-…`. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,120}$/;

/** communities.kind on the wire → the word a student would use. */
const KIND_LABEL: Record<string, string> = {
  institution: "Campus",
  programme: "Programme",
  level: "Level",
  course: "Course",
  topic: "Interest",
};

function notFoundCard(): Response {
  return new Response(
    botSeoHtml({
      title: "Community not found | Lantern Study",
      description:
        "This Lantern Study community link is not available. Browse campuses, courses and study communities on Lantern Study.",
      canonical: `${SITE_BASE}/discover`,
      image: `${SITE_BASE}/lantern-icon-v2.png`,
      ogType: "website",
      linkText: "Discover communities on Lantern Study",
    }),
    {
      status: 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    },
  );
}

export async function onRequest(context: {
  request: Request;
  params: { path?: string | string[] };
  next: () => Promise<Response>;
}): Promise<Response> {
  const ua = context.request.headers.get("user-agent") || "";
  if (!BOT_UA.test(ua)) {
    return context.next();
  }

  const raw = context.params.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const slug = (segments[0] || "").toLowerCase();
  // Mirror the server's slug rule so a junk path never becomes a fetch.
  if (!SLUG_RE.test(slug)) {
    return context.next();
  }

  let res: Response;
  try {
    res = await fetch(
      `${API_BASE}/api/v1/communities/public/${encodeURIComponent(slug)}`,
      { headers: { Accept: "application/json" } },
    );
  } catch {
    return context.next();
  }

  // Unknown or private: one answer, so the card is not an existence oracle.
  if (res.status === 404) {
    return notFoundCard();
  }
  if (!res.ok) {
    return context.next();
  }

  try {
    const payload = await res.json();
    const community = payload?.data;
    if (!community?.name || !community?.slug) {
      return context.next();
    }

    const name = String(community.name);
    const kindLabel = KIND_LABEL[String(community.kind)] || "Study";
    const memberCount = Math.max(0, Number(community.memberCount) || 0);
    const members = memberCount === 1 ? "1 member" : `${memberCount} members`;
    const institution =
      typeof community.institutionName === "string" && community.institutionName
        ? ` at ${community.institutionName}`
        : "";

    const title = `Join ${name} on Lantern Study`;
    const description = (
      `${kindLabel} community${institution} · ${members}. ` +
      `Open Lantern Study to join and study with your coursemates.`
    ).slice(0, 160);

    // The community page is canonical even for a board deep link: the post
    // itself is members-only and must never be the indexed URL.
    const canonical = `${SITE_BASE}/discover/c/${encodeURIComponent(String(community.slug))}`;

    return new Response(
      botSeoHtml({
        title,
        description,
        canonical,
        image: `${SITE_BASE}/lantern-icon-v2.png`,
        ogType: "website",
        linkText: `Open ${name} in Lantern Study`,
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
