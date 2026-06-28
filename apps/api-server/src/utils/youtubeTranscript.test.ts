import { decodeTranscriptXml, extractYouTubeVideoId, fetchYouTubeTranscript } from './youtubeTranscript';
import { ApiError } from '../middleware/errorHandler';
import {
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptTooManyRequestError,
} from 'youtube-transcript';

jest.mock('youtube-transcript', () => {
  const actual = jest.requireActual('youtube-transcript');
  return {
    ...actual,
    YoutubeTranscript: {
      fetchTranscript: jest.fn(),
    },
  };
});

import { YoutubeTranscript } from 'youtube-transcript';

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

  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns transcript from package without lang lock', async () => {
    mockFetchTranscript.mockResolvedValue([
      { text: 'Bonjour', duration: 1, offset: 0 },
      { text: 'monde', duration: 1, offset: 1 },
    ]);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ title: 'French Video' }),
    });

    const result = await fetchYouTubeTranscript('dQw4w9WgXcQ');
    expect(result).toEqual({ transcript: 'Bonjour monde', title: 'French Video' });
    expect(mockFetchTranscript).toHaveBeenCalledWith(
      'dQw4w9WgXcQ',
      expect.objectContaining({ fetch: expect.any(Function) })
    );
    expect(mockFetchTranscript.mock.calls[0][1]?.lang).toBeUndefined();
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

  it('throws 502 when rate limited', async () => {
    mockFetchTranscript.mockRejectedValue(new YoutubeTranscriptTooManyRequestError());

    await expect(fetchYouTubeTranscript('dQw4w9WgXcQ')).rejects.toMatchObject({
      statusCode: 502,
    });
  });

  it('throws 502 on unexpected package failure', async () => {
    mockFetchTranscript.mockRejectedValue(new Error('network down'));

    await expect(fetchYouTubeTranscript('dQw4w9WgXcQ')).rejects.toBeInstanceOf(ApiError);
    await expect(fetchYouTubeTranscript('dQw4w9WgXcQ')).rejects.toMatchObject({ statusCode: 502 });
  });
});
