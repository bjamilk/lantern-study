export type NoteStudyContentInput = {
  sourceType?: string;
  body?: string;
  summary?: string;
  attachments?: Array<{ extractedText?: string | null }>;
};

/** Plain text for AI study tools (summarize, quiz, flashcards). */
export function getNoteStudyContent(note: NoteStudyContentInput): string {
  const isDocumentSource =
    note.sourceType === 'pdf' || note.sourceType === 'presentation';

  const bodyText = note.body?.trim() || '';
  const extracted = (note.attachments || [])
    .map((a) => a.extractedText?.trim())
    .filter(Boolean)
    .join('\n\n');
  const summaryText = note.summary?.trim() || '';

  if (isDocumentSource) {
    return [extracted, bodyText, summaryText].filter(Boolean).join('\n\n');
  }

  if (bodyText) return bodyText;
  if (extracted) return extracted;
  return summaryText;
}
