export const RENDER_NOTES_API_ORIGIN = 'https://lantern-study-api.onrender.com';

const CF_PROXY_UNSAFE_BODY_CHARS = 48 * 1024;

/**
 * Select the API URL for note requests.
 *
 * Deployed web normally uses the same-origin Cloudflare Pages proxy. Lecture
 * transcription bypasses it because the proxy has intermittently forwarded an
 * empty POST body, including the small storagePath request sent after upload.
 */
export function resolveNotesRequestUrl({
  apiBaseUrl,
  path,
  bodyJson,
  isBrowser,
}: {
  apiBaseUrl: string;
  path: string;
  bodyJson: string;
  isBrowser: boolean;
}): string {
  const relative = `/api/v1/notes${path}`;
  const mustBypassCloudflare =
    path === '/transcribe-audio' || bodyJson.length >= CF_PROXY_UNSAFE_BODY_CHARS;

  if (isBrowser && !apiBaseUrl && mustBypassCloudflare) {
    return `${RENDER_NOTES_API_ORIGIN}${relative}`;
  }

  return `${apiBaseUrl}${relative}`;
}
