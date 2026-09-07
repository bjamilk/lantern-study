/**
 * Reading a Quizlet or Anki export into cards — on the device, with no server
 * and no AI use.
 *
 * The parsing itself is the shared `parseDeckImport`
 * (`@lantern/shared/utils/deckFormats`): Anki's `#separator:` header, HTML
 * fields, tags columns, Quizlet's custom separators and quoted CSV all live
 * there, once, so web and mobile cannot read the same file two ways. This
 * module is the mobile presentation layer over it — the card shape the sheet
 * renders, how many rows were unusable, and what to call the deck.
 *
 * Nothing here touches the network. That is the point of the door.
 */
import { parseDeckImport as parseShared } from '@lantern/shared/utils/deckFormats';
import type { DeckImportFormat } from '@lantern/shared/utils/deckFormats';

/** The one card shape the sheet, the preview and the save all speak. */
export interface ImportedCard {
  type: 'BASIC' | 'CLOZE';
  front: string;
  back: string;
  clozeText?: string;
  tags?: string[];
}

export interface ParsedImport {
  cards: ImportedCard[];
  format: DeckImportFormat;
  /** Rows we read but could not turn into a two-sided card. */
  skipped: number;
  /** What to call the deck if the student does not rename it. */
  suggestedName: string;
}

/**
 * The server refuses more than this in one request (`MAX_CARDS_PER_DECK`,
 * apps/api-server/src/services/deckWithCards.ts). The sheet says so before the
 * save rather than after.
 */
export const MAX_IMPORT_CARDS = 500;

/** Lines that are Anki header directives rather than cards. */
const ANKI_DIRECTIVE = /^#\s*(separator|html|tags column|columns|deck column|notetype column)\s*:/i;

/** A CSV export's column-name row, which is not a card. */
const CSV_HEADER = /^\s*"?(front|question|term)"?\s*,/i;

/**
 * Content lines — what the row count is measured against, so "N skipped" is a
 * count of the student's rows rather than of the file's lines. Anki's `#`
 * directives and a CSV header are file structure, not cards.
 */
function contentLineCount(text: string, format: DeckImportFormat): number {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !ANKI_DIRECTIVE.test(line.trim()));
  if (format === 'csv' && lines[0] && CSV_HEADER.test(lines[0])) return lines.length - 1;
  return lines.length;
}

/**
 * Parse a pasted or picked export.
 *
 * @param fileName used only to name the deck, never to choose a parser: a
 *   Quizlet export saved as `.csv` is tab-separated more often than not, and
 *   the shared detector reads the content instead of trusting the extension.
 */
export function parseDeckImport(text: string, fileName?: string): ParsedImport {
  const suggestedName = suggestDeckName(fileName);
  const raw = text ?? '';
  if (!raw.trim()) {
    return { cards: [], format: 'quizlet', skipped: 0, suggestedName };
  }

  const payload = parseShared(raw, { deckName: suggestedName });
  const cards: ImportedCard[] = [];
  for (const row of payload.flashcards) {
    const clozeText = row.clozeText ?? row.cloze_text;
    const front = (row.front ?? clozeText ?? '').trim();
    const back = (row.back ?? '').trim();
    const tags = Array.isArray(row.tags) && row.tags.length ? row.tags : undefined;
    if (clozeText && clozeText.trim()) {
      cards.push({
        type: 'CLOZE',
        front: front || clozeText.trim(),
        back,
        clozeText: clozeText.trim(),
        ...(tags ? { tags } : {}),
      });
      continue;
    }
    // A row with only one side cannot be reviewed. Counted as skipped rather
    // than imported as half a card the student would meet mid-session.
    if (!front || !back) continue;
    cards.push({ type: 'BASIC', front, back, ...(tags ? { tags } : {}) });
  }

  return {
    cards,
    format: payload.format,
    skipped: Math.max(0, contentLineCount(raw, payload.format) - cards.length),
    suggestedName,
  };
}

/** A deck name from the picked file, or a plain fallback. */
export function suggestDeckName(fileName?: string | null): string {
  const base = (fileName ?? '')
    .split('/')
    .pop()
    ?.replace(/\.(txt|csv|tsv|apkg)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!base) return 'Imported cards';
  return base.slice(0, 100);
}

/** How the sheet describes what it read. */
export function describeImport(parsed: ParsedImport): string {
  if (parsed.cards.length === 0) {
    return parsed.skipped > 0
      ? `We read ${parsed.skipped} line${parsed.skipped === 1 ? '' : 's'} but found no two-sided cards. Each line needs a front and a back, separated by a tab or a comma.`
      : 'Nothing to import yet.';
  }
  const found = `${parsed.cards.length} card${parsed.cards.length === 1 ? '' : 's'} found`;
  if (parsed.skipped === 0) return found;
  return `${found} \u00b7 ${parsed.skipped} line${parsed.skipped === 1 ? '' : 's'} skipped (no back)`;
}
