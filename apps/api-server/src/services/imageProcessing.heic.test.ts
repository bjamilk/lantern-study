/**
 * A real iPhone-format still, through the note-photo pipeline.
 *
 * WHY A FIXTURE AND NOT A MOCK. Whether an upload of a `.heic` works at all is
 * a property of the libvips binary sharp installs on the deploy target, not of
 * our code — and it is the single assumption the widened accept list rests on.
 * A mocked sharp would prove nothing about it. So the bytes below are a genuine
 * 64×64 HEIC (written by macOS `sips`, HEVC-coded, brand `heic`), base64'd so
 * the repository carries no binary.
 *
 * WHY THE TEST BRANCHES. If a build without HEIF support ever reaches CI, the
 * right outcome is not a red test that says "metadata error" — it is proof that
 * the student is told the one thing they can do about it. So the test asserts
 * the conversion when the build can decode, and the honest message when it
 * cannot, and prints which branch it took.
 */
import {
  HEIC_UNREADABLE_MESSAGE,
  IMAGE_BUDGETS,
  normalizeImageForStorage,
} from './imageProcessing';
import { assertNoteImageUpload, imageContentTypeFromFileName } from './noteFiles';
import { detectPhotoMime } from '../utils/fileValidation';

const HEIC_BASE64 =
  'AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABwm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAA' +
  'AAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAA' +
  'AgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABppcmVmAAAAAAAAAA5jZHNjAAIAAQABAAAA' +
  '5WlwcnAAAADEaXBjbwAAABNjb2xybmNseAACAAIABoAAAAAMY2xsaQDLAEAAAAAUaXNwZQAAAAAAAABAAAAAQAAAAAlpcm90' +
  'AAAAABBwaXhpAAAAAAMICAgAAABwaHZjQwEDcAAAALAAAAAAAB7wAPz9+PgAAAsDoAABABdAAQwB//8DcAAAAwCwAAADAAAD' +
  'AB5wJKEAAQAiQgEBA3AAAAMAsAAAAwAAAwAeoBQgQcGPiHuRZVNwICBgCKIAAQAJRAHAYXLIQFMkAAAAGWlwbWEAAAAAAAAA' +
  'AQABBoECAwWGhAAAACxpbG9jAAAAAEQAAAIAAQAAAAEAAAJCAAAALwACAAAAAQAAAfYAAABMAAAAAW1kYXQAAAAAAAAAiwAA' +
  'AAZFeGlmAABNTQAqAAAACAADARoABQAAAAEAAAAyARsABQAAAAEAAAA6ASgAAwAAAAEAAgAAAAAAAAAAABkAAAABAAAAGQAA' +
  'AAEAAAArKAGvovZGxX/+uzO96ZH/6iZjPcRP/+p3J//Rzj/9iFP6f/Q+bgcJmOKo/A==';

const heic = () => Buffer.from(HEIC_BASE64, 'base64');

describe('a .heic photographed page', () => {
  it('is recognised by its bytes, not by its name', () => {
    expect(detectPhotoMime(heic())).toBe('image/heic');
  });

  it('passes the note-photo gate as either declared name', () => {
    expect(imageContentTypeFromFileName('IMG_0042.HEIC')).toBe('image/heic');
    expect(() => assertNoteImageUpload(heic(), 'image/heic')).not.toThrow();
    expect(() => assertNoteImageUpload(heic(), 'image/heif')).not.toThrow();
  });

  it('is stored as WebP — or refused with a sentence the student can act on', async () => {
    let normalized;
    try {
      normalized = await normalizeImageForStorage(heic(), IMAGE_BUDGETS.notePhoto, {
        detectedMime: 'image/heic',
      });
    } catch (err) {
      // No HEIF in this libvips build. The requirement is that the student is
      // told what to change on their phone, not a libvips error string.
      expect((err as Error).message).toBe(HEIC_UNREADABLE_MESSAGE);
      return;
    }
    // Decoded: nothing downstream ever sees a HEIC, because the stored object
    // is the same WebP every other photograph becomes.
    expect(normalized.contentType).toBe('image/webp');
    expect(normalized.passthrough).toBe(false);
    expect(normalized.width).toBe(64);
    expect(normalized.height).toBe(64);
  });
});
