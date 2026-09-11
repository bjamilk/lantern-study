/**
 * Notes studio — Wave B of the academic replica.
 *
 * Depth ids stay the existing Smart Notes presets so the API and credit table
 * do not fork. The labels are what the student sees on the studio toolbar.
 */
import type { SmartNotesDepth } from '../utils/smartNotes';

export const MIN_HIGHLIGHT_CHARS = 8;

export const NOTES_STUDIO_DEPTHS: readonly {
  id: SmartNotesDepth;
  label: string;
}[] = [
  { id: 'concise', label: 'Summarized' },
  { id: 'standard', label: 'In-depth' },
  { id: 'deep', label: 'Comprehensive' },
];

/** The sentence queued with a highlighted span so the tutor is shown that span. */
export function buildSpanQuestion(input: {
  question?: string;
  excerpt: string;
  noteTitle?: string;
}): string {
  const question = input.question?.trim() || 'Explain this';
  const excerpt = input.excerpt.trim();
  const where = input.noteTitle?.trim()
    ? `in "${input.noteTitle.trim()}"`
    : 'in this note';
  if (!excerpt) {
    return `${question}\n\n(I highlighted a span ${where}, but it was empty.)`;
  }
  return `${question}\n\nI highlighted this span ${where}:\n"""\n${excerpt}\n"""`;
}

/** Ask about a photo or stored page image when we only have a label + optional OCR. */
export function buildFigureQuestion(input: {
  question?: string;
  label: string;
  excerpt?: string;
}): string {
  const question = input.question?.trim() || 'What does this figure show?';
  const label = input.label.trim() || 'this figure';
  const excerpt = input.excerpt?.trim();
  if (!excerpt) {
    return `${question}\n\nThis is the figure "${label}". There is no extracted text for it.`;
  }
  return `${question}\n\nThis is the figure "${label}":\n"""\n${excerpt}\n"""`;
}

export function highlightFromRange(
  text: string,
  start: number,
  end: number
): string {
  if (end <= start) return '';
  const from = Math.max(0, start);
  const to = Math.min(text.length, end);
  return text.slice(from, to);
}

export function canAskAboutHighlight(excerpt: string): boolean {
  return excerpt.trim().length >= MIN_HIGHLIGHT_CHARS;
}
