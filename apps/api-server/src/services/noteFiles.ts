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

/** Reject path traversal and paths outside the authenticated user's folder. */
export function assertUserOwnedNoteStoragePath(storagePath: string, userId: string): void {
  if (!storagePath || typeof storagePath !== 'string') {
    throw new Error('Storage path is required.');
  }
  if (storagePath.includes('..') || storagePath.startsWith('/')) {
    throw new Error('Invalid storage path.');
  }
  const prefix = `${userId}/`;
  if (!storagePath.startsWith(prefix) || storagePath.length <= prefix.length) {
    throw new Error('Invalid storage path.');
  }
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
      parseOffice: (file: Buffer) => Promise<{ toText: () => string }>;
    };
    const parsed = await parseOffice(buffer);
    return parsed.toText().trim();
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
/** Per-attempt budget; Render HTTP proxy ~100s — leave room for download/upload/text extraction. */
const GOTENBERG_CONVERT_TIMEOUT_MS = 72_000;
const GOTENBERG_CONVERT_ATTEMPTS = 1;
const GOTENBERG_WAKE_BUDGET_MS = 45_000;
const GOTENBERG_WAKE_ATTEMPT_TIMEOUT_MS = 15_000;

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

/** Wake cold Gotenberg instances (Render free tier) before a long conversion. */
async function warmGotenbergService(gotenbergUrl: string): Promise<void> {
  const deadline = Date.now() + GOTENBERG_WAKE_BUDGET_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const response = await fetch(`${gotenbergUrl}/health`, {
        signal: AbortSignal.timeout(GOTENBERG_WAKE_ATTEMPT_TIMEOUT_MS),
      });
      if (response.ok) {
        logger.info('Gotenberg ready', { gotenbergUrl, attempt });
        return;
      }
      logger.warn('Gotenberg health not ok', { gotenbergUrl, attempt, status: response.status });
    } catch (err) {
      logger.warn('Gotenberg wake attempt failed', { gotenbergUrl, attempt, err });
    }
    await sleep(2000);
  }

  logger.warn('Gotenberg wake timed out; attempting conversion anyway', { gotenbergUrl, attempt });
}

export type PresentationPdfConversionResult = {
  pdf: Buffer | null;
  error?: string;
};

async function convertWithGotenberg(
  gotenbergUrl: string,
  buffer: Buffer,
  fileName: string
): Promise<Buffer> {
  const form = new FormData();
  form.append(
    'files',
    new Blob([new Uint8Array(buffer)], { type: presentationContentType(fileName) }),
    fileName
  );

  const response = await fetch(`${gotenbergUrl}/forms/libreoffice/convert`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(GOTENBERG_CONVERT_TIMEOUT_MS),
  });

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

function formatConversionError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Conversion failed';
}

export async function convertPresentationToPdf(
  buffer: Buffer,
  fileName: string
): Promise<PresentationPdfConversionResult> {
  let lastError: unknown;

  for (const gotenbergUrl of getGotenbergCandidates()) {
    await warmGotenbergService(gotenbergUrl);
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
        return { pdf };
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
    if (!convertFn) {
      return { pdf: null, error: formatConversionError(lastError) };
    }

    const localPdf = await new Promise<Buffer | null>((resolve) => {
      convertFn(buffer, '.pdf', undefined, (err, done) => {
        if (err) {
          logger.warn('LibreOffice PPTX conversion failed', { err });
          resolve(null);
          return;
        }
        resolve(done);
      });
    });
    if (localPdf) {
      return { pdf: localPdf };
    }
  } catch (err) {
    logger.warn('LibreOffice convert unavailable', { err });
    lastError = lastError ?? err;
  }

  return {
    pdf: null,
    error: formatConversionError(lastError) || 'Could not generate slide preview.',
  };
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
