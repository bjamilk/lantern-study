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

  const companyId = context.params.id;
  if (!companyId) {
    return context.next();
  }

  try {
    const res = await fetch(
      `${API_BASE}/api/v1/jobs-board/companies/${encodeURIComponent(companyId)}/profile`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return context.next();
    const payload = await res.json();
    const company = payload?.data?.company;
    if (!company?.displayName || company.verificationStatus !== "verified") {
      return context.next();
    }

    const openRoles = Array.isArray(payload?.data?.jobs)
      ? payload.data.jobs.length
      : 0;
    const rolesHint =
      openRoles === 1 ? "1 open role" : `${openRoles} open roles`;
    const title = `${company.displayName} — jobs on Lantern Study`;
    const description = (
      (company.tagline || company.about || "").replace(/\s+/g, " ").trim() ||
      `${company.displayName}${company.industry ? ` · ${company.industry}` : ""}. ${rolesHint} on Lantern Study Jobs.`
    ).slice(0, 160);
    const canonical = `${SITE_BASE}/marketplace/companies/${encodeURIComponent(companyId)}`;
    const image = company.logoUrl || `${SITE_BASE}/lantern-icon-v2.png`;

    return new Response(
      botSeoHtml({
        title,
        description,
        canonical,
        image,
        linkText: company.displayName,
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
