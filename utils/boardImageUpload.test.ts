/**
 * What the web composer will send, and what it refuses before reading a byte.
 *
 * Two things are load-bearing here.
 *
 * A GIF must NOT be re-encoded. Founder decision: a GIF is an uploaded `.gif`
 * from the gallery and it has to animate. Every canvas round trip draws frame
 * one and discards the rest, so a "GIF" that goes through `compressImage`
 * arrives as a still — a failure that looks perfect to whoever posted it.
 *
 * And the cap is ONE number. Web used to check 8 MB while shared and the
 * server both said 10 MB, so a 9 MB pick was refused locally on web and
 * accepted from Android. Every limit now comes from `packages/shared`.
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_GIF_MAX_BYTES,
  BOARD_IMAGE_MAX_BYTES,
  BOARD_IMAGE_MAX_DIMENSION,
  COMMUNITY_BOARD_COPY,
} from '@lantern/shared/network';
import {
  BOARD_IMAGE_ACCEPT,
  boardImageExtension,
  boardImageFileName,
  boardImagePickError,
  dataUrlContentType,
  preservesOriginalBytes,
  resolvePickContentType,
  stripDataUrlPrefix,
} from './boardImageUpload';

describe('what the picker offers', () => {
  it('names the four types the server allows, and not HEIC', () => {
    expect(BOARD_IMAGE_ACCEPT.split(',')).toEqual([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ]);
    expect(BOARD_IMAGE_ACCEPT).not.toContain('heic');
    expect(BOARD_IMAGE_ACCEPT).not.toContain('image/*');
  });
});

describe('boardImagePickError', () => {
  it('accepts the four allowed types', () => {
    for (const contentType of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(boardImagePickError({ contentType, fileName: `a.${boardImageExtension(contentType)}`, byteLength: 1024 })).toBeNull();
    }
  });

  it('refuses a HEIC pick by type AND by extension, before any bytes are read', () => {
    expect(boardImagePickError({ contentType: 'image/heic', fileName: 'IMG_1.heic', byteLength: 10 }))
      .toMatch(/HEIC/);
    // Some iPhone browsers hand over an empty type and only the name.
    expect(boardImagePickError({ contentType: '', fileName: 'IMG_1.HEIF', byteLength: 10 }))
      .toMatch(/HEIC/);
  });

  it('refuses a non-image and a PDF', () => {
    expect(boardImagePickError({ contentType: 'application/pdf', fileName: 'a.pdf', byteLength: 10 }))
      .toBeTruthy();
    expect(boardImagePickError({ contentType: '', fileName: 'a.txt', byteLength: 10 })).toBeTruthy();
  });

  it('uses the SHARED cap, not a web-only 8 MB', () => {
    expect(BOARD_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
    // 9 MB was refused on web and accepted from Android. Now both accept it.
    expect(boardImagePickError({ contentType: 'image/jpeg', fileName: 'a.jpg', byteLength: 9 * 1024 * 1024 }))
      .toBeNull();
    expect(boardImagePickError({ contentType: 'image/jpeg', fileName: 'a.jpg', byteLength: BOARD_IMAGE_MAX_BYTES }))
      .toBeNull();
    expect(boardImagePickError({ contentType: 'image/jpeg', fileName: 'a.jpg', byteLength: BOARD_IMAGE_MAX_BYTES + 1 }))
      .toMatch(/too large/i);
  });

  it('holds a GIF to its own SMALLER cap, in the same words Android uses', () => {
    // A passthrough GIF is never resized and its first-frame thumb is no
    // substitute, so every reader pays the whole file — which is why the cap
    // is 5 MB and not the photo's 10 MB.
    expect(BOARD_GIF_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(boardImagePickError({ contentType: 'image/gif', fileName: 'a.gif', byteLength: BOARD_GIF_MAX_BYTES }))
      .toBeNull();
    expect(
      boardImagePickError({ contentType: 'image/gif', fileName: 'a.gif', byteLength: BOARD_GIF_MAX_BYTES + 1 })
    ).toBe(COMMUNITY_BOARD_COPY.gifTooLarge);
    // A 7 MB JPEG is fine; a 7 MB GIF is not.
    expect(boardImagePickError({ contentType: 'image/jpeg', fileName: 'a.jpg', byteLength: 7 * 1024 * 1024 }))
      .toBeNull();
    expect(boardImagePickError({ contentType: 'image/gif', fileName: 'a.gif', byteLength: 7 * 1024 * 1024 }))
      .toBe(COMMUNITY_BOARD_COPY.gifTooLarge);
  });

  it('accepts a .gif the browser gave no MIME type for', () => {
    // Refusing it as "not an image" would be an error the student cannot act
    // on: the file really is a GIF.
    expect(boardImagePickError({ contentType: '', fileName: 'reaction.GIF', byteLength: 2048 }))
      .toBeNull();
    expect(boardImagePickError({ contentType: '', fileName: 'reaction.gif', byteLength: BOARD_GIF_MAX_BYTES + 1 }))
      .toBe(COMMUNITY_BOARD_COPY.gifTooLarge);
  });
});

describe('preservesOriginalBytes', () => {
  it('is true only for a GIF', () => {
    expect(preservesOriginalBytes('image/gif')).toBe(true);
    expect(preservesOriginalBytes('IMAGE/GIF')).toBe(true);
    expect(preservesOriginalBytes('image/jpeg')).toBe(false);
    expect(preservesOriginalBytes('image/png')).toBe(false);
    expect(preservesOriginalBytes('image/webp')).toBe(false);
    expect(preservesOriginalBytes(null)).toBe(false);
    expect(preservesOriginalBytes(undefined)).toBe(false);
  });

  it('reads the file name too, because a missing MIME type is not proof', () => {
    // A false positive costs one un-resized upload the server still classifies
    // correctly; a false negative silently destroys the animation.
    expect(preservesOriginalBytes('', 'party.gif')).toBe(true);
    expect(preservesOriginalBytes(null, 'PARTY.GIF')).toBe(true);
    expect(preservesOriginalBytes('', 'party.png')).toBe(false);
    expect(preservesOriginalBytes('', 'noextension')).toBe(false);
  });
});

describe('resolvePickContentType', () => {
  it('keeps what the browser declared, minus any codec parameters', () => {
    expect(resolvePickContentType('image/jpeg;charset=binary', 'a.jpg')).toBe('image/jpeg');
    expect(resolvePickContentType('IMAGE/PNG', 'a.png')).toBe('image/png');
  });

  it('falls back to the extension when the browser declared nothing', () => {
    expect(resolvePickContentType('', 'a.gif')).toBe('image/gif');
    expect(resolvePickContentType(null, 'a.JPEG')).toBe('image/jpeg');
    expect(resolvePickContentType('', 'a.webp')).toBe('image/webp');
    // Unknown stays unknown, so the allowlist still refuses it.
    expect(resolvePickContentType('', 'a.heic')).toBe('');
  });
});

describe('naming and data URLs', () => {
  it('keeps the .gif extension so the object is not mislabelled', () => {
    expect(boardImageFileName('image/gif', 1725379200000)).toBe('image-1725379200000.gif');
    expect(boardImageFileName('image/png', 1)).toBe('image-1.png');
    expect(boardImageFileName('image/webp', 1)).toBe('image-1.webp');
    expect(boardImageFileName('image/jpeg', 1)).toBe('image-1.jpg');
    expect(boardImageFileName('', 1)).toBe('image-1.jpg');
  });

  it('strips the data: prefix and reads back the encoder that was used', () => {
    const dataUrl = 'data:image/webp;base64,AAAB';
    expect(stripDataUrlPrefix(dataUrl)).toBe('AAAB');
    expect(dataUrlContentType(dataUrl)).toBe('image/webp');
    // Canvas can fall back to JPEG when it will not encode WebP.
    expect(dataUrlContentType('data:image/jpeg;base64,AAAB')).toBe('image/jpeg');
    // Already-bare payloads pass through untouched.
    expect(stripDataUrlPrefix('AAAB')).toBe('AAAB');
    expect(dataUrlContentType('AAAB')).toBeNull();
  });
});

describe('the downscale target', () => {
  it('comes from shared, so both clients resize to the same edge', () => {
    expect(BOARD_IMAGE_MAX_DIMENSION).toBe(1600);
  });
});
