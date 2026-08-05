import {
  assessPdfTextExtraction,
  isPlaceholderExtractedText,
  MIN_NOTE_STUDY_CONTENT_CHARS,
  type NoteExtractionStatus,
  type PdfTextExtractionAssessment,
} from '@lantern/shared/utils/noteStudyContent';
import { logger } from '../utils/logger';
import { assertImageMagicBytes, assertPdfMagicBytes } from '../utils/fileValidation';

const NOTE_FILES_BUCKET = 'note-files';
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PRESENTATION_BYTES = 25 * 1024 * 1024;

/** Hard caps for local Tesseract OCR (memory / latency on Render). */
export const MAX_OCR_PDF_PAGES = Math.max(
  1,
  parseInt(process.env.NOTE_OCR_MAX_PDF_PAGES || '15', 10) || 15
);
export const MAX_OCR_SLIDES = Math.max(
  1,
  parseInt(process.env.NOTE_OCR_MAX_SLIDES || '20', 10) || 20
);
/** Soft timeout for sync officeparser OCR during upload/finalize. */
export const PRESENTATION_OCR_TIMEOUT_MS = Math.max(
  5_000,
  parseInt(process.env.NOTE_PRESENTATION_OCR_TIMEOUT_MS || '45000', 10) || 45_000
);
export const PDF_OCR_TIMEOUT_MS = Math.max(
  10_000,
  parseInt(process.env.NOTE_PDF_OCR_TIMEOUT_MS || '120000', 10) || 120_000
);
/**
 * Raster scale for PDF page OCR (1.0 = 72 DPI). Tesseract degrades badly on
 * small type below ~144 DPI: measured against a scanned copy of a dense study
 * guide, scale 1.5 recovered 15% of the real words and scale 2.0 recovered 98%.
 * Higher still buys little (3.0 = 98.5%, 4.0 = 99.0%) for roughly double the
 * time and canvas memory per page, so 2.0 is the knee of the curve.
 */
export const PDF_OCR_SCALE = Math.min(
  4,
  Math.max(1, parseFloat(process.env.NOTE_OCR_PDF_SCALE || '2') || 2)
);

export function sanitizeNoteFileName(name: string): string {
  const base = String(name || 'file').replace(/^.*[\\/]/, '');
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    // Collapse ".." so path-traversal checks don't reject normal names like "Lecture 1..pdf"
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 180);
  return cleaned || 'file';
}

export function buildNoteStoragePath(userId: string, fileName: string): string {
  return `${userId}/${Date.now()}-${sanitizeNoteFileName(fileName)}`;
}

/**
 * Reject path traversal and paths outside the authenticated user's folder.
 * Only treats `..` / `.` as dangerous when they are full path segments — filenames
 * may contain consecutive dots (e.g. "notes..final.pdf") without being traversal.
 */
export function assertUserOwnedNoteStoragePath(storagePath: string, userId: string): void {
  if (!storagePath || typeof storagePath !== 'string') {
    throw new Error('Storage path is required.');
  }
  if (storagePath.includes('\\') || storagePath.startsWith('/')) {
    throw new Error('Invalid storage path.');
  }
  const parts = storagePath.split('/').filter((part) => part.length > 0);
  if (parts.length < 2) {
    throw new Error('Invalid storage path.');
  }
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('Invalid storage path.');
  }
  if (parts[0] !== userId) {
    throw new Error('Invalid storage path.');
  }
}

export type PdfTextExtractionResult = {
  text: string;
  pageCount: number;
  assessment: PdfTextExtractionAssessment;
};

export type PresentationTextExtractionResult = {
  text: string;
  slideCount?: number;
  usedOcr: boolean;
  timedOut: boolean;
};

function isThinStudyText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || isPlaceholderExtractedText(trimmed)) return true;
  return trimmed.length < MIN_NOTE_STUDY_CONTENT_CHARS;
}

export async function extractPdfTextDetailsFromBuffer(
  buffer: Buffer
): Promise<PdfTextExtractionResult> {
  try {
    const pdfParse = require('pdf-parse') as (
      data: Buffer
    ) => Promise<{ text: string; numpages: number }>;
    const result = await pdfParse(buffer);
    const text = (result.text || '').trim();
    const pageCount =
      typeof result.numpages === 'number' && result.numpages > 0 ? result.numpages : 1;
    return {
      text,
      pageCount,
      assessment: assessPdfTextExtraction(text, pageCount),
    };
  } catch (err) {
    logger.warn('PDF text extraction failed', { err });
    return {
      text: '',
      pageCount: 1,
      assessment: assessPdfTextExtraction('', 1),
    };
  }
}

export async function extractPdfTextFromBuffer(buffer: Buffer): Promise<string> {
  const { text } = await extractPdfTextDetailsFromBuffer(buffer);
  return text;
}

async function astToPlainText(ast: {
  toText?: () => string;
  to?: (format: string) => Promise<{ value: string | Uint8Array }>;
}): Promise<string> {
  if (typeof ast.to === 'function') {
    try {
      const converted = await ast.to('text');
      if (typeof converted.value === 'string') {
        return converted.value.trim();
      }
    } catch {
      // fall through to deprecated toText()
    }
  }
  if (typeof ast.toText === 'function') {
    return (ast.toText() || '').trim();
  }
  return '';
}

async function parsePresentationWithoutOcr(
  buffer: Buffer
): Promise<{ text: string; slideCount?: number }> {
  const { parseOffice } = require('officeparser') as typeof import('officeparser');
  const parsed = await parseOffice(buffer, {
    extractAttachments: false,
    ocr: false,
  });
  const text = await astToPlainText(parsed);
  const slideCount =
    typeof parsed.metadata?.slides === 'number'
      ? parsed.metadata.slides
      : typeof parsed.metadata?.pages === 'number'
        ? parsed.metadata.pages
        : undefined;
  return { text, slideCount };
}

/**
 * Extract PPT/PPTX text. OCR is opt-in and never blocks the non-OCR open path.
 * Soft-caps runtime with AbortSignal; failures always fall back to shape text.
 */
export async function extractPresentationTextFromBuffer(
  buffer: Buffer,
  fileName: string,
  options?: { enableOcr?: boolean; timeoutMs?: number }
): Promise<string> {
  const details = await extractPresentationTextDetailsFromBuffer(buffer, fileName, options);
  return details.text;
}

export async function extractPresentationTextDetailsFromBuffer(
  buffer: Buffer,
  fileName: string,
  options?: { enableOcr?: boolean; timeoutMs?: number }
): Promise<PresentationTextExtractionResult> {
  // Default OFF: sync upload/finalize must stay fast and must not depend on Tesseract.
  const enableOcr = options?.enableOcr === true;
  const timeoutMs = options?.timeoutMs ?? PRESENTATION_OCR_TIMEOUT_MS;

  if (!enableOcr) {
    try {
      const parsed = await parsePresentationWithoutOcr(buffer);
      return { text: parsed.text, slideCount: parsed.slideCount, usedOcr: false, timedOut: false };
    } catch (err) {
      logger.warn('Presentation text extraction failed', {
        fileName,
        error: err instanceof Error ? err.message : String(err),
      });
      return { text: '', usedOcr: false, timedOut: false };
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { parseOffice } = require('officeparser') as typeof import('officeparser');
    const parsed = await parseOffice(buffer, {
      extractAttachments: true,
      ocr: true,
      ocrConfig: {
        language: 'eng',
        timeout: {
          workerLoad: 30_000,
          recognition: 15_000,
          autoTerminate: 10_000,
        },
      },
      abortSignal: controller.signal,
    });
    const text = await astToPlainText(parsed);
    const slideCount =
      typeof parsed.metadata?.slides === 'number'
        ? parsed.metadata.slides
        : typeof parsed.metadata?.pages === 'number'
          ? parsed.metadata.pages
          : undefined;
    return { text, slideCount, usedOcr: true, timedOut: false };
  } catch (err) {
    const aborted =
      err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message));
    logger.warn(
      aborted
        ? 'Presentation OCR timed out; falling back to shape text'
        : 'Presentation OCR failed; falling back to shape text',
      {
        fileName,
        timeoutMs,
        error: err instanceof Error ? err.message : String(err),
      }
    );
    try {
      const parsed = await parsePresentationWithoutOcr(buffer);
      return {
        text: parsed.text,
        slideCount: parsed.slideCount,
        usedOcr: false,
        timedOut: aborted,
      };
    } catch (fallbackErr) {
      logger.warn('Presentation text extraction failed after OCR fallback', {
        fileName,
        error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
      });
      return { text: '', usedOcr: false, timedOut: aborted };
    }
  } finally {
    clearTimeout(timer);
  }
}

export function buildPdfStudyText(
  fileName: string,
  extraction: PdfTextExtractionResult
): { studyText: string; extractionStatus: NoteExtractionStatus } {
  const { text, assessment } = extraction;
  if (assessment.status === 'ok' && text) {
    return { studyText: text, extractionStatus: 'ok' };
  }
  if (assessment.status === 'needs_ocr') {
    return {
      studyText: text || `[Scanned PDF: ${fileName}]`,
      extractionStatus: 'needs_ocr',
    };
  }
  return {
    studyText: text || `[PDF uploaded: ${fileName}. Text extraction unavailable.]`,
    extractionStatus: 'empty',
  };
}

export function buildPresentationStudyText(
  fileName: string,
  text: string
): { studyText: string; extractionStatus: NoteExtractionStatus } {
  if (text && !isThinStudyText(text)) {
    return { studyText: text, extractionStatus: 'ok' };
  }
  if (text && text.trim().length > 0 && !isPlaceholderExtractedText(text)) {
    return { studyText: text, extractionStatus: 'needs_ocr' };
  }
  return {
    studyText: `[Presentation uploaded: ${fileName}. Text extraction unavailable.]`,
    extractionStatus: text ? 'needs_ocr' : 'empty',
  };
}

export function mergeExtractionTexts(primary: string, fallback: string): string {
  const a = (primary || '').trim();
  const b = (fallback || '').trim();
  if (!a || isPlaceholderExtractedText(a)) return b || a;
  if (!b || isPlaceholderExtractedText(b)) return a;
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;
  if (b.length > a.length * 1.25) return b;
  return `${a}\n\n${b}`;
}

export function isThinExtractedStudyText(text: string | null | undefined): boolean {
  return isThinStudyText(text || '');
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
/** Background jobs are not limited by Render HTTP proxy (~100s). */
const GOTENBERG_CONVERT_TIMEOUT_MS = 90_000;
const GOTENBERG_CONVERT_ATTEMPTS = 2;
const GOTENBERG_WAKE_BUDGET_MS = 45_000;
const GOTENBERG_WAKE_ATTEMPT_TIMEOUT_MS = 6_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Allow the public Render fallback only when explicitly opted in for non-production.
 * Production must configure GOTENBERG_URL — never send private uploads to a shared host.
 */
function allowPublicGotenbergFallback(): boolean {
  if (isProductionRuntime()) return false;
  return process.env.ALLOW_PUBLIC_GOTENBERG_FALLBACK === 'true';
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
  if (configured) {
    return [configured];
  }
  if (allowPublicGotenbergFallback()) {
    logger.warn('Using public Gotenberg fallback (non-production only)', {
      url: GOTENBERG_PUBLIC_FALLBACK,
    });
    return [GOTENBERG_PUBLIC_FALLBACK];
  }
  return [];
}

/** Wake cold Gotenberg instances (Render free tier) before conversion. Returns time spent waking. */
async function warmGotenbergService(gotenbergUrl: string): Promise<number> {
  const wakeStartedAt = Date.now();
  const deadline = wakeStartedAt + GOTENBERG_WAKE_BUDGET_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const response = await fetch(`${gotenbergUrl}/health`, {
        signal: AbortSignal.timeout(GOTENBERG_WAKE_ATTEMPT_TIMEOUT_MS),
      });
      if (response.ok) {
        const wakeMs = Date.now() - wakeStartedAt;
        logger.info('Gotenberg ready', { gotenbergUrl, attempt, wakeMs });
        return wakeMs;
      }
      logger.warn('Gotenberg health not ok', { gotenbergUrl, attempt, status: response.status });
    } catch (err) {
      logger.warn('Gotenberg wake attempt failed', { gotenbergUrl, attempt, err });
    }
    await sleep(2000);
  }

  const wakeMs = Date.now() - wakeStartedAt;
  logger.warn('Gotenberg wake timed out; attempting conversion anyway', { gotenbergUrl, attempt, wakeMs });
  return wakeMs;
}

/** Fire-and-forget wake of Gotenberg (overlaps with client upload / finalize). */
export function warmGotenberg(): void {
  for (const gotenbergUrl of getGotenbergCandidates()) {
    void warmGotenbergService(gotenbergUrl).catch((err) => {
      logger.warn('Gotenberg background warm failed', { gotenbergUrl, err });
    });
  }
}

export type PresentationPdfConversionResult = {
  pdf: Buffer | null;
  error?: string;
  wakeMs?: number;
  convertMs?: number;
  totalMs?: number;
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
  fileName: string,
  context?: { noteId?: string }
): Promise<PresentationPdfConversionResult> {
  const totalStartedAt = Date.now();
  let lastError: unknown;
  let wakeMs = 0;
  let convertMs = 0;

  const candidates = getGotenbergCandidates();
  if (candidates.length === 0) {
    const message = isProductionRuntime()
      ? 'Presentation conversion is not configured (set GOTENBERG_URL)'
      : 'Presentation conversion is not configured (set GOTENBERG_URL or ALLOW_PUBLIC_GOTENBERG_FALLBACK=true for local/dev)';
    logger.error('Gotenberg not configured; refusing to convert presentation', {
      noteId: context?.noteId,
      fileName,
      production: isProductionRuntime(),
    });
    return { pdf: null, error: message, totalMs: Date.now() - totalStartedAt };
  }

  for (const gotenbergUrl of candidates) {
    wakeMs = await warmGotenbergService(gotenbergUrl);
    for (let attempt = 1; attempt <= GOTENBERG_CONVERT_ATTEMPTS; attempt++) {
      const convertStartedAt = Date.now();
      try {
        const pdf = await convertWithGotenberg(gotenbergUrl, buffer, fileName);
        convertMs = Date.now() - convertStartedAt;
        const totalMs = Date.now() - totalStartedAt;
        logger.info('Presentation converted to PDF via Gotenberg', {
          noteId: context?.noteId,
          gotenbergUrl,
          attempt,
          fileName,
          pptxBytes: buffer.length,
          pdfBytes: pdf.length,
          wakeMs,
          convertMs,
          totalMs,
          success: true,
        });
        return { pdf, wakeMs, convertMs, totalMs };
      } catch (err) {
        convertMs = Date.now() - convertStartedAt;
        lastError = err;
        logger.warn('Gotenberg PPTX conversion failed', {
          noteId: context?.noteId,
          err,
          gotenbergUrl,
          attempt,
          fileName,
          wakeMs,
          convertMs,
        });
        if (attempt < GOTENBERG_CONVERT_ATTEMPTS) {
          await sleep(2500);
        }
      }
    }
  }

  const totalMs = Date.now() - totalStartedAt;
  logger.error('All Gotenberg conversion attempts failed', {
    noteId: context?.noteId,
    lastError,
    fileName,
    bytes: buffer.length,
    wakeMs,
    convertMs,
    totalMs,
    success: false,
  });

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
      return { pdf: null, error: formatConversionError(lastError), wakeMs, convertMs, totalMs };
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
      return { pdf: localPdf, wakeMs, convertMs, totalMs: Date.now() - totalStartedAt };
    }
  } catch (err) {
    logger.warn('LibreOffice convert unavailable', { err });
    lastError = lastError ?? err;
  }

  return {
    pdf: null,
    error: formatConversionError(lastError) || 'Could not generate slide preview.',
    wakeMs,
    convertMs,
    totalMs: Date.now() - totalStartedAt,
  };
}

export function assertFileSize(buffer: Buffer, maxBytes: number, label: string): void {
  if (buffer.length > maxBytes) {
    throw new Error(`${label} exceeds maximum size of ${Math.round(maxBytes / (1024 * 1024))}MB`);
  }
}

export function assertPdfSize(buffer: Buffer): void {
  assertFileSize(buffer, MAX_PDF_BYTES, 'PDF');
  assertPdfMagicBytes(buffer);
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

export function imageContentTypeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/jpeg';
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export function assertNoteImageUpload(buffer: Buffer, contentType: string): void {
  const normalized = contentType.toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(normalized)) {
    throw new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('File is too large. Maximum size is 10 MB.');
  }
  assertImageMagicBytes(buffer, normalized);
}

export { NOTE_FILES_BUCKET, MAX_PDF_BYTES, MAX_PRESENTATION_BYTES };
