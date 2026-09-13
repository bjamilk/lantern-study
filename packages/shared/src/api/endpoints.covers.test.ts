/**
 * Cover-image client functions.
 *
 * The payload shape has to match the server route exactly — the flashcard
 * upload shipped a FormData variant that the JSON route answered with a 500
 * instead of a validation error, and that is the mistake being pinned here.
 * The other half is the contract that matters for correctness: what comes back
 * and is STORED is `coverPath`; the signed urls are display-only.
 */
import { createApiEndpoints } from './endpoints';
import type { ApiClient } from './client';

function createClient(request: jest.Mock): ApiClient {
  return {
    request,
    requestRaw: jest.fn(),
    requestText: jest.fn(),
    getBaseUrl: () => 'https://example.test',
  };
}

const PAYLOAD = {
  base64Data: 'iVBORw0KGgo=',
  fileName: 'cover.png',
  contentType: 'image/png',
};

const RESULT = {
  coverPath: 'user-1/decks/deck-1/1757600000-cover.webp',
  coverUrl: 'https://signed.test/cover?token=abc',
  coverThumbUrl: 'https://signed.test/cover.thumb.webp?token=abc',
};

describe('cover upload clients', () => {
  it('posts a deck cover as JSON to /decks/:id/cover', async () => {
    const request = jest.fn().mockResolvedValue(RESULT);
    const api = createApiEndpoints(createClient(request));

    await expect(api.uploadDeckCover('deck-1', PAYLOAD)).resolves.toEqual(RESULT);

    const [path, init] = request.mock.calls[0];
    expect(path).toBe('/decks/deck-1/cover');
    expect(init.method).toBe('POST');
    // JSON body, not FormData — the route reads req.body.base64Data.
    expect(typeof init.body).toBe('string');
    expect(JSON.parse(init.body)).toEqual(PAYLOAD);
  });

  it('posts a note cover as JSON to /notes/:id/cover', async () => {
    const request = jest.fn().mockResolvedValue(RESULT);
    const api = createApiEndpoints(createClient(request));

    await api.uploadNoteCover('note-7', PAYLOAD);

    const [path, init] = request.mock.calls[0];
    expect(path).toBe('/notes/note-7/cover');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(PAYLOAD);
  });

  it('returns a storage path, never a url, as the value to persist', async () => {
    const request = jest.fn().mockResolvedValue(RESULT);
    const api = createApiEndpoints(createClient(request));

    const result = await api.uploadDeckCover('deck-1', PAYLOAD);
    expect(result.coverPath).not.toMatch(/^https?:/);
    expect(result.coverUrl).toMatch(/^https:/);
  });
});

describe('cover clear clients', () => {
  it('deletes a deck cover with no body', async () => {
    const request = jest.fn().mockResolvedValue({ coverPath: null });
    const api = createApiEndpoints(createClient(request));

    await expect(api.clearDeckCover('deck-1')).resolves.toEqual({ coverPath: null });
    expect(request.mock.calls[0][0]).toBe('/decks/deck-1/cover');
    expect(request.mock.calls[0][1]).toEqual({ method: 'DELETE' });
  });

  it('deletes a note cover with no body', async () => {
    const request = jest.fn().mockResolvedValue({ coverPath: null });
    const api = createApiEndpoints(createClient(request));

    await api.clearNoteCover('note-7');
    expect(request.mock.calls[0][0]).toBe('/notes/note-7/cover');
    expect(request.mock.calls[0][1]).toEqual({ method: 'DELETE' });
  });
});
