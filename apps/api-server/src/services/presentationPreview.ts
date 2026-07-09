import type { SupabaseService } from './supabase';
import {
  assertValidOfficeZip,
  convertPresentationToPdf,
  extractPresentationTextFromBuffer,
} from './noteFiles';
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
  supabaseService: SupabaseService,
  params: PresentationPreviewJobParams
): Promise<void> {
  const { noteId, attachmentId, storagePath, fileName } = params;
  const meta = { ...params.meta };

  try {
    let buffer = params.buffer;
    if (!buffer) {
      const downloaded = await supabaseService.downloadNoteFile(storagePath);
      buffer = downloaded.buffer;
    }
    if (/\.pptx$/i.test(fileName)) {
      assertValidOfficeZip(buffer, fileName);
    }

    const extractedText =
      params.extractedText ?? (await extractPresentationTextFromBuffer(buffer, fileName));
    const studyText =
      extractedText ||
      `[Presentation uploaded: ${fileName}. Text extraction unavailable.]`;

    const { pdf: pdfBuffer, error: conversionError, wakeMs, convertMs, totalMs } =
      await convertPresentationToPdf(buffer, fileName, { noteId });

    if (!pdfBuffer) {
      await supabaseService.updateNoteAttachment(attachmentId, {
        extractedText: studyText,
        metadata: {
          ...meta,
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

    const previewStoragePath = storagePath.replace(/\.[^.]+$/, '') + '-preview.pdf';
    await supabaseService.uploadNoteFile({
      storagePath: previewStoragePath,
      buffer: pdfBuffer,
      contentType: 'application/pdf',
    });
    const previewUrl = await supabaseService.createSignedNoteFileUrl(previewStoragePath);
    await supabaseService.updateNoteAttachment(attachmentId, {
      extractedText: studyText,
      metadata: {
        ...meta,
        previewStoragePath,
        previewUrl,
        previewProcessing: false,
        previewError: undefined,
        previewFailedAt: undefined,
      },
    });
    logger.info('Presentation preview ready', {
      noteId,
      fileName,
      wakeMs,
      convertMs,
      totalMs,
      success: true,
    });
  } catch (err) {
    logger.error('Presentation preview job error', { noteId, attachmentId, err });
    await supabaseService
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
