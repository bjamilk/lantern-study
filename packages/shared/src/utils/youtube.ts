/** YouTube URL parsing shared by web, mobile, and the API server. */

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
]);

/**
 * Extract the 11-character video id from any common YouTube URL shape
 * (watch, youtu.be, shorts, live, embed, /v/) or a bare video id.
 * Returns null when no valid id can be found.
 */
export function parseYoutubeVideoId(input: string): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  if (VIDEO_ID_RE.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  if (!HOSTS.has(url.hostname.toLowerCase())) return null;

  if (url.hostname.toLowerCase() === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] || '';
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  const v = url.searchParams.get('v');
  if (v && VIDEO_ID_RE.test(v)) return v;

  const parts = url.pathname.split('/').filter(Boolean);
  const prefix = parts[0] || '';
  const candidate = parts[1] || '';
  if (['shorts', 'live', 'embed', 'v'].includes(prefix)) {
    return VIDEO_ID_RE.test(candidate) ? candidate : null;
  }

  return null;
}

export function canonicalYoutubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
