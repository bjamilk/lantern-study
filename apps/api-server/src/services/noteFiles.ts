import { logger } from '../utils/logger';

const NOTE_FILES_BUCKET = 'note-files';
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PRESENTATION_BYTES = 25 * 1024 * 1024;

export function sanitizeNoteFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function buildNoteStoragePath(userId: string, fileName: string): string {
  return `${userId}/${Date.now()}-${sanitizeNoteFileName(fileName)}`;
}

export async function extractPdfTextFromBuffer(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = require('pdf-parse') as (data: Buffer) => Promise<{ text: string }>;
    const result = await pdfParse(buffer);
    return (result.text || '').trim();
  } catch (err) {
    logger.warn('PDF text extraction failed', { err });
    return '';
  }
}

export async function extractPresentationTextFromBuffer(
  buffer: Buffer,
  fileName: string
): Promise<string> {
  try {
    const { parseOffice } = require('officeparser') as {
      parseOffice: (file: Buffer, callback: (err: Error | null, data?: string) => void) => void;
    };
    const text = await new Promise<string>((resolve, reject) => {
      parseOffice(buffer, (err: Error | null, data?: string) => {
        if (err) reject(err);
        else resolve(typeof data === 'string' ? data : '');
      });
    });
    return text.trim();
  } catch (err) {
    logger.warn('Presentation text extraction failed', { err, fileName });
    return '';
  }
}

export async function convertPresentationToPdf(buffer: Buffer, fileName: string): Promise<Buffer | null> {
  const gotenbergUrl = process.env.GOTENBERG_URL?.replace(/\/$/, '');
  if (gotenbergUrl) {
    try {
      const form = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });
      form.append('files', blob, fileName);
      const response = await fetch(`${gotenbergUrl}/forms/libreoffice/convert`, {
        method: 'POST',
        body: form,
      });
      if (!response.ok) {
        throw new Error(`Gotenberg conversion failed (${response.status})`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      logger.warn('Gotenberg PPTX conversion failed', { err });
    }
  }

  try {
    const libre = (await import('libreoffice-convert')) as {
      default?: {
        convert: (
          document: Buffer,
          format: string,
          filter: undefined,
          callback: (err: Error | null, done: Buffer) => void
        ) => void;
      };
      convert?: (
        document: Buffer,
        format: string,
        filter: undefined,
        callback: (err: Error | null, done: Buffer) => void
      ) => void;
    };
    const convertFn = libre.default?.convert || libre.convert;
    if (!convertFn) return null;

    return await new Promise<Buffer | null>((resolve) => {
      convertFn(buffer, '.pdf', undefined, (err, done) => {
        if (err) {
          logger.warn('LibreOffice PPTX conversion failed', { err });
          resolve(null);
          return;
        }
        resolve(done);
      });
    });
  } catch (err) {
    logger.warn('LibreOffice convert unavailable', { err });
    return null;
  }
}

export function assertFileSize(buffer: Buffer, maxBytes: number, label: string): void {
  if (buffer.length > maxBytes) {
    throw new Error(`${label} exceeds maximum size of ${Math.round(maxBytes / (1024 * 1024))}MB`);
  }
}

export function assertPdfSize(buffer: Buffer): void {
  assertFileSize(buffer, MAX_PDF_BYTES, 'PDF');
}

export function assertPresentationSize(buffer: Buffer): void {
  assertFileSize(buffer, MAX_PRESENTATION_BYTES, 'Presentation');
}

export { NOTE_FILES_BUCKET, MAX_PDF_BYTES, MAX_PRESENTATION_BYTES };
