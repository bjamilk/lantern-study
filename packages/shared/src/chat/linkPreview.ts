const URL_RE = /https?:\/\/[^\s<>'")\]]+/gi;

export function extractHttpUrls(text?: string | null): string[] {
  if (!text) return [];
  const matches = text.match(URL_RE) || [];
  return matches.map((url) => url.replace(/[.,;:!?]+$/u, '')).filter(Boolean);
}

export function firstLinkPreviewUrl(text?: string | null): string | null {
  return extractHttpUrls(text)[0] || null;
}

export function linkPreviewHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
