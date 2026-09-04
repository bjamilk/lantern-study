import {
  BOARD_GIF_COPY,
  BOARD_GIF_MAX_BYTES,
  base64ByteLength,
  gifFileName,
  gifSizeRefusal,
  isGifUpload,
} from './boardAttachments';

describe('isGifUpload', () => {
  it('accepts the mime type on its own', () => {
    // The Android picker reports the SOURCE content-resolver mime, which is
    // the only signal available for a `content://` uri.
    expect(isGifUpload({ mimeType: 'image/gif' })).toBe(true);
    expect(isGifUpload({ mimeType: 'IMAGE/GIF' })).toBe(true);
  });

  it('accepts the extension on its own', () => {
    expect(isGifUpload({ uri: 'file:///cache/ImagePicker/abc.gif' })).toBe(true);
    expect(isGifUpload({ fileName: 'reaction.GIF' })).toBe(true);
  });

  it('ignores a query string before looking at the extension', () => {
    // A signed storage url ends in `?token=…`, not in `.gif`.
    expect(
      isGifUpload({ uri: 'https://x.co/storage/v1/object/sign/note-files/a/b.gif?token=abc' })
    ).toBe(true);
    expect(
      isGifUpload({ uri: 'https://x.co/storage/v1/object/sign/note-files/a/b.webp?t=gif' })
    ).toBe(false);
  });

  it('refuses everything else', () => {
    expect(isGifUpload({ mimeType: 'image/jpeg', uri: 'file:///a/b.jpg' })).toBe(false);
    expect(isGifUpload({})).toBe(false);
    expect(isGifUpload({ mimeType: null, uri: null, fileName: null })).toBe(false);
    // "gif" inside a name is not an extension.
    expect(isGifUpload({ fileName: 'gift-list.png' })).toBe(false);
  });
});

describe('gifFileName', () => {
  it('replaces whatever extension it was given', () => {
    expect(gifFileName('chat-1.jpg')).toBe('chat-1.gif');
    expect(gifFileName('chat-1.gif')).toBe('chat-1.gif');
  });

  it('still produces a .gif name with nothing to work from', () => {
    expect(gifFileName(null).endsWith('.gif')).toBe(true);
    expect(gifFileName('')).toMatch(/\.gif$/);
  });
});

describe('gifSizeRefusal', () => {
  it('refuses above the cap and names the limit', () => {
    expect(gifSizeRefusal(BOARD_GIF_MAX_BYTES + 1)).toBe(BOARD_GIF_COPY.gifTooLarge);
    // A passthrough GIF is never resized, so this is the reader's whole bill:
    // 5 MB is deliberately tighter than BOARD_IMAGE_MAX_BYTES (10 MB).
    expect(BOARD_GIF_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it('allows the cap exactly, and anything under it', () => {
    expect(gifSizeRefusal(BOARD_GIF_MAX_BYTES)).toBeNull();
    expect(gifSizeRefusal(1024)).toBeNull();
  });

  it('says nothing when the size is unknown, rather than refusing blindly', () => {
    // `getInfoAsync` is best-effort; the base64 length is the real backstop.
    expect(gifSizeRefusal(null)).toBeNull();
    expect(gifSizeRefusal(undefined)).toBeNull();
    expect(gifSizeRefusal(Number.NaN)).toBeNull();
  });
});

describe('base64ByteLength', () => {
  it('counts the decoded bytes, not the characters', () => {
    // 'AAAA' is 4 base64 chars -> 3 bytes.
    expect(base64ByteLength('AAAA')).toBe(3);
    expect(base64ByteLength('AAA=')).toBe(2);
    expect(base64ByteLength('AA==')).toBe(1);
    expect(base64ByteLength('')).toBe(0);
  });

  it('is close enough to gate a 5 MB cap on', () => {
    const chars = Math.ceil((BOARD_GIF_MAX_BYTES * 4) / 3);
    expect(base64ByteLength('A'.repeat(chars))).toBeGreaterThanOrEqual(BOARD_GIF_MAX_BYTES);
  });
});
