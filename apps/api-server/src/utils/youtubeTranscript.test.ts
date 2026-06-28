import { decodeTranscriptXml, extractYouTubeVideoId, fetchYouTubeTranscript } from './youtubeTranscript';
import { ApiError } from '../middleware/errorHandler';

jest.mock('youtube-transcript', () => ({
  YoutubeTranscript: {
    fetchTranscript: jest.fn(),
  },
}));

import { YoutubeTranscript } from 'youtube-transcript';

const mockFetchTranscript = YoutubeTranscript.fetchTranscript as jest.Mock;

describe('extractYouTubeVideoId', () => {
  it('parses watch URLs', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses youtu.be URLs', () => {
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
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

  it('returns transcript from innertube captions', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '"INNERTUBE_API_KEY":"test-key"',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          videoDetails: { title: 'Test Video' },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{ baseUrl: 'https://example.com/captions', languageCode: 'en' }],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<transcript><text>Hello</text><text>world</text></transcript>',
      });

    const result = await fetchYouTubeTranscript('dQw4w9WgXcQ');
    expect(result).toEqual({ transcript: 'Hello world', title: 'Test Video' });
    expect(mockFetchTranscript).not.toHaveBeenCalled();
  });

  it('throws 422 when no captions are available', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '"INNERTUBE_API_KEY":"test-key"',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          playabilityStatus: { reason: 'Sign in to confirm your age' },
          captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
        }),
      });

    mockFetchTranscript.mockRejectedValue(new Error('Transcript not available'));

    await expect(fetchYouTubeTranscript('dQw4w9WgXcQ')).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('throws 502 when watch page cannot be loaded', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503 });

    await expect(fetchYouTubeTranscript('dQw4w9WgXcQ')).rejects.toMatchObject({ statusCode: 502 });
  });
});
