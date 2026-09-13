import { splitLectureNoteBody, preferLectureTranscript } from '../learning/lectureStudio';
import {
  SMART_NOTE_SOURCE_LABELS,
  parseSmartNoteSources,
  stripSmartNotesSection,
  type SmartNoteSourceId,
} from './smartNotes';

export type NoteStudyContentInput = {
  sourceType?: string;
  body?: string;
  summary?: string;
  /** Archived notes are excluded from quiz sourcing — see isQuizzableNote. */
  isArchived?: boolean;
  attachments?: Array<{
    type?: string | null;
    extractedText?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
};

export type SmartNoteSourceOption = {
  id: SmartNoteSourceId;
  label: string;
  text: string;
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
  const isPhotos = sourceType === 'photos';
  switch (status) {
    case 'needs_ocr':
      if (isPhotos) {
        return 'Text has not been read from these photos yet — OCR can pull it out (first 10 photos).';
      }
      return sourceType === 'presentation'
        ? 'This deck looks image-based — OCR can read text from slides (first 20 slides).'
        : 'Scanned PDF — text not readable yet. OCR can extract text from the first 15 pages.';
    case 'empty':
      if (isPhotos) {
        return 'No text found in these photos. Try OCR again, or type your own notes.';
      }
      return sourceType === 'presentation'
        ? 'No slide text found. Try OCR, or add your own notes before using Smart Notes.'
        : 'No readable text found. Try OCR for scanned pages, or open a text-based PDF.';
    case 'ocr_processing':
      return isPhotos
        ? 'Reading text from your photos…'
        : 'Running local OCR… this can take a minute for longer documents.';
    case 'ocr_failed':
      return isPhotos
        ? 'Could not read text from these photos. Try clearer, well-lit shots, or type your notes.'
        : 'Local OCR could not read this file. Add notes manually, or try a text-based export.';
    default:
      return null;
  }
}

function isDocumentSource(sourceType?: string): boolean {
  return (
    sourceType === 'pdf' ||
    sourceType === 'presentation' ||
    sourceType === 'youtube' ||
    // Photo notes carry OCR'd text on their image attachments. Without this the
    // extracted text is only used when the body is empty, so typing a single
    // line of your own would hide everything OCR read off the photographs.
    sourceType === 'photos'
  );
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

/** True for notes whose extracted text comes from photographs. */
export function isPhotoNoteSource(sourceType?: string): boolean {
  return sourceType === 'photos';
}

/**
 * A photo note has one attachment per photograph, so its OCR state is the state
 * of several jobs at once. Collapse them the way a reader would: still working
 * if any is, otherwise worth retrying if any failed or was never attempted, and
 * ready only once something was actually read.
 */
export function aggregatePhotoOcrStatus(
  attachments: Array<{
    type?: string;
    metadata?: Record<string, unknown> | null;
    extractedText?: string | null;
  }> | undefined | null
): NoteExtractionStatus | null {
  const images = (attachments || []).filter((a) => a.type === 'image');
  if (images.length === 0) return null;

  const statuses = images.map((a) => getAttachmentExtractionStatus(a));
  if (statuses.some((s) => s === 'ocr_processing')) return 'ocr_processing';
  if (statuses.some((s) => s === 'ocr_failed')) return 'ocr_failed';
  // A null status means that photograph has never been through OCR. Treat it
  // like needs_ocr: one unread photo in a set must not read as "ready", or the
  // note silently claims to contain text it never captured.
  if (statuses.some((s) => s === null || s === 'needs_ocr' || s === 'empty')) return 'needs_ocr';
  return 'ok';
}

function usableExtractedText(text: string | null | undefined): string {
  const trimmed = text?.trim() || '';
  if (!trimmed || isPlaceholderExtractedText(trimmed)) return '';
  return trimmed;
}

function extractedByTypes(note: NoteStudyContentInput, types: readonly string[]): string {
  return (note.attachments || [])
    .filter((attachment) => types.includes(String(attachment.type ?? '')))
    .map((attachment) => usableExtractedText(attachment.extractedText))
    .filter(Boolean)
    .join('\n\n');
}

function typedSourceText(note: NoteStudyContentInput): string {
  return splitLectureNoteBody(stripSmartNotesSection(note.body || '')).typed.trim();
}

function transcriptSourceText(note: NoteStudyContentInput): string {
  const fromBody = splitLectureNoteBody(stripSmartNotesSection(note.body || '')).transcript.trim();
  const fromAudio = (note.attachments || [])
    .filter((attachment) => !attachment.type || attachment.type === 'audio')
    .map((attachment) => usableExtractedText(attachment.extractedText))
    .filter(Boolean)
    .join('\n\n');
  return preferLectureTranscript(fromBody, fromAudio);
}

function documentSourceText(note: NoteStudyContentInput): string {
  return extractedByTypes(note, ['pdf', 'presentation']);
}

function youtubeSourceText(note: NoteStudyContentInput): string {
  const fromAttachment = extractedByTypes(note, ['youtube']);
  if (fromAttachment) return fromAttachment;
  if (note.sourceType === 'youtube') {
    return (note.attachments || [])
      .map((attachment) => usableExtractedText(attachment.extractedText))
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

function photosSourceText(note: NoteStudyContentInput): string {
  return extractedByTypes(note, ['image']);
}

const SOURCE_TEXT: Record<SmartNoteSourceId, (note: NoteStudyContentInput) => string> = {
  typed: typedSourceText,
  transcript: transcriptSourceText,
  document: documentSourceText,
  youtube: youtubeSourceText,
  photos: photosSourceText,
};

/** Sources that currently have readable text a student can turn on or off. */
export function listSmartNoteSources(note: NoteStudyContentInput): SmartNoteSourceOption[] {
  return (['typed', 'transcript', 'document', 'youtube', 'photos'] as const)
    .map((id) => {
      const text = SOURCE_TEXT[id](note);
      return { id, label: SMART_NOTE_SOURCE_LABELS[id], text };
    })
    .filter((source) => source.text.length > 0);
}

/** Join only the selected materials. Empty selection is an empty string. */
export function getNoteStudyContentForSources(
  note: NoteStudyContentInput,
  sources: readonly SmartNoteSourceId[] | undefined
): string {
  const parsed = parseSmartNoteSources(sources);
  if (parsed === undefined) {
    return getNoteStudyContent(note, { includeSummary: false, stripSmartNotes: true });
  }
  return parsed
    .map((id) => SOURCE_TEXT[id](note))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Source text for Smart Notes generation: prefer full extracted transcript/PDF text,
 * keep user annotations, exclude prior summary / Smart Notes section.
 * When `sources` is set, only those materials are included.
 */
export function getNoteStudyContentForSmartNotes(
  note: NoteStudyContentInput,
  sources?: readonly SmartNoteSourceId[]
): string {
  return getNoteStudyContentForSources(note, sources);
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

/**
 * Whether a note may be offered as a source for the daily quiz.
 *
 * Archiving a note is how a student says "I am done with this" — it is the
 * closest thing the app has to deleting it without losing it. Quizzing someone
 * on last semester's archived material is the opposite of what they asked for,
 * so archived notes are excluded here rather than at each call site.
 *
 * Shared because web and mobile were each deciding this independently and had
 * already drifted: web measured `getNoteStudyContent`, mobile measured
 * `body.length || summary.length`, so a PDF whose text lives in an attachment
 * counted on one client and not the other. One predicate, one answer.
 *
 * This governs the daily-quiz PICKER only. Generating questions from a note you
 * deliberately opened stays available whatever its archive state.
 */
export function isQuizzableNote(note: NoteStudyContentInput): boolean {
  if (note.isArchived) return false;
  return getNoteStudyContent(note).trim().length >= MIN_NOTE_STUDY_CONTENT_CHARS;
}
