import {
  normalizeStorageUrl,
  parseStorageObjectUrl,
  parseStoredStorageRef,
  toPersistedMarketplaceImageUrl,
} from './storageUrl';

describe('normalizeStorageUrl', () => {
  it('rewrites legacy localhost:54321 storage URLs', () => {
    const url =
      'http://localhost:54321/storage/v1/object/public/question-images/question-test.png';
    expect(normalizeStorageUrl(url, 'http://127.0.0.1:55421')).toBe(
      'http://127.0.0.1:55421/storage/v1/object/public/question-images/question-test.png'
    );
  });

  it('leaves data URLs unchanged', () => {
    const dataUrl = 'data:image/png;base64,abc';
    expect(normalizeStorageUrl(dataUrl, 'http://127.0.0.1:55421')).toBe(dataUrl);
  });

  it('leaves cloud storage URLs unchanged without requiring env config', () => {
    const url =
      'https://tiizkjhbrnaibaagmurl.supabase.co/storage/v1/object/public/question-images/q.png';
    expect(normalizeStorageUrl(url)).toBe(url);
  });

  it('parses public storage object URLs', () => {
    const url =
      'http://127.0.0.1:55421/storage/v1/object/public/question-images/user-1/questions/q.png';
    expect(parseStorageObjectUrl(url)).toEqual({
      bucket: 'question-images',
      path: 'user-1/questions/q.png',
    });
  });

  it('parses signed storage object URLs', () => {
    const url =
      'https://example.supabase.co/storage/v1/object/sign/marketplace-images/u1/listings/x.jpg?token=abc';
    expect(parseStorageObjectUrl(url)).toEqual({
      bucket: 'marketplace-images',
      path: 'u1/listings/x.jpg',
    });
  });

  it('parses signed chat voice-note URLs for re-signing', () => {
    const url =
      'https://example.supabase.co/storage/v1/object/sign/note-files/owner/chat/group1/voice-1.webm?token=abc.def';
    expect(parseStorageObjectUrl(url)).toEqual({
      bucket: 'note-files',
      path: 'owner/chat/group1/voice-1.webm',
    });
  });
});

describe('parseStoredStorageRef', () => {
  it('parses a bare marketplace shop-cover path', () => {
    const path =
      '1e547f81-77c8-437a-8154-c84e8cf2045e/temp/1789298321752-cover.webp';
    expect(parseStoredStorageRef(path)).toEqual({
      bucket: 'marketplace-images',
      path,
    });
  });

  it('parses bucket/path for a known private bucket', () => {
    expect(
      parseStoredStorageRef('marketplace-images/u1/shop/cover.webp'),
    ).toEqual({
      bucket: 'marketplace-images',
      path: 'u1/shop/cover.webp',
    });
  });

  it('ignores unrelated relative strings', () => {
    expect(parseStoredStorageRef('just-a-filename.webp')).toBeNull();
    expect(parseStoredStorageRef('docs/readme.md')).toBeNull();
  });
});

describe('toPersistedMarketplaceImageUrl', () => {
  const ownerId = '1e547f81-77c8-437a-8154-c84e8cf2045e';
  const supabaseUrl = 'https://example.supabase.co';

  it('rewrites a bare path into an unsigned object URL', () => {
    expect(
      toPersistedMarketplaceImageUrl(`${ownerId}/temp/cover.webp`, {
        ownerId,
        supabaseUrl,
      }),
    ).toBe(
      `${supabaseUrl}/storage/v1/object/marketplace-images/${ownerId}/temp/cover.webp`,
    );
  });

  it('rejects a path owned by someone else', () => {
    expect(
      toPersistedMarketplaceImageUrl('other-user/shop/cover.webp', {
        ownerId,
        supabaseUrl,
      }),
    ).toBeNull();
  });
});
