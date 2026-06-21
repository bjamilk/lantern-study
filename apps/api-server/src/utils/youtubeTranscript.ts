/**
 * Fetch YouTube captions/transcript without API key (public captions only).
 * Uses YouTube's Innertube player API — scraping caption URLs from the watch page
 * no longer returns usable signed URLs.
 */

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

function decodeTranscriptXml(xml: string): string {
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

async function fetchInnertubePlayer(videoId: string) {
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

  const html = await watchRes.text();
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  if (!apiKeyMatch?.[1]) {
    throw new ApiError('Could not initialize YouTube transcript fetch.', 502);
  }

  const playerRes = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${apiKeyMatch[1]}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
            androidSdkVersion: 30,
            hl: 'en',
            gl: 'US',
          },
        },
      }),
    }
  );

  if (!playerRes.ok) {
    throw new ApiError('Could not load YouTube player data.', 502);
  }

  return playerRes.json() as Promise<{
    videoDetails?: { title?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: Array<{ baseUrl?: string; languageCode?: string }>;
      };
    };
    playabilityStatus?: { status?: string; reason?: string };
  }>;
}

export async function fetchYouTubeTranscript(
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

  return { transcript, title };
}
