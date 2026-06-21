import { normalizeStorageUrl } from './storageUrl';

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

  it('leaves already-correct URLs unchanged', () => {
    const url =
      'http://127.0.0.1:55421/storage/v1/object/public/question-images/question-test.png';
    expect(normalizeStorageUrl(url, 'http://127.0.0.1:55421')).toBe(url);
  });
});
