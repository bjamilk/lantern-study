import FormData from 'form-data';
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

export function assertPresentationSize(buffer: Buffer): void {
  assertFileSize(buffer, MAX_PRESENTATION_BYTES, 'Presentation');
}

const PRESENTATION_EXT = /\.(pptx?|ppt)$/i;

export function assertPresentationFileName(fileName: string): void {
  if (!PRESENTATION_EXT.test(fileName)) {
    throw new Error('Presentation must be a .ppt or .pptx file.');
  }
}

export function presentationContentType(fileName: string): string {
  return /\.ppt$/i.test(fileName) && !/\.pptx$/i.test(fileName)
    ? 'application/vnd.ms-powerpoint'
    : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
}

const GOTENBERG_PUBLIC_FALLBACK = 'https://lantern-study-gotenberg.onrender.com';
/** Per-attempt budget; Render proxy ~100s — two attempts must stay under that. */
const GOTENBERG_CONVERT_TIMEOUT_MS = 85_000;
const GOTENBERG_CONVERT_ATTEMPTS = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveGotenbergBaseUrl(): string | undefined {
  const raw = process.env.GOTENBERG_URL?.trim();
  if (!raw) return undefined;
  const withoutTrailingSlash = raw.replace(/\/$/, '');
  if (/^https?:\/\//i.test(withoutTrailingSlash)) {
    return withoutTrailingSlash;
  }
  return `http://${withoutTrailingSlash}`;
}

function getGotenbergCandidates(): string[] {
  const configured = resolveGotenbergBaseUrl();
  const urls = [configured, GOTENBERG_PUBLIC_FALLBACK].filter(Boolean) as string[];
  return [...new Set(urls)];
}

async function convertWithGotenberg(
  gotenbergUrl: string,
  buffer: Buffer,
  fileName: string
): Promise<Buffer> {
  const form = new FormData();
  form.append('files', buffer, {
    filename: fileName,
    contentType: presentationContentType(fileName),
  });

  const response = await fetch(
    `${gotenbergUrl}/forms/libreoffice/convert`,
    {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
      signal: AbortSignal.timeout(GOTENBERG_CONVERT_TIMEOUT_MS),
      duplex: 'half',
    } as any
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Gotenberg conversion failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  const pdf = Buffer.from(arrayBuffer);
  if (pdf.length < 100) {
    throw new Error('Gotenberg returned an empty PDF');
  }
  return pdf;
}

export async function convertPresentationToPdf(buffer: Buffer, fileName: string): Promise<Buffer | null> {
  let lastError: unknown;

  for (const gotenbergUrl of getGotenbergCandidates()) {
    for (let attempt = 1; attempt <= GOTENBERG_CONVERT_ATTEMPTS; attempt++) {
      try {
        const pdf = await convertWithGotenberg(gotenbergUrl, buffer, fileName);
        logger.info('Presentation converted to PDF via Gotenberg', {
          gotenbergUrl,
          attempt,
          fileName,
          pptxBytes: buffer.length,
          pdfBytes: pdf.length,
        });
        return pdf;
      } catch (err) {
        lastError = err;
        logger.warn('Gotenberg PPTX conversion failed', { err, gotenbergUrl, attempt, fileName });
        if (attempt < GOTENBERG_CONVERT_ATTEMPTS) {
          await sleep(2500);
        }
      }
    }
  }

  logger.error('All Gotenberg conversion attempts failed', { lastError, fileName, bytes: buffer.length });

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

/** PPTX is ZIP-based; truncated uploads break LibreOffice conversion. Legacy .ppt is not ZIP. */
export function assertValidOfficeZip(buffer: Buffer, fileName: string): void {
  if (!/\.pptx$/i.test(fileName)) {
    return;
  }
  if (buffer.length < 4) {
    throw new Error('Uploaded file is empty or incomplete.');
  }
  const magic = buffer.readUInt32LE(0);
  // PK\x03\x04
  if (magic !== 0x04034b50) {
    throw new Error(`${fileName} is not a valid Office file.`);
  }
  const endSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  if (!buffer.includes(endSig)) {
    throw new Error(
      `${fileName} appears truncated. If the file is large, try again after the latest app update.`
    );
  }
}

export { NOTE_FILES_BUCKET, MAX_PDF_BYTES, MAX_PRESENTATION_BYTES };
