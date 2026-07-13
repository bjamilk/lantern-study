import { normalizeStorageUrl, parseStorageObjectUrl } from './storageUrl';

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
});
