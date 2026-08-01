import { Router, Request, Response } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import {
  requireNoteAccess,
  requireNoteEdit,
  requireNoteOwner,
} from '../middleware/authorizeResource';
import { idempotencyMiddleware, type IdempotentRequest } from '../middleware/idempotency';
import {
  aiRateLimit,
  aiRateLimitForFeature,
  chargeAiCredits,
  NOTE_OCR_CREDIT_COST,
} from '../middleware/aiRateLimit';
import {
  aiPostBurstRateLimit,
  collaboratorInviteRateLimit,
  uploadBurstRateLimit,
} from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuthUserId } from '../utils/requestAuth';
import { clientErrorMessage } from '../utils/safeError';
import {
  handleValidationErrors,
  validateNoteId,
  validateFolderId,
  validateNoteCreate,
  validateNoteUpdate,
  validateFolderCreate,
} from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import {
  summarizeNoteContent,
  generateDailyQuiz,
  generateFlashcardsFromNotes,
  resolveAudioUploadMeta,
  transcribeAudioBase64,
  transcribeAudioBuffer,
} from '../services/aiService';
import { runNoteAiSync, runSyncOrEnqueue } from '../queue/enqueue';
import { sendAsyncJobAccepted } from '../queue/respondAsync';
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
  MAX_OCR_PDF_PAGES,
  MAX_OCR_SLIDES,
} from '../services/noteFiles';
import { detectImageMime } from '../utils/fileValidation';
import {
  getNoteStudyContent,
  getNoteStudyContentForSmartNotes,
  hasEnoughNoteStudyContent,
  MIN_NOTE_STUDY_CONTENT_CHARS,
} from '@lantern/shared/utils/noteStudyContent';
import { upsertSmartNotesSection } from '@lantern/shared/utils/smartNotes';
import { defaultPhotoNoteTitle } from '@lantern/shared/utils/photoNoteTitle';
import { parseYoutubeVideoId, canonicalYoutubeUrl } from '@lantern/shared/utils/youtube';
import { fetchYoutubeMetadata } from '../services/youtubeTranscript';
import { runYoutubeTranscriptJob } from '../services/youtubeNote';
import { ocrPlaceholder, runNoteOcrJob, shouldAutoEnqueueOcr } from '../services/noteOcr';
import { logger } from '../utils/logger';
import { processImageForUpload } from '../services/imageProcessing';
import { storageThumbPath } from '@lantern/shared/utils/storageUrl';

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
  options?: { forSmartNotes?: boolean }
): Promise<string> {
  const attachments = await supabaseService.getNoteAttachments(noteId);
  const input = {
    sourceType: note.sourceType,
    body: note.body,
    summary: note.summary,
    attachments,
  };
  if (options?.forSmartNotes) {
    return getNoteStudyContentForSmartNotes(input);
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

async function startNoteOcrJob(params: {
  noteId: string;
  attachmentId: string;
  storagePath: string;
  fileName: string;
  sourceKind: 'pdf' | 'presentation' | 'preview_pdf' | 'image';
  meta: Record<string, unknown>;
  userId: string;
  buffer?: Buffer;
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
    })
  );
  if (outcome.mode === 'async') {
    return { mode: 'async', jobId: outcome.jobId };
  }
  return { mode: 'sync' };
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
  const { name, color, groupId, parentId } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ error: 'Folder name is required.' });
    return;
  }
  const folder = await supabaseService.createNoteFolder(userId, { name: name.trim(), color, groupId, parentId });
  res.json({ success: true, data: folder });
}));

router.patch('/folders/:folderId', validateFolderId, validateFolderCreate, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const folder = await supabaseService.updateNoteFolder(userId, req.params.folderId, req.body);
  res.json({ success: true, data: folder });
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
  const { fileName, base64Data, folderId } = req.body;
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
    void startNoteOcrJob({
      noteId: note.id,
      attachmentId: attachment.id,
      storagePath,
      fileName: String(fileName),
      sourceKind: 'pdf',
      meta: attachmentMeta,
      userId,
    }).catch((err) => {
      logger.error('Failed to start PDF OCR job', { noteId: note.id, err });
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
  const { fileName, base64Data, folderId } = req.body;
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
    void startNoteOcrJob({
      noteId: note.id,
      attachmentId: attachment.id,
      storagePath: ownedPath,
      fileName: safeName,
      sourceKind: 'pdf',
      meta: attachmentMeta,
      userId,
    }).catch((err) => {
      logger.error('Failed to start PDF OCR job', { noteId: note.id, err });
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

  logger.info('Photo note finalized', {
    userId,
    imageCount: validated.length,
    durationMs: Date.now() - startedAt,
  });

  res.json({ success: true, data: { note, attachments } });
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

  logger.info('Photo note uploaded via API', {
    userId,
    imageCount: validated.length,
    durationMs: Date.now() - startedAt,
  });

  res.json({ success: true, data: { note, attachments } });
}));

router.post('/daily-quiz', requirePermission('ai'), aiPostBurstRateLimit, aiRateLimitForFeature('generate_questions'), asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const { content, studyGoal, count } = req.body;
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
  const { audioBase64, mimeType, fileName, noteId } = req.body;
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

router.post('/transcribe-audio', requirePermission('ai'), aiPostBurstRateLimit, aiRateLimit, asyncHandler(async (req: Request, res: Response) => {
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

  // Authorize edit before calling Whisper so collaborators without write access
  // (and failed ACL checks) do not burn AI quota.
  if (noteId) {
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
    feature: 'transcribe-audio',
    provider: result.provider,
    requestId,
  });

  if (!noteId) {
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
  );

  if (outcome.mode === 'async') {
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
  res.json({ success: true, data: { attachments } });
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
    res.json({ success: true, data: { attachments } });
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
    res.status(400).json({ error: 'No storage path available for this attachment.' });
    return;
  }
  const variant = req.query.variant === 'thumb' ? 'thumb' : 'original';
  const url = await supabaseService.createSignedNoteFileUrl(
    storagePath,
    60 * 60 * 24,
    variant,
  );
  res.json({ success: true, data: { url, expiresIn: 60 * 60 * 24, variant } });
}));

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
    res.status(400).json({ error: 'No storage path available for this attachment.' });
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
  const { folderId, groupId, archived } = req.query;
  let archivedFilter: boolean | undefined;
  if (archived === 'true' || archived === '1') archivedFilter = true;
  else if (archived === 'false' || archived === '0') archivedFilter = false;
  const notes = await supabaseService.getNotes(userId, {
    folderId: folderId as string | undefined,
    groupId: groupId as string | undefined,
    archived: archivedFilter,
  });
  res.json({ success: true, data: notes });
}));

router.get('/:noteId', validateNoteId, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const note = await supabaseService.getNote(req.params.noteId, userId);
  const attachments = await supabaseService.getNoteAttachments(req.params.noteId);
  res.json({ success: true, data: { ...note, attachments } });
}));

router.post('/', validateNoteCreate, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const note = await supabaseService.createNote(userId, req.body);
  res.json({ success: true, data: note });
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

// AI-powered learn actions (Smart Notes). Counts as one daily AI credit via aiRateLimit;
// long sources may use multiple internal model calls under this single route.
router.post('/:noteId/summarize', requireNoteEdit('noteId'), requirePermission('ai'), aiPostBurstRateLimit, aiRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const note = await supabaseService.getNote(req.params.noteId, userId);
  const content = await resolveNoteStudyContent(note.id, note, { forSmartNotes: true });
  if (!content || content.length < MIN_NOTE_STUDY_CONTENT_CHARS) {
    res.status(400).json({
      error: `Note needs at least ${MIN_NOTE_STUDY_CONTENT_CHARS} characters of study content to summarize. For scanned PDFs, wait for OCR or add your own notes.`,
    });
    return;
  }
  const outcome = await runSyncOrEnqueue(
    'notes.ai.summarize',
    {
      content,
      title: note.title,
      noteId: note.id,
      sourceType: note.sourceType,
    },
    userId,
    async () => {
      const result = await summarizeNoteContent(content, {
        title: note.title,
        sourceType: note.sourceType,
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
  const sliced = content.slice(0, 8000);
  const outcome = await runSyncOrEnqueue(
    'notes.ai.quiz',
    { content: sliced, studyGoal, count, noteId: note.id },
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
      return supabaseService.upsertNoteQuiz(userId, note.id, {
        studyGoal: studyGoal || 'retention',
        questions,
      });
    }
  );
  if (outcome.mode === 'async') {
    sendAsyncJobAccepted(res, outcome.jobId);
    return;
  }
  res.json({ success: true, data: outcome.result });
}));

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
  const { count, style } = req.body || {};
  const sliced = content.slice(0, 8000);
  const outcome = await runSyncOrEnqueue(
    'notes.ai.flashcards',
    { content: sliced, count, style },
    userId,
    async () => generateFlashcardsFromNotes(sliced, { count, style })
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
    );

    if (outcome.mode === 'async') {
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
    if (note.sourceType !== 'pdf' && note.sourceType !== 'presentation') {
      res.status(400).json({ error: 'OCR is only available for PDF and presentation notes.' });
      return;
    }

    const attachments = await supabaseService.getNoteAttachments(note.id);
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
      const denied = await chargeAiCredits(userId, NOTE_OCR_CREDIT_COST);
      if (denied) {
        res.status(429).json(denied);
        return;
      }
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
    });

    if (outcome.mode === 'async') {
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
    if (note.sourceType !== 'pdf' && note.sourceType !== 'presentation') {
      res.status(400).json({ error: 'OCR status is only available for PDF and presentation notes.' });
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
