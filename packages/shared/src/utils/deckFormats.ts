/** CSV and deck interchange helpers for Lantern Study */

import type { SrsData } from '../types';
import { createInitialFsrsData } from './fsrs';

export interface DeckImportPayload {
  deck: { name: string; description?: string };
  flashcards: Array<{
    type?: string;
    front?: string;
    back?: string;
    clozeText?: string;
    cloze_text?: string;
    imageUrl?: string;
    image_url?: string;
    tags?: string[];
  }>;
}

/** Escape a CSV field */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Parse one delimited line respecting quoted fields (delimiter is one char) */
export function parseDelimitedLine(line: string, delimiter = ','): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/** Parse one CSV line respecting quoted fields */
export function parseCsvLine(line: string): string[] {
  return parseDelimitedLine(line, ',');
}

/**
 * Split CSV text into logical records without breaking on newlines inside quoted fields.
 */
export function splitCsvRecords(csv: string): string[] {
  const text = csv.replace(/^\uFEFF/, '');
  const records: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      current += ch;
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += text[++i];
        } else {
          inQuotes = false;
        }
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      current += ch;
      continue;
    }

    if (ch === '\n') {
      const trimmed = current.replace(/\r$/, '');
      if (trimmed.trim()) records.push(trimmed);
      current = '';
      continue;
    }

    current += ch;
  }

  const last = current.replace(/\r$/, '');
  if (last.trim()) records.push(last);
  return records;
}

/** Convert Lantern export payload to CSV (front,back,tags,image_url) */
export function deckToCsv(data: DeckImportPayload): string {
  const header = 'front,back,tags,image_url';
  const rows = (data.flashcards || []).map((card) => {
    const front = card.front || card.clozeText || card.cloze_text || '';
    const back = card.back || '';
    const tags = Array.isArray(card.tags) ? card.tags.join(';') : '';
    const imageUrl = card.image_url || card.imageUrl || '';
    return [csvEscape(front), csvEscape(back), csvEscape(tags), csvEscape(imageUrl)].join(',');
  });
  return [header, ...rows].join('\n');
}

/** Parse CSV text into Lantern import payload (always one deck) */
export function csvToImportData(csv: string, deckName = 'Imported Deck'): DeckImportPayload {
  const lines = splitCsvRecords(csv);
  if (lines.length === 0) {
    return { deck: { name: deckName }, flashcards: [] };
  }

  const firstLine = lines[0]!;
  const firstFields = parseCsvLine(firstLine).map((f) => f.trim().toLowerCase());
  const hasHeader =
    firstFields.includes('front') ||
    firstFields.includes('question') ||
    firstFields.includes('term');

  const startIdx = hasHeader ? 1 : 0;
  const frontIdx = hasHeader
    ? Math.max(firstFields.indexOf('front'), firstFields.indexOf('question'), firstFields.indexOf('term'), 0)
    : 0;
  const backIdx = hasHeader
    ? Math.max(firstFields.indexOf('back'), firstFields.indexOf('answer'), firstFields.indexOf('definition'), 1)
    : 1;
  const tagsIdx = hasHeader ? firstFields.indexOf('tags') : -1;
  const imageIdx = hasHeader
    ? Math.max(firstFields.indexOf('image_url'), firstFields.indexOf('image'))
    : -1;

  const flashcards: DeckImportPayload['flashcards'] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!;
    const fields = parseCsvLine(line);
    const front = (fields[frontIdx] || '').trim();
    const back = (fields[backIdx] || '').trim();
    if (!front && !back) continue;

    const tagsRaw = tagsIdx >= 0 ? fields[tagsIdx] : '';
    const tags = tagsRaw ? tagsRaw.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [];
    const imageUrl = imageIdx >= 0 ? (fields[imageIdx] || '').trim() : '';

    const isCloze = /\{\{c\d+::/.test(front) || /\{\{c\d+::/.test(back);
    const cardBase = imageUrl ? { imageUrl } : {};
    if (isCloze) {
      flashcards.push({ type: 'CLOZE', clozeText: front || back, tags, ...cardBase });
    } else {
      flashcards.push({ type: 'BASIC', front, back, tags, ...cardBase });
    }
  }

  return { deck: { name: deckName, description: 'Imported from CSV' }, flashcards };
}

/** Strip HTML tags from Anki fields */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/* ------------------------------------------------- Anki / Quizlet import -- */

/**
 * Text-file imports students actually arrive with.
 *
 * Anki's "Notes in Plain Text (.txt)" export is tab-separated, may carry
 * `#`-prefixed metadata lines (`#separator:tab`, `#html:true`,
 * `#tags column:3`), wraps fields containing the separator in quotes, and
 * leaves note HTML (`<div>`, `<br>`, `&nbsp;`) in place. Quizlet's export lets
 * the student choose both separators, so nothing about it can be assumed.
 *
 * All of this is pure text work: the parse never touches the network, which is
 * what makes import the zero-credit door in Library → Flashcards.
 */
export type DeckImportFormat = 'csv' | 'anki-txt' | 'quizlet';

export interface DeckTextImportOptions {
  deckName?: string;
  /** Between a term and its definition. Default: tab. */
  termSeparator?: string;
  /** Between cards. Default: newline. */
  rowSeparator?: string;
  /** Strip note HTML. Default: on when the file says `#html:true`, else auto. */
  stripHtmlFields?: boolean;
}

const ANKI_SEPARATOR_WORDS: Record<string, string> = {
  tab: '\t',
  comma: ',',
  semicolon: ';',
  space: ' ',
  pipe: '|',
  colon: ':',
};

/** Metadata Anki writes above the rows; absent in older exports. */
interface AnkiHeader {
  separator: string;
  html: boolean;
  /** 1-based column indexes, when declared. */
  tagsColumn?: number;
  deckColumn?: number;
  notetypeColumn?: number;
  /** Lines consumed by the header. */
  consumed: number;
  /** True when the file declared anything at all. */
  present: boolean;
}

function parseAnkiHeader(lines: string[]): AnkiHeader {
  const header: AnkiHeader = { separator: '\t', html: false, consumed: 0, present: false };
  for (const line of lines) {
    if (!line.startsWith('#')) break;
    header.consumed += 1;
    const body = line.slice(1).trim();
    const [rawKey, ...rest] = body.split(':');
    const key = (rawKey || '').trim().toLowerCase();
    const value = rest.join(':').trim();
    if (!value) continue;
    header.present = true;
    if (key === 'separator') {
      header.separator = ANKI_SEPARATOR_WORDS[value.toLowerCase()] ?? value;
    } else if (key === 'html') {
      header.html = value.toLowerCase() === 'true';
    } else if (key === 'tags column') {
      header.tagsColumn = parseInt(value, 10) || undefined;
    } else if (key === 'deck column') {
      header.deckColumn = parseInt(value, 10) || undefined;
    } else if (key === 'notetype column') {
      header.notetypeColumn = parseInt(value, 10) || undefined;
    }
  }
  return header;
}

/** A field is HTML-ish if it carries a tag or an entity we would otherwise show raw. */
function looksLikeHtml(value: string): boolean {
  return /<[a-z/][^>]*>/i.test(value) || /&(nbsp|amp|lt|gt|quot|#\d+);/i.test(value);
}

function cleanField(value: string, strip: boolean): string {
  const raw = value ?? '';
  const out = strip || looksLikeHtml(raw) ? stripHtml(raw) : raw;
  return out.trim();
}

function splitTags(raw: string | undefined): string[] {
  if (!raw) return [];
  // Anki space-separates tags; Lantern's own CSV uses ; or |.
  return raw
    .split(/[;|,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 50);
}

const CLOZE_RE = /\{\{c\d+::/;

function toCard(
  front: string,
  back: string,
  tags: string[]
): DeckImportPayload['flashcards'][number] | null {
  if (!front && !back) return null;
  if (CLOZE_RE.test(front) || CLOZE_RE.test(back)) {
    // The side that carries the deletion is the cloze text; taking `front`
    // whenever it is non-empty would hand back a cloze card with nothing to
    // hide when the {{c1::…}} sits in the second column.
    return { type: 'CLOZE', clozeText: CLOZE_RE.test(front) ? front : back, tags };
  }
  // A one-column row is not a reviewable card: both sides are required by the
  // deck constraint, so it is dropped here rather than rejected by the server
  // after the student already waited for a save.
  if (!front || !back) return null;
  return { type: 'BASIC', front, back, tags };
}

/**
 * Parse an Anki plain-text export (200+ rows, optional header, optional HTML,
 * optional tags column). Pure and offline.
 */
export function ankiTxtToImportData(
  text: string,
  options: DeckTextImportOptions = {}
): DeckImportPayload {
  const deckName = options.deckName || 'Imported Deck';
  const clean = (text || '').replace(/^\uFEFF/, '');
  const allLines = clean.split(/\r?\n/);
  const header = parseAnkiHeader(allLines);
  const separator = options.termSeparator ?? header.separator;
  const stripFields = options.stripHtmlFields ?? header.html;

  // Re-split on records so a quoted field containing a newline stays one card.
  const body = allLines.slice(header.consumed).join('\n');
  const records = splitCsvRecords(body).filter((line) => !line.startsWith('#'));

  const skipColumns = new Set(
    [header.deckColumn, header.notetypeColumn].filter((n): n is number => !!n).map((n) => n - 1)
  );
  const tagsIdx = header.tagsColumn ? header.tagsColumn - 1 : -1;

  const flashcards: DeckImportPayload['flashcards'] = [];
  for (const record of records) {
    const fields = (
      separator.length === 1 ? parseDelimitedLine(record, separator) : record.split(separator)
    ).map((f) => f ?? '');

    const contentIdx: number[] = [];
    for (let i = 0; i < fields.length; i++) {
      if (i === tagsIdx || skipColumns.has(i)) continue;
      contentIdx.push(i);
    }

    const front = cleanField(fields[contentIdx[0] ?? 0] ?? '', stripFields);
    const back = cleanField(fields[contentIdx[1] ?? 1] ?? '', stripFields);
    // No declared tags column: a trailing column that is not front/back is
    // Anki's default tags field.
    const tagsRaw =
      tagsIdx >= 0
        ? fields[tagsIdx]
        : contentIdx.length > 2
          ? fields[contentIdx[contentIdx.length - 1]!]
          : undefined;
    const tags = splitTags(tagsRaw ? cleanField(tagsRaw, stripFields) : undefined);

    const card = toCard(front, back, tags);
    if (card) flashcards.push(card);
  }

  return {
    deck: { name: deckName, description: 'Imported from Anki' },
    flashcards,
  };
}

/**
 * Parse a Quizlet export with the separators the student chose in Quizlet's
 * export dialog (term/definition, then between cards).
 */
export function quizletToImportData(
  text: string,
  options: DeckTextImportOptions = {}
): DeckImportPayload {
  const deckName = options.deckName || 'Imported Deck';
  const termSeparator = options.termSeparator || '\t';
  const rowSeparator = options.rowSeparator || '\n';
  const clean = (text || '').replace(/^\uFEFF/, '');
  const rows =
    rowSeparator === '\n' ? clean.split(/\r?\n/) : clean.split(rowSeparator).map((r) => r.trim());

  const flashcards: DeckImportPayload['flashcards'] = [];
  for (const row of rows) {
    const line = row.replace(/\r$/, '').trim();
    if (!line) continue;
    const at = line.indexOf(termSeparator);
    // Split at the FIRST separator only: a definition may legitimately contain
    // the same character, and Quizlet itself keeps the remainder as one field.
    const front = cleanField(at >= 0 ? line.slice(0, at) : line, options.stripHtmlFields ?? false);
    const back = cleanField(
      at >= 0 ? line.slice(at + termSeparator.length) : '',
      options.stripHtmlFields ?? false
    );
    const card = toCard(front, back, []);
    if (card) flashcards.push(card);
  }

  return {
    deck: { name: deckName, description: 'Imported from Quizlet' },
    flashcards,
  };
}

/**
 * Guess which of the three text formats a pasted or picked file is.
 * Anki metadata wins outright; otherwise a tab in the first content line means
 * a tab-separated export, and a comma-quoted line means CSV.
 */
export function detectDeckImportFormat(text: string): DeckImportFormat {
  const clean = (text || '').replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.some((l) => /^#(separator|html|tags column|deck column|notetype column):/i.test(l.trim()))) {
    return 'anki-txt';
  }
  const first = lines[0] ?? '';
  if (first.includes('\t')) return 'anki-txt';
  if (first.includes(',')) return 'csv';
  return 'quizlet';
}

/**
 * One door for every text import: detect the format, parse it, hand back the
 * same payload shape `POST /decks/with-cards` already consumes.
 */
export function parseDeckImport(
  text: string,
  options: DeckTextImportOptions & { format?: DeckImportFormat } = {}
): DeckImportPayload & { format: DeckImportFormat } {
  const format = options.format ?? detectDeckImportFormat(text);
  const deckName = options.deckName || 'Imported Deck';
  const payload =
    format === 'csv'
      ? csvToImportData(text, deckName)
      : format === 'quizlet'
        ? quizletToImportData(text, options)
        : ankiTxtToImportData(text, options);
  return { ...payload, format };
}

/* ------------------------------------------------------- FSRS seeding -- */

/**
 * Give every imported card the FSRS starting state.
 *
 * Imported cards have no review history, so they enter as new cards: seeded
 * stability and difficulty, no scheduled date. That is what makes the first
 * review schedule like any other new card (Again 1d / Hard 1d / Good 3d /
 * Easy 5d) instead of being treated as an already-reviewed card that happens
 * to be overdue — and it keeps a 200-card import flowing through the daily
 * new-card budget rather than landing as 200 due cards in one session.
 */
export function importedCardsToFsrs<T extends object>(
  cards: T[]
): Array<T & { srsData: SrsData }> {
  return (cards || []).map((card) => ({ ...card, srsData: createInitialFsrsData() }));
}
