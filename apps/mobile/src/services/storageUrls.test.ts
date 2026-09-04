/**
 * A stored media url is a REFERENCE, never a display url.
 *
 * `uploadChatImage` signs the object once, at upload time, and
 * `clampSignedUrlTtl` caps every signed url at STORAGE_SIGNED_URL_MAX_TTL —
 * 24 hours. That clamped string is then written verbatim into `messages.text`
 * and nothing ever re-signs it, so a day later the photo 400s. Mobile passed
 * it through `normalizeStorageUrl` (which returns cloud urls unchanged) into
 * `ChatImageThumbnail`, whose `if (failed) return null` made the photo
 * disappear with no error anywhere.
 *
 * These tests hold the read-side fix: an expired url is re-signed, the whole
 * screen's worth of photos costs ONE request, and a refusal is surfaced rather
 * than swallowed.
 */
const getAuthHeaders = jest.fn(async () => ({ Authorization: 'Bearer test' }));

jest.mock('./supabase', () => ({
  API_BASE_URL: 'https://api.test',
  getAuthHeaders: (...args: unknown[]) => (getAuthHeaders as any)(...args),
}));

import { fetchSignedStorageUrl, resolveStorageDisplayUrl } from './storageUrls';
import { clearSignedUrlCache } from '../utils/signedUrlCache';

/** What the server wrote into `messages.text` a day ago. The token is dead. */
const EXPIRED =
  'https://xyz.supabase.co/storage/v1/object/sign/note-files/user-1/chat/group-9/1756900000000-photo.webp?token=dead.token.from.yesterday';

type BatchBody = {
  items: Array<{ bucket: string; path: string; variant: string }>;
  expiresInSeconds: number;
};

function mockBatch(
  handler: (body: BatchBody) => { ok?: boolean; payload: unknown },
): { calls: BatchBody[]; urls: string[] } {
  const calls: BatchBody[] = [];
  const urls: string[] = [];
  (global as any).fetch = jest.fn(async (url: string, init: any) => {
    urls.push(url);
    const body = JSON.parse(init.body) as BatchBody;
    calls.push(body);
    const { ok = true, payload } = handler(body);
    return { ok, json: async () => payload } as any;
  });
  return { calls, urls };
}

beforeEach(() => {
  clearSignedUrlCache();
  jest.clearAllMocks();
});

describe('resolveStorageDisplayUrl', () => {
  it('re-signs an EXPIRED stored url instead of handing it back', async () => {
    const { calls, urls } = mockBatch((body) => ({
      payload: {
        success: true,
        data: {
          items: body.items.map((item) => ({
            ...item,
            signedUrl: `https://xyz.supabase.co/storage/v1/object/sign/${item.bucket}/${item.path}?token=fresh`,
          })),
        },
      },
    }));

    const resolved = await resolveStorageDisplayUrl(EXPIRED);

    expect(resolved).not.toBe(EXPIRED);
    expect(resolved).toContain('token=fresh');
    // The dead token is not what re-authorises the read: the PATH is, and
    // `parseStorageObjectUrl` recovers it from the corpse of the old url.
    expect(calls[0]?.items[0]).toEqual({
      bucket: 'note-files',
      path: 'user-1/chat/group-9/1756900000000-photo.webp',
      variant: 'original',
    });
    expect(urls[0]).toBe('https://api.test/api/v1/storage/signed-urls');
  });

  it('asks for the 480px sibling thumb when low-data mode wants one', async () => {
    const { calls } = mockBatch((body) => ({
      payload: {
        success: true,
        data: { items: body.items.map((item) => ({ ...item, signedUrl: 'https://cdn/thumb' })) },
      },
    }));

    await resolveStorageDisplayUrl(EXPIRED, { variant: 'thumb' });

    expect(calls[0]?.items[0]?.variant).toBe('thumb');
  });

  it('costs ONE request for a whole screen of photos', async () => {
    const { calls } = mockBatch((body) => ({
      payload: {
        success: true,
        data: {
          items: body.items.map((item) => ({ ...item, signedUrl: `https://cdn/${item.path}` })),
        },
      },
    }));

    const stored = Array.from(
      { length: 20 },
      (_, i) =>
        `https://xyz.supabase.co/storage/v1/object/sign/note-files/user-1/chat/group-9/photo-${i}.webp?token=dead`,
    );
    const resolved = await Promise.all(stored.map((url) => resolveStorageDisplayUrl(url)));

    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    expect(calls[0]?.items).toHaveLength(20);
    expect(resolved[19]).toBe('https://cdn/user-1/chat/group-9/photo-19.webp');
  });

  it('serves the second render from cache rather than signing again', async () => {
    mockBatch((body) => ({
      payload: {
        success: true,
        data: { items: body.items.map((item) => ({ ...item, signedUrl: 'https://cdn/one' })) },
      },
    }));

    await resolveStorageDisplayUrl(EXPIRED);
    await resolveStorageDisplayUrl(EXPIRED);

    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects — so the caller can say "Photo unavailable" — when access is refused', async () => {
    mockBatch((body) => ({
      payload: {
        success: true,
        data: {
          items: body.items.map((item) => ({ ...item, signedUrl: null, error: 'access_denied' })),
        },
      },
    }));

    await expect(resolveStorageDisplayUrl(EXPIRED)).rejects.toThrow('access_denied');
  });

  it('leaves public and inline sources alone', async () => {
    mockBatch(() => ({ payload: { success: true, data: { items: [] } } }));

    await expect(resolveStorageDisplayUrl('data:image/png;base64,AAA')).resolves.toBe(
      'data:image/png;base64,AAA',
    );
    await expect(resolveStorageDisplayUrl('https://example.com/logo.png')).resolves.toBe(
      'https://example.com/logo.png',
    );
    await expect(resolveStorageDisplayUrl(null)).resolves.toBeUndefined();
    expect((global as any).fetch).not.toHaveBeenCalled();
  });
});

describe('fetchSignedStorageUrl', () => {
  it('surfaces a failed batch instead of returning a dead url', async () => {
    mockBatch(() => ({ ok: false, payload: { error: 'Access denied' } }));

    await expect(
      fetchSignedStorageUrl('note-files', 'user-1/chat/group-9/photo.webp'),
    ).rejects.toThrow('Access denied');
  });
});
