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

  const jobId = context.params.id;
  if (!jobId || jobId === "new") {
    return context.next();
  }

  try {
    const res = await fetch(
      `${API_BASE}/api/v1/jobs-board/postings/${encodeURIComponent(jobId)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return context.next();
    const payload = await res.json();
    const job = payload?.data;
    if (!job?.title || !["active", "paused", "closed"].includes(job.status)) {
      return context.next();
    }

    const employer =
      job.company?.displayName ||
      job.poster?.name ||
      job.poster?.username ||
      "Independent poster";
    const location = job.isRemote
      ? "Remote"
      : job.locationText || job.campusName || "Nigeria";
    const title = `${job.title} — ${employer} · ${location} | Lantern Study`;
    const description = (
      (job.description || "").replace(/\s+/g, " ").trim() ||
      `${job.title} · ${employer} · ${location}. Apply on Lantern Study Jobs.`
    ).slice(0, 160);
    const canonical = `${SITE_BASE}/marketplace/jobs/${encodeURIComponent(jobId)}`;
    const image = job.company?.logoUrl || `${SITE_BASE}/lantern-icon-v2.png`;

    return new Response(
      botSeoHtml({
        title,
        description,
        canonical,
        image,
        linkText: job.title,
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
