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

export function assertImageMagicBytes(buffer: Buffer, declaredContentType?: string): void {
  const detected = detectImageMime(buffer);
  if (!detected) {
    throw new Error('File content is not a supported image (JPEG, PNG, GIF, or WebP).');
  }
  if (declaredContentType && declaredContentType !== detected && declaredContentType !== 'image/jpg') {
    throw new Error('Image content does not match declared content type.');
  }
}

export function assertPdfMagicBytes(buffer: Buffer): void {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('File content is not a valid PDF.');
  }
}

export const STORAGE_SIGNED_URL_MIN_TTL = 300;
export const STORAGE_SIGNED_URL_MAX_TTL = 60 * 60 * 24;

export function clampSignedUrlTtl(seconds?: number): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return STORAGE_SIGNED_URL_MAX_TTL;
  }
  return Math.min(STORAGE_SIGNED_URL_MAX_TTL, Math.max(STORAGE_SIGNED_URL_MIN_TTL, Math.floor(seconds)));
}
