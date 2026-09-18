/**
 * Content-based upload validation and the signed-URL lifetime clamp.
 *
 * Exports `detectImageMime`, `detectHeifMime`, `detectPhotoMime`,
 * `assertImageMagicBytes`, `assertPhotoMagicBytes`, `assertPdfMagicBytes`,
 * `clampSignedUrlTtl` and the TTL bounds. Called by the upload handlers in
 * routes/storage.ts, routes/notes.ts, routes/marketplace.ts and the avatar and
 * chat-photo paths, before bytes are written to a Supabase storage bucket.
 *
 * Validation is by magic bytes, not by the client-declared Content-Type: a
 * declared type is only ever used as a cross-check against what the bytes
 * actually are. Rejections are thrown as 400s (see `invalidUpload`).
 */
// Magic-byte signature table. Four formats, and only four:
//   image/jpeg   FF D8 FF
//   image/png    89 50 4E 47 0D 0A 1A 0A
//   image/gif    "GIF87a" or "GIF89a"
//   image/webp   "RIFF" at 0 and "WEBP" at 8
// SVG is accepted nowhere, and that is deliberate. An SVG is an XML document
// that can carry <script> and event handlers; served from a storage bucket it
// becomes stored XSS against anyone who opens the file URL. There is no
// signature to add here for it, and none should be added.
const IMAGE_SIGNATURES: Array<{ mime: string; check: (buf: Buffer) => boolean }> = [
  { mime: 'image/jpeg', check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', check: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/gif', check: (b) => b.length >= 6 && (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a') },
  {
    mime: 'image/webp',
    check: (b) => b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

export function detectImageMime(buffer: Buffer): string | null {
  for (const sig of IMAGE_SIGNATURES) {
    if (sig.check(buffer)) return sig.mime;
  }
  return null;
}

// --- HEIC / HEIF, note photographs only ---------------------------------------
// A photo taken on an iPhone is HEIC unless its owner changed a setting, so the
// photograph door has to read one. It is NOT added to IMAGE_SIGNATURES above,
// and `detectImageMime` is left exactly as it was, because that function gates
// avatars, chat photos and marketplace covers as well — surfaces that store the
// bytes and serve them straight back to a browser, where a HEIC is a file most
// browsers cannot display. The note-photo path is different: every image it
// accepts is re-encoded to WebP by `normalizeImageForStorage` before anything is
// stored, so what comes back out is a format every browser renders.
//
// A HEIC is ISO base media (the same container as MP4): a 4-byte big-endian box
// length, then the ASCII "ftyp", then the major brand. Only the still-image
// brands are matched — `mif1`/`msf1` are the generic HEIF ones Apple also
// writes, and the `hev*`/`hei*` pairs are the HEVC-coded stills. Sequence-only
// brands are deliberately absent: a HEIC "live photo" video is not a page of
// notes, and libvips would decode only its cover image anyway.
const HEIF_STILL_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);

/** The two names in circulation for the same bytes. */
export const HEIF_MIMES = new Set(['image/heic', 'image/heif']);

/** The mime for a HEIC/HEIF still, or null when the bytes are not one. */
export function detectHeifMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer.subarray(4, 8).toString('ascii') !== 'ftyp') return null;
  const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
  if (!HEIF_STILL_BRANDS.has(brand)) return null;
  // `heif` and `heic` are both in circulation for the same bytes; the one the
  // brand implies is the one reported, so a declared type can be cross-checked
  // against it without a second alias table.
  return brand.startsWith('hev') || brand === 'heic' || brand === 'heix' ? 'image/heic' : 'image/heif';
}

/**
 * What `detectImageMime` detects, PLUS HEIC/HEIF. Use it only where the bytes
 * are re-encoded before storage — see the note above.
 */
export function detectPhotoMime(buffer: Buffer): string | null {
  return detectImageMime(buffer) ?? detectHeifMime(buffer);
}

/**
 * A rejected upload is the caller's mistake, not a server fault. Without a
 * status the error handler reports 500 and Sentry files it as a crash — these
 * checks working exactly as designed produced a steady stream of issues.
 */
function invalidUpload(message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = 400;
  return error;
}

// --- Assertions ---
// `image/jpg` is allowed as an alias for `image/jpeg` because browsers and
// phone pickers send it; every other mismatch between the declared type and the
// detected one is rejected.
export function assertImageMagicBytes(buffer: Buffer, declaredContentType?: string): void {
  const detected = detectImageMime(buffer);
  if (!detected) {
    throw invalidUpload('File content is not a supported image (JPEG, PNG, GIF, or WebP).');
  }
  if (declaredContentType && declaredContentType !== detected && declaredContentType !== 'image/jpg') {
    throw invalidUpload('Image content does not match declared content type.');
  }
}

/**
 * `assertImageMagicBytes` for a note photograph, where HEIC is also allowed.
 *
 * `image/heic` and `image/heif` are cross-checked against each other rather
 * than for equality: a phone may declare either for the same bytes, and
 * refusing an iPhone photo over which of two synonyms the picker chose would be
 * a rejection no student could act on.
 */
export function assertPhotoMagicBytes(buffer: Buffer, declaredContentType?: string): void {
  const detected = detectPhotoMime(buffer);
  if (!detected) {
    throw invalidUpload(
      'File content is not a supported image (JPEG, PNG, GIF, WebP, or HEIC).'
    );
  }
  if (!declaredContentType) return;
  const declared = declaredContentType.toLowerCase();
  if (declared === detected || declared === 'image/jpg') return;
  const bothHeif = HEIF_MIMES.has(declared) && HEIF_MIMES.has(detected);
  if (bothHeif) return;
  throw invalidUpload('Image content does not match declared content type.');
}

export function assertPdfMagicBytes(buffer: Buffer): void {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw invalidUpload('File content is not a valid PDF.');
  }
}

// --- Signed-URL lifetime ---
// Bounds every caller-requested TTL into [5 minutes, 24 hours] before it is
// handed to Supabase `createSignedUrl`. A signed URL is a bearer token: anyone
// holding the link can read the object until it expires.
export const STORAGE_SIGNED_URL_MIN_TTL = 300;
export const STORAGE_SIGNED_URL_MAX_TTL = 60 * 60 * 24;

// FIXED (F10): the no-argument path used to return the 24 h MAXIMUM, so every
// caller that omitted a TTL — which is most of them — minted a day-long bearer
// link. The default is now one hour. A caller that genuinely needs longer (the
// mobile display path asks for six) still asks for it explicitly, and the
// ceiling is unchanged at 24 h, so nothing that already named a TTL moves.
export const STORAGE_SIGNED_URL_DEFAULT_TTL = 60 * 60;

// FIXED (F10): the function took no bucket argument, so a CV in `job-resumes`
// got the same ceiling as a public shop cover. Objects in these buckets carry
// names, addresses and phone numbers; a URL leaked through a referrer, a
// screenshot or a forwarded link is readable by anyone holding it until it
// expires, so their ceiling is an hour whatever the caller asks for. The
// dedicated download route (`jobsBoard.getResumeDownload`) already signs for ten
// minutes — this bounds the GENERIC `/storage/signed-url` path, which will sign
// any private bucket the ACL lets the caller read.
const SENSITIVE_BUCKET_MAX_TTL = 60 * 60;
const SENSITIVE_BUCKETS = new Set(['job-resumes']);

/**
 * Bound a caller-requested TTL. `bucket` is optional only because older callers
 * predate it; pass it wherever it is known, or a sensitive bucket silently gets
 * the general ceiling.
 */
export function clampSignedUrlTtl(seconds?: number, bucket?: string): number {
  const ceiling =
    bucket && SENSITIVE_BUCKETS.has(bucket)
      ? SENSITIVE_BUCKET_MAX_TTL
      : STORAGE_SIGNED_URL_MAX_TTL;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return Math.min(ceiling, STORAGE_SIGNED_URL_DEFAULT_TTL);
  }
  // The minimum is applied first and the ceiling last, so a sensitive bucket
  // cannot be pushed above its own ceiling by the 5-minute floor.
  return Math.min(ceiling, Math.max(STORAGE_SIGNED_URL_MIN_TTL, Math.floor(seconds)));
}
