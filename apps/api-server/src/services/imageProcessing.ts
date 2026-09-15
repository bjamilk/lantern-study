/**
 * Server-side image normalization for storage + egress control.
 * Uses sharp (already a production dependency for marketplace thumbs).
 *
 * Animated GIFs pass through untouched so they keep animating.
 * Everything else is rotated (EXIF), resized, and stored as WebP.
 */

/**
 * Purpose: every image the API stores passes through here first. Normalising
 * server-side is what bounds storage growth and egress, strips EXIF (including
 * GPS), and guarantees the bytes in a bucket are this encoder's output rather
 * than whatever a client uploaded.
 *
 * Exports: `processImageForUpload` (the one-call path most callers use),
 * `normalizeImageForStorage`, `buildThumbBuffer`, `IMAGE_BUDGETS`,
 * `IMMUTABLE_IMAGE_CACHE_CONTROL`, and the `ImageBudgetKey` / `ImageBudget` /
 * `NormalizedImage` types. Called by the avatar, flashcard, question, chat,
 * marketplace, note-photo and company-logo upload paths, and by
 * companionImageAttachments.ts.
 *
 * What it touches: nothing external. No database, no storage, no network — it
 * takes a Buffer and returns Buffers. The only dependency is `sharp`, imported
 * lazily so the native binding is not loaded on a request path that never
 * handles an image.
 *
 * Pipeline:
 *   1. DECODE — `sharp(...).metadata()` reads dimensions, format and frame
 *      count. An undecodable buffer throws before anything else runs.
 *   2. ANIMATED GIF — passed through byte-for-byte, because re-encoding to
 *      WebP is what flattened GIFs to a single frame. `passthrough: true` says
 *      so, and the caller stores `image/gif`.
 *   3. RESIZE — `rotate()` applies the EXIF orientation and drops the tag,
 *      then `fit: 'inside'` with `withoutEnlargement` caps the long edge at
 *      the budget's `maxDimension`. A small image is never upscaled.
 *   4. RE-ENCODE — WebP at the budget's quality. This is the step that makes
 *      the stored bytes the encoder's, so an image carrying a payload in a
 *      metadata segment does not survive.
 *   5. THUMBNAIL — when the budget names one, built from the NORMALIZED buffer
 *      (cheaper, and consistent with what is displayed); for a passthrough GIF
 *      it is built from the original so the thumb is a static first frame.
 *
 * Callers validate magic bytes on the raw buffer BEFORE calling in (see
 * utils/fileValidation.ts) — this module trusts that the buffer is one of the
 * four allowed formats and does not re-check it.
 */
export type ImageBudgetKey =
  | "avatar"
  | "flashcard"
  | "question"
  | "chat"
  | "marketplace"
  | "notePhoto"
  | "companyLogo";

export type ImageBudget = {
  maxDimension: number;
  quality: number;
  /** Max thumb edge in px; null = no sibling thumb. */
  thumb: number | null;
};

export const IMAGE_BUDGETS: Record<ImageBudgetKey, ImageBudget> = {
  avatar: { maxDimension: 256, quality: 80, thumb: null },
  flashcard: { maxDimension: 1600, quality: 80, thumb: 320 },
  question: { maxDimension: 1600, quality: 80, thumb: 320 },
  chat: { maxDimension: 1600, quality: 80, thumb: 480 },
  marketplace: { maxDimension: 1600, quality: 80, thumb: 320 },
  notePhoto: { maxDimension: 2000, quality: 82, thumb: 480 },
  companyLogo: { maxDimension: 512, quality: 82, thumb: null },
};

/** Immutable object cache header (paths are version/timestamp stamped). */
export const IMMUTABLE_IMAGE_CACHE_CONTROL = "31536000";

export type NormalizedImage = {
  buffer: Buffer;
  contentType: string;
  ext: string;
  width: number;
  height: number;
  /** True when the original animated GIF was left untouched. */
  passthrough: boolean;
};

function isAnimatedGif(buffer: Buffer, mime?: string | null): boolean {
  if (mime && mime.toLowerCase() !== "image/gif") return false;
  if (buffer.length < 6) return false;
  const header = buffer.subarray(0, 6).toString("ascii");
  if (header !== "GIF87a" && header !== "GIF89a") return false;
  // Count image descriptors / NETSCAPE2.0 loop — more than one frame => animated.
  // Sharp metadata.pages > 1 is the reliable check; this is a cheap pre-filter.
  return buffer.includes(Buffer.from("NETSCAPE2.0")) || buffer.includes(Buffer.from("ANIM"));
}

async function loadSharp() {
  const sharp = (await import("sharp")).default;
  return sharp;
}

/**
 * Validate-then-normalize: caller should already have verified magic bytes
 * on the raw buffer. Returns a WebP (or passthrough GIF) ready for storage.
 */
// FIXED (F7a): decompression-bomb and frame-count exhaustion are all bounded now.
//
// 1. `limitInputPixels: MAX_INPUT_PIXELS` is passed to every sharp call, so a
//    small file declaring enormous dimensions is refused by libvips BEFORE the
//    pixels are materialised, rather than after the decode the resize was
//    supposed to save us from.
// 2. `failOn` is raised from "none" to "truncated" on the DECODE paths. "none"
//    told libvips to press on through malformed and truncated input, which is
//    exactly how a deliberately broken file buys an expensive decode. The
//    metadata read keeps a laxer setting on purpose — it decodes no pixels, and
//    an unreadable header must produce our own "Could not read image metadata"
//    error rather than a libvips one.
// 3. Animated GIFs are capped at MAX_GIF_FRAMES. Under the cap the passthrough
//    behaviour is unchanged — the original bytes are stored and the GIF keeps
//    animating, which is the behaviour the memory notes say was hard-won. Over
//    it, the file is refused rather than stored whole and re-decoded for a thumb.
/** Widest decode this service will attempt: 4x a 4000x4000 photo. */
export const MAX_INPUT_PIXELS = (() => {
  const raw = Number(process.env.IMAGE_MAX_INPUT_PIXELS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 64_000_000;
})();

/**
 * Frames an animated GIF may have. A real reaction GIF is tens of frames; a
 * thousand-frame file is a way to spend memory on the passthrough store and the
 * thumbnail decode.
 */
export const MAX_GIF_FRAMES = (() => {
  const raw = Number(process.env.IMAGE_MAX_GIF_FRAMES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 200;
})();

/** Message a caller turns into a 400; every upload route already does this. */
export const IMAGE_TOO_LARGE_MESSAGE =
  'Image is too large to process. Please use a smaller image.';
export const GIF_TOO_MANY_FRAMES_MESSAGE =
  'Animated GIF has too many frames. Please use a shorter GIF.';
export async function normalizeImageForStorage(
  buffer: Buffer,
  budget: ImageBudget,
  options?: { detectedMime?: string | null },
): Promise<NormalizedImage> {
  const sharp = await loadSharp();
  const detectedMime = options?.detectedMime || null;

  let meta: { width?: number; height?: number; pages?: number; format?: string };
  try {
    // The metadata read decodes no pixels, so it keeps the laxer settings: a
    // header we cannot parse must surface as our own message below, not as a
    // libvips pixel-limit error raised while merely reading dimensions.
    meta = await sharp(buffer, { animated: true, failOn: "none" }).metadata();
  } catch (err: any) {
    throw new Error(err?.message || "Could not read image metadata");
  }

  // Refuse the bomb on the declared dimensions too: `metadata()` reads the
  // header without decoding, so this is the cheapest place to say no, and it
  // covers the animated branch, which never reaches a decode of its own.
  const declaredPixels = (meta.width || 0) * (meta.height || 0);
  const pages = typeof meta.pages === "number" ? meta.pages : 1;
  if (declaredPixels > MAX_INPUT_PIXELS || declaredPixels * Math.max(1, pages) > MAX_INPUT_PIXELS) {
    throw new Error(IMAGE_TOO_LARGE_MESSAGE);
  }
  const formatIsGif = meta.format === "gif" || detectedMime === "image/gif";
  const animated =
    (formatIsGif && pages > 1) ||
    isAnimatedGif(buffer, detectedMime || "image/gif");

  if (animated) {
    if (pages > MAX_GIF_FRAMES) {
      throw new Error(GIF_TOO_MANY_FRAMES_MESSAGE);
    }
    return {
      buffer,
      contentType: "image/gif",
      ext: "gif",
      width: meta.width || 0,
      height: meta.height || 0,
      passthrough: true,
    };
  }

  const pipeline = sharp(buffer, { failOn: "truncated", limitInputPixels: MAX_INPUT_PIXELS })
    .rotate() // apply EXIF orientation, then strip orientation tag
    .resize({
      width: budget.maxDimension,
      height: budget.maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: budget.quality });

  const out = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    buffer: out.data,
    contentType: "image/webp",
    ext: "webp",
    width: out.info.width || 0,
    height: out.info.height || 0,
    passthrough: false,
  };
}

/** Build a grid/list thumbnail (WebP). */
export async function buildThumbBuffer(
  buffer: Buffer,
  size: number,
): Promise<Buffer> {
  const sharp = await loadSharp();
  return sharp(buffer, { failOn: "truncated", limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({
      width: size,
      height: size,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 72 })
    .toBuffer();
}

/**
 * Convenience: normalize + optional thumb in one call.
 * Thumb is generated from the *normalized* buffer (cheaper + consistent).
 */
export async function processImageForUpload(
  buffer: Buffer,
  budgetKey: ImageBudgetKey,
  options?: { detectedMime?: string | null },
): Promise<{
  normalized: NormalizedImage;
  thumb: Buffer | null;
  budget: ImageBudget;
}> {
  const budget = IMAGE_BUDGETS[budgetKey];
  const normalized = await normalizeImageForStorage(buffer, budget, options);
  let thumb: Buffer | null = null;
  if (budget.thumb && !normalized.passthrough) {
    thumb = await buildThumbBuffer(normalized.buffer, budget.thumb);
  } else if (budget.thumb && normalized.passthrough) {
    // Still produce a static first-frame thumb for animated GIFs.
    thumb = await buildThumbBuffer(buffer, budget.thumb);
  }
  return { normalized, thumb, budget };
}
