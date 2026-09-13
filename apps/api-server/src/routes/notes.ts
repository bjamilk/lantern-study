import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import {
  requireNoteAccess,
  requireNoteEdit,
  requireNoteOwner,
} from '../middleware/authorizeResource';
import { idempotencyMiddleware, type IdempotentRequest } from '../middleware/idempotency';
import {
  aiRateLimitForFeature,
  aiRateLimitWithCost,
  applyGlobalUsageHeaders,
  chargeAiCredits,
  chargeAiCreditsDetailed,
  refundAiCredits,
  refundFeatureAiCredit,
  NOTE_OCR_CREDIT_COST,
} from '../middleware/aiRateLimit';
import {
  MAX_NARRATION_PAGES,
  getLectureTranscriptionCost,
  getNarrationCreditCost,
  getSmartNotesCreditCost,
} from '@lantern/shared/utils/aiCredits';
import {
  NARRATION_IMAGE_URL_TTL_SECONDS,
  buildNarrationScript,
  claimNarrationRun,
  getNarrationBundle,
  narrationApiPayload,
  markNarrationFailed,
  markStatus as markNarrationStatus,
  releaseNarrationClaim,
  resolveNarrationTarget,
  type NarrationClaimResult,
  type NarrationTarget,
} from '../services/narrationService';
import {
  VOICE_ASK_FEATURE_KEY,
  VOICE_ASK_MAX_AUDIO_BYTES,
  VOICE_ASK_MAX_DURATION_MS,
  VOICE_ASK_TOO_LONG_MESSAGE,
} from '@lantern/shared/utils/aiUsage';
import {
  aiPostBurstRateLimit,
  collaboratorInviteRateLimit,
  uploadBurstRateLimit,
} from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuthUserId } from '../utils/requestAuth';
import { clientErrorMessage, PublicError } from '../utils/safeError';
import {
  handleValidationErrors,
  validateNoteId,
  validateFolderId,
  validateNoteCreate,
  validateNoteUpdate,
  validateFolderCreate,
  validateFolderUpdate,
} from '../middleware/validation';
import {
  COURSE_FILTER_INVALID_MESSAGE,
  TOPIC_FILTER_INVALID_MESSAGE,
  parseCourseFilter,
  parseTopicFilter,
} from '../services/academicCourses';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import {
  summarizeNoteContent,
  SMART_NOTES_GUIDANCE_MAX_CHARS,
  type SmartNotesDepth,
  generateDailyQuiz,
  generateFlashcardsFromNotes,
  generateQuestionsFromNotes,
  resolveAudioUploadMeta,
  transcribeAudioBase64,
  transcribeAudioBuffer,
} from '../services/aiService';
import { type AiJobCharge, runNoteAiSync, runSyncOrEnqueue } from '../queue/enqueue';
import { sendAsyncJobAccepted, stampAiChargeOnJob, aiChargeFromRes } from '../queue/respondAsync';
import { isVersionConflictError } from '../utils/versionConflict';
import { runPresentationPreviewJob } from '../services/presentationPreview';
import {
  assertPdfSize,
  assertPresentationSize,
  buildNoteStoragePath,
  buildPdfStudyText,
  buildPresentationStudyText,
  extractPdfTextDetailsFromBuffer,
  extractPresentationTextDetailsFromBuffer,
  assertPresentationFileName,
  assertUserOwnedNoteStoragePath,
  assertValidOfficeZip,
  presentationContentType,
  imageContentTypeFromFileName,
  assertNoteImageUpload,
  warmGotenberg,
  MAX_OCR_IMAGES,
  MAX_OCR_PDF_PAGES,
  MAX_OCR_SLIDES,
} from '../services/noteFiles';
import { detectImageMime } from '../utils/fileValidation';
import {
  aggregatePhotoOcrStatus,
  getNoteStudyContent,
  getNoteStudyContentForSmartNotes,
  hasEnoughNoteStudyContent,
  MIN_NOTE_STUDY_CONTENT_CHARS,
} from '@lantern/shared/utils/noteStudyContent';
import {
  parseSmartNoteSources,
  upsertSmartNotesSection,
  type SmartNoteSourceId,
} from '@lantern/shared/utils/smartNotes';
import { defaultPhotoNoteTitle } from '@lantern/shared/utils/photoNoteTitle';
import { parseYoutubeVideoId, canonicalYoutubeUrl } from '@lantern/shared/utils/youtube';
import { fetchYoutubeMetadata } from '../services/youtubeTranscript';
import { runYoutubeTranscriptJob } from '../services/youtubeNote';
import { ocrPlaceholder, runNoteOcrJob, shouldAutoEnqueueOcr } from '../services/noteOcr';
import {
  ensurePageImages,
  ensurePages,
  getPages,
  getPageText,
  signPageImages,
} from '../services/notePages';
import { logger } from '../utils/logger';
import { processImageForUpload } from '../services/imageProcessing';
import { storageThumbPath } from '@lantern/shared/utils/storageUrl';
import { isFlashcardTypeMix } from '@lantern/shared/flashcards';
import { recordLearningEvent, surfaceFromRequest } from '../services/learningEvents';

const router = Router();

let supabaseService: SupabaseService;
let cacheService: CacheService;

export const initializeNotesRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

async function resolveNoteStudyContent(
  noteId: string,
  note: { body?: string; summary?: string; sourceType?: string },
  options?: { forSmartNotes?: boolean; sources?: SmartNoteSourceId[] }
): Promise<string> {
  const attachments = await supabaseService.getNoteAttachments(noteId);
  const input = {
    sourceType: note.sourceType,
    body: note.body,
    summary: note.summary,
    attachments,
  };
  if (options?.forSmartNotes) {
    return getNoteStudyContentForSmartNotes(input, options.sources);
  }
  return getNoteStudyContent(input);
}

type ValidatedNoteImage = {
  storagePath: string;
  fileName: string;
  fileUrl: string;
  contentType: string;
};

async function validateNoteImageUploads(
  userId: string,
  storagePaths: string[],
  fileNames: string[]
): Promise<ValidatedNoteImage[]> {
  const validated: ValidatedNoteImage[] = [];
  for (let i = 0; i < storagePaths.length; i++) {
    const storagePath = String(storagePaths[i]);
    const fileName = String(fileNames[i]);
    assertUserOwnedNoteStoragePath(storagePath, userId);
    const downloaded = await supabaseService.downloadNoteFile(storagePath);
    let contentType = downloaded.contentType;
    if (contentType === 'application/octet-stream') {
      contentType = detectImageMime(downloaded.buffer) || imageContentTypeFromFileName(fileName);
    }
    assertNoteImageUpload(downloaded.buffer, contentType);
    const fileUrl = await supabaseService.createSignedNoteFileUrl(storagePath);
    validated.push({ storagePath, fileName, fileUrl, contentType });
  }
  return validated;
}

async function createPhotoNoteAttachments(
  noteId: string,
  images: ValidatedNoteImage[],
  startOrder: number
) {
  const attachments = [];
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const attachment = await supabaseService.addNoteAttachment(noteId, {
      type: 'image',
      fileUrl: image.fileUrl,
      fileName: image.fileName,
      metadata: {
        storagePath: image.storagePath,
        sortOrder: startOrder + i,
        contentType: image.contentType,
      },
    });
    attachments.push(attachment);
  }
  return attachments;
}

type Base64NoteImageInput = {
  fileName?: unknown;
  base64Data?: unknown;
  contentType?: unknown;
};

async function uploadBase64NoteImages(
  userId: string,
  images: Base64NoteImageInput[]
): Promise<ValidatedNoteImage[]> {
  const validated: ValidatedNoteImage[] = [];
  const uploadedPaths: string[] = [];

  try {
    for (let i = 0; i < images.length; i++) {
      const item = images[i] || {};
      const rawFileName = String(item.fileName || `photo-${i + 1}.jpg`);
      if (typeof item.base64Data !== 'string' || !item.base64Data) {
        throw new Error('Each image requires fileName and base64Data.');
      }

      const buffer = Buffer.from(item.base64Data, 'base64');
      let contentType =
        typeof item.contentType === 'string' && item.contentType
          ? item.contentType
          : imageContentTypeFromFileName(rawFileName);
      if (contentType === 'application/octet-stream') {
        contentType = detectImageMime(buffer) || imageContentTypeFromFileName(rawFileName);
      }
      assertNoteImageUpload(buffer, contentType);

      const { normalized, thumb } = await processImageForUpload(buffer, 'notePhoto', {
        detectedMime: detectImageMime(buffer) || contentType,
      });
      const baseName = rawFileName.replace(/\.[^/.]+$/, '') || `photo-${i + 1}`;
      const fileName = `${baseName}.${normalized.ext}`;
      const storagePath = buildNoteStoragePath(userId, `${i}-${fileName}`);
      await supabaseService.uploadNoteFile({
        storagePath,
        buffer: normalized.buffer,
        contentType: normalized.contentType,
      });
      uploadedPaths.push(storagePath);

      if (thumb) {
        const thumbPath = storageThumbPath(storagePath);
        try {
          await supabaseService.uploadNoteFile({
            storagePath: thumbPath,
            buffer: thumb,
            contentType: 'image/webp',
            upsert: true,
          });
          uploadedPaths.push(thumbPath);
        } catch (thumbErr: any) {
          logger.warn('Note photo thumbnail upload failed', {
            storagePath,
            error: thumbErr?.message,
          });
        }
      }

      const fileUrl = await supabaseService.createSignedNoteFileUrl(storagePath);
      validated.push({
        storagePath,
        fileName,
        fileUrl,
        contentType: normalized.contentType,
      });
    }
    return validated;
  } catch (err) {
    for (const path of uploadedPaths) {
      await supabaseService.deleteNoteFile(path).catch(() => {});
    }
    throw err;
  }
}

async function startPresentationPreviewJob(params: {
  noteId: string;
  attachmentId: string;
  storagePath: string;
  fileName: string;
  meta: Record<string, unknown>;
  buffer?: Buffer;
  extractedText?: string;
}): Promise<void> {
  void runPresentationPreviewJob(supabaseService, params).catch((err) => {
    logger.error('Presentation preview job unhandled error', {
      noteId: params.noteId,
      attachmentId: params.attachmentId,
      err,
    });
  });
}

/**
 * Auto-OCR on upload uses the same global AI credits as manual OCR.
 * Returns false when the user is out of credits — caller should skip OCR
 * rather than fail the upload itself.
 */
async function tryChargeAutoOcrCredits(userId: string): Promise<boolean> {
  if (NOTE_OCR_CREDIT_COST <= 0) return true;
  const denied = await chargeAiCredits(userId, NOTE_OCR_CREDIT_COST);
  if (denied) {
    logger.warn('Skipping auto OCR — daily AI credit limit reached', {
      userId,
      creditCost: NOTE_OCR_CREDIT_COST,
      used: denied.used,
      limit: denied.limit,
    });
    return false;
  }
  return true;
}

/**
 * The upload response already told the client OCR is running
 * (extractionStatus 'ocr_processing', ocrQueued: true) — but the credit charge
 * happens after that response, fire-and-forget. If the job can never start
 * (daily AI limit hit, enqueue failure), nothing would revert that metadata:
 * resolveOcrStatus kept answering 'processing', and the client polled a doomed
 * 240s "Running OCR on scanned pages…" loop. Revert the attachment to
 * 'needs_ocr' so the poll exits and the editor offers the manual Run OCR
 * button instead.
 *
 * Exported for tests.
 */
export async function revertAttachmentToNeedsOcr(params: {
  noteId: string;
  attachmentId: string;
  /** Metadata written at upload time; fallback when the attachment cannot be re-read. */
  meta: Record<string, unknown>;
  /** Replaces the "[Running OCR…]" placeholder (usually the thin extracted text). */
  fallbackText?: string;
  reason: string;
}): Promise<void> {
  try {
    let latest = params.meta;
    try {
      const current = await supabaseService.getNoteAttachment(params.noteId, params.attachmentId);
      if (current?.metadata && typeof current.metadata === 'object') {
        latest = current.metadata as Record<string, unknown>;
      }
    } catch {
      // Re-read is best-effort; fall back to the meta we wrote at upload.
    }
    // Never clobber a state some other path already resolved (a worker that
    // did run, a manual OCR, a concurrent revert).
    if (latest.extractionStatus !== 'ocr_processing') return;
    await supabaseService.updateNoteAttachment(params.attachmentId, {
      ...(params.fallbackText !== undefined ? { extractedText: params.fallbackText } : {}),
      metadata: {
        ...latest,
        extractionStatus: 'needs_ocr',
        ocrError: params.reason,
        ocrStartedAt: undefined,
        ocrProvider: undefined,
      },
    });
  } catch (err) {
    logger.warn('Failed to revert attachment to needs_ocr after OCR could not start', {
      noteId: params.noteId,
      attachmentId: params.attachmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Fire-and-forget auto-OCR for a freshly uploaded PDF: charge credits, then
 * start the job — and on either failing, revert the attachment out of
 * 'ocr_processing' (see revertAttachmentToNeedsOcr). Callers `void` the
 * returned promise; it never rejects. Exported for tests.
 */
export async function autoStartPdfOcrOrRevert(params: {
  noteId: string;
  attachmentId: string;
  storagePath: string;
  fileName: string;
  meta: Record<string, unknown>;
  userId: string;
  /** Text to restore over the OCR placeholder when OCR cannot start. */
  fallbackText: string;
}): Promise<void> {
  const { noteId, attachmentId, storagePath, fileName, meta, userId, fallbackText } = params;
  try {
    const charged = await tryChargeAutoOcrCredits(userId);
    if (!charged) {
      await revertAttachmentToNeedsOcr({
        noteId,
        attachmentId,
        meta,
        fallbackText,
        reason: 'Daily AI limit reached — run OCR manually when credits reset',
      });
      return;
    }
    await startNoteOcrJob({
      noteId,
      attachmentId,
      storagePath,
      fileName,
      sourceKind: 'pdf',
      meta,
      userId,
    });
  } catch (err) {
    logger.error('Failed to start PDF OCR job', { noteId, err });
    await revertAttachmentToNeedsOcr({
      noteId,
      attachmentId,
      meta,
      fallbackText,
      reason: 'OCR could not be started. Run OCR manually to retry.',
    });
  }
}

async function startNoteOcrJob(params: {
  noteId: string;
  attachmentId: string;
  storagePath: string;
  fileName: string;
  sourceKind: 'pdf' | 'presentation' | 'preview_pdf' | 'image';
  meta: Record<string, unknown>;
  userId: string;
  buffer?: Buffer;
  /** AI credits reserved by the calling request; stamped on the job record at
      enqueue so a permanently failed OCR job refunds them (race-free) — to the
      pool that paid, which is why this is the full `AiJobCharge`. */
  charge?: AiJobCharge;
}): Promise<{ mode: 'sync' | 'async'; jobId?: string }> {
  const payload = {
    noteId: params.noteId,
    attachmentId: params.attachmentId,
    storagePath: params.storagePath,
    fileName: params.fileName,
    sourceKind: params.sourceKind,
    meta: params.meta,
    // Avoid huge Redis payloads — worker re-downloads from storage.
  };
  const outcome = await runSyncOrEnqueue('notes.ocr.extract', payload, params.userId, () =>
    runNoteOcrJob(supabaseService, {
      ...params,
      buffer: params.buffer,
    }),
    params.charge
  );
  if (outcome.mode === 'async') {
    return { mode: 'async', jobId: outcome.jobId };
  }
  return { mode: 'sync' };
}

/**
 * Photo notes hold one attachment per photograph, so OCR is a batch: one job per
 * image, capped at MAX_OCR_IMAGES. Credits are charged once for the batch by the
 * caller, not per photograph — a ten-photo note should not cost ten times a PDF.
 *
 * Returns the number of images queued.
 */
async function startPhotoNoteOcr(params: {
  noteId: string;
  userId: string;
  attachments: Array<{ id: string; type: string; fileName?: string | null; metadata?: Record<string, unknown> | null; extractedText?: string | null }>;
  /** Only re-run images that have no usable text yet (manual retry passes false). */
  skipAlreadyRead?: boolean;
}): Promise<number> {
  const images = params.attachments.filter((a) => a.type === 'image');
  const pending = images.filter((a) => {
    if (!params.skipAlreadyRead) return true;
    const status = (a.metadata as Record<string, unknown> | null)?.extractionStatus;
    return status !== 'ok' && status !== 'ocr_processing';
  });
  const targets = pending.slice(0, MAX_OCR_IMAGES);
  if (targets.length === 0) return 0;

  for (const attachment of targets) {
    const meta = (attachment.metadata || {}) as Record<string, unknown>;
    const storagePath = typeof meta.storagePath === 'string' ? meta.storagePath : null;
    if (!storagePath) continue;

    const fileName = attachment.fileName || 'photo.jpg';
    const processingMeta = {
      ...meta,
      extractionStatus: 'ocr_processing',
      ocrProvider: 'tesseract',
      ocrStartedAt: new Date().toISOString(),
      ocrError: undefined,
      ocrFailedAt: undefined,
      ocrMaxImages: MAX_OCR_IMAGES,
      ocrCreditCost: NOTE_OCR_CREDIT_COST,
    };

    await supabaseService.updateNoteAttachment(attachment.id, {
      extractedText: ocrPlaceholder(fileName),
      metadata: processingMeta,
    });

    await startNoteOcrJob({
      noteId: params.noteId,
      attachmentId: attachment.id,
      storagePath,
      fileName,
      sourceKind: 'image',
      meta: processingMeta,
      userId: params.userId,
    });
  }

  if (pending.length > MAX_OCR_IMAGES) {
    logger.info('Photo note OCR capped', {
      noteId: params.noteId,
      requested: pending.length,
      queued: targets.length,
      cap: MAX_OCR_IMAGES,
    });
  }
  return targets.length;
}

/**
 * Queue OCR for freshly added photographs, charging the batch once.
 * Awaits enqueue (not the actual read) so the upload response can tell the
 * client to poll — previously this was fire-and-forget, so photo OCR status
 * had no `attachment` and no `ocr_processing` flag when the client first polled.
 */
async function queuePhotoNoteOcr(
  noteId: string,
  userId: string,
  attachments: any[]
): Promise<number> {
  try {
    const charged = await tryChargeAutoOcrCredits(userId);
    if (!charged) return 0;
    return await startPhotoNoteOcr({ noteId, userId, attachments, skipAlreadyRead: true });
  } catch (err) {
    logger.warn('Photo note OCR could not be started', {
      noteId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

const OCR_PROCESSING_STALE_MS = 10 * 60 * 1000;

function resolveOcrStatus(meta: Record<string, unknown>): 'ready' | 'processing' | 'failed' | 'none' | 'needs_ocr' {
  const status = meta.extractionStatus;
  if (status === 'ocr_processing') {
    const started = typeof meta.ocrStartedAt === 'string' ? Date.parse(meta.ocrStartedAt) : NaN;
    if (Number.isFinite(started) && Date.now() - started > OCR_PROCESSING_STALE_MS) {
      return 'failed';
    }
    return 'processing';
  }
  if (status === 'ocr_failed') return 'failed';
  if (status === 'needs_ocr' || status === 'empty') return 'needs_ocr';
  if (status === 'ok' && meta.ocrProvider === 'tesseract') return 'ready';
  if (status === 'ok') return 'ready';
  return 'none';
}

const PREVIEW_PROCESSING_STALE_MS = 5 * 60 * 1000;

function parsePreviewStartedAt(meta: Record<string, unknown>): number | null {
  const raw = meta.previewStartedAt;
  if (typeof raw !== 'string') return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPreviewProcessingStale(meta: Record<string, unknown>): boolean {
  if (meta.previewProcessing !== true) return true;
  const started = parsePreviewStartedAt(meta);
  if (!started) return true;
  return Date.now() - started > PREVIEW_PROCESSING_STALE_MS;
}

function resolvePreviewStatus(meta: Record<string, unknown>): 'ready' | 'processing' | 'failed' | 'none' {
  if (typeof meta.previewStoragePath === 'string' && meta.previewStoragePath) {
    return 'ready';
  }
  if (meta.previewProcessing === true && !isPreviewProcessingStale(meta)) {
    return 'processing';
  }
  if (typeof meta.previewError === 'string' && meta.previewError) {
    return 'failed';
  }
  if (meta.previewProcessing === true && isPreviewProcessingStale(meta)) {
    return 'failed';
  }
  return 'none';
}

function resolvePreviewErrorMessage(meta: Record<string, unknown>, status: ReturnType<typeof resolvePreviewStatus>): string | undefined {
  if (status !== 'failed') return undefined;
  if (typeof meta.previewError === 'string' && meta.previewError) {
    return meta.previewError;
  }
  if (meta.previewProcessing === true && isPreviewProcessingStale(meta)) {
    return 'Preview generation timed out. Try Retry preview.';
  }
  return 'Could not generate slide preview.';
}

router.use(authMiddleware);

/** A rejected topic (wrong course, no course, unusable id) is the caller's mistake — 400, not 500. */
const respondPublicError = (err: unknown, res: Response): boolean => {
  if (!(err instanceof PublicError)) return false;
  res.status(400).json({ success: false, error: err.message });
  return true;
};

// Folders
router.get('/folders', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const folders = await supabaseService.getNoteFolders(userId);
  res.json({ success: true, data: folders });
}));

router.post('/folders', validateFolderCreate, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const { name, color, groupId, parentId, courseId } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ error: 'Folder name is required.' });
    return;
  }
  try {
    const folder = await supabaseService.createNoteFolder(userId, { name: name.trim(), color, groupId, parentId, courseId });
    res.json({ success: true, data: folder });
  } catch (err) {
    if (respondPublicError(err, res)) return;
    throw err;
  }
}));

router.patch('/folders/:folderId', validateFolderId, validateFolderUpdate, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  // Only columns the folder row owns; courseId (null clears) rides along.
  const { name, color, courseId } = req.body || {};
  const updates: { name?: string; color?: string; courseId?: string | null } = {};
  if (name !== undefined) updates.name = name;
  if (color !== undefined) updates.color = color;
  if (courseId !== undefined) updates.courseId = courseId;
  try {
    const folder = await supabaseService.updateNoteFolder(userId, req.params.folderId, updates);
    res.json({ success: true, data: folder });
  } catch (err) {
    if (respondPublicError(err, res)) return;
    throw err;
  }
}));

router.delete('/folders/:folderId', validateFolderId, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  await supabaseService.deleteNoteFolder(userId, req.params.folderId);
  res.json({ success: true });
}));

// Special routes (must be before /:noteId)
router.post('/upload-pdf', uploadBurstRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const { fileName, base64Data, folderId } = req.body || {};
  if (!fileName || !base64Data) {
    res.status(400).json({ error: 'fileName and base64Data are required.' });
    return;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Data, 'base64');
    assertPdfSize(buffer);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'PDF file is invalid. Please re-upload.',
    });
    return;
  }

  const storagePath = buildNoteStoragePath(userId, fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
  await supabaseService.uploadNoteFile({
    storagePath,
    buffer,
    contentType: 'application/pdf',
  });
  const fileUrl = await supabaseService.createSignedNoteFileUrl(storagePath);
  const extraction = await extractPdfTextDetailsFromBuffer(buffer);
  const { studyText, extractionStatus } = buildPdfStudyText(String(fileName), extraction);
  const noteTitle = String(fileName).replace(/\.pdf$/i, '') || 'Imported PDF';
  const willOcr = shouldAutoEnqueueOcr(extractionStatus);
  const attachmentMeta: Record<string, unknown> = {
    storagePath,
    extractionStatus: willOcr ? 'ocr_processing' : extractionStatus,
    pageCount: extraction.pageCount,
    charsPerPage: extraction.assessment.charsPerPage,
    ocrMaxPages: MAX_OCR_PDF_PAGES,
    ...(willOcr
      ? {
          ocrProvider: 'tesseract',
          ocrStartedAt: new Date().toISOString(),
        }
      : {}),
  };

  let note;
  let attachment;
  try {
    note = await supabaseService.createNote(userId, {
      title: noteTitle,
      body: '',
      folderId,
      sourceType: 'pdf',
    });
    attachment = await supabaseService.addNoteAttachment(note.id, {
      type: 'pdf',
      fileUrl,
      fileName,
      extractedText: willOcr ? ocrPlaceholder(String(fileName)) : studyText,
      metadata: attachmentMeta,
    });
  } catch (err) {
    await supabaseService.deleteNoteFile(storagePath).catch(() => {});
    throw err;
  }

  if (willOcr) {
    void autoStartPdfOcrOrRevert({
      noteId: note.id,
      attachmentId: attachment.id,
      storagePath,
      fileName: String(fileName),
      meta: attachmentMeta,
      userId,
      fallbackText: studyText,
    });
  }

  res.json({
    success: true,
    data: {
      note,
      attachment,
      extractionStatus: willOcr ? 'ocr_processing' : extractionStatus,
      ocrQueued: willOcr,
    },
  });
}));

router.post('/upload-presentation', uploadBurstRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  warmGotenberg();
  const { fileName, base64Data, folderId } = req.body || {};
  if (!fileName || !base64Data) {
    res.status(400).json({ error: 'fileName and base64Data are required.' });
    return;
  }

  const safeName = String(fileName);
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Data, 'base64');
    assertPresentationSize(buffer);
    assertPresentationFileName(safeName);
    if (/\.pptx$/i.test(safeName)) {
      assertValidOfficeZip(buffer, safeName);
    }
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Presentation file is invalid. Please re-upload.',
    });
    return;
  }

  const storagePath = buildNoteStoragePath(userId, safeName);
  const contentType = presentationContentType(safeName);
  await supabaseService.uploadNoteFile({
    storagePath,
    buffer,
    contentType,
  });

  const fileUrl = await supabaseService.createSignedNoteFileUrl(storagePath);
  // Never run Tesseract on the sync upload path — it can OOM/timeout and block open.
  const presentationExtract = await extractPresentationTextDetailsFromBuffer(buffer, safeName, {
    enableOcr: false,
  });
  const { studyText, extractionStatus } = buildPresentationStudyText(
    safeName,
    presentationExtract.text
  );
  const noteTitle = safeName.replace(/\.(pptx?|ppt)$/i, '') || 'Imported slides';

  const processingMeta = {
    storagePath,
    originalMime: contentType,
    previewProcessing: true,
    previewStartedAt: new Date().toISOString(),
    extractionStatus,
    slideCount: presentationExtract.slideCount,
    ocrMaxSlides: MAX_OCR_SLIDES,
    presentationOcrUsed: false,
    presentationOcrTimedOut: false,
  };

  let note;
  let attachment;
  try {
    note = await supabaseService.createNote(userId, {
      title: noteTitle,
      body: '',
      folderId,
      sourceType: 'presentation',
    });
    attachment = await supabaseService.addNoteAttachment(note.id, {
      type: 'presentation',
      fileUrl,
      fileName: safeName,
      extractedText: studyText,
      metadata: processingMeta,
    });
  } catch (err) {
    await supabaseService.deleteNoteFile(storagePath).catch(() => {});
    throw err;
  }

  startPresentationPreviewJob({
    noteId: note.id,
    attachmentId: attachment.id,
    storagePath,
    fileName: safeName,
    meta: processingMeta,
    buffer,
    extractedText: studyText,
  });

  res.json({
    success: true,
    data: {
      note,
      attachment,
      previewAvailable: false,
      status: 'processing',
      extractionStatus,
    },
  });
}));

router.post('/finalize-presentation', uploadBurstRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  warmGotenberg();
  const { storagePath, fileName, folderId } = req.body;
  if (!storagePath || !fileName) {
    res.status(400).json({ error: 'storagePath and fileName are required.' });
    return;
  }

  const safeName = String(fileName);
  let buffer: Buffer;
  let ownedPath: string | null = null;

  try {
    assertUserOwnedNoteStoragePath(String(storagePath), userId);
    ownedPath = String(storagePath);
    assertPresentationFileName(safeName);
    const downloaded = await supabaseService.downloadNoteFile(ownedPath);
    buffer = downloaded.buffer;
    assertPresentationSize(buffer);
    if (/\.pptx$/i.test(safeName)) {
      assertValidOfficeZip(buffer, safeName);
    }
  } catch (err) {
    if (ownedPath) {
      await supabaseService.deleteNoteFile(ownedPath).catch(() => {});
    }
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Presentation file is invalid. Please re-upload.',
    });
    return;
  }

  const contentType = presentationContentType(safeName);
  const fileUrl = await supabaseService.createSignedNoteFileUrl(ownedPath);
  const presentationExtract = await extractPresentationTextDetailsFromBuffer(buffer, safeName, {
    enableOcr: false,
  });
  const { studyText, extractionStatus } = buildPresentationStudyText(
    safeName,
    presentationExtract.text
  );
  const noteTitle = safeName.replace(/\.(pptx?|ppt)$/i, '') || 'Imported slides';

  const processingMeta = {
    storagePath: ownedPath,
    originalMime: contentType,
    previewProcessing: true,
    previewStartedAt: new Date().toISOString(),
    extractionStatus,
    slideCount: presentationExtract.slideCount,
    ocrMaxSlides: MAX_OCR_SLIDES,
    presentationOcrUsed: false,
    presentationOcrTimedOut: false,
  };

  let note;
  let attachment;
  try {
    note = await supabaseService.createNote(userId, {
      title: noteTitle,
      body: '',
      folderId,
      sourceType: 'presentation',
    });
    attachment = await supabaseService.addNoteAttachment(note.id, {
      type: 'presentation',
      fileUrl,
      fileName: safeName,
      extractedText: studyText,
      metadata: processingMeta,
    });
  } catch (err) {
    await supabaseService.deleteNoteFile(ownedPath).catch(() => {});
    throw err;
  }

  startPresentationPreviewJob({
    noteId: note.id,
    attachmentId: attachment.id,
    storagePath: ownedPath,
    fileName: safeName,
    meta: processingMeta,
    buffer,
    extractedText: studyText,
  });

  logger.info('Presentation upload finalized', {
    userId,
    fileName: safeName,
    bytes: buffer.length,
    durationMs: Date.now() - startedAt,
    extractionStatus,
  });

  res.json({
    success: true,
    data: {
      note,
      attachment,
      previewAvailable: false,
      status: 'processing',
      extractionStatus,
    },
  });
}));

router.post('/warm-preview', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  warmGotenberg();
  res.json({ success: true });
}));

router.post('/finalize-pdf', uploadBurstRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const { storagePath, fileName, folderId } = req.body;
  if (!storagePath || !fileName) {
    res.status(400).json({ error: 'storagePath and fileName are required.' });
    return;
  }

  const safeName = String(fileName);
  let buffer: Buffer;
  let ownedPath: string | null = null;

  try {
    assertUserOwnedNoteStoragePath(String(storagePath), userId);
    ownedPath = String(storagePath);
    const downloaded = await supabaseService.downloadNoteFile(ownedPath);
    buffer = downloaded.buffer;
    assertPdfSize(buffer);
  } catch (err) {
    if (ownedPath) {
      await supabaseService.deleteNoteFile(ownedPath).catch(() => {});
    }
    res.status(400).json({
      error: err instanceof Error ? err.message : 'PDF file is invalid. Please re-upload.',
    });
    return;
  }

  const fileUrl = await supabaseService.createSignedNoteFileUrl(ownedPath);
  const extraction = await extractPdfTextDetailsFromBuffer(buffer);
  const { studyText, extractionStatus } = buildPdfStudyText(safeName, extraction);
  const noteTitle = safeName.replace(/\.pdf$/i, '') || 'Imported PDF';
  const willOcr = shouldAutoEnqueueOcr(extractionStatus);
  const attachmentMeta: Record<string, unknown> = {
    storagePath: ownedPath,
    extractionStatus: willOcr ? 'ocr_processing' : extractionStatus,
    pageCount: extraction.pageCount,
    charsPerPage: extraction.assessment.charsPerPage,
    ocrMaxPages: MAX_OCR_PDF_PAGES,
    ...(willOcr
      ? {
          ocrProvider: 'tesseract',
          ocrStartedAt: new Date().toISOString(),
        }
      : {}),
  };

  let note;
  let attachment;
  try {
    note = await supabaseService.createNote(userId, {
      title: noteTitle,
      body: '',
      folderId,
      sourceType: 'pdf',
    });
    attachment = await supabaseService.addNoteAttachment(note.id, {
      type: 'pdf',
      fileUrl,
      fileName: safeName,
      extractedText: willOcr ? ocrPlaceholder(safeName) : studyText,
      metadata: attachmentMeta,
    });
  } catch (err) {
    await supabaseService.deleteNoteFile(ownedPath).catch(() => {});
    throw err;
  }

  if (willOcr) {
    void autoStartPdfOcrOrRevert({
      noteId: note.id,
      attachmentId: attachment.id,
      storagePath: ownedPath,
      fileName: safeName,
      meta: attachmentMeta,
      userId,
      fallbackText: studyText,
    });
  }

  logger.info('PDF upload finalized', {
    userId,
    fileName: safeName,
    bytes: buffer.length,
    durationMs: Date.now() - startedAt,
    extractionStatus,
    ocrQueued: willOcr,
  });

  res.json({
    success: true,
    data: {
      note,
      attachment,
      extractionStatus: willOcr ? 'ocr_processing' : extractionStatus,
      ocrQueued: willOcr,
    },
  });
}));

router.post('/finalize-images', uploadBurstRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const { storagePaths, fileNames, folderId, title } = req.body;
  if (!Array.isArray(storagePaths) || !Array.isArray(fileNames) || storagePaths.length === 0) {
    res.status(400).json({ error: 'storagePaths and fileNames arrays are required.' });
    return;
  }
  if (storagePaths.length !== fileNames.length) {
    res.status(400).json({ error: 'storagePaths and fileNames must have the same length.' });
    return;
  }

  let validated: ValidatedNoteImage[] = [];
  try {
    validated = await validateNoteImageUploads(userId, storagePaths, fileNames);
  } catch (err) {
    for (const path of storagePaths) {
      await supabaseService.deleteNoteFile(String(path)).catch(() => {});
    }
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Image file is invalid. Please re-upload.',
    });
    return;
  }

  const noteTitle =
    (typeof title === 'string' && title.trim()) || defaultPhotoNoteTitle();

  let note;
  let attachments;
  try {
    note = await supabaseService.createNote(userId, {
      title: noteTitle,
      body: '',
      folderId,
      sourceType: 'photos',
    });
    attachments = await createPhotoNoteAttachments(note.id, validated, 0);
  } catch (err) {
    for (const image of validated) {
      await supabaseService.deleteNoteFile(image.storagePath).catch(() => {});
    }
    throw err;
  }

  const queued = await queuePhotoNoteOcr(note.id, userId, attachments);
  const latest =
    queued > 0 ? await supabaseService.getNoteAttachments(note.id) : attachments;

  logger.info('Photo note finalized', {
    userId,
    imageCount: validated.length,
    ocrQueued: queued > 0,
    durationMs: Date.now() - startedAt,
  });

  res.json({
    success: true,
    data: { note, attachments: latest, ocrQueued: queued > 0 },
  });
}));

router.post('/upload-images', uploadBurstRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const { images, folderId, title } = req.body;
  if (!Array.isArray(images) || images.length === 0) {
    res.status(400).json({ error: 'images array is required.' });
    return;
  }

  let validated: ValidatedNoteImage[] = [];
  try {
    validated = await uploadBase64NoteImages(userId, images);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Image file is invalid. Please re-upload.',
    });
    return;
  }

  const noteTitle =
    (typeof title === 'string' && title.trim()) || defaultPhotoNoteTitle();

  let note;
  let attachments;
  try {
    note = await supabaseService.createNote(userId, {
      title: noteTitle,
      body: '',
      folderId,
      sourceType: 'photos',
    });
    attachments = await createPhotoNoteAttachments(note.id, validated, 0);
  } catch (err) {
    for (const image of validated) {
      await supabaseService.deleteNoteFile(image.storagePath).catch(() => {});
    }
    throw err;
  }

  const queued = await queuePhotoNoteOcr(note.id, userId, attachments);
  const latest =
    queued > 0 ? await supabaseService.getNoteAttachments(note.id) : attachments;

  logger.info('Photo note uploaded via API', {
    userId,
    imageCount: validated.length,
    ocrQueued: queued > 0,
    durationMs: Date.now() - startedAt,
  });

  res.json({
    success: true,
    data: { note, attachments: latest, ocrQueued: queued > 0 },
  });
}));

router.post('/daily-quiz', requirePermission('ai'), aiPostBurstRateLimit, aiRateLimitForFeature('generate_questions'), asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const { content, studyGoal, count } = req.body || {};
  if (!content || typeof content !== 'string' || content.trim().length < 50) {
    res.status(400).json({ error: 'At least 50 characters of study material required.' });
    return;
  }
  const result = await runNoteAiSync(() => generateDailyQuiz(content, { studyGoal, count }));
  res.json({ success: true, data: result });
}));

const MAX_LECTURE_AUDIO_BYTES = 25 * 1024 * 1024;
const ALLOWED_LECTURE_AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-m4a',
]);

function resolveLectureMimeFromDeclared(mimeType: unknown): { mimeType: string; extension: string } {
  // Empty buffer skips magic sniffing; declared MIME drives extension selection.
  return resolveAudioUploadMeta(
    Buffer.alloc(0),
    typeof mimeType === 'string' && mimeType.trim() ? mimeType : 'audio/webm'
  );
}

/**
 * Mint a signed Supabase upload URL so the browser can PUT lecture audio
 * directly to storage (avoids CF proxy / API body limits for large clips).
 */
router.post('/prepare-lecture-audio-upload', uploadBurstRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const requestId = (req as { requestId?: string }).requestId;
  const { mimeType, fileName, noteId, byteLength } = req.body || {};

  if (noteId) {
    try {
      const canEdit = await supabaseService.canEditNote(userId, noteId);
      if (!canEdit) {
        res.status(403).json({
          success: false,
          error: 'You do not have permission to edit this note. Ask the owner to grant editor access.',
          message: 'You do not have permission to edit this note. Ask the owner to grant editor access.',
        });
        return;
      }
    } catch (error) {
      logger.warn('prepare-lecture-audio-upload canEditNote failed', {
        requestId,
        userId,
        noteId,
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(400).json({
        success: false,
        error: 'Could not verify note edit access. Check the note id and try again.',
        message: 'Could not verify note edit access. Check the note id and try again.',
      });
      return;
    }
  }

  if (typeof byteLength === 'number') {
    if (byteLength < 64) {
      res.status(400).json({
        success: false,
        error: 'Recording was empty or too short. Hold for at least 2 seconds, then stop.',
        message: 'Recording was empty or too short. Hold for at least 2 seconds, then stop.',
      });
      return;
    }
    if (byteLength > MAX_LECTURE_AUDIO_BYTES) {
      res.status(413).json({
        success: false,
        error: 'Recording is too large to upload. Try a shorter clip (under ~20 minutes).',
        message: 'Recording is too large to upload. Try a shorter clip (under ~20 minutes).',
      });
      return;
    }
  }

  const meta = resolveLectureMimeFromDeclared(mimeType);
  const normalizedMime = meta.mimeType === 'audio/x-m4a' ? 'audio/mp4' : meta.mimeType;
  if (!ALLOWED_LECTURE_AUDIO_TYPES.has(meta.mimeType) && !ALLOWED_LECTURE_AUDIO_TYPES.has(normalizedMime)) {
    res.status(400).json({
      success: false,
      error: 'Unsupported audio type. Use webm, mp4/m4a, ogg, or wav.',
      message: 'Unsupported audio type. Use webm, mp4/m4a, ogg, or wav.',
    });
    return;
  }

  const safeName =
    typeof fileName === 'string' && fileName.trim()
      ? fileName
      : `lecture-${Date.now()}.${meta.extension}`;
  const storagePath = buildNoteStoragePath(userId, safeName);

  try {
    const signed = await supabaseService.createSignedNoteFileUploadUrl(storagePath);
    logger.info('prepare-lecture-audio-upload minted', {
      requestId,
      userId,
      noteId: noteId || null,
      storagePath: signed.path,
      mimeType: normalizedMime,
      byteLength: typeof byteLength === 'number' ? byteLength : null,
    });
    res.json({
      success: true,
      data: {
        storagePath: signed.path,
        signedUrl: signed.signedUrl,
        token: signed.token,
        mimeType: normalizedMime,
        fileName: safeName,
        bucket: 'note-files',
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error('prepare-lecture-audio-upload failed', {
      requestId,
      userId,
      noteId: noteId || null,
      storagePath,
      message: detail,
    });
    res.status(502).json({
      success: false,
      error: 'Could not prepare recording upload. Please try again.',
      message: clientErrorMessage(error, 'Could not prepare recording upload. Please try again.'),
    });
  }
}));

router.post('/upload-lecture-audio', uploadBurstRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const requestId = (req as { requestId?: string }).requestId;
  const { audioBase64, mimeType, fileName, noteId } = req.body || {};
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    res.status(400).json({ success: false, error: 'audioBase64 is required.', message: 'audioBase64 is required.' });
    return;
  }

  if (noteId) {
    try {
      const canEdit = await supabaseService.canEditNote(userId, noteId);
      if (!canEdit) {
        res.status(403).json({
          success: false,
          error: 'You do not have permission to edit this note. Ask the owner to grant editor access.',
          message: 'You do not have permission to edit this note. Ask the owner to grant editor access.',
        });
        return;
      }
    } catch (error) {
      logger.warn('upload-lecture-audio canEditNote failed', {
        requestId,
        userId,
        noteId,
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(400).json({
        success: false,
        error: 'Could not verify note edit access. Check the note id and try again.',
        message: 'Could not verify note edit access. Check the note id and try again.',
      });
      return;
    }
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(audioBase64, 'base64');
  } catch {
    res.status(400).json({
      success: false,
      error: 'Could not decode recording payload.',
      message: 'Could not decode recording payload.',
    });
    return;
  }
  if (buffer.length < 64) {
    res.status(400).json({
      success: false,
      error: 'Recording was empty or too short. Hold for at least 2 seconds, then stop.',
      message: 'Recording was empty or too short. Hold for at least 2 seconds, then stop.',
    });
    return;
  }
  if (buffer.length > MAX_LECTURE_AUDIO_BYTES) {
    res.status(413).json({
      success: false,
      error: 'Recording is too large to upload. Try a shorter clip (under ~20 minutes).',
      message: 'Recording is too large to upload. Try a shorter clip (under ~20 minutes).',
    });
    return;
  }

  const meta = resolveAudioUploadMeta(buffer, typeof mimeType === 'string' ? mimeType : 'audio/webm');
  const normalizedMime = meta.mimeType === 'audio/x-m4a' ? 'audio/mp4' : meta.mimeType;
  if (!ALLOWED_LECTURE_AUDIO_TYPES.has(meta.mimeType) && !ALLOWED_LECTURE_AUDIO_TYPES.has(normalizedMime)) {
    res.status(400).json({
      success: false,
      error: 'Unsupported audio type. Use webm, mp4/m4a, ogg, or wav.',
      message: 'Unsupported audio type. Use webm, mp4/m4a, ogg, or wav.',
    });
    return;
  }

  const safeName =
    typeof fileName === 'string' && fileName.trim()
      ? fileName
      : `lecture-${Date.now()}.${meta.extension}`;
  const storagePath = buildNoteStoragePath(userId, safeName);

  try {
    await supabaseService.uploadNoteFile({
      storagePath,
      buffer,
      contentType: normalizedMime,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error('upload-lecture-audio storage failed', {
      requestId,
      userId,
      noteId: noteId || null,
      storagePath,
      byteLength: buffer.length,
      sniffedMimeType: normalizedMime,
      message: detail,
    });
    res.status(502).json({
      success: false,
      error: 'Could not store the recording. Please try again.',
      message: clientErrorMessage(error, 'Could not store the recording. Please try again.'),
    });
    return;
  }

  logger.info('upload-lecture-audio stored', {
    requestId,
    userId,
    noteId: noteId || null,
    storagePath,
    byteLength: buffer.length,
    sniffedMimeType: normalizedMime,
  });

  res.json({
    success: true,
    data: {
      storagePath,
      mimeType: normalizedMime,
      byteLength: buffer.length,
      fileName: safeName,
    },
  });
}));

/**
 * Transcription is priced by how long the recording is: 1 AI use per 15
 * minutes, or part of one (founder decision, 2026-09-07). The cost is reserved
 * BEFORE any work happens, so a student who cannot afford a 90-minute lecture
 * is refused up front instead of being charged for a partial job, and the
 * charge is stamped on `X-AI-Cost` so the client can show what it actually
 * cost next to the estimate it quoted.
 *
 * `durationMs` comes from the client, so it is a claim. It is bounded by
 * `MAX_LECTURE_TRANSCRIPTION_MS` and by `MAX_AI_CREDIT_COST` inside
 * `getLectureTranscriptionCost`, and a missing or nonsense figure prices at
 * the 1-use minimum rather than at a guess. The transcription service reads
 * the real audio afterwards and logs the sniffed length; the price is not
 * re-charged from it, because a student must never be billed more than the
 * number they were shown before they pressed the button.
 */
/**
 * The price of one transcription request, read off the body.
 *
 * Exported so the price a student is charged can be tested directly, rather
 * than through a route that needs Whisper, storage and a note to exist. A CF
 * Pages proxy or an empty Content-Type can leave `body` unset, so it is never
 * destructured; a missing duration falls through to the 1-use minimum.
 */
export function lectureTranscriptionCostFromRequest(req: { body?: unknown }): number {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  return getLectureTranscriptionCost(Number(body.durationMs));
}

/**
 * Is this request a spoken QUESTION rather than a recording to write out?
 *
 * The client says so with `featureKey: "voice_ask"`. Nothing else about the
 * two paths differs at the transport level — same audio, same Whisper call —
 * so the flag is what decides which rules apply, and every rule below is
 * enforced server-side because a flag in a body is a claim.
 */
export function isVoiceAskRequest(req: { body?: unknown }): boolean {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  return body.featureKey === VOICE_ASK_FEATURE_KEY;
}

/** Bytes of audio actually in this request, or null when it came from storage. */
function voiceAskPayloadBytes(body: Record<string, unknown>): number | null {
  const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64 : '';
  if (!audioBase64) return null;
  // Base64 is 4 characters per 3 bytes; padding trims up to two.
  const padding = audioBase64.endsWith('==') ? 2 : audioBase64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((audioBase64.length * 3) / 4) - padding);
}

/**
 * Why this voice question is refused, or null when it is fine.
 *
 * Two rules, both about keeping the free door narrow enough that it stays
 * free: the clip must CLAIM to be short, and it must BE short. The claim
 * alone would let a mislabelled lecture through; the size alone would let a
 * silent hour of near-empty audio through. A voice question also never comes
 * from storage — it is recorded and posted in one go — so a storagePath here
 * is a lecture wearing the wrong flag.
 */
export function voiceAskRejection(req: { body?: unknown }): string | null {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const durationMs = Number(body.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return `Ask by voice needs the length of the clip. Record again, or type your question.`;
  }
  if (durationMs > VOICE_ASK_MAX_DURATION_MS) return VOICE_ASK_TOO_LONG_MESSAGE;

  if (typeof body.storagePath === 'string' && body.storagePath) {
    return VOICE_ASK_TOO_LONG_MESSAGE;
  }

  const bytes = voiceAskPayloadBytes(body);
  if (bytes === null || bytes === 0) {
    return 'Ask by voice needs the recording itself. Record again, or type your question.';
  }
  if (bytes > VOICE_ASK_MAX_AUDIO_BYTES) return VOICE_ASK_TOO_LONG_MESSAGE;

  return null;
}

/**
 * One route, two prices.
 *
 * A lecture is priced by its length (1 AI use per 15 minutes). A spoken
 * question is free, capped 40 a day, and pays no per-15-minute charge at all —
 * asking out loud must never cost more than typing the same words. The
 * duration guard runs BEFORE either limiter, so a refused clip does not spend
 * one of the day's questions on its way to a 400.
 */
export function transcribeAudioLimiter(req: Request, res: Response, next: NextFunction): void {
  if (!isVoiceAskRequest(req)) {
    void aiRateLimitWithCost(lectureTranscriptionCostFromRequest, {
      label: 'Transcribing this recording',
    })(req, res, next);
    return;
  }
  const rejection = voiceAskRejection(req);
  if (rejection) {
    res.status(400).json({ error: rejection });
    return;
  }
  void aiRateLimitForFeature(VOICE_ASK_FEATURE_KEY)(req, res, next);
}

router.post('/transcribe-audio', requirePermission('ai'), aiPostBurstRateLimit, transcribeAudioLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  // CF Pages proxy / empty Content-Type can leave body unset — never destructure undefined.
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const audioBase64 = body.audioBase64;
  const storagePath = body.storagePath;
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : undefined;
  const noteId = typeof body.noteId === 'string' ? body.noteId : undefined;
  const fileName = typeof body.fileName === 'string' ? body.fileName : undefined;
  const currentBody = body.currentBody;
  const durationMs = body.durationMs;
  const clientByteLength = body.clientByteLength;
  const hasBase64 = typeof audioBase64 === 'string' && audioBase64.length > 0;
  const hasStoragePath = typeof storagePath === 'string' && storagePath.length > 0;
  if (!hasBase64 && !hasStoragePath) {
    res.status(400).json({ error: 'audioBase64 or storagePath is required.' });
    return;
  }

  // A spoken question is never written into the note — it is a question, not a
  // transcript — so it needs no edit rights on the note it is asked about. It
  // also skips the note-writing tail below entirely: appending "what does
  // Krebs mean here" to a student's lecture notes would be a bug, not a save.
  const voiceAsk = isVoiceAskRequest(req);

  // Authorize edit before calling Whisper so collaborators without write access
  // (and failed ACL checks) do not burn AI quota.
  if (noteId && !voiceAsk) {
    const canEdit = await supabaseService.canEditNote(userId, noteId);
    if (!canEdit) {
      res.status(403).json({
        success: false,
        error: 'You do not have permission to edit this note. Ask the owner to grant editor access.',
      });
      return;
    }
  }

  const requestId = (req as { requestId?: string }).requestId;
  const logContext = {
    requestId,
    noteId: noteId || null,
    storagePath: hasStoragePath ? String(storagePath) : null,
    clientDurationMs: typeof durationMs === 'number' ? durationMs : null,
    clientByteLength: typeof clientByteLength === 'number' ? clientByteLength : null,
    clientMimeType: mimeType || null,
  };

  const result = await runNoteAiSync(async () => {
    if (hasStoragePath) {
      assertUserOwnedNoteStoragePath(String(storagePath), userId);
      const downloaded = await supabaseService.downloadNoteFile(String(storagePath));
      return transcribeAudioBuffer(
        downloaded.buffer,
        mimeType || downloaded.contentType || 'audio/webm',
        logContext
      );
    }
    return transcribeAudioBase64(String(audioBase64), mimeType || 'audio/webm', logContext);
  });

  const { logAIInference } = await import('../services/aiInferenceLog');
  await logAIInference(supabaseService.getClient(), {
    userId,
    feature: voiceAsk ? 'voice-ask' : 'transcribe-audio',
    provider: result.provider,
    requestId,
  });

  if (!noteId || voiceAsk) {
    res.json({ success: true, data: result });
    return;
  }

  // Persist transcript with CAS-safe retries. Always return the Whisper text so the
  // client can still show it if note write races with autosave.
  let updatedNote: Awaited<ReturnType<typeof supabaseService.updateNote>> | undefined;
  let attachmentFileUrl: string | undefined;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const note = await supabaseService.getNote(noteId, userId);
      const preferredBody =
        attempt === 0 && typeof currentBody === 'string' ? currentBody : (note.body || '');
      const alreadyHasTranscript =
        Boolean(result.transcript) && preferredBody.includes(result.transcript);
      const mergedBody = alreadyHasTranscript
        ? preferredBody
        : [preferredBody, result.transcript].filter(Boolean).join('\n\n');
      try {
        updatedNote = await supabaseService.updateNote(
          userId,
          noteId,
          { body: mergedBody },
          { allowRetryOnConflict: true }
        );
        break;
      } catch (error) {
        if (!isVersionConflictError(error) || attempt === 2) throw error;
      }
    }

    if (hasStoragePath) {
      try {
        attachmentFileUrl = await supabaseService.createSignedNoteFileUrl(String(storagePath));
      } catch {
        attachmentFileUrl = undefined;
      }
    }

    await supabaseService.addNoteAttachment(noteId, {
      type: 'audio',
      fileName: fileName || 'lecture-recording.webm',
      fileUrl: attachmentFileUrl,
      extractedText: result.transcript,
      metadata: {
        provider: result.provider,
        mimeType: result.sniffedMimeType || mimeType || null,
        storagePath: hasStoragePath ? String(storagePath) : null,
        byteLength: result.byteLength,
      },
    });
  } catch (error) {
    logger.warn('Transcript persist failed after successful Whisper', {
      noteId,
      userId,
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
    res.json({
      success: true,
      data: {
        ...result,
        persistWarning:
          'Transcript ready, but saving to the note failed. It was added in your editor — tap Save if it does not stick.',
      },
    });
    return;
  }

  res.json({ success: true, data: { ...result, note: updatedNote } });
}));

router.post('/from-youtube', uploadBurstRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const { url, folderId } = req.body;
  const videoId = parseYoutubeVideoId(typeof url === 'string' ? url : '');
  if (!videoId) {
    res.status(400).json({ error: 'Please paste a valid YouTube link.' });
    return;
  }

  const canonicalUrl = canonicalYoutubeUrl(videoId);
  const metadata = await fetchYoutubeMetadata(videoId);
  const noteTitle = metadata?.title || 'YouTube video';

  const attachmentMeta: Record<string, unknown> = {
    videoId,
    authorName: metadata?.authorName || null,
    thumbnailUrl: metadata?.thumbnailUrl || null,
    transcriptStatus: 'processing',
    transcriptStartedAt: new Date().toISOString(),
  };

  const note = await supabaseService.createNote(userId, {
    title: noteTitle,
    body: '',
    folderId,
    sourceType: 'youtube',
    youtubeUrl: canonicalUrl,
    youtubeVideoId: videoId,
  });
  const attachment = await supabaseService.addNoteAttachment(note.id, {
    type: 'youtube',
    fileUrl: canonicalUrl,
    fileName: noteTitle,
    metadata: attachmentMeta,
  });

  const outcome = await runSyncOrEnqueue(
    'notes.youtube.transcript',
    { noteId: note.id, attachmentId: attachment.id, videoId, meta: attachmentMeta },
    userId,
    () =>
      runYoutubeTranscriptJob(supabaseService, {
        noteId: note.id,
        attachmentId: attachment.id,
        videoId,
        meta: attachmentMeta,
      })
  ,
    aiChargeFromRes(res)
  );

  if (outcome.mode === 'async') {
    stampAiChargeOnJob(res, outcome.jobId);
    res.status(202).json({
      success: true,
      data: { note, attachment, status: 'processing' },
      jobId: outcome.jobId,
    });
    return;
  }

  const jobResult = outcome.result;
  const attachments = await supabaseService.getNoteAttachments(note.id);
  const updatedAttachment = attachments.find((a) => a.id === attachment.id) || attachment;
  res.json({
    success: true,
    data: {
      note,
      attachment: updatedAttachment,
      status: jobResult.status,
      ...(jobResult.status === 'failed' ? { transcriptError: jobResult.error } : {}),
    },
  });
}));

// Secure share-link preview/accept (token path — before UUID noteId middleware)
router.get(
  '/share/:token/preview',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const preview = await supabaseService.previewNoteShareLink(String(req.params.token || ''), userId);
      res.json({ success: true, data: preview });
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      const status =
        code === 'share_link_not_found' || code === 'share_link_invalid'
          ? 404
          : code === 'share_link_revoked' || code === 'share_link_expired'
            ? 410
            : 400;
      res.status(status).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid share link',
        code,
      });
    }
  })
);

router.post(
  '/share/:token/accept',
  idempotencyMiddleware({
    operation: 'note_share_accept',
    fallbackKey: (req) =>
      `note_share_accept:${(req as IdempotentRequest).user?.id}:${req.params.token}`,
  }),
  asyncHandler(async (req: IdempotentRequest, res: Response) => {
    const userId = requireAuthUserId(req as any, res);
    if (!userId) return;
    try {
      const result = await req.runIdempotent!(async () => {
        const accepted = await supabaseService.acceptNoteShareLink(
          String(req.params.token || ''),
          userId
        );
        return { accepted: accepted as unknown as Record<string, unknown> };
      });
      res.json({ success: true, data: result.accepted });
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      const status =
        code === 'share_link_not_found' || code === 'share_link_invalid'
          ? 404
          : code === 'share_link_revoked' || code === 'share_link_expired'
            ? 410
            : 400;
      res.status(status).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to accept share link',
        code,
      });
    }
  })
);

// Note-scoped ownership checks (must be after static paths like /folders, /upload-pdf)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
router.use('/:noteId', (req, res, next) => {
  if (!UUID_RE.test(String(req.params.noteId || ''))) {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
  return requireNoteAccess('noteId')(req as any, res, next);
});

// Attachment routes (before /:noteId CRUD) — static paths before :attachmentId
router.patch('/:noteId/attachments/reorder', requireNoteEdit('noteId'), asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  await supabaseService.getNote(req.params.noteId, userId);
  const { attachmentIds } = req.body;
  if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) {
    res.status(400).json({ error: 'attachmentIds array is required.' });
    return;
  }

  const attachments = await supabaseService.getNoteAttachments(req.params.noteId);
  const imageAttachments = attachments.filter((a) => a.type === 'image');
  if (attachmentIds.length !== imageAttachments.length) {
    res.status(400).json({ error: 'attachmentIds must include every image attachment exactly once.' });
    return;
  }

  const imageIdSet = new Set(imageAttachments.map((a) => a.id));
  for (const id of attachmentIds) {
    if (typeof id !== 'string' || !imageIdSet.has(id)) {
      res.status(400).json({ error: 'attachmentIds must include every image attachment exactly once.' });
      return;
    }
  }

  const updated = [];
  for (let i = 0; i < attachmentIds.length; i++) {
    const existing = imageAttachments.find((a) => a.id === attachmentIds[i]);
    const metadata = { ...(existing?.metadata || {}), sortOrder: i };
    const attachment = await supabaseService.updateNoteAttachment(attachmentIds[i], { metadata });
    updated.push(attachment);
  }

  updated.sort(
    (a, b) =>
      (typeof a.metadata?.sortOrder === 'number' ? a.metadata.sortOrder : 0) -
      (typeof b.metadata?.sortOrder === 'number' ? b.metadata.sortOrder : 0)
  );

  res.json({ success: true, data: { attachments: updated } });
}));

router.post('/:noteId/attachments/finalize-image', requireNoteEdit('noteId'), uploadBurstRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const note = await supabaseService.getNote(req.params.noteId, userId);
  if (note.sourceType !== 'photos') {
    res.status(400).json({ error: 'Note is not a photo note.' });
    return;
  }

  const { storagePaths, fileNames } = req.body;
  if (!Array.isArray(storagePaths) || !Array.isArray(fileNames) || storagePaths.length === 0) {
    res.status(400).json({ error: 'storagePaths and fileNames arrays are required.' });
    return;
  }
  if (storagePaths.length !== fileNames.length) {
    res.status(400).json({ error: 'storagePaths and fileNames must have the same length.' });
    return;
  }

  let validated: ValidatedNoteImage[] = [];
  try {
    validated = await validateNoteImageUploads(userId, storagePaths, fileNames);
  } catch (err) {
    for (const path of storagePaths) {
      await supabaseService.deleteNoteFile(String(path)).catch(() => {});
    }
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Image file is invalid. Please re-upload.',
    });
    return;
  }

  const existing = await supabaseService.getNoteAttachments(req.params.noteId);
  const imageAttachments = existing.filter((a) => a.type === 'image');
  const startOrder =
    imageAttachments.reduce(
      (max, a) =>
        Math.max(max, typeof a.metadata?.sortOrder === 'number' ? a.metadata.sortOrder : 0),
      -1
    ) + 1;

  const attachments = await createPhotoNoteAttachments(req.params.noteId, validated, startOrder);
  const queued = await queuePhotoNoteOcr(req.params.noteId, userId, attachments);
  const latest =
    queued > 0 ? await supabaseService.getNoteAttachments(req.params.noteId) : attachments;
  res.json({
    success: true,
    data: {
      attachments: latest.filter((a) => a.type === 'image'),
      ocrQueued: queued > 0,
    },
  });
}));

router.post('/:noteId/attachments/upload-images', requireNoteEdit('noteId'), uploadBurstRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const note = await supabaseService.getNote(req.params.noteId, userId);
  if (note.sourceType !== 'photos') {
    res.status(400).json({ error: 'Note is not a photo note.' });
    return;
  }

  const { images } = req.body;
  if (!Array.isArray(images) || images.length === 0) {
    res.status(400).json({ error: 'images array is required.' });
    return;
  }

  let validated: ValidatedNoteImage[] = [];
  try {
    validated = await uploadBase64NoteImages(userId, images);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Image file is invalid. Please re-upload.',
    });
    return;
  }

  try {
    const existing = await supabaseService.getNoteAttachments(req.params.noteId);
    const imageAttachments = existing.filter((a) => a.type === 'image');
    const startOrder =
      imageAttachments.reduce(
        (max, a) =>
          Math.max(max, typeof a.metadata?.sortOrder === 'number' ? a.metadata.sortOrder : 0),
        -1
      ) + 1;

    const attachments = await createPhotoNoteAttachments(req.params.noteId, validated, startOrder);
    const queued = await queuePhotoNoteOcr(req.params.noteId, userId, attachments);
    const latest =
      queued > 0 ? await supabaseService.getNoteAttachments(req.params.noteId) : attachments;
    res.json({
      success: true,
      data: {
        attachments: latest.filter((a) => a.type === 'image'),
        ocrQueued: queued > 0,
      },
    });
  } catch (err) {
    for (const image of validated) {
      await supabaseService.deleteNoteFile(image.storagePath).catch(() => {});
    }
    throw err;
  }
}));

router.get('/:noteId/attachments/:attachmentId/url', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  await supabaseService.getNote(req.params.noteId, userId);
  const attachment = await supabaseService.getNoteAttachment(req.params.noteId, req.params.attachmentId);
  if (!attachment) {
    res.status(404).json({ error: 'Attachment not found.' });
    return;
  }
  const storagePath = supabaseService.resolveNoteAttachmentStoragePath(attachment);
  if (!storagePath) {
    // Name the shape, because the client now SHOWS this sentence. An audio row
    // transcribed straight from base64 is stored with `metadata.storagePath:
    // null` and no `fileUrl` (see transcribe-audio above), and "no storage
    // path" alone sent the Round 2 device pass hunting an expiry bug that was
    // never there.
    const detail = attachment.fileUrl
      ? 'Its saved link does not point at this app\u2019s note storage.'
      : 'This attachment was saved without a stored file.';
    logger.warn('attachment url has no storage path', {
      noteId: req.params.noteId,
      attachmentId: req.params.attachmentId,
      type: attachment.type || null,
      hasFileUrl: Boolean(attachment.fileUrl),
    });
    res.status(400).json({
      error: `This file cannot be opened. ${detail}`,
      message: `This file cannot be opened. ${detail}`,
    });
    return;
  }
  const variant = req.query.variant === 'thumb' ? 'thumb' : 'original';
  let url: string;
  try {
    url = await supabaseService.createSignedNoteFileUrl(storagePath, 60 * 60 * 24, variant);
  } catch (error) {
    // Storage refusing to sign means the object is gone (or the bucket is not
    // the one the row claims). That is a 404 about the FILE, not a 500 about
    // this server, and the difference is the whole diagnosis on the handset.
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn('attachment url signing failed', {
      noteId: req.params.noteId,
      attachmentId: req.params.attachmentId,
      storagePath,
      message: detail,
    });
    res.status(404).json({
      error: 'The stored file could not be found. It may have been removed from storage.',
      message: 'The stored file could not be found. It may have been removed from storage.',
    });
    return;
  }
  res.json({ success: true, data: { url, expiresIn: 60 * 60 * 24, variant } });
}));

/**
 * The page model: one row per page of an uploaded document, for walk-through
 * mode, per-page quizzes and page-scoped grounding.
 *
 * Pages are backfilled from the stored file the first time this is called, so a
 * document uploaded before the page model existed gets pages on first open.
 * Page images are NOT rendered unless asked for (`?images=1`) — rendering is
 * the expensive half of OCR, and a plan panel only needs the text.
 *
 * When the migration has not been hand-applied yet this answers 200 with
 * `available: false` and no pages, so the client says the document has not been
 * split into pages rather than showing an error or inventing pages.
 */
router.get('/:noteId/attachments/:attachmentId/pages', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  // Same ACL as every other attachment read: owner, collaborator, or a member
  // of the group the note is shared into. Throws when the user cannot read it.
  await supabaseService.getNote(req.params.noteId, userId);
  const attachment = await supabaseService.getNoteAttachment(req.params.noteId, req.params.attachmentId);
  if (!attachment) {
    res.status(404).json({ error: 'Attachment not found.' });
    return;
  }

  // Text first, pictures second: the image pass only renders pages that
  // already have rows, so on a document's first open it must run AFTER the
  // backfill or the first walk-through would come back with no pictures and
  // only the second would have them.
  let result = await ensurePages(supabaseService, {
    noteId: req.params.noteId,
    attachmentId: req.params.attachmentId,
  });

  const wantsImages = req.query.images === '1' || req.query.images === 'true';
  if (wantsImages && result.available && result.pages.length > 0) {
    const render = await ensurePageImages(supabaseService, {
      noteId: req.params.noteId,
      attachmentId: req.params.attachmentId,
    }).catch((err) => {
      // A failed render must not fail the read — the page text is the answer.
      logger.warn('Page image render failed', {
        attachmentId: req.params.attachmentId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { available: true, rendered: 0 };
    });
    if (render.rendered > 0) {
      const refreshed = await getPages(supabaseService, req.params.attachmentId);
      if (refreshed.available && refreshed.pages.length > 0) {
        result = { ...result, pages: refreshed.pages };
      }
    }
  }
  const signed = result.pages.length
    ? await signPageImages(supabaseService, result.pages)
    : new Map<number, string>();

  res.json({
    success: true,
    data: {
      attachmentId: req.params.attachmentId,
      available: result.available,
      reason: result.reason,
      pageCount: result.pages.length,
      maxPages: MAX_OCR_PDF_PAGES,
      pages: result.pages.map((page) => ({
        attachmentId: page.attachmentId,
        pageIndex: page.pageIndex,
        text: page.text,
        charCount: page.charCount,
        ...(signed.has(page.pageIndex) ? { imageUrl: signed.get(page.pageIndex) } : {}),
        createdAt: page.createdAt,
      })),
    },
  });
}));

/* ------------------------------------------------- read it to me (narration) -- */

/**
 * Where a resolved narration target is parked between the two middlewares.
 *
 * The page count has to be known BEFORE the credit middleware runs — the price
 * depends on it, and a document with no readable pages must be refused without
 * charging — but the credit middleware is what stands between the request and
 * the handler. So the resolver runs first, answers the request itself in every
 * case that must not be charged, and leaves the target here for the two that
 * follow it.
 */
type NarrationRequest = Request & {
  narrationTarget?: Extract<NarrationTarget, { ok: true }>;
  /** The row this request owns, taken before the credit middleware ran. */
  narrationClaim?: NarrationClaimResult;
  /**
   * Set the moment the charge succeeded. Until then the claim is a reservation
   * that must be handed back if the response ends without a run starting.
   */
  narrationClaimConsumed?: boolean;
};

/**
 * Resolve the pages, decide the price, CLAIM the run, and answer every request
 * that must not be charged: the migration is not applied, the document has no
 * readable pages, or a script for this student already exists (or is being
 * written, or was just claimed by a request that arrived a moment before this
 * one).
 *
 * Only a request that will genuinely produce a new script reaches
 * `aiRateLimitWithCost` below, and it arrives there already holding the row —
 * reading the row and then writing `queued` in the handler left a window in
 * which two taps a tenth of a second apart both looked like the first, and the
 * student paid twice for one reading.
 */
export const resolveNarrationCharge = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const attachment = await supabaseService.getNoteAttachment(req.params.noteId, req.params.attachmentId);
  if (!attachment) {
    res.status(404).json({ error: 'Attachment not found.' });
    return;
  }

  const regenerate = req.body?.regenerate === true;
  const target = await resolveNarrationTarget(supabaseService, {
    noteId: req.params.noteId,
    attachmentId: req.params.attachmentId,
    userId,
    regenerate,
  });

  if (!target.ok) {
    if (target.status === 200) {
      // The hand-applied migration is missing. That is not an error the student
      // caused, and it is not a failure of their document — say so plainly.
      res.json({
        success: true,
        data: {
          attachmentId: req.params.attachmentId,
          available: false,
          reason: target.reason,
          message: target.message,
          pageCount: 0,
          segments: [],
          pages: [],
        },
      });
      return;
    }
    res.status(target.status).json({ error: target.message, reason: target.reason });
    return;
  }

  if (target.reuse) {
    // Rule 2: charge once. A retry gets the script (or the run in flight) that
    // already exists, and no credit is reserved on the way.
    const bundle = await getNarrationBundle(supabaseService, {
      noteId: req.params.noteId,
      attachmentId: req.params.attachmentId,
      userId,
    });
    res.json({
      success: true,
      data: narrationApiPayload(req.params.attachmentId, bundle.bundle, { reused: true }),
    });
    return;
  }

  // Take the row before the credit middleware runs. Whoever wins this write
  // owns the run; everyone else is reuse, at cost 0.
  const claim = await claimNarrationRun(supabaseService, {
    attachmentId: req.params.attachmentId,
    userId,
    previous: target.existing,
    pageCount: target.pageCount,
    creditCost: target.cost,
  });

  if (!claim.available) {
    res.json({
      success: true,
      data: {
        attachmentId: req.params.attachmentId,
        available: false,
        reason: 'schema_missing',
        message: 'Reading documents aloud is not switched on yet.',
        pageCount: 0,
        segments: [],
        pages: [],
      },
    });
    return;
  }

  if (!claim.claimed) {
    // Another request for this same document claimed the row between our read
    // and our write. That run is the answer to this one, and this one pays
    // nothing — the same contract as any other repeat request.
    const bundle = await getNarrationBundle(supabaseService, {
      noteId: req.params.noteId,
      attachmentId: req.params.attachmentId,
      userId,
    });
    res.json({
      success: true,
      data: narrationApiPayload(req.params.attachmentId, bundle.bundle, { reused: true }),
    });
    return;
  }

  const narrationReq = req as NarrationRequest;
  narrationReq.narrationTarget = target;
  narrationReq.narrationClaim = claim;

  // The claim is a reservation until the charge goes through. If the response
  // ends without a run having started — a 429 from the limiter below is the
  // ordinary case — put the row back exactly as it was, or the student is
  // locked out of their own document until the stale window passes.
  res.on('finish', () => {
    if (narrationReq.narrationClaimConsumed) return;
    void releaseNarrationClaim(supabaseService, {
      attachmentId: req.params.attachmentId,
      userId,
      previous: claim.previous,
    });
  });

  next();
});

/**
 * POST /notes/:noteId/attachments/:attachmentId/narration — write the script a
 * device will read aloud.
 *
 * 2 AI uses for a document up to 20 pages, 3 above that, charged once per
 * document per student. Playing it back, replaying it and listening offline
 * are all free; only `{ regenerate: true }` pays again.
 */
router.post(
  '/:noteId/attachments/:attachmentId/narration',
  requirePermission('ai'),
  aiPostBurstRateLimit,
  resolveNarrationCharge,
  aiRateLimitWithCost(
    (req) => getNarrationCreditCost((req as NarrationRequest).narrationTarget?.pageCount ?? 0),
    { label: 'Reading this document aloud' }
  ),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const target = (req as NarrationRequest).narrationTarget;
    if (!target) {
      res.status(500).json({ error: 'Narration request was not resolved.' });
      return;
    }

    // Past the limiter the charge is made, so the claim is spent: nothing may
    // hand the row back now. A failure from here on is the run's own, and is
    // recorded as a failure with a reason (and refunded by the job hook).
    (req as NarrationRequest).narrationClaimConsumed = true;

    const note = await supabaseService.getNote(req.params.noteId, userId);
    const version =
      (req as NarrationRequest).narrationClaim?.version ??
      (target.existing ? target.existing.version + 1 : 1);
    const cost = Number(res.getHeader('X-AI-Cost')) || target.cost;

    // The claim already wrote `queued`; this rewrites it with what the charge
    // actually cost, so a client polling GET sees the real price.
    await markNarrationStatus(supabaseService, {
      attachmentId: req.params.attachmentId,
      userId,
      version,
      status: 'queued',
      pageCount: target.pageCount,
      creditCost: cost,
      errorMessage: null,
    });

    const outcome = await runSyncOrEnqueue(
      'notes.ai.narration',
      {
        noteId: req.params.noteId,
        attachmentId: req.params.attachmentId,
        version,
        creditCost: cost,
        title: note.title,
      },
      userId,
      async () => {
        try {
          await buildNarrationScript(
            supabaseService,
            {
              noteId: req.params.noteId,
              attachmentId: req.params.attachmentId,
              userId,
              version,
              creditCost: cost,
              title: note.title,
            }
          );
        } catch (err) {
          await markNarrationFailed(supabaseService, {
            attachmentId: req.params.attachmentId,
            userId,
            version,
            message: clientErrorMessage(err, 'The reading could not be written.'),
          });
          throw err;
        }
        const bundle = await getNarrationBundle(supabaseService, {
          noteId: req.params.noteId,
          attachmentId: req.params.attachmentId,
          userId,
        });
        return narrationApiPayload(req.params.attachmentId, bundle.bundle, {
          truncated: target.truncated,
        });
      },
      aiChargeFromRes(res)
    );

    if (outcome.mode === 'async') {
      await markNarrationStatus(supabaseService, {
        attachmentId: req.params.attachmentId,
        userId,
        version,
        status: 'queued',
        jobId: outcome.jobId,
      });
      sendAsyncJobAccepted(res, outcome.jobId);
      return;
    }
    res.json({ success: true, data: outcome.result });
  })
);

/**
 * GET /notes/:noteId/attachments/:attachmentId/narration — the deck, ready to
 * cache for offline play.
 *
 * One response carries the script AND this document's page images, signed in a
 * single batch, because that is what a client stores to play the deck with no
 * network. Signed URLs expire, so the response says how long they last
 * (`imageUrlExpiresIn`) and a client refreshes by calling this again — the
 * script itself never changes underneath it.
 *
 * Free, always: reading back a script the student already paid for costs
 * nothing, and no AI runs here.
 */
router.get(
  '/:noteId/attachments/:attachmentId/narration',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    await supabaseService.getNote(req.params.noteId, userId);
    const attachment = await supabaseService.getNoteAttachment(req.params.noteId, req.params.attachmentId);
    if (!attachment) {
      res.status(404).json({ error: 'Attachment not found.' });
      return;
    }

    const includeImages = req.query.images !== '0' && req.query.images !== 'false';
    const result = await getNarrationBundle(supabaseService, {
      noteId: req.params.noteId,
      attachmentId: req.params.attachmentId,
      userId,
      includeImages,
    });

    if (!result.available) {
      res.json({
        success: true,
        data: {
          attachmentId: req.params.attachmentId,
          available: false,
          reason: 'schema_missing',
          pageCount: 0,
          segments: [],
          pages: [],
        },
      });
      return;
    }

    // Only a FINISHED deck is cacheable, and then privately for as long as the
    // shortest thing in the payload stays valid: the signed image URLs. A run
    // still being written must never be cached — the web player polls this
    // route every few seconds while the status is queued/generating, and a
    // max-age on that answer would have the browser's HTTP cache replay
    // "queued" for twelve hours after the script was ready. Nothing yet, and
    // failed, are answered fresh for the same reason.
    if (result.bundle?.status === 'ready') {
      res.setHeader(
        'Cache-Control',
        `private, max-age=${Math.floor(NARRATION_IMAGE_URL_TTL_SECONDS / 2)}`
      );
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }
    res.json({
      success: true,
      data: narrationApiPayload(req.params.attachmentId, result.bundle),
    });
  })
);

router.get('/:noteId/attachments/:attachmentId/content', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  await supabaseService.getNote(req.params.noteId, userId);
  const attachment = await supabaseService.getNoteAttachment(req.params.noteId, req.params.attachmentId);
  if (!attachment) {
    res.status(404).json({ error: 'Attachment not found.' });
    return;
  }
  const storagePath = supabaseService.resolveNoteAttachmentStoragePath(attachment);
  if (!storagePath) {
    // Name the shape, because the client now SHOWS this sentence. An audio row
    // transcribed straight from base64 is stored with `metadata.storagePath:
    // null` and no `fileUrl` (see transcribe-audio above), and "no storage
    // path" alone sent the Round 2 device pass hunting an expiry bug that was
    // never there.
    const detail = attachment.fileUrl
      ? 'Its saved link does not point at this app\u2019s note storage.'
      : 'This attachment was saved without a stored file.';
    logger.warn('attachment url has no storage path', {
      noteId: req.params.noteId,
      attachmentId: req.params.attachmentId,
      type: attachment.type || null,
      hasFileUrl: Boolean(attachment.fileUrl),
    });
    res.status(400).json({
      error: `This file cannot be opened. ${detail}`,
      message: `This file cannot be opened. ${detail}`,
    });
    return;
  }
  const { buffer, contentType } = await supabaseService.downloadNoteFile(storagePath);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(buffer);
}));

router.post('/:noteId/regenerate-preview', requireNoteEdit('noteId'), validateNoteId, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const note = await supabaseService.getNote(req.params.noteId, userId);
  if (note.sourceType !== 'presentation') {
    res.status(400).json({ error: 'Note is not a presentation.' });
    return;
  }

  const attachments = await supabaseService.getNoteAttachments(req.params.noteId);
  const attachment = attachments.find((a) => a.type === 'presentation');
  if (!attachment) {
    res.json({
      success: true,
      data: {
        status: 'none' as const,
        previewAvailable: false,
        previewError: 'No presentation attachment found.',
        attachment: null,
      },
    });
    return;
  }

  const meta = (attachment.metadata || {}) as Record<string, unknown>;
  const storagePath = typeof meta.storagePath === 'string' ? meta.storagePath : null;
  if (!storagePath) {
    res.status(400).json({ error: 'Presentation file path is missing.' });
    return;
  }

  if (typeof meta.previewStoragePath === 'string' && meta.previewStoragePath) {
    res.json({ success: true, data: { attachment, previewAvailable: true, status: 'ready' } });
    return;
  }

  const status = resolvePreviewStatus(meta);
  if (status === 'processing') {
    res.status(202).json({
      success: true,
      data: { status: 'processing', previewAvailable: false, attachment },
    });
    return;
  }

  const fileName = attachment.fileName || 'slides.pptx';
  const processingMeta = {
    ...meta,
    previewProcessing: true,
    previewStartedAt: new Date().toISOString(),
    previewError: undefined,
    previewFailedAt: undefined,
  };
  const updated = await supabaseService.updateNoteAttachment(attachment.id, {
    metadata: processingMeta,
  });

  res.status(202).json({
    success: true,
    data: { status: 'processing', previewAvailable: false, attachment: updated },
  });

  void startPresentationPreviewJob({
    noteId: req.params.noteId,
    attachmentId: attachment.id,
    storagePath,
    fileName,
    meta: processingMeta,
  });
}));

router.get('/:noteId/preview-status', validateNoteId, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const note = await supabaseService.getNote(req.params.noteId, userId);
  if (note.sourceType !== 'presentation') {
    res.status(400).json({ error: 'Note is not a presentation.' });
    return;
  }

  const attachments = await supabaseService.getNoteAttachments(req.params.noteId);
  const attachment = attachments.find((a) => a.type === 'presentation');
  if (!attachment) {
    res.json({
      success: true,
      data: {
        status: 'none' as const,
        previewAvailable: false,
        previewError: 'No presentation attachment found.',
        attachment: null,
      },
    });
    return;
  }

  const meta = (attachment.metadata || {}) as Record<string, unknown>;
  const status = resolvePreviewStatus(meta);

  res.json({
    success: true,
    data: {
      status,
      previewAvailable: status === 'ready',
      previewError: resolvePreviewErrorMessage(meta, status),
      attachment,
    },
  });
}));

// Notes CRUD
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const { folderId, groupId, archived, courseId, topicId, studySetId } = req.query;
  let archivedFilter: boolean | undefined;
  if (archived === 'true' || archived === '1') archivedFilter = true;
  else if (archived === 'false' || archived === '0') archivedFilter = false;
  // ?courseId= — uuid, the literal "null" (unfiled) or absent; anything else is a 400.
  const courseFilter = parseCourseFilter(courseId);
  if (courseFilter.kind === 'invalid') {
    res.status(400).json({ success: false, error: COURSE_FILTER_INVALID_MESSAGE });
    return;
  }
  // ?topicId= — same grammar one level down; "null" is "in this course, under no topic".
  const topicFilter = parseTopicFilter(topicId);
  if (topicFilter.kind === 'invalid') {
    res.status(400).json({ success: false, error: TOPIC_FILTER_INVALID_MESSAGE });
    return;
  }
  const notes = await supabaseService.getNotes(userId, {
    folderId: folderId as string | undefined,
    groupId: groupId as string | undefined,
    archived: archivedFilter,
    courseFilter,
    topicFilter,
    studySetId: typeof studySetId === 'string' && studySetId ? studySetId : undefined,
  });
  res.json({ success: true, data: notes });
}));

router.get('/:noteId', validateNoteId, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const note = await supabaseService.getNote(req.params.noteId, userId);
  const attachments = await supabaseService.getNoteAttachments(req.params.noteId);
  // learning_events: resource_opened — the single-note fetch is the "opened
  // a note" signal (list/search reads are not). Never throws.
  await recordLearningEvent(supabaseService, {
    userId,
    eventType: 'resource_opened',
    targetType: 'note',
    targetId: note?.id ?? req.params.noteId,
    noteId: note?.id ?? req.params.noteId,
    groupId: note?.groupId ?? null,
    courseId: note?.courseId ?? null,
    surface: surfaceFromRequest(req),
  });
  res.json({ success: true, data: { ...note, attachments } });
}));

router.post('/', validateNoteCreate, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  try {
    // createNote emits learning_events note_created; the surface header only exists here.
    // courseId/topicId ride on the body — createNote resolves the topic against
    // the course before the insert, so a wrong-course topic lands here as a 400.
    const note = await supabaseService.createNote(userId, req.body, { surface: surfaceFromRequest(req) });
    res.json({ success: true, data: note });
  } catch (err) {
    if (respondPublicError(err, res)) return;
    throw err;
  }
}));

router.patch('/:noteId', requireNoteEdit('noteId'), validateNoteId, validateNoteUpdate, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  try {
    const { expectedVersion, expectedUpdatedAt, ...updates } = req.body || {};
    const note = await supabaseService.updateNote(userId, req.params.noteId, updates, {
      expectedVersion:
        expectedVersion != null && Number.isFinite(Number(expectedVersion))
          ? Number(expectedVersion)
          : undefined,
      expectedUpdatedAt: typeof expectedUpdatedAt === 'string' ? expectedUpdatedAt : undefined,
    });
    await cacheService.delete(`note:${req.params.noteId}`);
    res.json({ success: true, data: note });
  } catch (error) {
    if (isVersionConflictError(error)) {
      return res.status(409).json({
        success: false,
        error: error.message,
        code: 'version_conflict',
        data: (error as { current?: unknown }).current ?? null,
      });
    }
    if (respondPublicError(error, res)) return;
    throw error;
  }
}));

router.delete('/:noteId', requireNoteOwner('noteId'), validateNoteId, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  await supabaseService.deleteNote(userId, req.params.noteId);
  res.json({ success: true });
}));

router.post('/:noteId/attachments', requireNoteEdit('noteId'), asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  await supabaseService.getNote(req.params.noteId, userId);
  const attachment = await supabaseService.addNoteAttachment(req.params.noteId, req.body);
  res.json({ success: true, data: attachment });
}));

router.post(
  '/:noteId/copy',
  idempotencyMiddleware({
    operation: 'note_copy',
    fallbackKey: (req) =>
      `note_copy:${(req as IdempotentRequest).user?.id}:${req.params.noteId}`,
  }),
  asyncHandler(async (req: IdempotentRequest, res: Response) => {
    const userId = requireAuthUserId(req as any, res);
    if (!userId) return;
    const result = await req.runIdempotent!(async () => {
      const note = await supabaseService.copyNoteForUser(req.params.noteId, userId);
      return { note: note as unknown as Record<string, unknown> };
    });
    res.status(201).json({ success: true, data: result.note });
  })
);

// AI-powered learn actions (Smart Notes). Credits scale with depth
// (SMART_NOTES_CREDIT_COST: concise/standard 1, deep 3), reserved atomically
// before any work; long sources may use multiple internal model calls under
// this single charged action.
router.post('/:noteId/summarize', requireNoteEdit('noteId'), requirePermission('ai'), aiPostBurstRateLimit, aiRateLimitWithCost((req) => getSmartNotesCreditCost(req.body?.depth), { label: 'Deep dive Smart Notes' }), asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const note = await supabaseService.getNote(req.params.noteId, userId);
  const sources = parseSmartNoteSources(req.body?.sources);
  const content = await resolveNoteStudyContent(note.id, note, { forSmartNotes: true, sources });
  if (!content || content.length < MIN_NOTE_STUDY_CONTENT_CHARS) {
    // No manual refund here: aiRateLimitWithCost's finish hook refunds every
    // non-2xx response — the old manual refundAiCredits DOUBLED the refund,
    // minting free credits for anyone with other usage that day.
    res.status(400).json({
      error: `Note needs at least ${MIN_NOTE_STUDY_CONTENT_CHARS} characters of study content to summarize. For scanned PDFs, wait for OCR or add your own notes.`,
    });
    return;
  }
  // Optional steering: free-text guidance (sanitized server-side) + depth preset.
  const guidanceRaw = typeof req.body?.guidance === 'string' ? req.body.guidance.trim() : '';
  const guidance = guidanceRaw ? guidanceRaw.slice(0, SMART_NOTES_GUIDANCE_MAX_CHARS) : undefined;
  const depth: SmartNotesDepth =
    req.body?.depth === 'concise' || req.body?.depth === 'deep' ? req.body.depth : 'standard';
  const outcome = await runSyncOrEnqueue(
    'notes.ai.summarize',
    {
      content,
      title: note.title,
      noteId: note.id,
      sourceType: note.sourceType,
      guidance,
      depth,
    },
    userId,
    async () => {
      const result = await summarizeNoteContent(content, {
        title: note.title,
        sourceType: note.sourceType,
        guidance,
        depth,
      });
      const latest = await supabaseService.getNote(note.id, userId);
      const nextBody = upsertSmartNotesSection(latest.body || '', result.summary);
      const updated = await supabaseService.updateNote(
        userId,
        note.id,
        { summary: result.summary, body: nextBody },
        { allowRetryOnConflict: true }
      );
      return { summary: result.summary, provider: result.provider, note: updated };
    }
  ,
    aiChargeFromRes(res)
  );
  if (outcome.mode === 'async') {
    sendAsyncJobAccepted(res, outcome.jobId);
    return;
  }
  res.json({ success: true, data: outcome.result });
}));

// Note quiz (persisted)
router.get('/:noteId/quiz', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const quiz = await supabaseService.getNoteQuiz(userId, req.params.noteId);
  res.json({ success: true, data: quiz });
}));

router.post('/:noteId/quiz', requirePermission('ai'), aiPostBurstRateLimit, aiRateLimitForFeature('generate_questions'), asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const note = await supabaseService.getNote(req.params.noteId, userId);
  const content = (await resolveNoteStudyContent(note.id, note)).trim();
  if (content.length < 50) {
    res.status(400).json({ error: 'Note needs at least 50 characters to generate a quiz.' });
    return;
  }
  const { studyGoal, count } = req.body || {};

  // REL-02: a quiz with answers or a completed run is never overwritten by
  // regenerate. Check BEFORE generating — the old order generated first and
  // let upsertNoteQuiz refuse afterwards, burning an AI generation (and the
  // middleware-reserved credits) for questions that were thrown away.
  const existingQuiz = await supabaseService.getNoteQuiz(userId, note.id);
  if (existingQuiz && supabaseService.isNoteQuizProtected(existingQuiz)) {
    // No AI work happened — give the reserved feature + global credits back.
    await refundFeatureAiCredit(userId, 'generate_questions');
    await applyGlobalUsageHeaders(res, userId);
    res.json({ success: true, data: { ...existingQuiz, reused: true } });
    return;
  }

  const sliced = content.slice(0, 8000);
  const surface = surfaceFromRequest(req);
  const outcome = await runSyncOrEnqueue(
    'notes.ai.quiz',
    // surface/courseId ride on the payload so the queued path can emit the
    // same learning event from the worker.
    // `sourceTitle` is what the completion push is named after ("5-question
    // quiz · SDOH"). Without it every quiz notification read "Your quiz",
    // because this payload carried no `title` for enqueue to pick up.
    {
      content: sliced,
      studyGoal,
      count,
      noteId: note.id,
      courseId: note.courseId ?? null,
      surface,
      sourceTitle: note.title || undefined,
    },
    userId,
    async () => {
      const result = await generateDailyQuiz(sliced, { studyGoal, count });
      const questions = result.questions.map((q, index) => ({
        id: `nq-${index}`,
        text: q.text,
        type: q.type,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        topic: q.topic,
      }));
      // learning_events: question_generated with count + note. Never throws.
      await recordLearningEvent(supabaseService, {
        userId,
        eventType: 'question_generated',
        targetType: 'note',
        targetId: note.id,
        noteId: note.id,
        courseId: note.courseId ?? null,
        count: questions.length,
        surface,
      });
      return supabaseService.upsertNoteQuiz(userId, note.id, {
        studyGoal: studyGoal || 'retention',
        questions,
      });
    }
  ,
    aiChargeFromRes(res)
  );
  if (outcome.mode === 'async') {
    sendAsyncJobAccepted(res, outcome.jobId);
    return;
  }
  res.json({ success: true, data: outcome.result });
}));

/**
 * "Quiz me on this page" — questions from ONE page of a document.
 *
 * Deliberately not the note quiz (`POST /:noteId/quiz`): that one is persisted
 * and protected once it has answers, so a page quiz sharing it would either
 * overwrite a student's finished quiz or be refused by it. This returns its
 * questions and stores nothing, which is also what the walk-through wants — a
 * quick check on the page you are reading, not a saved artefact.
 *
 * It costs the same one AI use as any other generation and counts against the
 * SAME `generate_questions` cap, so scoping to a page cannot be used to buy
 * more generations than the whole note would have.
 *
 * Every "no questions" answer says which of the four reasons it is, in plain
 * words, because "failed to generate" for an unapplied migration, a blank
 * page and a photo attachment are three different things a student can act on
 * differently.
 */
function pageScopeMessage(
  reason: string,
  pageIndex: number
): string | null {
  switch (reason) {
    case 'ok':
      return null;
    case 'schema_missing':
      return 'This document has not been split into pages yet.';
    case 'preview_pending':
      return 'This document is still being converted. Try again in a moment.';
    case 'unsupported':
      return 'This attachment has no pages to quiz you on.';
    case 'page_missing':
      return `Page ${pageIndex + 1} is not part of this document.`;
    case 'source_missing':
      return 'The original file for this document is missing, so its pages cannot be read.';
    default:
      return 'This document could not be split into pages, so a page quiz is not available.';
  }
}

router.post(
  '/:noteId/generate-questions',
  requirePermission('ai'),
  aiPostBurstRateLimit,
  aiRateLimitForFeature('generate_questions'),
  validateNoteId,
  handleValidationErrors,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const attachmentId = typeof body.attachmentId === 'string' ? body.attachmentId : '';
    const pageIndex = Math.floor(Number(body.pageIndex));
    if (!attachmentId || !Number.isFinite(pageIndex) || pageIndex < 0) {
      res.status(400).json({ error: 'attachmentId and a page number are required.' });
      return;
    }

    // Same ACL as every other attachment read: throws when the user cannot
    // read the note, 404 when the attachment belongs to a different one.
    const note = await supabaseService.getNote(req.params.noteId, userId);
    const attachment = await supabaseService.getNoteAttachment(req.params.noteId, attachmentId);
    if (!attachment) {
      res.status(404).json({ error: 'Attachment not found.' });
      return;
    }

    const page = await getPageText(supabaseService, {
      noteId: req.params.noteId,
      attachmentId,
      pageIndex,
    });
    const blocked = pageScopeMessage(page.reason, pageIndex);
    if (blocked) {
      // A 400 here is refunded by the limiter's finish hook, so a page that
      // cannot be quizzed costs the student nothing.
      res.status(400).json({ error: blocked, reason: page.reason });
      return;
    }

    const source = page.text.trim();
    if (source.length < 50) {
      res.status(400).json({
        error: `There is too little text on page ${pageIndex + 1} to make questions from.`,
        reason: 'page_blank',
      });
      return;
    }

    const rawCount = Number(body.count);
    const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(10, Math.floor(rawCount))) : 5;
    const difficulty =
      body.difficulty === 'easy' || body.difficulty === 'medium' || body.difficulty === 'hard'
        ? body.difficulty
        : 'mixed';
    const questionTypes = Array.isArray(body.questionTypes)
      ? body.questionTypes.filter((type): type is string => typeof type === 'string')
      : undefined;

    const surface = surfaceFromRequest(req);
    const generated = await generateQuestionsFromNotes(source, {
      count,
      difficulty,
      questionTypes,
      subject: note.title || undefined,
    });

    const { logAIInference } = await import('../services/aiInferenceLog');
    await logAIInference(supabaseService.getClient(), {
      userId,
      feature: 'generate-questions-page',
      provider: generated.provider,
      requestId: (req as { requestId?: string }).requestId,
    });

    await recordLearningEvent(supabaseService, {
      userId,
      eventType: 'question_generated',
      targetType: 'note',
      targetId: note.id,
      noteId: note.id,
      courseId: note.courseId ?? null,
      count: Array.isArray(generated.questions) ? generated.questions.length : 0,
      surface,
    });

    res.json({
      success: true,
      data: {
        attachmentId,
        pageIndex,
        pageCount: page.pageCount,
        questions: generated.questions,
        provider: generated.provider,
      },
    });
  })
);

router.patch('/:noteId/quiz', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const { answers, completed } = req.body || {};
  const session = await supabaseService.updateNoteQuiz(userId, req.params.noteId, {
    answers: answers && typeof answers === 'object' ? answers : undefined,
    completed: typeof completed === 'boolean' ? completed : undefined,
  });
  res.json({ success: true, data: session });
}));

router.post('/:noteId/generate-flashcards', requirePermission('ai'), aiPostBurstRateLimit, aiRateLimitForFeature('generate_flashcards'), validateNoteId, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const note = await supabaseService.getNote(req.params.noteId, userId);
  const attachments = await supabaseService.getNoteAttachments(note.id);
  const studyInput = {
    sourceType: note.sourceType,
    body: note.body,
    summary: note.summary,
    attachments,
  };
  if (!hasEnoughNoteStudyContent(studyInput)) {
    res.status(400).json({
      error: 'Note needs at least 50 characters of study content. Add notes or wait for import/extraction to finish.',
    });
    return;
  }
  const content = getNoteStudyContent(studyInput);
  const { count, style, typeMix, difficulty } = req.body || {};
  if (typeMix !== undefined && !isFlashcardTypeMix(typeMix)) {
    res.status(400).json({ error: 'typeMix must be one of basic, cloze, mixed.' });
    return;
  }
  const sliced = content.slice(0, 8000);
  const surface = surfaceFromRequest(req);
  const outcome = await runSyncOrEnqueue(
    'notes.ai.flashcards',
    // noteId/courseId/surface ride on the payload so the queued path can emit
    // the same learning event from the worker.
    {
      content: sliced,
      count,
      style,
      typeMix,
      difficulty,
      noteId: note.id,
      courseId: note.courseId ?? null,
      surface,
      // Names the completion push after the note it came from.
      sourceTitle: note.title || undefined,
    },
    userId,
    async () => {
      const generated = await generateFlashcardsFromNotes(sliced, {
        count,
        style,
        typeMix,
        difficulty,
      });
      // learning_events: card_generated with count + note. Never throws.
      await recordLearningEvent(supabaseService, {
        userId,
        eventType: 'card_generated',
        targetType: 'note',
        targetId: note.id,
        noteId: note.id,
        courseId: note.courseId ?? null,
        count: Array.isArray(generated.flashcards) ? generated.flashcards.length : 0,
        surface,
      });
      return generated;
    }
  ,
    aiChargeFromRes(res)
  );
  if (outcome.mode === 'async') {
    sendAsyncJobAccepted(res, outcome.jobId);
    return;
  }
  res.json({ success: true, data: outcome.result });
}));

router.post(
  '/:noteId/retry-youtube-transcript',
  requireNoteEdit('noteId'),
  validateNoteId,
  handleValidationErrors,
  uploadBurstRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const note = await supabaseService.getNote(req.params.noteId, userId);
    const videoId =
      note.youtubeVideoId ||
      parseYoutubeVideoId(typeof note.youtubeUrl === 'string' ? note.youtubeUrl : '');
    if (!videoId) {
      res.status(400).json({ error: 'This note is not linked to a YouTube video.' });
      return;
    }

    const canonicalUrl = canonicalYoutubeUrl(videoId);
    const attachments = await supabaseService.getNoteAttachments(note.id);
    let attachment = attachments.find((a) => a.type === 'youtube');
    const priorMeta = (attachment?.metadata || {}) as Record<string, unknown>;
    const attachmentMeta: Record<string, unknown> = {
      ...priorMeta,
      videoId,
      transcriptStatus: 'processing',
      transcriptStartedAt: new Date().toISOString(),
      transcriptError: null,
      transcriptFailedAt: null,
    };

    if (!attachment) {
      attachment = await supabaseService.addNoteAttachment(note.id, {
        type: 'youtube',
        fileUrl: note.youtubeUrl || canonicalUrl,
        fileName: note.title || 'YouTube video',
        metadata: attachmentMeta,
      });
    } else {
      attachment = await supabaseService.updateNoteAttachment(attachment.id, {
        metadata: attachmentMeta,
      });
    }

    const outcome = await runSyncOrEnqueue(
      'notes.youtube.transcript',
      {
        noteId: note.id,
        attachmentId: attachment.id,
        videoId,
        meta: attachmentMeta,
      },
      userId,
      () =>
        runYoutubeTranscriptJob(supabaseService, {
          noteId: note.id,
          attachmentId: attachment!.id,
          videoId,
          meta: attachmentMeta,
        })
    ,
    aiChargeFromRes(res)
  );

    if (outcome.mode === 'async') {
      stampAiChargeOnJob(res, outcome.jobId);
      res.status(202).json({
        success: true,
        data: { note, attachment, status: 'processing' },
        jobId: outcome.jobId,
      });
      return;
    }

    const jobResult = outcome.result;
    const refreshed = await supabaseService.getNoteAttachments(note.id);
    const updatedAttachment = refreshed.find((a) => a.id === attachment!.id) || attachment;
    res.json({
      success: true,
      data: {
        note,
        attachment: updatedAttachment,
        status: jobResult.status,
        ...(jobResult.status === 'failed' ? { transcriptError: jobResult.error } : {}),
      },
    });
  })
);

router.post('/:noteId/reextract-text', requireNoteEdit('noteId'), validateNoteId, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const note = await supabaseService.getNote(req.params.noteId, userId);
  if (note.sourceType !== 'presentation' && note.sourceType !== 'pdf') {
    res.status(400).json({ error: 'Text re-extraction is only available for PDF and presentation notes.' });
    return;
  }

  const attachments = await supabaseService.getNoteAttachments(note.id);
  const attachment =
    note.sourceType === 'pdf'
      ? attachments.find((a) => a.type === 'pdf')
      : attachments.find((a) => a.type === 'presentation');
  if (!attachment) {
    res.status(404).json({
      error:
        note.sourceType === 'pdf'
          ? 'No PDF attachment found for this note.'
          : 'No presentation attachment found for this note.',
    });
    return;
  }

  const storagePath =
    typeof attachment.metadata?.storagePath === 'string' ? attachment.metadata.storagePath : null;
  const fileName =
    attachment.fileName || (note.sourceType === 'pdf' ? 'document.pdf' : 'slides.pptx');
  if (!storagePath) {
    res.status(404).json({ error: 'Source file is missing from storage.' });
    return;
  }

  const { buffer } = await supabaseService.downloadNoteFile(storagePath);
  const prevMeta = (attachment.metadata || {}) as Record<string, unknown>;

  if (note.sourceType === 'pdf') {
    const extraction = await extractPdfTextDetailsFromBuffer(buffer);
    const { studyText, extractionStatus } = buildPdfStudyText(fileName, extraction);
    const updatedAttachment = await supabaseService.updateNoteAttachment(attachment.id, {
      extractedText: studyText,
      metadata: {
        ...prevMeta,
        extractionStatus,
        pageCount: extraction.pageCount,
        charsPerPage: extraction.assessment.charsPerPage,
      },
    });
    res.json({
      success: true,
      data: {
        attachment: updatedAttachment,
        extractedText: studyText,
        contentLength: studyText.trim().length,
        extractionStatus,
      },
    });
    return;
  }

  if (/\.pptx$/i.test(fileName)) {
    assertValidOfficeZip(buffer, fileName);
  }

  const presentationExtract = await extractPresentationTextDetailsFromBuffer(buffer, fileName, {
    enableOcr: false,
  });
  const { studyText, extractionStatus } = buildPresentationStudyText(
    fileName,
    presentationExtract.text
  );

  const updatedAttachment = await supabaseService.updateNoteAttachment(attachment.id, {
    extractedText: studyText,
    metadata: {
      ...prevMeta,
      extractionStatus,
      slideCount: presentationExtract.slideCount,
      presentationOcrUsed: presentationExtract.usedOcr,
      presentationOcrTimedOut: presentationExtract.timedOut,
    },
  });

  res.json({
    success: true,
    data: {
      attachment: updatedAttachment,
      extractedText: studyText,
      contentLength: studyText.trim().length,
      extractionStatus,
    },
  });
}));

router.post(
  '/:noteId/ocr',
  requireNoteEdit('noteId'),
  validateNoteId,
  handleValidationErrors,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const note = await supabaseService.getNote(req.params.noteId, userId);
    if (
      note.sourceType !== 'pdf' &&
      note.sourceType !== 'presentation' &&
      note.sourceType !== 'photos'
    ) {
      res
        .status(400)
        .json({ error: 'OCR is only available for PDF, presentation and photo notes.' });
      return;
    }

    const attachments = await supabaseService.getNoteAttachments(note.id);

    // Photo notes are a batch of images rather than one document.
    if (note.sourceType === 'photos') {
      const images = attachments.filter((a) => a.type === 'image');
      if (images.length === 0) {
        res.status(404).json({ error: 'This note has no photographs to read.' });
        return;
      }
      if (aggregatePhotoOcrStatus(images) === 'ocr_processing') {
        res.status(202).json({ success: true, data: { status: 'processing' } });
        return;
      }

      if (NOTE_OCR_CREDIT_COST > 0) {
        const denied = await chargeAiCredits(userId, NOTE_OCR_CREDIT_COST);
        if (denied) {
          res.status(429).json(denied);
          return;
        }
        await applyGlobalUsageHeaders(res, userId);
      }

      // Manual run re-reads every photograph — the user asked for a retry.
      const queued = await startPhotoNoteOcr({
        noteId: note.id,
        userId,
        attachments: images,
        skipAlreadyRead: false,
      });

      const refreshed = await supabaseService.getNoteAttachments(note.id);
      const status = aggregatePhotoOcrStatus(refreshed.filter((a) => a.type === 'image'));
      res.status(status === 'ocr_processing' ? 202 : 200).json({
        success: true,
        data: {
          status: status === 'ok' ? 'ready' : status,
          attachments: refreshed.filter((a) => a.type === 'image'),
          imageCount: images.length,
          queued,
          ocrMaxImages: MAX_OCR_IMAGES,
          creditCost: NOTE_OCR_CREDIT_COST,
        },
      });
      return;
    }
    const attachment =
      note.sourceType === 'pdf'
        ? attachments.find((a) => a.type === 'pdf')
        : attachments.find((a) => a.type === 'presentation');
    if (!attachment) {
      res.status(404).json({ error: 'No document attachment found for this note.' });
      return;
    }

    const meta = (attachment.metadata || {}) as Record<string, unknown>;
    const ocrStatus = resolveOcrStatus(meta);
    if (ocrStatus === 'processing') {
      res.status(202).json({
        success: true,
        data: { status: 'processing', attachment },
      });
      return;
    }

    const previewPath =
      typeof meta.previewStoragePath === 'string' ? meta.previewStoragePath : null;
    const storagePath =
      typeof meta.storagePath === 'string' ? meta.storagePath : null;
    // Presentations must OCR the Gotenberg preview PDF (page rasters). Running OCR on the
    // raw .ppt/.pptx while preview is still processing races and can wipe preview metadata.
    if (note.sourceType === 'presentation' && !previewPath) {
      if (meta.previewProcessing === true) {
        res.status(409).json({
          error: 'Slide preview is still generating. Wait for preview, then run OCR.',
        });
        return;
      }
      res.status(409).json({
        error: 'Slide preview is required before OCR. Use Retry preview, then run OCR.',
      });
      return;
    }
    const usePreviewPdf = note.sourceType === 'presentation' && Boolean(previewPath);
    const pathForOcr = usePreviewPdf ? previewPath! : storagePath;
    if (!pathForOcr) {
      res.status(404).json({ error: 'Source file is missing from storage.' });
      return;
    }

    if (NOTE_OCR_CREDIT_COST > 0) {
      const charged = await chargeAiCreditsDetailed(userId, NOTE_OCR_CREDIT_COST);
      if (!charged.ok) {
        res.status(429).json(charged.denial);
        return;
      }
      await applyGlobalUsageHeaders(res, userId);
      // chargeAiCredits is not middleware, so nothing else records this
      // reservation — without it a permanently failed OCR job (the costliest
      // charge) kept the user's credits. `pool` rides along so that refund
      // goes back to the balance that paid: a bonus use refunded into the
      // daily counter would expire at midnight.
      (res.locals as Record<string, unknown>).aiCharge = {
        credits: NOTE_OCR_CREDIT_COST,
        pool: charged.pool,
      };
    }

    const fileName =
      attachment.fileName ||
      (note.sourceType === 'pdf' ? 'document.pdf' : usePreviewPdf ? 'preview.pdf' : 'slides.pptx');
    const sourceKind: 'pdf' | 'presentation' | 'preview_pdf' = usePreviewPdf
      ? 'preview_pdf'
      : note.sourceType === 'pdf'
        ? 'pdf'
        : 'presentation';

    const processingMeta = {
      ...meta,
      extractionStatus: 'ocr_processing',
      ocrProvider: 'tesseract',
      ocrStartedAt: new Date().toISOString(),
      ocrError: undefined,
      ocrFailedAt: undefined,
      ocrMaxPages: MAX_OCR_PDF_PAGES,
      ocrMaxSlides: MAX_OCR_SLIDES,
      ocrCreditCost: NOTE_OCR_CREDIT_COST,
    };

    const updated = await supabaseService.updateNoteAttachment(attachment.id, {
      extractedText: ocrPlaceholder(fileName),
      metadata: processingMeta,
    });

    const outcome = await startNoteOcrJob({
      noteId: note.id,
      attachmentId: attachment.id,
      storagePath: pathForOcr,
      fileName,
      sourceKind,
      meta: processingMeta,
      userId,
      charge: aiChargeFromRes(res),
    });

    if (outcome.mode === 'async') {
      // Charge already stamped at enqueue via startNoteOcrJob's charge param.
      res.status(202).json({
        success: true,
        data: {
          status: 'processing',
          attachment: updated,
          ocrMaxPages: MAX_OCR_PDF_PAGES,
          ocrMaxSlides: MAX_OCR_SLIDES,
          creditCost: NOTE_OCR_CREDIT_COST,
        },
        jobId: outcome.jobId,
      });
      return;
    }

    const refreshed = await supabaseService.getNoteAttachments(note.id);
    const finalAttachment = refreshed.find((a) => a.id === attachment.id) || updated;
    const finalStatus = resolveOcrStatus((finalAttachment.metadata || {}) as Record<string, unknown>);
    res.json({
      success: true,
      data: {
        status: finalStatus === 'ready' ? 'ready' : finalStatus,
        attachment: finalAttachment,
        ocrMaxPages: MAX_OCR_PDF_PAGES,
        ocrMaxSlides: MAX_OCR_SLIDES,
        creditCost: NOTE_OCR_CREDIT_COST,
      },
    });
  })
);

router.get(
  '/:noteId/ocr-status',
  validateNoteId,
  handleValidationErrors,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const note = await supabaseService.getNote(req.params.noteId, userId);
    if (
      note.sourceType !== 'pdf' &&
      note.sourceType !== 'presentation' &&
      note.sourceType !== 'photos'
    ) {
      res.status(400).json({
        error: 'OCR status is only available for PDF, presentation and photo notes.',
      });
      return;
    }

    if (note.sourceType === 'photos') {
      const images = (await supabaseService.getNoteAttachments(note.id)).filter(
        (a) => a.type === 'image'
      );
      const aggregated = aggregatePhotoOcrStatus(images);
      const failed = images.find(
        (a) => (a.metadata as Record<string, unknown> | null)?.ocrError
      );
      res.json({
        success: true,
        data: {
          status: aggregated === 'ok' ? 'ready' : aggregated === 'ocr_processing' ? 'processing' : aggregated === 'ocr_failed' ? 'failed' : aggregated ?? 'none',
          imageCount: images.length,
          attachment: images[0] || null,
          attachments: images,
          ocrError:
            aggregated === 'ocr_failed' && failed
              ? String((failed.metadata as Record<string, unknown>).ocrError)
              : undefined,
        },
      });
      return;
    }

    const attachments = await supabaseService.getNoteAttachments(note.id);
    const attachment =
      note.sourceType === 'pdf'
        ? attachments.find((a) => a.type === 'pdf')
        : attachments.find((a) => a.type === 'presentation');
    if (!attachment) {
      res.json({
        success: true,
        data: { status: 'none', attachment: null },
      });
      return;
    }

    const meta = (attachment.metadata || {}) as Record<string, unknown>;
    const status = resolveOcrStatus(meta);
    const ocrError =
      status === 'failed'
        ? typeof meta.ocrError === 'string'
          ? meta.ocrError
          : 'Local OCR failed.'
        : undefined;

    res.json({
      success: true,
      data: {
        status,
        attachment,
        extractionStatus: meta.extractionStatus,
        ocrProvider: meta.ocrProvider,
        ocrPageCount: meta.ocrPageCount,
        ocrError,
        ocrMaxPages: MAX_OCR_PDF_PAGES,
        ocrMaxSlides: MAX_OCR_SLIDES,
      },
    });
  })
);

// Collaboration + secure share links (owner-managed)
router.get('/:noteId/collaborators', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  await supabaseService.getNote(req.params.noteId, userId);
  const collaborators = await supabaseService.getNoteCollaborators(req.params.noteId);
  res.json({ success: true, data: collaborators });
}));

router.post(
  '/:noteId/collaborators',
  requireNoteOwner('noteId'),
  collaboratorInviteRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const { collaboratorUserId, role } = req.body;
  if (!collaboratorUserId || typeof collaboratorUserId !== 'string') {
    res.status(400).json({ error: 'collaboratorUserId is required.' });
    return;
  }
  try {
    const collab = await supabaseService.addNoteCollaborator(
      req.params.noteId,
      userId,
      collaboratorUserId.trim(),
      role || 'editor'
    );
    res.json({ success: true, data: collab });
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    const message = error instanceof Error ? error.message : 'Failed to add collaborator.';
    const clientSafe =
      code === 'collaborator_not_found' ||
      code === 'collaborator_invalid' ||
      code === 'collaborator_ambiguous' ||
      message.includes('cannot add yourself') ||
      message.includes('Only the note owner');
    // SEC-06: never echo distinct "email not found" style messages.
    res.status(clientSafe ? 400 : 500).json({
      error: clientSafe
        ? message
        : 'Unable to add that collaborator. Check the @username and try again.',
    });
  }
}));

router.patch(
  '/:noteId/collaborators/:collaboratorUserId',
  requireNoteOwner('noteId'),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const role = req.body?.role === 'viewer' ? 'viewer' : req.body?.role === 'editor' ? 'editor' : null;
    if (!role) {
      res.status(400).json({ success: false, error: 'role must be viewer or editor' });
      return;
    }
    try {
      const collab = await supabaseService.updateNoteCollaboratorRole(
        req.params.noteId,
        userId,
        req.params.collaboratorUserId,
        role
      );
      res.json({ success: true, data: collab });
    } catch (error: unknown) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update role',
      });
    }
  })
);

router.delete('/:noteId/collaborators/:collaboratorUserId', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  // Self-leave OR owner remove
  if (req.params.collaboratorUserId === userId || req.params.collaboratorUserId === 'me') {
    try {
      await supabaseService.leaveNoteCollaboration(req.params.noteId, userId);
      res.json({ success: true });
    } catch (error: unknown) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to leave note',
      });
    }
    return;
  }
  try {
    await supabaseService.removeNoteCollaborator(req.params.noteId, userId, req.params.collaboratorUserId);
    res.json({ success: true });
  } catch (error: unknown) {
    res.status(403).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove collaborator',
    });
  }
}));

router.get(
  '/:noteId/share-links',
  requireNoteOwner('noteId'),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const links = await supabaseService.listNoteShareLinks(req.params.noteId, userId);
    res.json({ success: true, data: links });
  })
);

router.post(
  '/:noteId/share-links',
  requireNoteOwner('noteId'),
  collaboratorInviteRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const role = req.body?.role === 'viewer' ? 'viewer' : 'editor';
    const expiresAt =
      typeof req.body?.expiresAt === 'string' && req.body.expiresAt.trim()
        ? req.body.expiresAt.trim()
        : null;
    try {
      const link = await supabaseService.createNoteShareLink(req.params.noteId, userId, role, {
        expiresAt,
      });
      res.status(201).json({ success: true, data: link });
    } catch (error: unknown) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create share link',
      });
    }
  })
);

router.delete(
  '/:noteId/share-links/:linkId',
  requireNoteOwner('noteId'),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      await supabaseService.revokeNoteShareLink(req.params.noteId, userId, req.params.linkId);
      res.json({ success: true });
    } catch (error: unknown) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to revoke share link',
      });
    }
  })
);

router.post('/:noteId/share-group', requireNoteOwner('noteId'), asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const { groupId } = req.body;
  if (!groupId) {
    res.status(400).json({ error: 'groupId is required.' });
    return;
  }
  const note = await supabaseService.shareNoteWithGroup(req.params.noteId, userId, groupId);
  res.json({ success: true, data: note });
}));

// Comments
router.get('/:noteId/comments', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  await supabaseService.getNote(req.params.noteId, userId);
  const comments = await supabaseService.getNoteComments(req.params.noteId);
  res.json({ success: true, data: comments });
}));

router.post('/:noteId/comments', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const { comment } = req.body;
  if (!comment?.trim()) {
    res.status(400).json({ error: 'Comment is required.' });
    return;
  }
  await supabaseService.getNote(req.params.noteId, userId);
  const created = await supabaseService.addNoteComment(req.params.noteId, userId, comment.trim());
  res.json({ success: true, data: created });
}));

export default router;
