/**
 * Fetch YouTube captions/transcript without API key (public captions only).
 * Uses the youtube-transcript package first (direct Innertube + web fallback),
 * with oEmbed for video titles.
 */

import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
} from 'youtube-transcript';
import { ApiError } from '../middleware/errorHandler';

const YOUTUBE_FETCH_TIMEOUT_MS = 10_000;
const OEMBED_TIMEOUT_MS = 5_000;

/** Broad URL matching (watch, embed, shorts, live, youtu.be, raw id). */
const YOUTUBE_ID_PATTERN =
  /(?:youtube\.com\/(?:[^/\s]+\/.+\/|(?:v|e(?:mbed)?|shorts|live)\/|.*[?&]v=)|youtu\.be\/|m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/i;

export function extractYouTubeVideoId(url: string): string | null {
  const trimmed = url.trim();
  const match = trimmed.match(YOUTUBE_ID_PATTERN);
  if (match?.[1]) return match[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  return null;
}

function timedFetch(url: string, init: RequestInit = {}, timeoutMs = YOUTUBE_FETCH_TIMEOUT_MS): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export function decodeTranscriptXml(xml: string): string {
  const segments: string[] = [];

  const textRegex = /<text[^>]*>([^<]*)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = textRegex.exec(xml)) !== null) {
    const raw = decodeHtmlEntities(match[1]);
    if (raw) segments.push(raw);
  }
  if (segments.length > 0) {
    return segments.join(' ');
  }

  const paragraphRegex = /<p[^>]*>([\s\S]*?)<\/p>/g;
  while ((match = paragraphRegex.exec(xml)) !== null) {
    const words: string[] = [];
    const segmentRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let segmentMatch: RegExpExecArray | null;
    while ((segmentMatch = segmentRegex.exec(match[1])) !== null) {
      const word = decodeHtmlEntities(segmentMatch[1]);
      if (word) words.push(word);
    }
    if (words.length > 0) segments.push(words.join(' '));
  }

  return segments.join(' ');
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n/g, ' ')
    .trim();
}

function mapPackageError(err: unknown, videoId: string): ApiError {
  if (err instanceof YoutubeTranscriptDisabledError || err instanceof YoutubeTranscriptNotAvailableError) {
    return new ApiError(
      'No captions available for this video. Enable captions on the video or try another link.',
      422
    );
  }
  if (err instanceof YoutubeTranscriptNotAvailableLanguageError) {
    return new ApiError(
      'No captions available in the requested language. Try a video with captions enabled.',
      422
    );
  }
  if (err instanceof YoutubeTranscriptVideoUnavailableError) {
    return new ApiError(`This YouTube video is unavailable (${videoId}).`, 422);
  }
  if (err instanceof YoutubeTranscriptTooManyRequestError) {
    return new ApiError('YouTube rate-limited the request. Try again in a minute.', 502);
  }

  const message = err instanceof Error ? err.message : String(err);
  if (/disabled|not available|unavailable|no transcript/i.test(message)) {
    return new ApiError(
      'No captions available for this video. Enable captions on the video or try another link.',
      422
    );
  }
  if (/too many requests|429|captcha/i.test(message)) {
    return new ApiError('YouTube rate-limited the request. Try again in a minute.', 502);
  }
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new ApiError('YouTube transcript request timed out. Try again.', 502);
  }
  return new ApiError('Could not fetch YouTube transcript.', 502);
}

async function fetchVideoTitle(videoId: string): Promise<string | null> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`;
    const res = await timedFetch(oembedUrl, {}, OEMBED_TIMEOUT_MS);
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string };
    return data.title?.trim() || null;
  } catch {
    return null;
  }
}

async function fetchTranscriptViaPackage(
  videoId: string
): Promise<{ transcript: string; title: string | null }> {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId, {
      fetch: (url, init) => timedFetch(String(url), init),
    });
    const transcript = segments.map((s) => s.text).join(' ').trim();
    if (!transcript) {
      throw new ApiError('Transcript was empty.', 422);
    }
    const title = await fetchVideoTitle(videoId);
    return { transcript, title };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw mapPackageError(err, videoId);
  }
}

export async function fetchYouTubeTranscript(
  videoId: string
): Promise<{ transcript: string; title: string | null }> {
  return fetchTranscriptViaPackage(videoId);
}
