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
import { readPhotoPageText } from './noteOcr';
import { processImageForUpload } from './imageProcessing';
import {
  assertNoteImageUpload,
  buildNoteStoragePath,
  imageContentTypeFromFileName,
} from './noteFiles';
import { detectImageMime } from '../utils/fileValidation';
import type { SupabaseService } from './supabase';
import { logger } from '../utils/logger';

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
export async function createCompanionImageAttachment(params: {
  supabaseService: SupabaseService;
  userId: string;
  buffer: Buffer;
  fileName: string;
  contentType?: string | null;
  ocrTimeoutMs?: number;
}): Promise<CompanionImageAttachmentRecord> {
  const { supabaseService, userId, buffer } = params;
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

  await supabaseService.uploadNoteFile({
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

  const { data, error } = await supabaseService
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
    await supabaseService.deleteNoteFile(storagePath).catch(() => {});
    if (isMissingCompanionImageTable(error)) throw new CompanionImageTableMissingError();
    throw new Error(error?.message || 'Failed to save image attachment');
  }

  const url = await supabaseService.createSignedNoteFileUrl(storagePath);

  return {
    attachmentId: data.id as string,
    url,
    fileName: storedName,
    extractedText,
    wordCount,
    provider,
  };
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
  supabaseService: SupabaseService,
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

  const { data, error } = await supabaseService
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
