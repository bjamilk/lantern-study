/**
 * Email delivery for job alerts, over the same Resend transport the contact
 * form uses. One digest per saved search per sweep — never one email per
 * posting — so a burst of new postings cannot turn into a burst of mail.
 */
import { logger } from "../utils/logger";

const SITE_BASE = "https://lanternstudy.com";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function isAlertMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export interface JobAlertEmailMatch {
  id: string;
  title: string;
  compensationLabel?: string | null;
  locationLabel?: string | null;
}

export async function sendJobAlertEmail(params: {
  to: string;
  searchName: string;
  matches: JobAlertEmailMatch[];
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const { to, searchName, matches } = params;
  if (!matches.length) return false;

  const from =
    process.env.ALERTS_FROM_EMAIL ||
    process.env.RESEND_FROM_EMAIL ||
    "Lantern Study <noreply@lanternstudy.com>";

  const rows = matches
    .map((m) => {
      const meta = [m.compensationLabel, m.locationLabel]
        .filter(Boolean)
        .map((part) => escapeHtml(String(part)))
        .join(" · ");
      return `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;">
            <a href="${SITE_BASE}/marketplace/jobs/${encodeURIComponent(m.id)}"
               style="font-size:15px;font-weight:600;color:#4f46e5;text-decoration:none;">
              ${escapeHtml(m.title)}
            </a>
            ${meta ? `<div style="font-size:12px;color:#64748b;margin-top:2px;">${meta}</div>` : ""}
          </td>
        </tr>`;
    })
    .join("");

  const count = matches.length;
  const subject = `${count} new job${count === 1 ? "" : "s"} for “${searchName}”`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
      <h2 style="font-size:18px;">New matches for “${escapeHtml(searchName)}”</h2>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      <p style="margin-top:20px;">
        <a href="${SITE_BASE}/marketplace/jobs"
           style="display:inline-block;background:#4f46e5;color:#ffffff;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">
          See all jobs
        </a>
      </p>
      <p style="font-size:12px;color:#94a3b8;margin-top:24px;">
        You get these because alerts are on for this saved search.
        Manage them from Jobs → Saved searches, or turn off email
        notifications in Settings.
      </p>
    </div>
  `.trim();

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.warn("Job alert email failed", { status: response.status, body });
    return false;
  }
  return true;
}
