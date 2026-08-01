import { stripSmartNotesSection } from './smartNotes';

export type NoteStudyContentInput = {
  sourceType?: string;
  body?: string;
  summary?: string;
  attachments?: Array<{
    extractedText?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
};

export type GetNoteStudyContentOptions = {
  /** Include the note.summary field (default true). Disable when regenerating Smart Notes. */
  includeSummary?: boolean;
  /** Strip an existing Smart Notes body section before returning (default false). */
  stripSmartNotes?: boolean;
};

/** Unified minimum for Smart Notes, flashcards, quiz, and Import & Study. */
export const MIN_NOTE_STUDY_CONTENT_CHARS = 50;

/**
 * PDF scan heuristic: high page count + sparse chars/page ⇒ likely image-only scan.
 * Tuned to catch half-scanned decks (page numbers/headers) that clear tiny length checks.
 */
export const PDF_SCAN_MIN_PAGES_FOR_DENSITY = 2;
export const PDF_SCAN_MAX_CHARS_PER_PAGE = 40;
export const PDF_SCAN_EMPTY_MAX_CHARS = 20;

export type NoteExtractionStatus = 'ok' | 'needs_ocr' | 'empty' | 'ocr_processing' | 'ocr_failed';

export type PdfTextExtractionAssessment = {
  status: 'ok' | 'needs_ocr' | 'empty';
  pageCount: number;
  charCount: number;
  charsPerPage: number;
  reason?: string;
};

const EXTRACTING_SLIDES_PLACEHOLDER = '[Extracting text from slides…]';
const EXTRACTING_SLIDES_PLACEHOLDER_ASCII = '[Extracting text from slides...]';
const OCR_PROCESSING_PLACEHOLDER = '[Running OCR on scanned pages…]';
const OCR_PROCESSING_PLACEHOLDER_ASCII = '[Running OCR on scanned pages...]';

export function isPlaceholderExtractedText(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed === EXTRACTING_SLIDES_PLACEHOLDER) return true;
  if (trimmed === EXTRACTING_SLIDES_PLACEHOLDER_ASCII) return true;
  if (trimmed === OCR_PROCESSING_PLACEHOLDER) return true;
  if (trimmed === OCR_PROCESSING_PLACEHOLDER_ASCII) return true;
  if (/^\[PDF uploaded: .+\. Text extraction unavailable\.\]$/.test(trimmed)) return true;
  if (/^\[Presentation uploaded: .+\. Text extraction unavailable\.\]$/.test(trimmed)) return true;
  if (/^\[Scanned PDF: .+\]$/.test(trimmed)) return true;
  if (/^\[OCR failed: .+\]$/.test(trimmed)) return true;
  return false;
}

/**
 * Assess whether PDF text-layer extraction looks usable, empty, or like a scan needing OCR.
 */
export function assessPdfTextExtraction(
  text: string | null | undefined,
  pageCount: number
): PdfTextExtractionAssessment {
  const normalized = (text || '').trim();
  const charCount = normalized.length;
  const pages = Number.isFinite(pageCount) && pageCount > 0 ? Math.floor(pageCount) : 1;
  const charsPerPage = charCount / pages;

  if (charCount === 0 || charCount <= PDF_SCAN_EMPTY_MAX_CHARS) {
    return {
      status: 'empty',
      pageCount: pages,
      charCount,
      charsPerPage,
      reason: 'No readable text layer found.',
    };
  }

  if (pages >= PDF_SCAN_MIN_PAGES_FOR_DENSITY && charsPerPage < PDF_SCAN_MAX_CHARS_PER_PAGE) {
    return {
      status: 'needs_ocr',
      pageCount: pages,
      charCount,
      charsPerPage,
      reason: 'Sparse text for page count — likely a scanned or image-heavy PDF.',
    };
  }

  return {
    status: 'ok',
    pageCount: pages,
    charCount,
    charsPerPage,
  };
}

export function getAttachmentExtractionStatus(
  attachment?: { metadata?: Record<string, unknown> | null; extractedText?: string | null } | null
): NoteExtractionStatus | null {
  const raw = attachment?.metadata?.extractionStatus;
  if (
    raw === 'ok' ||
    raw === 'needs_ocr' ||
    raw === 'empty' ||
    raw === 'ocr_processing' ||
    raw === 'ocr_failed'
  ) {
    return raw;
  }
  if (isPlaceholderExtractedText(attachment?.extractedText)) {
    return 'empty';
  }
  return null;
}

/** User-facing copy when extraction is incomplete or OCR is required/failed. */
export function getExtractionStatusMessage(
  status: NoteExtractionStatus | null | undefined,
  sourceType?: string
): string | null {
  switch (status) {
    case 'needs_ocr':
      return sourceType === 'presentation'
        ? 'This deck looks image-based — OCR can read text from slides (first 20 slides).'
        : 'Scanned PDF — text not readable yet. OCR can extract text from the first 15 pages.';
    case 'empty':
      return sourceType === 'presentation'
        ? 'No slide text found. Try OCR, or add your own notes before using Smart Notes.'
        : 'No readable text found. Try OCR for scanned pages, or open a text-based PDF.';
    case 'ocr_processing':
      return 'Running local OCR… this can take a minute for longer documents.';
    case 'ocr_failed':
      return 'Local OCR could not read this file. Add notes manually, or try a text-based export.';
    default:
      return null;
  }
}

function isDocumentSource(sourceType?: string): boolean {
  return sourceType === 'pdf' || sourceType === 'presentation' || sourceType === 'youtube';
}

function normalizeBody(
  body: string | undefined,
  stripSmartNotes: boolean
): string {
  const raw = body?.trim() || '';
  if (!raw) return '';
  return stripSmartNotes ? stripSmartNotesSection(raw) : raw;
}

/** Plain text for AI study tools (summarize, quiz, flashcards). */
export function getNoteStudyContent(
  note: NoteStudyContentInput,
  options: GetNoteStudyContentOptions = {}
): string {
  const includeSummary = options.includeSummary !== false;
  const stripSmartNotes = options.stripSmartNotes === true;
  const bodyText = normalizeBody(note.body, stripSmartNotes);
  const extracted = (note.attachments || [])
    .map((a) => a.extractedText?.trim())
    .filter((text): text is string => Boolean(text) && !isPlaceholderExtractedText(text))
    .join('\n\n');
  const summaryText = includeSummary ? note.summary?.trim() || '' : '';

  if (isDocumentSource(note.sourceType)) {
    return [extracted, bodyText, summaryText].filter(Boolean).join('\n\n');
  }

  if (bodyText) return bodyText;
  if (extracted) return extracted;
  return summaryText;
}

/**
 * Source text for Smart Notes generation: prefer full extracted transcript/PDF text,
 * keep user annotations, exclude prior summary / Smart Notes section.
 */
export function getNoteStudyContentForSmartNotes(note: NoteStudyContentInput): string {
  return getNoteStudyContent(note, { includeSummary: false, stripSmartNotes: true });
}

export function hasEnoughNoteStudyContent(note: NoteStudyContentInput): boolean {
  return getNoteStudyContent(note).trim().length >= MIN_NOTE_STUDY_CONTENT_CHARS;
}

/** True when Smart Notes / import should not claim success (thin, placeholder, or OCR pending). */
export function isThinOrUnusableStudyContent(note: NoteStudyContentInput): boolean {
  if (!hasEnoughNoteStudyContent(note)) return true;
  const statuses = (note.attachments || [])
    .map((a) => getAttachmentExtractionStatus(a))
    .filter((s): s is NoteExtractionStatus => Boolean(s));
  if (statuses.some((s) => s === 'ocr_processing' || s === 'needs_ocr' || s === 'ocr_failed')) {
    // Allow if user/body content alone is enough and extraction is not the only source.
    const bodyOnly = getNoteStudyContent({ ...note, attachments: [] }).trim().length;
    if (bodyOnly >= MIN_NOTE_STUDY_CONTENT_CHARS) return false;
    return true;
  }
  return false;
}
