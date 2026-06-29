import { decodeTranscriptXml, extractYouTubeVideoId, fetchYouTubeTranscript } from './youtubeTranscript';
import { ApiError } from '../middleware/errorHandler';
import {
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptTooManyRequestError,
} from 'youtube-transcript';

jest.mock('../services/cache', () => ({
  cacheService: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

jest.mock('../services/supadataYoutube', () => ({
  fetchSupadataTranscript: jest.fn(),
  getSupadataApiKey: jest.fn(),
}));

jest.mock('youtube-transcript', () => {
  const actual = jest.requireActual('youtube-transcript');
  return {
    ...actual,
    YoutubeTranscript: {
      fetchTranscript: jest.fn(),
    },
  };
});

import { cacheService } from '../services/cache';
import { fetchSupadataTranscript, getSupadataApiKey } from '../services/supadataYoutube';
import { YoutubeTranscript } from 'youtube-transcript';

const mockCacheGet = cacheService.get as jest.Mock;
const mockCacheSet = cacheService.set as jest.Mock;
const mockGetSupadataApiKey = getSupadataApiKey as jest.Mock;
const mockFetchSupadataTranscript = fetchSupadataTranscript as jest.Mock;
const mockFetchTranscript = YoutubeTranscript.fetchTranscript as jest.Mock;

describe('extractYouTubeVideoId', () => {
  it('parses watch URLs', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses youtu.be URLs', () => {
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses shorts URLs', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses live URLs', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
});

describe('decodeTranscriptXml', () => {
  it('extracts text nodes', () => {
    const xml = '<transcript><text>Hello</text><text>world</text></transcript>';
    expect(decodeTranscriptXml(xml)).toBe('Hello world');
  });
});

describe('fetchYouTubeTranscript', () => {
  const originalFetch = global.fetch;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.NODE_ENV = 'development';
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
    mockGetSupadataApiKey.mockReturnValue(null);
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns cached transcript without calling providers', async () => {
    mockCacheGet.mockResolvedValue({
      transcript: 'Cached transcript',
      title: 'Cached Title',
    });

    const result = await fetchYouTubeTranscript('dQw4w9WgXcQ');

    expect(result).toEqual({
      transcript: 'Cached transcript',
      title: 'Cached Title',
      provider: 'cache',
    });
    expect(mockFetchSupadataTranscript).not.toHaveBeenCalled();
    expect(mockFetchTranscript).not.toHaveBeenCalled();
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it('uses Supadata when API key is configured', async () => {
    mockGetSupadataApiKey.mockReturnValue('test-key');
    mockFetchSupadataTranscript.mockResolvedValue('Supadata transcript');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ title: 'Supadata Video' }),
    });

    const result = await fetchYouTubeTranscript('dQw4w9WgXcQ');

    expect(result).toEqual({
      transcript: 'Supadata transcript',
      title: 'Supadata Video',
      provider: 'supadata',
    });
    expect(mockFetchSupadataTranscript).toHaveBeenCalledWith('dQw4w9WgXcQ');
    expect(mockFetchTranscript).not.toHaveBeenCalled();
    expect(mockCacheSet).toHaveBeenCalledWith(
      'youtube:transcript:dQw4w9WgXcQ',
      { transcript: 'Supadata transcript', title: 'Supadata Video' },
      60 * 60 * 24 * 7
    );
  });

  it('returns transcript from scrape fallback in development', async () => {
    mockFetchTranscript.mockResolvedValue([
      { text: 'Bonjour', duration: 1, offset: 0 },
      { text: 'monde', duration: 1, offset: 1 },
    ]);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ title: 'French Video' }),
    });

    const result = await fetchYouTubeTranscript('dQw4w9WgXcQ');

    expect(result).toEqual({
      transcript: 'Bonjour monde',
      title: 'French Video',
      provider: 'scrape',
    });
    expect(mockFetchTranscript).toHaveBeenCalledWith(
      'dQw4w9WgXcQ',
      expect.objectContaining({ fetch: expect.any(Function) })
    );
    expect(mockFetchTranscript.mock.calls[0][1]?.lang).toBeUndefined();
  });

  it('throws 503 in production when Supadata key is missing', async () => {
    process.env.NODE_ENV = 'production';
    mockGetSupadataApiKey.mockReturnValue(null);

    await expect(fetchYouTubeTranscript('dQw4w9WgXcQ')).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(mockFetchTranscript).not.toHaveBeenCalled();
  });

  it('throws 422 when captions are disabled', async () => {
    mockFetchTranscript.mockRejectedValue(new YoutubeTranscriptDisabledError('dQw4w9WgXcQ'));

    await expect(fetchYouTubeTranscript('dQw4w9WgXcQ')).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('throws 422 when no captions exist', async () => {
    mockFetchTranscript.mockRejectedValue(new YoutubeTranscriptNotAvailableError('dQw4w9WgXcQ'));

    await expect(fetchYouTubeTranscript('dQw4w9WgXcQ')).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('throws 502 when rate limited via scrape', async () => {
    mockFetchTranscript.mockRejectedValue(new YoutubeTranscriptTooManyRequestError());

    await expect(fetchYouTubeTranscript('dQw4w9WgXcQ')).rejects.toMatchObject({
      statusCode: 502,
    });
  });

  it('maps Supadata 402 to ApiError', async () => {
    mockGetSupadataApiKey.mockReturnValue('test-key');
    mockFetchSupadataTranscript.mockRejectedValue(
      new ApiError('YouTube import credits exhausted. Try again later or contact support.', 402)
    );

    await expect(fetchYouTubeTranscript('dQw4w9WgXcQ')).rejects.toMatchObject({
      statusCode: 402,
    });
  });

  it('maps Supadata 429 to ApiError', async () => {
    mockGetSupadataApiKey.mockReturnValue('test-key');
    mockFetchSupadataTranscript.mockRejectedValue(
      new ApiError('Too many imports right now. Wait a minute and try again.', 429)
    );

    await expect(fetchYouTubeTranscript('dQw4w9WgXcQ')).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it('throws 502 on unexpected scrape failure', async () => {
    mockFetchTranscript.mockRejectedValue(new Error('network down'));

    await expect(fetchYouTubeTranscript('dQw4w9WgXcQ')).rejects.toBeInstanceOf(ApiError);
    await expect(fetchYouTubeTranscript('dQw4w9WgXcQ')).rejects.toMatchObject({ statusCode: 502 });
  });
});
