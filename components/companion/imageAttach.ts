/**
 * Composer image attachments — the rules, kept out of the panel so they can be
 * tested and so the phone can state the same limits.
 */
import { AI_CREDIT_COSTS, formatCreditCost } from '@lantern/shared/utils/aiCredits';

/** What reading one photo costs — the same charge the note photo OCR makes. */
export const IMAGE_ATTACH_CREDIT_COST = AI_CREDIT_COSTS.note_ocr;

/** Said before the student picks a file, never after the money is gone. */
export const IMAGE_ATTACH_COST_LABEL = `Reading a photo costs ${formatCreditCost(
  IMAGE_ATTACH_CREDIT_COST
)}`;

export const MAX_IMAGE_ATTACH_BYTES = 10 * 1024 * 1024;

export const ALLOWED_IMAGE_ATTACH_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

/** The accept attribute and the picker filter, from one list. */
export const IMAGE_ATTACH_ACCEPT = ALLOWED_IMAGE_ATTACH_TYPES.join(',');

export const MAX_IMAGE_ATTACHMENTS = 3;

/**
 * Refuse locally what the server would refuse anyway.
 *
 * Worth doing here because the server charges before it reads: a 40 MB HEIC
 * that was always going to be rejected should not cost the student 2 AI uses
 * to find that out.
 */
export function validateImagePick(file: { type?: string; size?: number }): string | null {
  const type = (file.type || '').toLowerCase();
  if (!type.startsWith('image/')) return 'Pick an image file.';
  if (!(ALLOWED_IMAGE_ATTACH_TYPES as readonly string[]).includes(type)) {
    return 'That image type is not supported. Use JPEG, PNG, GIF or WebP.';
  }
  if (typeof file.size === 'number' && file.size > MAX_IMAGE_ATTACH_BYTES) {
    return 'That image is over 10 MB. Try a smaller photo.';
  }
  return null;
}

/**
 * The chip's label.
 *
 * Zero words is the honest and important case: the companion cannot see the
 * picture, only the text read out of it, so an unreadable photo has to say so
 * instead of sitting there looking attached and useful.
 */
export function describeImageAttachment(wordCount: number): string {
  if (!wordCount || wordCount <= 0) return 'Image · no text found';
  return `Image · ${wordCount} word${wordCount === 1 ? '' : 's'}`;
}

/** Strip the `data:` prefix a FileReader result carries. */
export function stripDataUrlPrefix(dataUrl: string): string {
  return String(dataUrl || '').replace(/^data:[^;]+;base64,/, '');
}

/** Read a picked File as bare base64. */
export function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => resolve(stripDataUrlPrefix(String(reader.result || '')));
    reader.readAsDataURL(file);
  });
}
