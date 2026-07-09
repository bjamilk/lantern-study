import { Router, Request, Response } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { requireNoteAccess } from '../middleware/authorizeResource';
import { aiRateLimit, aiRateLimitForFeature } from '../middleware/aiRateLimit';
import { aiPostBurstRateLimit, uploadBurstRateLimit } from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuthUserId } from '../utils/requestAuth';
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
  transcribeAudioBase64,
} from '../services/aiService';
import { runNoteAiSync, enqueueJob } from '../queue/enqueue';
import { runPresentationPreviewJob } from '../services/presentationPreview';
import {
  assertPdfSize,
  assertPresentationSize,
  buildNoteStoragePath,
  extractPdfTextFromBuffer,
  extractPresentationTextFromBuffer,
  assertPresentationFileName,
  assertUserOwnedNoteStoragePath,
  assertValidOfficeZip,
  presentationContentType,
  warmGotenberg,
} from '../services/noteFiles';
import {
  getNoteStudyContent,
  hasEnoughNoteStudyContent,
} from '@lantern/shared/utils/noteStudyContent';
import { logger } from '../utils/logger';

const router = Router();

let supabaseService: SupabaseService;
let cacheService: CacheService;

export const initializeNotesRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

async function resolveNoteStudyContent(
  noteId: string,
  note: { body?: string; summary?: string; sourceType?: string }
): Promise<string> {
  const attachments = await supabaseService.getNoteAttachments(noteId);
  return getNoteStudyContent({
    sourceType: note.sourceType,
    body: note.body,
    summary: note.summary,
    attachments,
  });
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
  const enqueued = await enqueueJob(
    'notes.presentation.preview',
    {
      noteId: params.noteId,
      attachmentId: params.attachmentId,
      storagePath: params.storagePath,
      fileName: params.fileName,
      meta: params.meta,
      bufferBase64: params.buffer?.toString('base64'),
      extractedText: params.extractedText,
    },
    undefined
  );

  if (enqueued) return;

  void runPresentationPreviewJob(supabaseService, params).catch((err) => {
    logger.error('Presentation preview job unhandled error', {
      noteId: params.noteId,
      attachmentId: params.attachmentId,
      err,
    });
  });
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
  return 'none';
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
  const extractedText = await extractPdfTextFromBuffer(buffer);
  const studyText = extractedText || `[PDF uploaded: ${fileName}. Text extraction unavailable.]`;
  const noteTitle = String(fileName).replace(/\.pdf$/i, '') || 'Imported PDF';

  const note = await supabaseService.createNote(userId, {
    title: noteTitle,
    body: '',
    folderId,
    sourceType: 'pdf',
  });
  const attachment = await supabaseService.addNoteAttachment(note.id, {
    type: 'pdf',
    fileUrl,
    fileName,
    extractedText: studyText,
    metadata: { storagePath },
  });
  res.json({ success: true, data: { note, attachment } });
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
  const extractedText = await extractPresentationTextFromBuffer(buffer, safeName);
  const studyText =
    extractedText ||
    `[Presentation uploaded: ${safeName}. Text extraction unavailable.]`;
  const noteTitle = safeName.replace(/\.(pptx?|ppt)$/i, '') || 'Imported slides';

  const note = await supabaseService.createNote(userId, {
    title: noteTitle,
    body: '',
    folderId,
    sourceType: 'presentation',
  });
  const processingMeta = {
    storagePath,
    originalMime: contentType,
    previewProcessing: true,
    previewStartedAt: new Date().toISOString(),
  };
  const attachment = await supabaseService.addNoteAttachment(note.id, {
    type: 'presentation',
    fileUrl,
    fileName: safeName,
    extractedText: studyText,
    metadata: processingMeta,
  });

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
    data: { note, attachment, previewAvailable: false, status: 'processing' },
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

  try {
    assertUserOwnedNoteStoragePath(String(storagePath), userId);
    assertPresentationFileName(safeName);
    const downloaded = await supabaseService.downloadNoteFile(String(storagePath));
    buffer = downloaded.buffer;
    assertPresentationSize(buffer);
    if (/\.pptx$/i.test(safeName)) {
      assertValidOfficeZip(buffer, safeName);
    }
  } catch (err) {
    await supabaseService.deleteNoteFile(String(storagePath));
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Presentation file is invalid. Please re-upload.',
    });
    return;
  }

  const contentType = presentationContentType(safeName);
  const fileUrl = await supabaseService.createSignedNoteFileUrl(String(storagePath));
  const extractedText = await extractPresentationTextFromBuffer(buffer, safeName);
  const studyText =
    extractedText ||
    `[Presentation uploaded: ${safeName}. Text extraction unavailable.]`;
  const noteTitle = safeName.replace(/\.(pptx?|ppt)$/i, '') || 'Imported slides';

  const note = await supabaseService.createNote(userId, {
    title: noteTitle,
    body: '',
    folderId,
    sourceType: 'presentation',
  });
  const processingMeta = {
    storagePath: String(storagePath),
    originalMime: contentType,
    previewProcessing: true,
    previewStartedAt: new Date().toISOString(),
  };
  const attachment = await supabaseService.addNoteAttachment(note.id, {
    type: 'presentation',
    fileUrl,
    fileName: safeName,
    extractedText: studyText,
    metadata: processingMeta,
  });

  startPresentationPreviewJob({
    noteId: note.id,
    attachmentId: attachment.id,
    storagePath: String(storagePath),
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
  });

  res.json({
    success: true,
    data: { note, attachment, previewAvailable: false, status: 'processing' },
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

  try {
    assertUserOwnedNoteStoragePath(String(storagePath), userId);
    const downloaded = await supabaseService.downloadNoteFile(String(storagePath));
    buffer = downloaded.buffer;
    assertPdfSize(buffer);
  } catch (err) {
    await supabaseService.deleteNoteFile(String(storagePath));
    res.status(400).json({
      error: err instanceof Error ? err.message : 'PDF file is invalid. Please re-upload.',
    });
    return;
  }

  const fileUrl = await supabaseService.createSignedNoteFileUrl(String(storagePath));
  const extractedText = await extractPdfTextFromBuffer(buffer);
  const studyText = extractedText || `[PDF uploaded: ${safeName}. Text extraction unavailable.]`;
  const noteTitle = safeName.replace(/\.pdf$/i, '') || 'Imported PDF';

  const note = await supabaseService.createNote(userId, {
    title: noteTitle,
    body: '',
    folderId,
    sourceType: 'pdf',
  });
  const attachment = await supabaseService.addNoteAttachment(note.id, {
    type: 'pdf',
    fileUrl,
    fileName: safeName,
    extractedText: studyText,
    metadata: { storagePath: String(storagePath) },
  });

  logger.info('PDF upload finalized', {
    userId,
    fileName: safeName,
    bytes: buffer.length,
    durationMs: Date.now() - startedAt,
  });

  res.json({ success: true, data: { note, attachment } });
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

router.post('/transcribe-audio', requirePermission('ai'), aiPostBurstRateLimit, aiRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const { audioBase64, mimeType, noteId, fileName } = req.body;
  if (!audioBase64) {
    res.status(400).json({ error: 'audioBase64 is required.' });
    return;
  }
  const result = await runNoteAiSync(() =>
    transcribeAudioBase64(audioBase64, mimeType || 'audio/webm')
  );

  const { logAIInference } = await import('../services/aiInferenceLog');
  await logAIInference(supabaseService.getClient(), {
    userId,
    feature: 'transcribe-audio',
    provider: result.provider,
    requestId: (req as any).requestId,
  });

  if (noteId) {
    const note = await supabaseService.getNote(noteId, userId);
    const mergedBody = [note.body, result.transcript].filter(Boolean).join('\n\n');
    await supabaseService.updateNote(userId, noteId, { body: mergedBody });
    await supabaseService.addNoteAttachment(noteId, {
      type: 'audio',
      fileName: fileName || 'lecture-recording.webm',
      extractedText: result.transcript,
      metadata: { provider: result.provider },
    });
  }

  res.json({ success: true, data: result });
}));

// Note-scoped ownership checks (must be after static paths like /folders, /upload-pdf)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
router.use('/:noteId', (req, res, next) => {
  if (!UUID_RE.test(String(req.params.noteId || ''))) {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
  return requireNoteAccess('noteId')(req as any, res, next);
});

// Attachment routes (before /:noteId CRUD)
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
  const url = await supabaseService.createSignedNoteFileUrl(storagePath);
  res.json({ success: true, data: { url, expiresIn: 60 * 60 * 24 } });
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

router.post('/:noteId/regenerate-preview', validateNoteId, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
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
  const previewError = typeof meta.previewError === 'string' ? meta.previewError : undefined;

  res.json({
    success: true,
    data: {
      status,
      previewAvailable: status === 'ready',
      previewError: status === 'failed' ? previewError : undefined,
      attachment,
    },
  });
}));

// Notes CRUD
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const { folderId, groupId } = req.query;
  const notes = await supabaseService.getNotes(userId, {
    folderId: folderId as string | undefined,
    groupId: groupId as string | undefined,
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

router.patch('/:noteId', validateNoteId, validateNoteUpdate, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const note = await supabaseService.updateNote(userId, req.params.noteId, req.body);
  await cacheService.delete(`note:${req.params.noteId}`);
  res.json({ success: true, data: note });
}));

router.delete('/:noteId', validateNoteId, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  await supabaseService.deleteNote(userId, req.params.noteId);
  res.json({ success: true });
}));

router.post('/:noteId/attachments', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  await supabaseService.getNote(req.params.noteId, userId);
  const attachment = await supabaseService.addNoteAttachment(req.params.noteId, req.body);
  res.json({ success: true, data: attachment });
}));

// AI-powered learn actions
router.post('/:noteId/summarize', requirePermission('ai'), aiPostBurstRateLimit, aiRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const note = await supabaseService.getNote(req.params.noteId, userId);
  const content = await resolveNoteStudyContent(note.id, note);
  if (!content || content.length < 30) {
    res.status(400).json({ error: 'Note needs at least 30 characters to summarize.' });
    return;
  }
  const result = await runNoteAiSync(() => summarizeNoteContent(content, note.title));
  const updated = await supabaseService.updateNote(userId, note.id, { summary: result.summary });
  res.json({ success: true, data: { summary: result.summary, provider: result.provider, note: updated } });
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
  const result = await runNoteAiSync(() =>
    generateDailyQuiz(content.slice(0, 8000), { studyGoal, count })
  );
  const questions = result.questions.map((q, index) => ({
    id: `nq-${index}`,
    text: q.text,
    type: q.type,
    options: q.options,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    topic: q.topic,
  }));
  const session = await supabaseService.upsertNoteQuiz(userId, note.id, {
    studyGoal: studyGoal || 'retention',
    questions,
  });
  res.json({ success: true, data: session });
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
  const result = await runNoteAiSync(() =>
    generateFlashcardsFromNotes(content.slice(0, 8000), { count, style })
  );
  res.json({ success: true, data: result });
}));

router.post('/:noteId/reextract-text', validateNoteId, handleValidationErrors, asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const note = await supabaseService.getNote(req.params.noteId, userId);
  if (note.sourceType !== 'presentation') {
    res.status(400).json({ error: 'Text re-extraction is only available for presentation notes.' });
    return;
  }

  const attachments = await supabaseService.getNoteAttachments(note.id);
  const presentation = attachments.find((a) => a.type === 'presentation');
  if (!presentation) {
    res.status(404).json({ error: 'No presentation attachment found for this note.' });
    return;
  }

  const storagePath =
    typeof presentation.metadata?.storagePath === 'string' ? presentation.metadata.storagePath : null;
  const fileName = presentation.fileName || 'slides.pptx';
  if (!storagePath) {
    res.status(404).json({ error: 'Presentation file is missing from storage.' });
    return;
  }

  const { buffer } = await supabaseService.downloadNoteFile(storagePath);
  if (/\.pptx$/i.test(fileName)) {
    assertValidOfficeZip(buffer, fileName);
  }

  const extractedText = await extractPresentationTextFromBuffer(buffer, fileName);
  const studyText =
    extractedText ||
    `[Presentation uploaded: ${fileName}. Text extraction unavailable.]`;

  const updatedAttachment = await supabaseService.updateNoteAttachment(presentation.id, {
    extractedText: studyText,
  });

  res.json({
    success: true,
    data: {
      attachment: updatedAttachment,
      extractedText: studyText,
      contentLength: studyText.trim().length,
    },
  });
}));

// Collaboration
router.get('/:noteId/collaborators', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  await supabaseService.getNote(req.params.noteId, userId);
  const collaborators = await supabaseService.getNoteCollaborators(req.params.noteId);
  res.json({ success: true, data: collaborators });
}));

router.post('/:noteId/collaborators', asyncHandler(async (req: Request, res: Response) => {
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
    const message = error instanceof Error ? error.message : 'Failed to add collaborator.';
    const status = message.includes('not found') || message.includes('Enter a') || message.includes('Multiple users') || message.includes('cannot add yourself')
      ? 400
      : 500;
    res.status(status).json({ error: message });
  }
}));

router.delete('/:noteId/collaborators/:collaboratorUserId', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  await supabaseService.removeNoteCollaborator(req.params.noteId, userId, req.params.collaboratorUserId);
  res.json({ success: true });
}));

router.post('/:noteId/share-group', asyncHandler(async (req: Request, res: Response) => {
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
