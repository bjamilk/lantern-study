/**
 * Companion image attachments — "Add image" in the chat composer.
 *
 * Why text and not a picture: the companion's replies come from
 * `chatCompletion` (Groq / Fireworks), which is a TEXT path — there is no
 * image message shape anywhere in aiService. The only vision code in this API
 * is `perceivePageImage`, a page transcriber. So a photo is read ONCE, here,
 * at upload time, and what reaches the model is the transcript, fenced the
 * same way note excerpts are.
 *
 * The transcript is stored server-side rather than carried in the chat
 * request: a client-supplied `extractedText` would be an open prompt-injection
 * channel into the companion's context. Clients send ids they own.
 */
/**
 * Purpose: the server half of "Add image" — upload, transcribe once, store the
 * transcript, and hand it back to a chat turn by id.
 *
 * Exports: `createCompanionImageAttachment` (routes/ai.ts image-upload
 * handler), `loadTrustedCompanionImages` and
 * `collectCompanionImageAttachmentIds` (the `/message` route AND the BullMQ
 * companion processor), plus the caps, the table name, the
 * `CompanionImageTableMissingError` and its detector.
 *
 * What it touches: Supabase table `companion_image_attachments` (columns
 * `user_id`, `storage_path`, `file_name`, `content_type`, `extracted_text`,
 * `word_count`, `extraction_provider`) and the `note-files` storage bucket,
 * under the note path shape `<userId>/<timestamp>-companion-<name>` built by
 * `buildNoteStoragePath`. Reading is done by `noteOcr.readPhotoPageText`
 * (Tesseract / the configured vision provider); bytes are normalised by
 * `imageProcessing.processImageForUpload` under the `notePhoto` budget.
 *
 * Lifecycle of one attachment:
 *   1. Bytes arrive. `detectImageMime` decides the real type and
 *      `assertNoteImageUpload` enforces type, size and magic bytes.
 *   2. `processImageForUpload` re-encodes to WebP (animated GIFs pass through).
 *   3. The NORMALIZED bytes are written to `note-files`.
 *   4. The same normalized bytes are transcribed; a failed read is logged and
 *      leaves an empty transcript rather than failing the upload.
 *   5. The row is inserted. If the insert fails, the stored object is removed
 *      so nothing is orphaned.
 *   6. A signed URL for the object is returned for the composer chip.
 * There is no delete path here — account deletion and the storage purge in
 * userDataLifecycle.ts are what remove these objects.
 *
 * Migration `20260912100000_companion_image_attachments.sql` is hand-applied,
 * which is why the missing-table case has a named error and a 503 rather than
 * a generic failure. That migration's two RLS policies were written without a
 * `TO` clause, so their role list defaulted to PUBLIC and included `anon`;
 * nothing leaked because the predicate `auth.uid() = user_id` is false for
 * anon, but the grant surface was wrong for a table holding the text read out
 * of students' photographed pages. `20260915100000_rls_ownership_and_
 * visibility_hardening.sql` re-creates both policies `TO authenticated`. A
 * policy with no `TO` clause is TO PUBLIC — worth remembering before the next
 * table is added here.
 */
import { readPhotoPageText } from './noteOcr';
import { processImageForUpload } from './imageProcessing';
import {
  assertNoteImageUpload,
  buildNoteStoragePath,
  imageContentTypeFromFileName,
} from './noteFiles';
import { detectImageMime } from '../utils/fileValidation';
import type { DataLayer } from './data';
import { logger } from '../utils/logger';

// --- Table, caps and the missing-migration signal ----------------------------

export const COMPANION_IMAGE_TABLE = 'companion_image_attachments';

/** How many images one turn may carry. Each one costs credits to read. */
export const MAX_COMPANION_IMAGES_PER_TURN = 3;

/** Per-image transcript cap sent to the model (the fencer trims again). */
export const MAX_COMPANION_IMAGE_TEXT = 6000;

export type CompanionImageAttachmentRecord = {
  attachmentId: string;
  url: string;
  fileName: string;
  extractedText: string;
  wordCount: number;
  provider: string;
};

export function countWords(text: string): number {
  const trimmed = (text || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/**
 * True when PostgREST is telling us the table is not there yet. Migrations in
 * this project are hand-applied, so the honest answer is a clear 503 naming
 * the migration rather than a generic failure the student cannot act on.
 */
export function isMissingCompanionImageTable(error: any): boolean {
  const code = String(error?.code || '');
  const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (text.includes(COMPANION_IMAGE_TABLE) && text.includes('does not exist'))
  );
}

export class CompanionImageTableMissingError extends Error {
  constructor() {
    super(
      'Image attachments are not enabled yet (apply 20260912100000_companion_image_attachments.sql).'
    );
    this.name = 'CompanionImageTableMissingError';
  }
}

/**
 * Upload one photo, read it, and record the transcript.
 *
 * The caller has already reserved the OCR credits — this never charges, and
 * never charges twice for one upload.
 */
// --- Upload and transcribe ---------------------------------------------------

export async function createCompanionImageAttachment(params: {
  layer: DataLayer;
  userId: string;
  buffer: Buffer;
  fileName: string;
  contentType?: string | null;
  ocrTimeoutMs?: number;
}): Promise<CompanionImageAttachmentRecord> {
  const { layer, userId, buffer } = params;
  const rawFileName = (params.fileName || 'image.jpg').trim() || 'image.jpg';

  let contentType =
    params.contentType && params.contentType.toLowerCase().startsWith('image/')
      ? params.contentType.toLowerCase()
      : imageContentTypeFromFileName(rawFileName);
  const detected = detectImageMime(buffer);
  if (detected) contentType = detected;

  // Same gate the note photo upload uses: real image bytes, allowed type, cap.
  assertNoteImageUpload(buffer, contentType);

  const { normalized } = await processImageForUpload(buffer, 'notePhoto', {
    detectedMime: detected || contentType,
  });

  const baseName = rawFileName.replace(/\.[^/.]+$/, '') || 'image';
  const storedName = `${baseName}.${normalized.ext}`;
  const storagePath = buildNoteStoragePath(userId, `companion-${storedName}`);

  await layer.notes.uploadNoteFile({
    storagePath,
    buffer: normalized.buffer,
    contentType: normalized.contentType,
  });

  let extractedText = '';
  let provider = 'none';
  try {
    // Read the NORMALIZED bytes: that is what is stored, so the transcript and
    // the thumbnail the student sees are of the same picture.
    const read = await readPhotoPageText(normalized.buffer, params.ocrTimeoutMs ?? 60_000);
    extractedText = (read.text || '').trim().slice(0, MAX_COMPANION_IMAGE_TEXT);
    provider = read.provider;
  } catch (err) {
    logger.warn('Companion image extraction failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const wordCount = countWords(extractedText);

  const { data, error } = await layer
    .getClient()
    .from(COMPANION_IMAGE_TABLE)
    .insert({
      user_id: userId,
      storage_path: storagePath,
      file_name: storedName,
      content_type: normalized.contentType,
      extracted_text: extractedText,
      word_count: wordCount,
      extraction_provider: provider,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    // Nothing usable was created, so do not leave the object behind.
    await layer.notes.deleteNoteFile(storagePath).catch(() => {});
    if (isMissingCompanionImageTable(error)) throw new CompanionImageTableMissingError();
    throw new Error(error?.message || 'Failed to save image attachment');
  }

  const url = await layer.notes.createSignedNoteFileUrl(storagePath);

  return {
    attachmentId: data.id as string,
    url,
    fileName: storedName,
    extractedText,
    wordCount,
    provider,
  };
}

/**
 * The attachment ids on a chat turn, from either shape a client may send.
 *
 * Clients post the whole `CompanionImageAttachment` objects the upload handed
 * back (so the composer chip can keep its word count without a second round
 * trip); only the ids in them are ever believed. Kept here, next to the reader
 * that consumes them, because BOTH entry points need it — the HTTP route and
 * the BullMQ processor that actually answers `/message` in production.
 */
// --- Read back for a chat turn ----------------------------------------------

export function collectCompanionImageAttachmentIds(context?: {
  imageAttachmentIds?: unknown;
  imageAttachments?: unknown;
}): string[] {
  const direct = Array.isArray(context?.imageAttachmentIds) ? context!.imageAttachmentIds : [];
  const fromObjects = Array.isArray(context?.imageAttachments)
    ? (context!.imageAttachments as Array<{ attachmentId?: unknown } | null>).map(
        (item) => item?.attachmentId
      )
    : [];
  return [...direct, ...fromObjects].filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0
  );
}

export type TrustedCompanionImage = {
  id: string;
  title: string;
  text: string;
  wordCount: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Read back the transcripts for ids the user owns.
 *
 * Ownership is the whole point: `user_id` is filtered here, so pasting someone
 * else's attachment id into a chat request returns nothing rather than their
 * notes. A missing table is not an error for a send — the turn is still worth
 * answering without the picture.
 */
export async function loadTrustedCompanionImages(
  layer: DataLayer,
  userId: string,
  rawIds: unknown
): Promise<TrustedCompanionImage[]> {
  const ids = Array.isArray(rawIds)
    ? rawIds
        .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id.trim()))
        .map((id) => id.trim())
        .slice(0, MAX_COMPANION_IMAGES_PER_TURN)
    : [];
  if (ids.length === 0) return [];

  const { data, error } = await layer
    .getClient()
    .from(COMPANION_IMAGE_TABLE)
    .select('id, file_name, extracted_text, word_count')
    .eq('user_id', userId)
    .in('id', ids);

  if (error) {
    if (!isMissingCompanionImageTable(error)) {
      logger.warn('Companion image context read failed', { error: error.message });
    }
    return [];
  }

  const byId = new Map<string, any>((data || []).map((row: any) => [row.id, row]));
  // Keep the order the student attached them in.
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((row: any) => ({
      id: row.id as string,
      title: (row.file_name as string) || 'Image',
      text: String(row.extracted_text || '').slice(0, MAX_COMPANION_IMAGE_TEXT),
      wordCount: Number(row.word_count) || 0,
    }))
    .filter((image) => image.text.trim().length > 0);
}
