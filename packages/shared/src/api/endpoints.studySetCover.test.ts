/**
 * Study-set cover client functions.
 *
 * Kept beside `endpoints.covers.test.ts` rather than inside it because the set
 * routes hang off a DIFFERENT base — `/users/me/study-sets/:id/cover`, not
 * `/study-sets/:id/cover` — and that prefix is the whole bug worth pinning: a
 * client aimed one segment short gets a 404 that looks exactly like a missing
 * migration to the student reading the error.
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
  coverPath: 'user-1/study-sets/set-1/1757600000-cover.webp',
  coverUrl: 'https://signed.test/cover?token=abc',
  coverThumbUrl: 'https://signed.test/cover.thumb.webp?token=abc',
};

describe('study set cover client', () => {
  it('posts the cover as JSON to /users/me/study-sets/:id/cover', async () => {
    const request = jest.fn().mockResolvedValue(RESULT);
    const api = createApiEndpoints(createClient(request));

    await expect(api.uploadStudySetCover('set-1', PAYLOAD)).resolves.toEqual(RESULT);

    const [path, init] = request.mock.calls[0];
    expect(path).toBe('/users/me/study-sets/set-1/cover');
    expect(init.method).toBe('POST');
    // JSON body, not FormData — the route reads req.body.base64Data.
    expect(typeof init.body).toBe('string');
    expect(JSON.parse(init.body)).toEqual(PAYLOAD);
  });

  it('stores a PATH, never one of the two signed urls', async () => {
    const request = jest.fn().mockResolvedValue(RESULT);
    const api = createApiEndpoints(createClient(request));

    const result = await api.uploadStudySetCover('set-1', PAYLOAD);

    // A persisted signed URL is a broken image in 24h — the chat-photo bug.
    expect(result.coverPath).not.toMatch(/^https?:/);
    expect(result.coverPath).toContain('/study-sets/');
  });

  it('escapes a set id rather than pasting it into the path', async () => {
    const request = jest.fn().mockResolvedValue(RESULT);
    const api = createApiEndpoints(createClient(request));

    await api.uploadStudySetCover('a b/c', PAYLOAD);

    expect(request.mock.calls[0][0]).toBe('/users/me/study-sets/a%20b%2Fc/cover');
  });

  it('clears with DELETE and no body', async () => {
    const request = jest.fn().mockResolvedValue({ coverPath: null });
    const api = createApiEndpoints(createClient(request));

    await expect(api.clearStudySetCover('set-1')).resolves.toEqual({ coverPath: null });

    const [path, init] = request.mock.calls[0];
    expect(path).toBe('/users/me/study-sets/set-1/cover');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });
});
