import { stripSmartNotesSection } from './smartNotes';

export type NoteStudyContentInput = {
  sourceType?: string;
  body?: string;
  summary?: string;
  attachments?: Array<{ extractedText?: string | null }>;
};

export type GetNoteStudyContentOptions = {
  /** Include the note.summary field (default true). Disable when regenerating Smart Notes. */
  includeSummary?: boolean;
  /** Strip an existing Smart Notes body section before returning (default false). */
  stripSmartNotes?: boolean;
};

export const MIN_NOTE_STUDY_CONTENT_CHARS = 50;

const EXTRACTING_SLIDES_PLACEHOLDER = '[Extracting text from slides…]';
const EXTRACTING_SLIDES_PLACEHOLDER_ASCII = '[Extracting text from slides...]';

export function isPlaceholderExtractedText(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed === EXTRACTING_SLIDES_PLACEHOLDER) return true;
  if (trimmed === EXTRACTING_SLIDES_PLACEHOLDER_ASCII) return true;
  if (/^\[PDF uploaded: .+\. Text extraction unavailable\.\]$/.test(trimmed)) return true;
  return /^(\[Presentation uploaded: .+\. Text extraction unavailable\.\])$/.test(trimmed);
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
