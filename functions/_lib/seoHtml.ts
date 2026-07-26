/** Shared HTML escaping for Cloudflare bot prerender pages. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const BOT_UA =
  /googlebot|bingbot|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot/i;

export const API_BASE = "https://lantern-study-api.onrender.com";
export const SITE_BASE = "https://lanternstudy.com";

export function botSeoHtml(input: {
  title: string;
  description: string;
  canonical: string;
  image: string;
  ogType?: string;
  linkText: string;
}): string {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const canonical = escapeHtml(input.canonical);
  const image = escapeHtml(input.image);
  const ogType = escapeHtml(input.ogType || "website");
  const linkText = escapeHtml(input.linkText);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${image}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${image}" />
  <meta http-equiv="refresh" content="0;url=${canonical}" />
</head>
<body>
  <p><a href="${canonical}">${linkText}</a></p>
</body>
</html>`;
}
