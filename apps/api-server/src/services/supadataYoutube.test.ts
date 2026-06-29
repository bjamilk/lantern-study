import { fetchSupadataTranscript, mapSupadataHttpError } from './supadataYoutube';
import { ApiError } from '../middleware/errorHandler';

describe('mapSupadataHttpError', () => {
  it('maps 401 to 503', () => {
    const err = mapSupadataHttpError(401, {});
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(503);
  });

  it('maps 402 to credits exhausted', () => {
    const err = mapSupadataHttpError(402, {});
    expect(err.statusCode).toBe(402);
    expect(err.message).toMatch(/credits exhausted/i);
  });

  it('maps 422 to no captions', () => {
    const err = mapSupadataHttpError(422, {});
    expect(err.statusCode).toBe(422);
    expect(err.message).toMatch(/no captions/i);
  });

  it('maps 429 to rate limit', () => {
    const err = mapSupadataHttpError(429, {});
    expect(err.statusCode).toBe(429);
    expect(err.message).toMatch(/too many imports/i);
  });
});

describe('fetchSupadataTranscript', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.SUPADATA_API_KEY;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.SUPADATA_API_KEY = 'test-supadata-key';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.SUPADATA_API_KEY;
    } else {
      process.env.SUPADATA_API_KEY = originalApiKey;
    }
  });

  it('returns plain text transcript when text=true', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/plain' },
      text: async () => 'Hello from Supadata',
    });

    const transcript = await fetchSupadataTranscript('dQw4w9WgXcQ');
    expect(transcript).toBe('Hello from Supadata');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('videoId=dQw4w9WgXcQ'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'test-supadata-key' }),
      })
    );
  });

  it('parses JSON content array', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        content: [{ text: 'Hello' }, { text: 'world' }],
      }),
    });

    const transcript = await fetchSupadataTranscript('dQw4w9WgXcQ');
    expect(transcript).toBe('Hello world');
  });

  it('throws 503 when API key is missing', async () => {
    delete process.env.SUPADATA_API_KEY;

    await expect(fetchSupadataTranscript('dQw4w9WgXcQ')).rejects.toMatchObject({
      statusCode: 503,
    });
  });
});
