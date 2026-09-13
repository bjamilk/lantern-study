import {
  isPlaceholderExtractedText,
  MIN_NOTE_STUDY_CONTENT_CHARS,
} from '@lantern/shared/utils/noteStudyContent';
import type { SupabaseService } from './supabase';
import {
  PDF_OCR_TIMEOUT_MS,
  MAX_OCR_PDF_PAGES,
  MAX_OCR_SLIDES,
  PRESENTATION_OCR_TIMEOUT_MS,
  extractPdfTextDetailsFromBuffer,
  extractPresentationTextDetailsFromBuffer,
  isThinExtractedStudyText,
  mergeExtractionTexts,
} from './noteFiles';
import { ocrImageBuffer, ocrPdfPagesFromBuffer } from './pdfPageOcr';
import { persistPagesAfterPdfOcr } from './notePages';
import {
  isPerceiveVisionEnabled,
  perceivePageImage,
  shouldEscalateToVisionOcr,
} from './perceiveVision';
import { logger } from '../utils/logger';

/**
 * Read one photograph: Tesseract first, escalating to the Gemini vision
 * transcriber when the local pass comes back weak.
 *
 * Exported for the companion's image attachments, which need exactly this
 * chain on a single photo — a second copy of it would be a second set of
 * fallback rules to keep in step with this one.
 */
export async function readPhotoPageText(
  buffer: Buffer,
  timeoutMs: number
): Promise<{ text: string; provider: string }> {
  let tesseractText = '';
  try {
    tesseractText = await ocrImageBuffer(buffer, timeoutMs);
  } catch (err) {
    logger.warn('Tesseract photo OCR failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!shouldEscalateToVisionOcr(tesseractText) || !isPerceiveVisionEnabled()) {
    return { text: tesseractText, provider: 'tesseract' };
  }

  try {
    const perceived = await perceivePageImage(buffer, { timeoutMs });
    if (perceived?.text) {
      return { text: perceived.text, provider: perceived.provider };
    }
  } catch (err) {
    logger.warn('Perceive vision OCR failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { text: tesseractText, provider: 'tesseract' };
}

export interface NoteOcrJobParams {
  noteId: string;
  attachmentId: string;
  storagePath: string;
  fileName: string;
  sourceKind: 'pdf' | 'presentation' | 'preview_pdf' | 'image';
  meta: Record<string, unknown>;
  /** Optional in-memory buffer to avoid re-download. */
  buffer?: Buffer;
}

export interface NoteOcrJobResult {
  status: 'ok' | 'ocr_failed' | 'empty';
  noteId: string;
  attachmentId: string;
  ocrPageCount?: number;
  contentLength?: number;
  error?: string;
}

function ocrPlaceholder(_fileName?: string): string {
  return `[Running OCR on scanned pages…]`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err || 'Local OCR failed.');
}

/**
 * Merge job meta with the latest attachment metadata so OCR cannot wipe
 * previewStoragePath / previewUrl written by a concurrent preview job.
 */
async function resolveAttachmentMeta(
  supabaseService: SupabaseService,
  noteId: string,
  attachmentId: string,
  jobMeta: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    const current = await supabaseService.getNoteAttachment(noteId, attachmentId);
    if (current?.metadata && typeof current.metadata === 'object') {
      const existing = current.metadata as Record<string, unknown>;
      return {
        ...existing,
        ...jobMeta,
        // Always prefer preview fields already persisted on the attachment.
        previewStoragePath: existing.previewStoragePath ?? jobMeta.previewStoragePath,
        previewUrl: existing.previewUrl ?? jobMeta.previewUrl,
        previewProcessing:
          existing.previewProcessing === false
            ? false
            : jobMeta.previewProcessing === false
              ? false
              : (existing.previewProcessing ?? jobMeta.previewProcessing),
        previewError: existing.previewError ?? jobMeta.previewError,
        previewFailedAt: existing.previewFailedAt ?? jobMeta.previewFailedAt,
        previewStartedAt: existing.previewStartedAt ?? jobMeta.previewStartedAt,
      };
    }
  } catch {
    // Fall through to job meta when lookup is unavailable.
  }
  return { ...jobMeta };
}

function sanitizeMetaForOcr(meta: Record<string, unknown>): Record<string, unknown> {
  const {
    ocrError: _prevErr,
    ocrFailedAt: _prevFailed,
    ocrCompletedAt: _prevDone,
    ...rest
  } = meta;
  return rest;
}

/**
 * Local Tesseract OCR. PDFs use pdfjs page rasterization + tesseract.js.
 * Presentations OCR the Gotenberg preview PDF when available; shape OCR is fallback only.
 * Caps pages/slides and aborts on timeout to protect worker memory.
 */
export async function runNoteOcrJob(
  supabaseService: SupabaseService,
  params: NoteOcrJobParams
): Promise<NoteOcrJobResult> {
  const { noteId, attachmentId, storagePath, fileName, sourceKind } = params;
  const mergedMeta = await resolveAttachmentMeta(
    supabaseService,
    noteId,
    attachmentId,
    params.meta
  );
  const baseMeta = sanitizeMetaForOcr(mergedMeta);

  const processingMeta = {
    ...baseMeta,
    extractionStatus: 'ocr_processing' as const,
    ocrProvider: 'tesseract',
    ocrStartedAt: new Date().toISOString(),
    ocrError: undefined,
    ocrFailedAt: undefined,
    // Never leave a presentation stuck in previewProcessing because of OCR.
    ...(sourceKind === 'presentation' || sourceKind === 'preview_pdf'
      ? { previewProcessing: baseMeta.previewProcessing === true && !baseMeta.previewStoragePath }
      : {}),
  };

  try {
    await supabaseService.updateNoteAttachment(attachmentId, {
      metadata: processingMeta,
    });

    let buffer = params.buffer;
    if (!buffer) {
      const downloaded = await supabaseService.downloadNoteFile(storagePath);
      buffer = downloaded.buffer;
    }

    const timeoutMs =
      sourceKind === 'presentation' || sourceKind === 'image'
        ? PRESENTATION_OCR_TIMEOUT_MS
        : PDF_OCR_TIMEOUT_MS;

    let ocrText = '';
    let ocrPageCount = 0;
    let capped = false;
    let ocrProvider = 'tesseract';

    if (sourceKind === 'image') {
      const photo = await readPhotoPageText(buffer, timeoutMs);
      ocrText = photo.text;
      ocrProvider = photo.provider;
      ocrPageCount = 1;
    } else if (sourceKind === 'presentation') {
      // Prefer non-OCR shape text; optional embedded-image OCR is best-effort only.
      const details = await extractPresentationTextDetailsFromBuffer(buffer, fileName, {
        enableOcr: true,
        timeoutMs,
      });
      ocrText = details.text;
      ocrPageCount = Math.min(details.slideCount || 0, MAX_OCR_SLIDES);
      if ((details.slideCount || 0) > MAX_OCR_SLIDES) {
        capped = true;
        const approxPerSlide = Math.max(
          1,
          Math.floor(ocrText.length / Math.max(1, details.slideCount || 1))
        );
        ocrText = ocrText.slice(0, approxPerSlide * MAX_OCR_SLIDES).trim();
      }
      if (details.timedOut && isThinExtractedStudyText(ocrText)) {
        throw new Error(
          `OCR timed out after ${Math.round(timeoutMs / 1000)}s. Try a shorter deck or export as PDF.`
        );
      }
    } else {
      // PDF / preview PDF — rasterize pages then Tesseract (not officeparser image-XObject OCR).
      const raster = await ocrPdfPagesFromBuffer(buffer, {
        maxPages: MAX_OCR_PDF_PAGES,
        timeoutMs,
      });
      ocrText = raster.text;
      ocrPageCount = raster.ocrPageCount;
      capped = raster.capped;

      const layer = await extractPdfTextDetailsFromBuffer(buffer);
      ocrText = mergeExtractionTexts(layer.text, ocrText);

      // Page model (walk-through). Purely additive: the joined `ocrText` above
      // is what gets written to extracted_text, exactly as before. Failures are
      // swallowed inside persistPagesAfterPdfOcr — OCR succeeding is the thing
      // the student paid for and it must not be undone by a page write.
      await persistPagesAfterPdfOcr(supabaseService, attachmentId, buffer, raster.pages, {
        noteId,
      });
    }

    const trimmed = (ocrText || '').trim();
    if (!trimmed || isPlaceholderExtractedText(trimmed) || trimmed.length < 10) {
      const message =
        'Local OCR found no readable text. The file may be blank, too low-resolution, or unsupported.';
      const latestMeta = await resolveAttachmentMeta(
        supabaseService,
        noteId,
        attachmentId,
        processingMeta
      );
      await supabaseService.updateNoteAttachment(attachmentId, {
        extractedText: `[OCR failed: ${fileName}]`,
        metadata: {
          ...sanitizeMetaForOcr(latestMeta),
          extractionStatus: 'ocr_failed',
          ocrProvider,
          ocrPageCount,
          ocrCapped: capped,
          ocrError: message,
          ocrFailedAt: new Date().toISOString(),
          ocrCompletedAt: new Date().toISOString(),
          previewProcessing:
            latestMeta.previewProcessing === true && !latestMeta.previewStoragePath
              ? true
              : false,
        },
      });
      return { status: 'empty', noteId, attachmentId, ocrPageCount, error: message };
    }

    const extractionStatus =
      trimmed.length >= MIN_NOTE_STUDY_CONTENT_CHARS ? 'ok' : 'needs_ocr';

    const latestMeta = await resolveAttachmentMeta(
      supabaseService,
      noteId,
      attachmentId,
      processingMeta
    );
    await supabaseService.updateNoteAttachment(attachmentId, {
      extractedText: trimmed,
      metadata: {
        ...sanitizeMetaForOcr(latestMeta),
        extractionStatus,
        ocrProvider,
        ocrPageCount,
        ocrCapped: capped,
        ocrError: undefined,
        ocrFailedAt: undefined,
        ocrCompletedAt: new Date().toISOString(),
        previewProcessing:
          latestMeta.previewProcessing === true && !latestMeta.previewStoragePath
            ? true
            : false,
      },
    });

    logger.info('Note OCR completed', {
      noteId,
      attachmentId,
      sourceKind,
      ocrProvider,
      ocrPageCount,
      capped,
      contentLength: trimmed.length,
      extractionStatus,
    });

    return {
      status: extractionStatus === 'ok' ? 'ok' : 'empty',
      noteId,
      attachmentId,
      ocrPageCount,
      contentLength: trimmed.length,
    };
  } catch (err) {
    const message = errorMessage(err);
    logger.warn('Note OCR job failed', {
      noteId,
      attachmentId,
      sourceKind,
      error: message,
    });
    const latestMeta: Record<string, unknown> = await resolveAttachmentMeta(
      supabaseService,
      noteId,
      attachmentId,
      processingMeta
    ).catch(() => ({ ...processingMeta } as Record<string, unknown>));
    await supabaseService
      .updateNoteAttachment(attachmentId, {
        extractedText: `[OCR failed: ${message.slice(0, 120)}]`,
        metadata: {
          ...sanitizeMetaForOcr(latestMeta),
          extractionStatus: 'ocr_failed',
          ocrProvider: 'tesseract',
          ocrError: message,
          ocrFailedAt: new Date().toISOString(),
          ocrCompletedAt: new Date().toISOString(),
          previewProcessing:
            latestMeta.previewProcessing === true && !latestMeta.previewStoragePath
              ? true
              : false,
        },
      })
      .catch(() => {});
    return { status: 'ocr_failed', noteId, attachmentId, error: message };
  }
}

export function shouldAutoEnqueueOcr(status: string | undefined | null): boolean {
  return status === 'needs_ocr' || status === 'empty';
}

export { ocrPlaceholder };
