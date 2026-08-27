import {
  API_BASE,
  BOT_UA,
  SITE_BASE,
  botSeoHtml,
} from "../_lib/seoHtml";

/**
 * WhatsApp / crawler unfurl for group invite links.
 * Bot-only; every failure path continues to the SPA. Never includes member names.
 */
export async function onRequest(context: {
  request: Request;
  params: { id?: string };
  next: () => Promise<Response>;
}): Promise<Response> {
  const ua = context.request.headers.get("user-agent") || "";
  if (!BOT_UA.test(ua)) {
    return context.next();
  }

  const inviteId = context.params.id;
  if (!inviteId) {
    return context.next();
  }

  try {
    const res = await fetch(
      `${API_BASE}/api/v1/groups/invite/${encodeURIComponent(inviteId)}/preview`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) {
      return context.next();
    }
    const payload = await res.json();
    const preview = payload?.data;
    if (!preview?.name) {
      return context.next();
    }

    const memberCount = Number(preview.memberCount) || 0;
    const members =
      memberCount === 1 ? "1 member" : `${memberCount} members`;
    const title = `Join ${preview.name} on Lantern Study`;
    const description = `A Lantern Study group — ${members}.`;
    const canonical = `${SITE_BASE}/invite/${encodeURIComponent(inviteId)}`;

    return new Response(
      botSeoHtml({
        title,
        description,
        canonical,
        image: `${SITE_BASE}/lantern-icon-v2.png`,
        ogType: "website",
        linkText: preview.name,
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
