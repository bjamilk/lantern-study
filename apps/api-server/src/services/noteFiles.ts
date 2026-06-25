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
const GOTENBERG_FETCH_TIMEOUT_MS = 120_000;
const GOTENBERG_WAKE_ATTEMPTS = 3;

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
  const urls = [resolveGotenbergBaseUrl(), GOTENBERG_PUBLIC_FALLBACK].filter(Boolean) as string[];
  return [...new Set(urls)];
}

async function wakeGotenberg(gotenbergUrl: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= GOTENBERG_WAKE_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${gotenbergUrl}/health`, {
        signal: AbortSignal.timeout(GOTENBERG_FETCH_TIMEOUT_MS),
      });
      if (response.ok) return;
      lastError = new Error(`Gotenberg health check failed (${response.status})`);
    } catch (err) {
      lastError = err;
      logger.warn('Gotenberg wake attempt failed', { err, gotenbergUrl, attempt });
    }
    if (attempt < GOTENBERG_WAKE_ATTEMPTS) {
      await sleep(3000 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Gotenberg unavailable');
}

async function convertWithGotenberg(
  gotenbergUrl: string,
  buffer: Buffer,
  fileName: string
): Promise<Buffer> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], {
    type: presentationContentType(fileName),
  });
  form.append('files', blob, fileName);
  const response = await fetch(`${gotenbergUrl}/forms/libreoffice/convert`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(GOTENBERG_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Gotenberg conversion failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function convertPresentationToPdf(buffer: Buffer, fileName: string): Promise<Buffer | null> {
  for (const gotenbergUrl of getGotenbergCandidates()) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await wakeGotenberg(gotenbergUrl);
        return await convertWithGotenberg(gotenbergUrl, buffer, fileName);
      } catch (err) {
        logger.warn('Gotenberg PPTX conversion failed', { err, gotenbergUrl, attempt });
        if (attempt < 2) await sleep(2000);
      }
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

/** PPTX/PPT are ZIP-based; truncated uploads break LibreOffice conversion. */
export function assertValidOfficeZip(buffer: Buffer, fileName: string): void {
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
