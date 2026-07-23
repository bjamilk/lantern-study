/** Shared upload validation for images across web and mobile clients. */

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export const DEFAULT_MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

export const HEIC_IMAGE_UPLOAD_ERROR =
  'HEIC photos are not supported. Please convert or export the image as JPEG or PNG, then try again.';

export type ImageUploadValidationInput = {
  contentType?: string | null;
  fileName?: string | null;
  byteLength?: number | null;
  maxBytes?: number;
};

export function isHeicImageUpload(input: {
  contentType?: string | null;
  fileName?: string | null;
}): boolean {
  const contentType = (input.contentType || '').toLowerCase();
  const fileName = (input.fileName || '').toLowerCase();
  return (
    contentType.includes('heic') ||
    contentType.includes('heif') ||
    fileName.endsWith('.heic') ||
    fileName.endsWith('.heif')
  );
}

export function isAllowedImageMimeType(contentType?: string | null): boolean {
  if (!contentType) return false;
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(contentType.toLowerCase());
}

export function assertAllowedImageUpload(input: ImageUploadValidationInput): void {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_IMAGE_UPLOAD_BYTES;
  const contentType = input.contentType?.toLowerCase();

  if (isHeicImageUpload(input)) {
    throw new Error(HEIC_IMAGE_UPLOAD_ERROR);
  }

  if (!isAllowedImageMimeType(contentType)) {
    throw new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.');
  }

  if (typeof input.byteLength === 'number' && input.byteLength > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    throw new Error(`File is too large. Maximum size is ${maxMb} MB.`);
  }
}

export function validateImageUpload(
  input: ImageUploadValidationInput
): { ok: true } | { ok: false; error: string } {
  try {
    assertAllowedImageUpload(input);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid upload',
    };
  }
}
