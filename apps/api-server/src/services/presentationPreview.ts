import type { DataLayer } from './data';
import {
  assertValidOfficeZip,
  buildPresentationStudyText,
  convertPresentationToPdf,
  extractPdfTextFromBuffer,
  extractPresentationTextFromBuffer,
  isThinExtractedStudyText,
  mergeExtractionTexts,
} from './noteFiles';
import { runNoteOcrJob, shouldAutoEnqueueOcr } from './noteOcr';
import { persistPagesFromPdfBuffer } from './notePages';
import { runSyncOrEnqueue } from '../queue/enqueue';
import { logger } from '../utils/logger';

export interface PresentationPreviewJobParams {
  noteId: string;
  attachmentId: string;
  storagePath: string;
  fileName: string;
  meta: Record<string, unknown>;
  buffer?: Buffer;
  extractedText?: string;
}

export async function runPresentationPreviewJob(
  layer: DataLayer,
  params: PresentationPreviewJobParams
): Promise<void> {
  const { noteId, attachmentId, storagePath, fileName } = params;
  const meta = { ...params.meta };

  try {
    let buffer = params.buffer;
    if (!buffer) {
      const downloaded = await layer.notes.downloadNoteFile(storagePath);
      buffer = downloaded.buffer;
    }
    if (/\.pptx$/i.test(fileName)) {
      assertValidOfficeZip(buffer, fileName);
    }

    let extractedText =
      params.extractedText ??
      (await extractPresentationTextFromBuffer(buffer, fileName, { enableOcr: false }));
    let { studyText, extractionStatus } = buildPresentationStudyText(fileName, extractedText);

    const { pdf: pdfBuffer, error: conversionError, wakeMs, convertMs, totalMs } =
      await convertPresentationToPdf(buffer, fileName, { noteId });

    if (!pdfBuffer) {
      await layer.notes.updateNoteAttachment(attachmentId, {
        extractedText: studyText,
        metadata: {
          ...meta,
          extractionStatus,
          previewProcessing: false,
          previewError: conversionError || 'Could not generate slide preview.',
          previewFailedAt: new Date().toISOString(),
        },
      });
      logger.warn('Presentation preview failed', {
        noteId,
        fileName,
        wakeMs,
        convertMs,
        totalMs,
        success: false,
      });
      return;
    }

    // Phase A: when shape text is empty/thin, harvest text layer from the Gotenberg PDF.
    if (isThinExtractedStudyText(extractedText)) {
      const pdfText = await extractPdfTextFromBuffer(pdfBuffer);
      if (pdfText && !isThinExtractedStudyText(pdfText)) {
        extractedText = mergeExtractionTexts(extractedText, pdfText);
        ({ studyText, extractionStatus } = buildPresentationStudyText(fileName, extractedText));
        logger.info('Merged preview PDF text into presentation extraction', {
          noteId,
          fileName,
          pdfTextLength: pdfText.length,
        });
      } else if (pdfText) {
        extractedText = mergeExtractionTexts(extractedText, pdfText);
        ({ studyText, extractionStatus } = buildPresentationStudyText(fileName, extractedText));
      }
    }

    const previewStoragePath = storagePath.replace(/\.[^.]+$/, '') + '-preview.pdf';
    await layer.notes.uploadNoteFile({
      storagePath: previewStoragePath,
      buffer: pdfBuffer,
      contentType: 'application/pdf',
    });
    const previewUrl = await layer.notes.createSignedNoteFileUrl(previewStoragePath);

    // Page model (walk-through): the Gotenberg PDF is the only paginable view
    // of a deck, so this is the moment slides become pages. Best effort — the
    // preview and the extracted text are this job's real output and neither
    // depends on the page rows.
    await persistPagesFromPdfBuffer(layer, attachmentId, pdfBuffer, {
      noteId,
      source: 'presentation_preview',
    });

    const shouldOcr = shouldAutoEnqueueOcr(extractionStatus);
    const finalMeta: Record<string, unknown> = {
      ...meta,
      extractionStatus: shouldOcr ? 'ocr_processing' : extractionStatus,
      previewStoragePath,
      previewUrl,
      previewProcessing: false,
      previewError: undefined,
      previewFailedAt: undefined,
      ...(shouldOcr
        ? {
            ocrProvider: 'tesseract',
            ocrStartedAt: new Date().toISOString(),
          }
        : {}),
    };

    await layer.notes.updateNoteAttachment(attachmentId, {
      extractedText: studyText,
      metadata: finalMeta,
    });
    logger.info('Presentation preview ready', {
      noteId,
      fileName,
      wakeMs,
      convertMs,
      totalMs,
      extractionStatus,
      ocrQueued: shouldOcr,
      success: true,
    });

    // Phase B: if shape + preview PDF text are still thin, OCR the preview PDF on the worker.
    // Do not pass the PDF buffer through Redis — worker re-downloads from storage.
    if (shouldOcr) {
      void runSyncOrEnqueue(
        'notes.ocr.extract',
        {
          noteId,
          attachmentId,
          storagePath: previewStoragePath,
          fileName: fileName.replace(/\.[^.]+$/, '') + '-preview.pdf',
          sourceKind: 'preview_pdf',
          meta: finalMeta,
        },
        undefined,
        () =>
          runNoteOcrJob(layer, {
            noteId,
            attachmentId,
            storagePath: previewStoragePath,
            fileName: fileName.replace(/\.[^.]+$/, '') + '-preview.pdf',
            sourceKind: 'preview_pdf',
            meta: finalMeta,
            buffer: pdfBuffer,
          })
      ).catch((ocrErr) => {
        logger.error('Auto OCR after presentation preview failed', {
          noteId,
          error: ocrErr instanceof Error ? ocrErr.message : String(ocrErr),
        });
      });
    }
  } catch (err) {
    logger.error('Presentation preview job error', { noteId, attachmentId, err });
    await layer.notes
      .updateNoteAttachment(attachmentId, {
        metadata: {
          ...meta,
          previewProcessing: false,
          previewError: err instanceof Error ? err.message : 'Preview generation failed.',
          previewFailedAt: new Date().toISOString(),
        },
      })
      .catch(() => {});
    throw err;
  }
}
