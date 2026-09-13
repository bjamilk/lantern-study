/**
 * Composer image attachments — the phone's half of the rules.
 *
 * Mirrors `components/companion/imageAttach.ts` on web, the same way
 * `companionScope.ts` is mirrored: the shared package carries the wire types,
 * each app carries its own picker rules.
 */
import { AI_CREDIT_COSTS, formatCreditCost } from '@lantern/shared/utils/aiCredits';

/** Reading one photo costs what the note photo OCR costs. */
export const IMAGE_ATTACH_CREDIT_COST = AI_CREDIT_COSTS.note_ocr;

/** Shown before the picker opens — the charge happens on pick, not on send. */
export const IMAGE_ATTACH_COST_LABEL = `Reading a photo costs ${formatCreditCost(
  IMAGE_ATTACH_CREDIT_COST
)}`;

export const MAX_IMAGE_ATTACH_BYTES = 10 * 1024 * 1024;

export const MAX_IMAGE_ATTACHMENTS = 3;

/**
 * Refuse locally what the server would refuse anyway: it charges before it
 * reads, so an oversized photo should not cost AI uses to be told no.
 */
export function validateImageAsset(asset: {
  fileSize?: number | null;
  mimeType?: string | null;
}): string | null {
  const mime = (asset.mimeType || '').toLowerCase();
  if (mime && !mime.startsWith('image/')) return 'Pick an image.';
  if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_IMAGE_ATTACH_BYTES) {
    return 'That image is over 10 MB. Try a smaller photo.';
  }
  return null;
}

/**
 * The chip's label. Zero words is the case that matters: the companion never
 * sees the picture, only the text read out of it, so an unreadable photo has
 * to say so rather than sit there looking useful.
 */
export function describeImageAttachment(wordCount: number): string {
  if (!wordCount || wordCount <= 0) return 'Image · no text found';
  return `Image · ${wordCount} word${wordCount === 1 ? '' : 's'}`;
}

/** What the composer shows when an upload fails: a sentence, and the small print. */
export type ImageAttachFailure = {
  /** One readable line, never a bare class name like "Error". */
  message: string;
  /** The file and the server's own words, behind a "Details" toggle. */
  detail: string | null;
};

/** Shown when the attachments table is not migrated on the server yet. */
export const IMAGE_ATTACH_SERVER_UPDATE_MESSAGE =
  'Photos need a server update — try again later.';

const GENERIC_FAILURE_LABELS = new Set([
  'error',
  'apierror',
  'request failed',
  'bad request',
  'internal server error',
  'service unavailable',
  'unknown error',
  '[object object]',
]);

/** A 503 that names the pending migration file, e.g. `20260912100000_….sql`. */
const MIGRATION_NAME = /\b(\d{8,}_[A-Za-z0-9_.-]+\.sql)\b/;

function rawMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err.trim();
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' ? message.trim() : '';
}

/**
 * Turn whatever the upload threw into something a student can act on.
 *
 * Two rules the phone taught us: never print a class name (the API answers an
 * unhandled throw with `error: 'Error'`), and never print nothing — a failure
 * with no words at all still has a status worth stating.
 */
export function describeImageAttachFailure(
  err: unknown,
  fileName?: string | null
): ImageAttachFailure {
  const status = Number((err as { status?: unknown } | null)?.status) || 0;
  const raw = rawMessage(err);
  const named = (fileName || '').trim();
  const file = named ? `File: ${named}` : null;
  const isGeneric = !raw || GENERIC_FAILURE_LABELS.has(raw.toLowerCase());

  const migration = raw.match(MIGRATION_NAME)?.[1];
  if (status === 503 && (migration || /not enabled yet/i.test(raw))) {
    return {
      message: IMAGE_ATTACH_SERVER_UPDATE_MESSAGE,
      detail: [file, migration ? `Waiting on ${migration}` : raw].filter(Boolean).join(' · '),
    };
  }

  if (isGeneric) {
    return {
      message: status
        ? `Could not read that image (server said ${status}).`
        : 'Could not read that image. Check your connection and try again.',
      detail: file,
    };
  }

  return { message: raw, detail: file };
}
