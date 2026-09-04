/**
 * Board photo/GIF attachment rules — the pure half, so the interesting parts
 * are unit-testable without a picker, a file system or a network.
 *
 * WHY A GIF NEEDS ITS OWN PATH
 * ----------------------------
 * The server already handles an animated GIF with no new code:
 * `normalizeImageForStorage` detects `pages > 1` / NETSCAPE2.0 and returns
 * `passthrough: true`, and `image/gif` is already in `ALLOWED_IMAGE_MIME_TYPES`.
 * Web sends original bytes, so a .gif posted from a laptop animates today.
 *
 * Mobile was the odd one out, and it flattened the GIF TWICE before any of our
 * code ran:
 *
 *  1. `expo-image-picker` on Android picks `RawImageExporter` only when
 *     `quality === 1`; at any lower quality `CompressionImageExporter` decodes
 *     ONE bitmap frame and writes it back with
 *     `File.toBitmapCompressFormat()`, which maps a `.gif` extension to
 *     `Bitmap.CompressFormat.JPEG`. The asset that came back was therefore
 *     JPEG bytes in a file still named `.gif`, still reporting
 *     `mimeType: 'image/gif'` from the content resolver — so a naive
 *     "is it a gif? pass it through" check would have uploaded a flattened
 *     frame LABELLED as animated. That is why `ChatComposer` now asks for
 *     `quality: 1` and lets `prepareImageForUpload` own compression.
 *  2. `prepareImageForUpload` then re-encoded every pick through
 *     `ImageManipulator.SaveFormat.JPEG`, which keeps frame one and throws the
 *     animation away.
 *
 * WHY THE CAP IS SMALLER THAN A PHOTO'S
 * -------------------------------------
 * A passthrough GIF is never resized, and its first-frame thumb is useless as
 * a substitute, so every reader pays the whole file. At the 10 MB image cap
 * that is ₦3-₦5 per reader per view on Nigerian mobile data. 5 MB is the cap
 * both clients and the upload route are meant to enforce.
 */

/**
 * The cap and the words live in `packages/shared`, NOT here, so web enforces
 * the identical number and shows the identical words (§9.3 parity rules 2 and
 * 3). They were briefly defined locally while a parallel slice owned
 * `communityBoard.ts`; they are now re-exported from the one definition.
 * Two definitions of one limit is exactly how the 8/10/10 MB photo drift
 * happened — do not reintroduce a local copy.
 *
 * Imported via the `@lantern/shared/network` SUBPATH: mobile jest does not map
 * the bare `@lantern/shared` specifier.
 */
export { BOARD_GIF_MAX_BYTES } from '@lantern/shared/network';

import { BOARD_GIF_MAX_BYTES as GIF_MAX_BYTES, COMMUNITY_BOARD_COPY } from '@lantern/shared/network';

export const BOARD_GIF_COPY = {
  /** Shown when a pick is refused BEFORE any bytes leave the phone. */
  gifTooLarge: COMMUNITY_BOARD_COPY.gifTooLarge,
  /** The badge on a GIF chip. Words, never colour alone (§9.1). */
  gif: COMMUNITY_BOARD_COPY.gif,
} as const;

export const GIF_MIME_TYPE = 'image/gif';

/**
 * Is this pick an animated-capable GIF?
 *
 * Checks the mime type AND the file name, because the two disagree in real
 * picks: Android reports the source content-resolver mime while handing back a
 * cache file named from it, and a `content://` uri carries no extension at
 * all. Either signal is enough — a false positive costs one un-resized upload
 * that the server's own passthrough check will still classify correctly, while
 * a false negative silently destroys the animation.
 */
export function isGifUpload(input: {
  mimeType?: string | null;
  uri?: string | null;
  fileName?: string | null;
}): boolean {
  const mime = (input.mimeType || '').toLowerCase().trim();
  if (mime === GIF_MIME_TYPE || mime.startsWith('image/gif')) return true;
  for (const candidate of [input.fileName, input.uri]) {
    if (!candidate) continue;
    // Strip a query string / fragment before looking at the extension: a
    // signed storage url ends in `?token=…`, not in `.gif`.
    const path = String(candidate).split(/[?#]/)[0]!.toLowerCase();
    if (path.endsWith('.gif')) return true;
  }
  return false;
}

/** `photo.jpg` → `photo.gif`. Keeps the upload's name honest about its bytes. */
export function gifFileName(fallback?: string | null): string {
  const base = (fallback || `board-${Date.now()}`).replace(/\.[^/.]+$/, '') || 'board';
  return `${base}.gif`;
}

/**
 * Refuse an oversized GIF with the size in the message, or resolve `null`.
 * Returned rather than thrown so the caller decides between a toast and an
 * alert without unwrapping an Error.
 */
export function gifSizeRefusal(byteLength: number | null | undefined): string | null {
  if (typeof byteLength !== 'number' || !Number.isFinite(byteLength)) return null;
  return byteLength > GIF_MAX_BYTES ? BOARD_GIF_COPY.gifTooLarge : null;
}

/** base64 characters → the byte count they decode to, padding included. */
export function base64ByteLength(base64: string): number {
  const clean = (base64 || '').replace(/=+$/, '');
  return Math.floor((clean.length * 3) / 4);
}
