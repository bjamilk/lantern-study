import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

/**
 * YouTube transcript fetching with a library-first cascade:
 *   1. Shared cache (youtube_transcripts table) — transcripts never change.
 *   2. YouTube InnerTube player API (free, no key; can be IP-blocked on cloud hosts).
 *   3. Managed fallback (Supadata) — only when SUPADATA_API_KEY is set.
 */

export interface TranscriptSegment {
  /** Seconds from video start. */
  start: number;
  /** Seconds. */
  duration: number;
  text: string;
}

export interface YoutubeTranscript {
  videoId: string;
  language: string | null;
  source: 'cache' | 'innertube' | 'supadata';
  text: string;
  segments: TranscriptSegment[];
}

export interface YoutubeVideoMetadata {
  title: string;
  authorName: string | null;
  thumbnailUrl: string | null;
}

const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Free oEmbed endpoint — title/author only, no key needed. */
export async function fetchYoutubeMetadata(videoId: string): Promise<YoutubeVideoMetadata | null> {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    if (!data.title) return null;
    return {
      title: data.title,
      authorName: data.author_name || null,
      thumbnailUrl: data.thumbnail_url || null,
    };
  } catch (err) {
    logger.warn('YouTube oEmbed lookup failed', { videoId, err });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider 1: InnerTube (what open-source transcript libraries use internally)
// ---------------------------------------------------------------------------

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string; // 'asr' for auto-generated
}

function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const usable = tracks.filter((t) => typeof t.baseUrl === 'string' && t.baseUrl);
  if (usable.length === 0) return null;
  const isEnglish = (t: CaptionTrack) => (t.languageCode || '').toLowerCase().startsWith('en');
  return (
    usable.find((t) => isEnglish(t) && t.kind !== 'asr') ||
    usable.find((t) => isEnglish(t)) ||
    usable.find((t) => t.kind !== 'asr') ||
    usable[0]
  );
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function parseTimedTextJson3(body: string): TranscriptSegment[] {
  const timedText = JSON.parse(body) as {
    events?: Array<{
      tStartMs?: number;
      dDurationMs?: number;
      segs?: Array<{ utf8?: string }>;
    }>;
  };
  const segments: TranscriptSegment[] = [];
  for (const event of timedText.events || []) {
    const text = (event.segs || [])
      .map((s) => s.utf8 || '')
      .join('')
      .replace(/\n/g, ' ')
      .trim();
    if (!text) continue;
    segments.push({
      start: (event.tStartMs || 0) / 1000,
      duration: (event.dDurationMs || 0) / 1000,
      text,
    });
  }
  return segments;
}

/**
 * Timedtext XML. Two shapes exist:
 *   - legacy web:      <text start="1.2" dur="3.4">caption</text>   (seconds)
 *   - android format3: <p t="1200" d="3400">caption</p>             (milliseconds)
 */
function parseTimedTextXml(body: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  const textRe = /<text[^>]*start="([\d.]+)"[^>]*(?:dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = textRe.exec(body)) !== null) {
    const text = decodeXmlEntities(match[3].replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    segments.push({
      start: parseFloat(match[1]) || 0,
      duration: match[2] ? parseFloat(match[2]) || 0 : 0,
      text,
    });
  }
  if (segments.length > 0) return segments;

  const pRe = /<p[^>]*\bt="(\d+)"[^>]*(?:\bd="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
  while ((match = pRe.exec(body)) !== null) {
    const text = decodeXmlEntities(match[3].replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    segments.push({
      start: (parseInt(match[1], 10) || 0) / 1000,
      duration: match[2] ? (parseInt(match[2], 10) || 0) / 1000 : 0,
      text,
    });
  }
  return segments;
}

type InnertubeClient = {
  clientName: string;
  clientVersion: string;
  userAgent: string;
  extra?: Record<string, unknown>;
};

const INNERTUBE_CLIENTS: InnertubeClient[] = [
  {
    // ANDROID bypasses most consent/age walls and returns caption tracks.
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
    extra: { androidSdkVersion: 30 },
  },
  {
    // WEB as a second attempt when datacenter IPs trip ANDROID restrictions.
    clientName: 'WEB',
    clientVersion: '2.20250320.01.00',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  },
];

function humanizePlayabilityError(status: string, reason?: string): string {
  const detail = reason ? `: ${reason}` : '';
  if (/LOGIN_REQUIRED|UNPLAYABLE|AGE/i.test(`${status} ${reason || ''}`)) {
    return 'This video is private, age-restricted, or otherwise unavailable for transcript fetch.';
  }
  if (/ERROR|CONTENT_CHECK_REQUIRED/i.test(status)) {
    return `This video cannot be accessed for transcripts (${status}${detail}).`;
  }
  return `Video is not playable (${status}${detail})`;
}

async function fetchTranscriptViaInnertubeClient(
  videoId: string,
  client: InnertubeClient
): Promise<YoutubeTranscript> {
  const playerRes = await fetchWithTimeout(
    'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': client.userAgent,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: client.clientName,
            clientVersion: client.clientVersion,
            hl: 'en',
            ...(client.extra || {}),
          },
        },
        videoId,
      }),
    }
  );
  if (!playerRes.ok) {
    throw new Error(`InnerTube player request failed (${playerRes.status})`);
  }

  const player = (await playerRes.json()) as {
    playabilityStatus?: { status?: string; reason?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
    };
  };

  const status = player.playabilityStatus?.status;
  if (status && status !== 'OK') {
    throw new Error(humanizePlayabilityError(status, player.playabilityStatus?.reason));
  }

  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const track = pickCaptionTrack(tracks);
  if (!track?.baseUrl) {
    throw new Error('This video has no captions or transcript available.');
  }

  const timedTextUrl = `${track.baseUrl}${track.baseUrl.includes('?') ? '&' : '?'}fmt=json3`;
  const textRes = await fetchWithTimeout(timedTextUrl, {
    headers: { 'User-Agent': client.userAgent },
  });
  if (!textRes.ok) {
    throw new Error(`Transcript download failed (${textRes.status})`);
  }

  // Some caption tracks ignore fmt=json3 and return the legacy XML format.
  const rawBody = await textRes.text();
  const segments = rawBody.trimStart().startsWith('<')
    ? parseTimedTextXml(rawBody)
    : parseTimedTextJson3(rawBody);

  if (segments.length === 0) {
    throw new Error('Transcript was empty.');
  }

  return {
    videoId,
    language: track.languageCode || null,
    source: 'innertube',
    text: segments.map((s) => s.text).join(' '),
    segments,
  };
}

async function fetchTranscriptViaInnertube(videoId: string): Promise<YoutubeTranscript> {
  let lastError: Error | null = null;
  for (const client of INNERTUBE_CLIENTS) {
    try {
      return await fetchTranscriptViaInnertubeClient(videoId, client);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn('InnerTube client failed', {
        videoId,
        client: client.clientName,
        error: lastError.message,
      });
    }
  }
  throw lastError || new Error('Could not fetch a transcript for this video.');
}

// ---------------------------------------------------------------------------
// Provider 2: managed fallback (Supadata) — stubbed behind SUPADATA_API_KEY
// ---------------------------------------------------------------------------

export function isManagedTranscriptFallbackEnabled(): boolean {
  return Boolean(process.env.SUPADATA_API_KEY);
}

async function fetchTranscriptViaSupadata(videoId: string): Promise<YoutubeTranscript> {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) {
    throw new Error('Managed transcript fallback is not configured (SUPADATA_API_KEY unset).');
  }

  const res = await fetchWithTimeout(
    `https://api.supadata.ai/v1/youtube/transcript?videoId=${encodeURIComponent(videoId)}&text=false`,
    { headers: { 'x-api-key': apiKey } }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supadata transcript request failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`);
  }

  const data = (await res.json()) as {
    lang?: string;
    content?: Array<{ text?: string; offset?: number; duration?: number }>;
  };

  const segments: TranscriptSegment[] = (data.content || [])
    .filter((c) => typeof c.text === 'string' && c.text.trim())
    .map((c) => ({
      start: (c.offset || 0) / 1000,
      duration: (c.duration || 0) / 1000,
      text: String(c.text).replace(/\n/g, ' ').trim(),
    }));

  if (segments.length === 0) {
    throw new Error('Supadata returned an empty transcript.');
  }

  return {
    videoId,
    language: data.lang || null,
    source: 'supadata',
    text: segments.map((s) => s.text).join(' '),
    segments,
  };
}

// ---------------------------------------------------------------------------
// Cache + cascade
// ---------------------------------------------------------------------------

async function readTranscriptCache(
  client: SupabaseClient,
  videoId: string
): Promise<YoutubeTranscript | null> {
  const { data, error } = await client
    .from('youtube_transcripts')
    .select('video_id, language, transcript_text, segments')
    .eq('video_id', videoId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    videoId: data.video_id,
    language: data.language || null,
    source: 'cache',
    text: data.transcript_text,
    segments: Array.isArray(data.segments) ? (data.segments as TranscriptSegment[]) : [],
  };
}

async function writeTranscriptCache(
  client: SupabaseClient,
  transcript: YoutubeTranscript
): Promise<void> {
  const { error } = await client.from('youtube_transcripts').upsert({
    video_id: transcript.videoId,
    language: transcript.language,
    source: transcript.source,
    transcript_text: transcript.text,
    segments: transcript.segments,
    fetched_at: new Date().toISOString(),
  });
  if (error) {
    logger.warn('Failed to cache YouTube transcript', { videoId: transcript.videoId, error });
  }
}

export async function getYoutubeTranscript(
  client: SupabaseClient,
  videoId: string
): Promise<YoutubeTranscript> {
  const cached = await readTranscriptCache(client, videoId);
  if (cached && cached.text.trim()) return cached;

  let innertubeError: Error | null = null;
  try {
    const transcript = await fetchTranscriptViaInnertube(videoId);
    await writeTranscriptCache(client, transcript);
    return transcript;
  } catch (err) {
    innertubeError = err instanceof Error ? err : new Error(String(err));
    logger.warn('InnerTube transcript fetch failed', { videoId, error: innertubeError.message });
  }

  if (isManagedTranscriptFallbackEnabled()) {
    try {
      const transcript = await fetchTranscriptViaSupadata(videoId);
      await writeTranscriptCache(client, transcript);
      return transcript;
    } catch (err) {
      const supadataError = err instanceof Error ? err : new Error(String(err));
      logger.warn('Supadata transcript fetch failed', {
        videoId,
        error: supadataError.message,
      });
      if (/402|credit|quota|rate.?limit|429/i.test(supadataError.message)) {
        throw new Error(
          'Transcript provider rate-limited or out of credits. Try again in a few minutes.'
        );
      }
      throw new Error(
        innertubeError?.message ||
          supadataError.message ||
          'Could not fetch a transcript for this video.'
      );
    }
  }

  const baseMessage =
    innertubeError?.message || 'Could not fetch a transcript for this video.';
  // Cloud hosts are often IP-blocked by YouTube's free caption endpoints.
  if (/failed \(\d{3}\)|abort|timeout|fetch/i.test(baseMessage)) {
    throw new Error(
      `${baseMessage} YouTube may be blocking transcript fetches from this server. Try again later, or use a video with public captions.`
    );
  }
  throw new Error(baseMessage);
}

// ---------------------------------------------------------------------------
// Formatting for note study content
// ---------------------------------------------------------------------------

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const BLOCK_WINDOW_SECONDS = 30;

/** Groups segments into ~30s timestamped paragraphs: "[m:ss] text…" */
export function formatTranscriptForNote(segments: TranscriptSegment[]): string {
  if (segments.length === 0) return '';
  const blocks: string[] = [];
  let blockStart = segments[0].start;
  let blockParts: string[] = [];

  for (const segment of segments) {
    if (blockParts.length > 0 && segment.start - blockStart >= BLOCK_WINDOW_SECONDS) {
      blocks.push(`[${formatTimestamp(blockStart)}] ${blockParts.join(' ')}`);
      blockStart = segment.start;
      blockParts = [];
    }
    blockParts.push(segment.text);
  }
  if (blockParts.length > 0) {
    blocks.push(`[${formatTimestamp(blockStart)}] ${blockParts.join(' ')}`);
  }
  return blocks.join('\n\n');
}
