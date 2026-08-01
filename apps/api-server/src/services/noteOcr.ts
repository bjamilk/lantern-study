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
import { logger } from '../utils/logger';

export interface NoteOcrJobParams {
  noteId: string;
  attachmentId: string;
  storagePath: string;
  fileName: string;
  sourceKind: 'pdf' | 'presentation' | 'preview_pdf';
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

/**
 * Local Tesseract OCR via officeparser (tesseract.js). No cloud OCR fallback.
 * Caps pages/slides and aborts on timeout to protect worker memory.
 */
export async function runNoteOcrJob(
  supabaseService: SupabaseService,
  params: NoteOcrJobParams
): Promise<NoteOcrJobResult> {
  const { noteId, attachmentId, storagePath, fileName, sourceKind } = params;
  const {
    ocrError: _prevErr,
    ocrFailedAt: _prevFailed,
    previewError: _keepPreviewErr,
    ...baseMeta
  } = params.meta;

  const processingMeta = {
    ...baseMeta,
    extractionStatus: 'ocr_processing' as const,
    ocrProvider: 'tesseract',
    ocrStartedAt: new Date().toISOString(),
    ocrError: undefined,
    ocrFailedAt: undefined,
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
      sourceKind === 'presentation' ? PRESENTATION_OCR_TIMEOUT_MS : PDF_OCR_TIMEOUT_MS;

    let ocrText = '';
    let ocrPageCount = 0;
    let capped = false;

    if (sourceKind === 'presentation') {
      const details = await extractPresentationTextDetailsFromBuffer(buffer, fileName, {
        enableOcr: true,
        timeoutMs,
      });
      ocrText = details.text;
      ocrPageCount = Math.min(details.slideCount || 0, MAX_OCR_SLIDES);
      if ((details.slideCount || 0) > MAX_OCR_SLIDES) {
        capped = true;
        // Soft-cap messaging: officeparser may have processed more; keep first portion.
        const approxPerSlide = Math.max(1, Math.floor(ocrText.length / Math.max(1, details.slideCount || 1)));
        ocrText = ocrText.slice(0, approxPerSlide * MAX_OCR_SLIDES).trim();
      }
      if (details.timedOut && isThinExtractedStudyText(ocrText)) {
        throw new Error(
          `OCR timed out after ${Math.round(timeoutMs / 1000)}s. Try a shorter deck or export as PDF.`
        );
      }
    } else {
      // PDF / preview PDF — prefer officeparser OCR (embedded page images → Tesseract).
      ocrText = await runPdfOcrWithOfficeParser(buffer, fileName, timeoutMs);
      const layer = await extractPdfTextDetailsFromBuffer(buffer);
      ocrPageCount = Math.min(layer.pageCount, MAX_OCR_PDF_PAGES);
      if (layer.pageCount > MAX_OCR_PDF_PAGES) {
        capped = true;
      }
      // Merge any existing text layer with OCR so headers aren't lost.
      ocrText = mergeExtractionTexts(layer.text, ocrText);
      if (capped && ocrText) {
        // Approximate trim when page count exceeds hard cap (officeparser has no page limit API).
        const approxPerPage = Math.max(
          1,
          Math.floor(ocrText.length / Math.max(1, layer.pageCount))
        );
        ocrText = ocrText.slice(0, approxPerPage * MAX_OCR_PDF_PAGES).trim();
      }
    }

    const trimmed = (ocrText || '').trim();
    if (!trimmed || isPlaceholderExtractedText(trimmed) || trimmed.length < 10) {
      const message =
        'Local OCR found no readable text. The file may be blank, too low-resolution, or unsupported.';
      await supabaseService.updateNoteAttachment(attachmentId, {
        extractedText: `[OCR failed: ${fileName}]`,
        metadata: {
          ...processingMeta,
          extractionStatus: 'ocr_failed',
          ocrProvider: 'tesseract',
          ocrPageCount,
          ocrCapped: capped,
          ocrError: message,
          ocrFailedAt: new Date().toISOString(),
          ocrCompletedAt: new Date().toISOString(),
        },
      });
      return { status: 'empty', noteId, attachmentId, ocrPageCount, error: message };
    }

    const extractionStatus =
      trimmed.length >= MIN_NOTE_STUDY_CONTENT_CHARS ? 'ok' : 'needs_ocr';

    await supabaseService.updateNoteAttachment(attachmentId, {
      extractedText: trimmed,
      metadata: {
        ...processingMeta,
        extractionStatus,
        ocrProvider: 'tesseract',
        ocrPageCount,
        ocrCapped: capped,
        ocrError: undefined,
        ocrFailedAt: undefined,
        ocrCompletedAt: new Date().toISOString(),
      },
    });

    logger.info('Note OCR completed', {
      noteId,
      attachmentId,
      sourceKind,
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
    const message = err instanceof Error ? err.message : 'Local OCR failed.';
    logger.warn('Note OCR job failed', { noteId, attachmentId, sourceKind, error: message });
    await supabaseService
      .updateNoteAttachment(attachmentId, {
        extractedText: `[OCR failed: ${message.slice(0, 120)}]`,
        metadata: {
          ...processingMeta,
          extractionStatus: 'ocr_failed',
          ocrProvider: 'tesseract',
          ocrError: message,
          ocrFailedAt: new Date().toISOString(),
          ocrCompletedAt: new Date().toISOString(),
        },
      })
      .catch(() => {});
    return { status: 'ocr_failed', noteId, attachmentId, error: message };
  }
}

async function runPdfOcrWithOfficeParser(
  buffer: Buffer,
  fileName: string,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { parseOffice } = require('officeparser') as typeof import('officeparser');
    const ast = await parseOffice(buffer, {
      extractAttachments: true,
      ocr: true,
      ocrConfig: {
        language: 'eng',
        timeout: {
          workerLoad: 30_000,
          recognition: 20_000,
          autoTerminate: 10_000,
        },
      },
      abortSignal: controller.signal,
    });

    let text = '';
    if (typeof ast.to === 'function') {
      const converted = await ast.to('text');
      if (typeof converted.value === 'string') text = converted.value.trim();
    }
    if (!text && typeof ast.toText === 'function') {
      text = (ast.toText() || '').trim();
    }

    // Prefer OCR text from attachments when body text is still thin.
    const ocrBits = (ast.attachments || [])
      .map((a) => (a.ocrText || '').trim())
      .filter(Boolean);
    if (ocrBits.length && (!text || text.length < MIN_NOTE_STUDY_CONTENT_CHARS)) {
      text = mergeExtractionTexts(text, ocrBits.join('\n\n'));
    }
    return text;
  } catch (err) {
    const aborted =
      err instanceof Error &&
      (err.name === 'AbortError' || /aborted|abort/i.test(err.message));
    if (aborted) {
      throw new Error(
        `OCR timed out after ${Math.round(timeoutMs / 1000)}s (capped at ${MAX_OCR_PDF_PAGES} pages).`
      );
    }
    logger.warn('PDF officeparser OCR failed', { fileName, err });
    throw err instanceof Error ? err : new Error('PDF OCR failed');
  } finally {
    clearTimeout(timer);
  }
}

export function shouldAutoEnqueueOcr(status: string | undefined | null): boolean {
  return status === 'needs_ocr' || status === 'empty';
}

export { ocrPlaceholder };
