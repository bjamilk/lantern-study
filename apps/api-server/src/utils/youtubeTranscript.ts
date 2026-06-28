/**
 * Fetch YouTube captions/transcript without API key (public captions only).
 * Uses YouTube's Innertube player API with multiple client profiles, then
 * falls back to the youtube-transcript package.
 */

import { YoutubeTranscript } from 'youtube-transcript';
import { ApiError } from '../middleware/errorHandler';

export function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
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

type InnertubeClient = {
  clientName: string;
  clientVersion: string;
  androidSdkVersion?: number;
  hl?: string;
  gl?: string;
};

const INNERTUBE_CLIENTS: InnertubeClient[] = [
  {
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    androidSdkVersion: 30,
    hl: 'en',
    gl: 'US',
  },
  {
    clientName: 'WEB',
    clientVersion: '2.20240101.00.00',
    hl: 'en',
    gl: 'US',
  },
  {
    clientName: 'TVHTML5',
    clientVersion: '7.20240101.00.00',
    hl: 'en',
    gl: 'US',
  },
];

type InnertubePlayerResponse = {
  videoDetails?: { title?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{ baseUrl?: string; languageCode?: string }>;
    };
  };
  playabilityStatus?: { status?: string; reason?: string };
};

async function fetchWatchPageHtml(videoId: string): Promise<string> {
  const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!watchRes.ok) {
    throw new ApiError('Could not load YouTube video page.', 502);
  }
  return watchRes.text();
}

function extractInnertubeApiKey(html: string): string | null {
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  return apiKeyMatch?.[1] || null;
}

async function fetchInnertubePlayerWithClient(
  videoId: string,
  apiKey: string,
  client: InnertubeClient
): Promise<InnertubePlayerResponse | null> {
  const playerRes = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId,
      context: { client },
    }),
  });

  if (!playerRes.ok) {
    return null;
  }

  return playerRes.json() as Promise<InnertubePlayerResponse>;
}

async function fetchInnertubePlayer(videoId: string): Promise<InnertubePlayerResponse> {
  const html = await fetchWatchPageHtml(videoId);
  const apiKey = extractInnertubeApiKey(html);
  if (!apiKey) {
    throw new ApiError('Could not initialize YouTube transcript fetch.', 502);
  }

  let lastResponse: InnertubePlayerResponse | null = null;
  for (const client of INNERTUBE_CLIENTS) {
    const player = await fetchInnertubePlayerWithClient(videoId, apiKey, client);
    if (!player) continue;
    lastResponse = player;
    const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks?.length) {
      return player;
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw new ApiError('Could not load YouTube player data.', 502);
}

async function downloadCaptionTrack(
  track: { baseUrl?: string; languageCode?: string }
): Promise<string> {
  if (!track?.baseUrl) {
    throw new ApiError('No usable caption track found.', 422);
  }

  const captionRes = await fetch(track.baseUrl, {
    headers: {
      'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11)',
    },
  });
  if (!captionRes.ok) {
    throw new ApiError('Failed to download transcript.', 502);
  }

  const xml = await captionRes.text();
  if (!xml.trim()) {
    throw new ApiError('Transcript download returned no content.', 422);
  }

  const transcript = decodeTranscriptXml(xml);
  if (!transcript.trim()) {
    throw new ApiError('Transcript was empty.', 422);
  }

  return transcript;
}

async function fetchTranscriptViaInnertube(
  videoId: string
): Promise<{ transcript: string; title: string | null }> {
  const player = await fetchInnertubePlayer(videoId);
  const title = player.videoDetails?.title?.trim() || null;

  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) {
    const reason = player.playabilityStatus?.reason;
    throw new ApiError(
      reason
        ? `No captions available: ${reason}`
        : 'No captions available for this video.',
      422
    );
  }

  const track =
    tracks.find((t) => t.languageCode === 'en') ||
    tracks.find((t) => t.languageCode?.startsWith('en')) ||
    tracks[0];

  const transcript = await downloadCaptionTrack(track);
  return { transcript, title };
}

async function fetchTranscriptViaPackage(
  videoId: string
): Promise<{ transcript: string; title: string | null }> {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    const transcript = segments.map((s) => s.text).join(' ').trim();
    if (!transcript) {
      throw new ApiError('Transcript was empty.', 422);
    }
    return { transcript, title: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/disabled|not available|unavailable|no transcript/i.test(message)) {
      throw new ApiError(
        'No captions available for this video. Enable captions on the video or try another link.',
        422
      );
    }
    if (/too many requests|429/i.test(message)) {
      throw new ApiError('YouTube rate-limited the request. Try again in a minute.', 502);
    }
    throw new ApiError('Could not fetch YouTube transcript.', 502);
  }
}

export async function fetchYouTubeTranscript(
  videoId: string
): Promise<{ transcript: string; title: string | null }> {
  try {
    return await fetchTranscriptViaInnertube(videoId);
  } catch (innertubeErr) {
    if (innertubeErr instanceof ApiError && innertubeErr.statusCode === 422) {
      throw innertubeErr;
    }

    try {
      return await fetchTranscriptViaPackage(videoId);
    } catch (packageErr) {
      if (packageErr instanceof ApiError) {
        throw packageErr;
      }
      if (innertubeErr instanceof ApiError) {
        throw innertubeErr;
      }
      throw new ApiError('Could not fetch YouTube transcript.', 502);
    }
  }
}
