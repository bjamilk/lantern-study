export type NoteStudyContentInput = {
  sourceType?: string;
  body?: string;
  summary?: string;
  attachments?: Array<{ extractedText?: string | null }>;
};

export const MIN_NOTE_STUDY_CONTENT_CHARS = 50;

const EXTRACTING_SLIDES_PLACEHOLDER = '[Extracting text from slides…]';

export function isPlaceholderExtractedText(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed === EXTRACTING_SLIDES_PLACEHOLDER) return true;
  return /^(\[Presentation uploaded: .+\. Text extraction unavailable\.\])$/.test(trimmed);
}

/** Plain text for AI study tools (summarize, quiz, flashcards). */
export function getNoteStudyContent(note: NoteStudyContentInput): string {
  const isDocumentSource =
    note.sourceType === 'pdf' || note.sourceType === 'presentation';

  const bodyText = note.body?.trim() || '';
  const extracted = (note.attachments || [])
    .map((a) => a.extractedText?.trim())
    .filter((text): text is string => Boolean(text) && !isPlaceholderExtractedText(text))
    .join('\n\n');
  const summaryText = note.summary?.trim() || '';

  if (isDocumentSource) {
    return [extracted, bodyText, summaryText].filter(Boolean).join('\n\n');
  }

  if (bodyText) return bodyText;
  if (extracted) return extracted;
  return summaryText;
}

export function hasEnoughNoteStudyContent(note: NoteStudyContentInput): boolean {
  return getNoteStudyContent(note).trim().length >= MIN_NOTE_STUDY_CONTENT_CHARS;
}
