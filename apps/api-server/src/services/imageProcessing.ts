/**
 * Server-side image normalization for storage + egress control.
 * Uses sharp (already a production dependency for marketplace thumbs).
 *
 * Animated GIFs pass through untouched so they keep animating.
 * Everything else is rotated (EXIF), resized, and stored as WebP.
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
export async function normalizeImageForStorage(
  buffer: Buffer,
  budget: ImageBudget,
  options?: { detectedMime?: string | null },
): Promise<NormalizedImage> {
  const sharp = await loadSharp();
  const detectedMime = options?.detectedMime || null;

  let meta: { width?: number; height?: number; pages?: number; format?: string };
  try {
    meta = await sharp(buffer, { animated: true, failOn: "none" }).metadata();
  } catch (err: any) {
    throw new Error(err?.message || "Could not read image metadata");
  }

  const pages = typeof meta.pages === "number" ? meta.pages : 1;
  const formatIsGif = meta.format === "gif" || detectedMime === "image/gif";
  const animated =
    (formatIsGif && pages > 1) ||
    isAnimatedGif(buffer, detectedMime || "image/gif");

  if (animated) {
    return {
      buffer,
      contentType: "image/gif",
      ext: "gif",
      width: meta.width || 0,
      height: meta.height || 0,
      passthrough: true,
    };
  }

  const pipeline = sharp(buffer, { failOn: "none" })
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
  return sharp(buffer, { failOn: "none" })
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
