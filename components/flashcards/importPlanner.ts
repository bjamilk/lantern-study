/**
 * Turning an exported deck into saveable cards, on this machine, for free.
 *
 * The parsing is the shared one — `parseDeckImport` in
 * packages/shared/src/utils/deckFormats.ts — so an Anki or Quizlet file that
 * imports on the phone imports here, with the same header handling, the same
 * cloze detection and the same tag splitting. Nothing in this path touches the
 * network until the student presses Save: no upload, no AI call, no AI use
 * spent. That is what makes Import the zero-credit door in Library →
 * Flashcards.
 *
 * What web adds is the rest of the journey: a deck name from the file they
 * picked, repeats dropped, the FSRS starting state every imported card gets,
 * and the split into save requests the server will accept.
 */
import {
  detectDeckImportFormat,
  importedCardsToFsrs,
  parseDeckImport,
  type DeckImportFormat,
  type DeckImportPayload,
  type DeckTextImportOptions,
} from '@lantern/shared/utils/deckFormats';
import type { SrsData } from '@lantern/shared/types';

export type { DeckImportFormat };

export interface ImportedCard {
  type: 'BASIC' | 'CLOZE';
  front: string;
  back: string;
  clozeText?: string;
  tags: string[];
  /**
   * The state the card starts life in: FSRS seeds, never scheduled. Comes from
   * the shared `importedCardsToFsrs`, so an imported card is a NEW card — it
   * enters study through the daily new-card budget and its first answer
   * schedules Again 1d / Hard 1d / Good 3d / Easy 5d, exactly like a card the
   * student typed. Held locally: `POST /decks/with-cards` takes no SRS field
   * and the server stores new cards with none either.
   */
  srsData: SrsData;
}

export interface ImportPlan {
  format: DeckImportFormat | 'json' | 'empty' | 'unreadable';
  deckName: string;
  cards: ImportedCard[];
  /** Rows with nothing on one side; the shared parser drops them. */
  skipped: number;
  /** Rows dropped because that exact card had already been read. */
  duplicates: number;
  /** Plain sentences for the student. Never a stack trace. */
  warnings: string[];
  /**
   * The save requests this import becomes — one deck each. The server refuses
   * more than 500 cards in one write (MAX_CARDS_PER_DECK), and a silently
   * truncated import is worse than a second deck.
   */
  batches: ImportedCard[][];
}

/** Cards per save request. Half the server's ceiling, so long fields still fit. */
export const MAX_CARDS_PER_REQUEST = 200;

/** Files the picker accepts; everything is read as text. */
export const IMPORT_FILE_ACCEPT = '.txt,.csv,.tsv,.json,text/plain,text/csv,application/json';

/** Largest file we will read into the browser. */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

/** A deck name from the file the student picked, without its extension. */
export function deckNameFromFileName(fileName: string | undefined): string | null {
  if (!fileName) return null;
  const base = fileName
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return base ? base.slice(0, 80) : null;
}

/** Split the cards into the save requests they will become. */
export function planBatches(cards: ImportedCard[], size = MAX_CARDS_PER_REQUEST): ImportedCard[][] {
  if (cards.length === 0) return [];
  const batches: ImportedCard[][] = [];
  for (let i = 0; i < cards.length; i += size) batches.push(cards.slice(i, i + size));
  return batches;
}

/** The deck name for one batch, when an import needs more than one deck. */
export function batchDeckName(deckName: string, index: number, total: number): string {
  return (total <= 1 ? deckName : `${deckName} (${index + 1} of ${total})`).slice(0, 80);
}

function toCards(payload: DeckImportPayload): { cards: ImportedCard[]; duplicates: number } {
  const seen = new Set<string>();
  const kept: Array<Omit<ImportedCard, 'srsData'>> = [];
  let duplicates = 0;

  for (const raw of payload.flashcards) {
    const clozeText = (raw.clozeText || raw.cloze_text || '').trim();
    const isCloze = raw.type === 'CLOZE' || Boolean(clozeText);
    const front = (raw.front || clozeText).trim();
    const back = (raw.back || '').trim();
    const key = `${isCloze ? 'c' : 'b'}|${front}|${back}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    kept.push({
      type: isCloze ? 'CLOZE' : 'BASIC',
      front,
      back,
      ...(isCloze ? { clozeText: clozeText || front } : {}),
      tags: (raw.tags || []).map((t) => t.trim()).filter(Boolean),
    });
  }

  // One call, at the end: every card that survives gets the same starting
  // state, from the shared helper rather than a second copy of the constants.
  return { cards: importedCardsToFsrs(kept), duplicates };
}

/** Rows the student's file offered, before anything was dropped. */
function countRows(text: string, format: DeckImportFormat): number {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (format === 'csv') {
    const first = (lines[0] || '').toLowerCase();
    const hasHeader = /(^|,)\s*"?(front|question|term)"?\s*(,|$)/.test(first);
    return Math.max(0, lines.length - (hasHeader ? 1 : 0));
  }
  return lines.filter((line) => !line.startsWith('#')).length;
}

export interface PlanImportOptions extends DeckTextImportOptions {
  fileName?: string;
  format?: DeckImportFormat;
}

/**
 * Read pasted or opened text into a save plan.
 *
 * Pure and synchronous: the whole preview — format, count, what was dropped,
 * the first few cards — is available with the phone in flight mode.
 */
export function planCardImport(text: string, options: PlanImportOptions = {}): ImportPlan {
  const deckName =
    options.deckName?.trim() || deckNameFromFileName(options.fileName) || 'Imported cards';

  if (!text || !text.trim()) {
    return { format: 'empty', deckName, cards: [], skipped: 0, duplicates: 0, warnings: [], batches: [] };
  }

  const trimmed = text.trim();
  // JSON is Lantern's own export; the shared text parsers do not read it.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const payload = parseJson(trimmed, deckName);
    if (!payload) {
      return {
        format: 'unreadable',
        deckName,
        cards: [],
        skipped: 0,
        duplicates: 0,
        warnings: ["That looks like JSON, but there was no deck inside it."],
        batches: [],
      };
    }
    const { cards, duplicates } = toCards(payload);
    const name = (payload.deck?.name || deckName).slice(0, 80);
    return finish(name, cards, Math.max(0, payload.flashcards.length - cards.length - duplicates), duplicates, 'json');
  }

  const format = options.format ?? detectDeckImportFormat(text);
  const parsed = parseDeckImport(text, { ...options, deckName, format });
  const { cards, duplicates } = toCards(parsed);
  const skipped = Math.max(0, countRows(text, format) - parsed.flashcards.length);

  if (cards.length === 0) {
    return {
      format: 'unreadable',
      deckName,
      cards: [],
      skipped,
      duplicates,
      warnings: [
        'No cards in there. Each line needs a front and a back, separated by a tab or a comma.',
      ],
      batches: [],
    };
  }

  return finish(deckName, cards, skipped, duplicates, format);
}

function finish(
  deckName: string,
  cards: ImportedCard[],
  skipped: number,
  duplicates: number,
  format: ImportPlan['format']
): ImportPlan {
  return {
    format,
    deckName,
    cards,
    skipped,
    duplicates,
    warnings: buildWarnings(cards, skipped, duplicates),
    batches: planBatches(cards),
  };
}

function parseJson(text: string, fallbackName: string): DeckImportPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { flashcards?: unknown })?.flashcards)
      ? (parsed as { flashcards: unknown[] }).flashcards
      : null;
  if (!list) return null;
  const name = (parsed as { deck?: { name?: string } })?.deck?.name?.trim() || fallbackName;
  return {
    deck: { name },
    flashcards: list as DeckImportPayload['flashcards'],
  };
}

function buildWarnings(cards: ImportedCard[], skipped: number, duplicates: number): string[] {
  const warnings: string[] = [];
  if (skipped > 0) {
    warnings.push(
      `${skipped} row${skipped === 1 ? '' : 's'} had nothing on one side, so ${skipped === 1 ? 'it was' : 'they were'} left out.`
    );
  }
  if (duplicates > 0) {
    warnings.push(`${duplicates} repeated card${duplicates === 1 ? '' : 's'} left out.`);
  }
  if (cards.length > MAX_CARDS_PER_REQUEST) {
    warnings.push(
      `That is more than one deck holds, so it saves as ${Math.ceil(cards.length / MAX_CARDS_PER_REQUEST)} decks.`
    );
  }
  return warnings;
}

const FORMAT_LABELS: Record<string, string> = {
  'anki-txt': 'an Anki export',
  csv: 'a CSV file',
  quizlet: 'a Quizlet export',
  json: 'a Lantern export',
};

/** One line naming what was read, for the modal's summary row. */
export function describeImportPlan(plan: ImportPlan): string {
  if (plan.format === 'empty') return 'Paste your export, or choose a file.';
  if (plan.format === 'unreadable' || plan.cards.length === 0) {
    return plan.warnings[0] || 'No cards could be read from that.';
  }
  const cloze = plan.cards.filter((c) => c.type === 'CLOZE').length;
  const clozePart = cloze > 0 ? `, ${cloze} of them fill-in-the-blank` : '';
  const label = FORMAT_LABELS[plan.format] ?? 'that file';
  return `${plan.cards.length} card${plan.cards.length === 1 ? '' : 's'} read from ${label}${clozePart}.`;
}

/** Read a picked file as text, with the size guard the picker cannot enforce. */
export async function readImportFile(file: File): Promise<string> {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error('That file is over 5 MB. Export a smaller deck, or split it in two.');
  }
  return file.text();
}
