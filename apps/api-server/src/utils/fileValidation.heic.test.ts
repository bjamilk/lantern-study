/**
 * The iPhone-photograph door.
 *
 * A HEIC is ISO base media: `[4-byte length]["ftyp"][major brand]`. These tests
 * pin the two things that make widening the note-photo accept list safe — that
 * the brand table matches real still images and nothing else, and that the
 * generic image gate (avatars, chat photos, marketplace covers) did NOT widen
 * with it, because those surfaces serve the stored bytes straight back to a
 * browser that cannot draw a HEIC.
 */
import {
  assertImageMagicBytes,
  assertPhotoMagicBytes,
  detectHeifMime,
  detectImageMime,
  detectPhotoMime,
} from './fileValidation';

function isoBmff(brand: string, extra = 32): Buffer {
  const head = Buffer.alloc(8 + 4 + extra);
  head.writeUInt32BE(8 + 4 + extra, 0);
  head.write('ftyp', 4, 'ascii');
  head.write(brand, 8, 'ascii');
  return head;
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('detectHeifMime', () => {
  it('recognises the still-image brands Apple writes', () => {
    expect(detectHeifMime(isoBmff('heic'))).toBe('image/heic');
    expect(detectHeifMime(isoBmff('heix'))).toBe('image/heic');
    expect(detectHeifMime(isoBmff('hevc'))).toBe('image/heic');
    expect(detectHeifMime(isoBmff('mif1'))).toBe('image/heif');
    expect(detectHeifMime(isoBmff('msf1'))).toBe('image/heif');
  });

  it('is case-insensitive about the brand', () => {
    expect(detectHeifMime(isoBmff('HEIC'))).toBe('image/heic');
  });

  it('refuses other ISO base-media files — an MP4 is not a page of notes', () => {
    expect(detectHeifMime(isoBmff('isom'))).toBeNull();
    expect(detectHeifMime(isoBmff('mp42'))).toBeNull();
    expect(detectHeifMime(isoBmff('qt  '))).toBeNull();
  });

  it('refuses anything without the ftyp box, including a truncated header', () => {
    expect(detectHeifMime(JPEG)).toBeNull();
    expect(detectHeifMime(Buffer.alloc(0))).toBeNull();
    expect(detectHeifMime(Buffer.from('ftyp'))).toBeNull();
  });
});

describe('detectPhotoMime', () => {
  it('is detectImageMime plus HEIC', () => {
    expect(detectPhotoMime(JPEG)).toBe('image/jpeg');
    expect(detectPhotoMime(isoBmff('heic'))).toBe('image/heic');
  });
});

describe('the generic image gate did not widen', () => {
  it('still refuses a HEIC — those bytes are served back to a browser as-is', () => {
    expect(detectImageMime(isoBmff('heic'))).toBeNull();
    expect(() => assertImageMagicBytes(isoBmff('heic'), 'image/heic')).toThrow(
      /not a supported image/i
    );
  });
});

describe('assertPhotoMagicBytes', () => {
  it('accepts a HEIC declared as either of its two names', () => {
    expect(() => assertPhotoMagicBytes(isoBmff('heic'), 'image/heic')).not.toThrow();
    // A phone that calls the same bytes image/heif must not be refused over a
    // synonym the student never chose.
    expect(() => assertPhotoMagicBytes(isoBmff('heic'), 'image/heif')).not.toThrow();
    expect(() => assertPhotoMagicBytes(isoBmff('mif1'), 'image/heic')).not.toThrow();
  });

  it('still rejects a mismatch between the bytes and the declared type', () => {
    expect(() => assertPhotoMagicBytes(JPEG, 'image/heic')).toThrow(
      /does not match declared content type/i
    );
    expect(() => assertPhotoMagicBytes(isoBmff('heic'), 'image/png')).toThrow(
      /does not match declared content type/i
    );
  });

  it('rejects an SVG, which has no signature and never will', () => {
    expect(() => assertPhotoMagicBytes(Buffer.from('<svg xmlns="..."></svg>'))).toThrow(
      /not a supported image/i
    );
  });
});
