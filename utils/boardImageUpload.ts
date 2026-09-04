/**
 * What the web composer is allowed to send, and in what shape.
 *
 * This exists because the three numbers that used to describe one limit — web
 * 8 MB, shared 10 MB, server 10 MB — disagreed, and because a phone-browser
 * pick went onto the wire at full size. On a ₦0.30–0.50/MB connection a 10 MB
 * pick base64s to ~13.4 MB, which is real money spent before the server has
 * even decided whether it wants the file.
 *
 * Everything here is pure so it can be tested without a canvas, a network or
 * a DOM. `BOARD_IMAGE_MAX_BYTES` / `BOARD_IMAGE_MAX_DIMENSION` come from
 * packages/shared and are re-checked server-side (§9.3 rule 3).
 */
import {
  BOARD_GIF_MAX_BYTES,
  BOARD_IMAGE_MAX_BYTES,
  BOARD_IMAGE_MAX_DIMENSION,
  COMMUNITY_BOARD_COPY,
} from '@lantern/shared/network';
import { assertAllowedImageUpload } from '@lantern/shared/utils/uploadValidation';

export { BOARD_GIF_MAX_BYTES, BOARD_IMAGE_MAX_BYTES, BOARD_IMAGE_MAX_DIMENSION };

/** The file types the picker offers. Spelled out rather than `image/*` so an
 *  iPhone cannot hand us a HEIC we are only going to refuse afterwards. */
export const BOARD_IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

export interface BoardImagePick {
  contentType?: string | null;
  fileName?: string | null;
  byteLength?: number | null;
}

/**
 * Why this pick is refused, or `null` when it is fine. Runs BEFORE the file is
 * read, which is the whole point: a HEIC pick and an over-cap pick both cost
 * zero bytes on the wire.
 */
export function boardImagePickError(pick: BoardImagePick): string | null {
  const contentType = resolvePickContentType(pick.contentType, pick.fileName);
  try {
    assertAllowedImageUpload({
      contentType,
      fileName: pick.fileName,
      byteLength: pick.byteLength,
      // A GIF is never resized, so it answers to its own, smaller cap — the
      // SAME number and the SAME words Android uses.
      maxBytes: preservesOriginalBytes(contentType, pick.fileName)
        ? BOARD_GIF_MAX_BYTES
        : BOARD_IMAGE_MAX_BYTES,
    });
    return null;
  } catch (error) {
    if (
      preservesOriginalBytes(contentType, pick.fileName) &&
      typeof pick.byteLength === 'number' &&
      pick.byteLength > BOARD_GIF_MAX_BYTES
    ) {
      return COMMUNITY_BOARD_COPY.gifTooLarge;
    }
    return error instanceof Error ? error.message : COMMUNITY_BOARD_COPY.invalidImage;
  }
}

/**
 * A GIF must reach storage byte-for-byte.
 *
 * Founder decision: a GIF is an uploaded `.gif` from the gallery, and it has to
 * animate. Any canvas round trip (`compressImage`) draws frame one and throws
 * the rest away, so the "GIF" that arrives is a still — a silent failure that
 * looks fine to whoever posted it. The server already agrees:
 * `normalizeImageForStorage` detects a multi-frame GIF and passes it through
 * untouched, writing only a static first-frame thumb beside it.
 *
 * The size cap gets no exemption — it gets a TIGHTER one. A passthrough GIF is
 * never resized and its static first-frame thumb is no substitute, so every
 * reader pays the whole file; `boardImagePickError` therefore holds a GIF to
 * `BOARD_GIF_MAX_BYTES` (5 MB) rather than the `BOARD_IMAGE_MAX_BYTES` (10 MB)
 * every other pick answers to. The same number is enforced on Android and
 * again in the upload route.
 */
export function preservesOriginalBytes(
  contentType?: string | null,
  fileName?: string | null,
): boolean {
  if ((contentType || '').toLowerCase().startsWith('image/gif')) return true;
  // The name is a second signal, for the same reason Android needs one: a
  // false positive costs one un-resized upload the server still classifies
  // correctly, while a false negative silently destroys the animation.
  return fileExtension(fileName) === 'gif';
}

/** `photo.GIF` → `gif`. Query strings and fragments are stripped first. */
function fileExtension(fileName?: string | null): string {
  const path = String(fileName || '').split(/[?#]/)[0]!.toLowerCase();
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot + 1) : '';
}

/**
 * The MIME type to act on. Browsers occasionally hand back a `File` with an
 * empty `type`, and refusing every one of those as "not an image" would turn a
 * perfectly good `.gif` pick into an error the student cannot explain.
 */
export function resolvePickContentType(
  contentType?: string | null,
  fileName?: string | null,
): string {
  const declared = (contentType || '').split(';')[0].trim().toLowerCase();
  if (declared) return declared;
  switch (fileExtension(fileName)) {
    case 'gif':
      return 'image/gif';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    default:
      return '';
  }
}

/** The extension the uploaded object gets, from its MIME type. */
export function boardImageExtension(contentType?: string | null): string {
  const type = (contentType || '').toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  return 'jpg';
}

/** `data:image/webp;base64,AAAA` → `AAAA`. A bare payload is returned as-is. */
export function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** The MIME type a `data:` URL declares, or null when it declares none. */
export function dataUrlContentType(dataUrl: string): string | null {
  const match = /^data:([^;,]+)[;,]/i.exec(dataUrl || '');
  return match ? match[1].toLowerCase() : null;
}

/** `image-1725379200000.gif` — one naming rule for every board photo. */
export function boardImageFileName(contentType?: string | null, now: number = Date.now()): string {
  return `image-${now}.${boardImageExtension(contentType)}`;
}
