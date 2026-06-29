import { ApiError } from '../middleware/errorHandler';

const SUPADATA_BASE_URL = 'https://api.supadata.ai/v1';
const REQUEST_TIMEOUT_MS = 10_000;

export function getSupadataApiKey(): string | null {
  const key = process.env.SUPADATA_API_KEY?.trim();
  return key || null;
}

function parseTranscriptBody(data: unknown): string {
  if (typeof data === 'string') return data.trim();
  if (!data || typeof data !== 'object') return '';

  const obj = data as Record<string, unknown>;
  if (typeof obj.text === 'string') return obj.text.trim();
  if (typeof obj.content === 'string') return obj.content.trim();

  if (Array.isArray(obj.content)) {
    return obj.content
      .map((segment) => {
        if (!segment || typeof segment !== 'object') return '';
        const text = (segment as { text?: string }).text;
        return typeof text === 'string' ? text.trim() : '';
      })
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  return '';
}

export function mapSupadataHttpError(status: number, body: unknown): ApiError {
  const message =
    body && typeof body === 'object' && 'message' in body
      ? String((body as { message?: string }).message)
      : body && typeof body === 'object' && 'error' in body
        ? String((body as { error?: string }).error)
        : '';

  switch (status) {
    case 401:
      return new ApiError('YouTube import is not available right now. Please try again later.', 503);
    case 402:
      return new ApiError(
        'YouTube import credits exhausted. Try again later or contact support.',
        402
      );
    case 404:
    case 422:
      return new ApiError(
        'No captions available for this video. Enable captions on the video or try another link.',
        422
      );
    case 429:
      return new ApiError('Too many imports right now. Wait a minute and try again.', 429);
    default:
      if (status >= 500) {
        return new ApiError('YouTube transcript service is temporarily unavailable. Try again.', 502);
      }
      return new ApiError(message || 'Could not fetch YouTube transcript.', 502);
  }
}

export async function fetchSupadataTranscript(videoId: string): Promise<string> {
  const apiKey = getSupadataApiKey();
  if (!apiKey) {
    throw new ApiError(
      'YouTube import is not available right now. Please try again later.',
      503
    );
  }

  const url = new URL(`${SUPADATA_BASE_URL}/youtube/transcript`);
  url.searchParams.set('videoId', videoId);
  url.searchParams.set('text', 'true');

  const response = await fetch(url.toString(), {
    headers: {
      'x-api-key': apiKey,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const contentType = response.headers.get('content-type') || '';
  let body: unknown;
  if (contentType.includes('application/json')) {
    body = await response.json().catch(() => null);
  } else {
    body = await response.text().catch(() => '');
  }

  if (!response.ok) {
    throw mapSupadataHttpError(response.status, body);
  }

  const transcript = parseTranscriptBody(body);
  if (!transcript) {
    throw new ApiError('Transcript was empty.', 422);
  }

  return transcript;
}
