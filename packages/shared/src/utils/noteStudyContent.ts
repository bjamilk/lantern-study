export type NoteStudyContentInput = {
  sourceType?: string;
  body?: string;
  summary?: string;
  attachments?: Array<{ extractedText?: string | null }>;
};

export const MIN_NOTE_STUDY_CONTENT_CHARS = 50;

const EXTRACTING_SLIDES_PLACEHOLDER = '[Extracting text from slides…]';
const EXTRACTING_SLIDES_PLACEHOLDER_ASCII = '[Extracting text from slides...]';

export function isPlaceholderExtractedText(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed === EXTRACTING_SLIDES_PLACEHOLDER) return true;
  if (trimmed === EXTRACTING_SLIDES_PLACEHOLDER_ASCII) return true;
  return /^(\[Presentation uploaded: .+\. Text extraction unavailable\.\])$/.test(trimmed);
}

function isDocumentSource(sourceType?: string): boolean {
  return sourceType === 'pdf' || sourceType === 'presentation' || sourceType === 'youtube';
}

/** Plain text for AI study tools (summarize, quiz, flashcards). */
export function getNoteStudyContent(note: NoteStudyContentInput): string {
  const bodyText = note.body?.trim() || '';
  const extracted = (note.attachments || [])
    .map((a) => a.extractedText?.trim())
    .filter((text): text is string => Boolean(text) && !isPlaceholderExtractedText(text))
    .join('\n\n');
  const summaryText = note.summary?.trim() || '';

  if (isDocumentSource(note.sourceType)) {
    return [extracted, bodyText, summaryText].filter(Boolean).join('\n\n');
  }

  if (bodyText) return bodyText;
  if (extracted) return extracted;
  return summaryText;
}

export function hasEnoughNoteStudyContent(note: NoteStudyContentInput): boolean {
  return getNoteStudyContent(note).trim().length >= MIN_NOTE_STUDY_CONTENT_CHARS;
}
