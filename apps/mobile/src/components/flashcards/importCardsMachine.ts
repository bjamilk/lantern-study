/**
 * The import sheet's decisions, with no React and no I/O.
 *
 * paste (or pick a file) → parsed → named → saved, or queued.
 *
 * The last step is two outcomes rather than one because the honest answer
 * depends on the network, and the sheet has to SAY which happened. See
 * `services/importedDeck.ts` for why "queued" is a real state here and not a
 * polite word for "saved".
 */
import type { Flashcard } from '@lantern/shared/types';
import { importedCardsToFsrs } from '@lantern/shared/utils/deckFormats';
import { MAX_IMPORT_CARDS, describeImport, parseDeckImport, suggestDeckName } from './deckImportParse';
import type { ImportedCard, ParsedImport } from './deckImportParse';

export type ImportStage = 'input' | 'review' | 'saving' | 'saved' | 'queued' | 'failed';

export interface ImportOutcome {
  kind: 'saved' | 'queued';
  count: number;
  deckName: string;
}

export interface ImportCardsState {
  stage: ImportStage;
  text: string;
  fileName: string | null;
  parsed: ParsedImport | null;
  deckName: string;
  /** True once the student types a name, so re-parsing stops overwriting it. */
  deckNameEdited: boolean;
  error: string | null;
  outcome: ImportOutcome | null;
}

export type ImportCardsEvent =
  | { type: 'text_changed'; text: string }
  | { type: 'file_picked'; text: string; fileName: string }
  | { type: 'parse' }
  | { type: 'deck_name_changed'; name: string }
  | { type: 'edit_source' }
  | { type: 'save_started' }
  | { type: 'save_succeeded'; outcome: ImportOutcome }
  | { type: 'save_failed'; message: string }
  | { type: 'reset' };

export const INITIAL_IMPORT_STATE: ImportCardsState = {
  stage: 'input',
  text: '',
  fileName: null,
  parsed: null,
  deckName: '',
  deckNameEdited: false,
  error: null,
  outcome: null,
};

export function importCardsReducer(
  state: ImportCardsState,
  event: ImportCardsEvent
): ImportCardsState {
  switch (event.type) {
    case 'text_changed':
      // Typing after a parse invalidates it; going back to `input` is what
      // stops "203 cards found" sitting above text that no longer says so.
      return { ...state, stage: 'input', text: event.text, parsed: null, error: null };

    case 'file_picked': {
      const suggested = suggestDeckName(event.fileName);
      return {
        ...state,
        stage: 'input',
        text: event.text,
        fileName: event.fileName,
        parsed: null,
        error: null,
        deckName: state.deckNameEdited ? state.deckName : suggested,
      };
    }

    case 'parse': {
      const parsed = parseDeckImport(state.text, state.fileName ?? undefined);
      return {
        ...state,
        stage: 'review',
        parsed,
        error: null,
        deckName: state.deckNameEdited && state.deckName.trim() ? state.deckName : parsed.suggestedName,
      };
    }

    case 'deck_name_changed':
      return { ...state, deckName: event.name, deckNameEdited: true };

    case 'edit_source':
      return { ...state, stage: 'input', error: null };

    case 'save_started':
      return { ...state, stage: 'saving', error: null };

    case 'save_succeeded':
      return {
        ...state,
        stage: event.outcome.kind === 'saved' ? 'saved' : 'queued',
        outcome: event.outcome,
        error: null,
      };

    case 'save_failed':
      // Back to `failed`, never to `input`: the parsed cards are still here
      // and a retry must not make the student paste 200 rows again.
      return { ...state, stage: 'failed', error: event.message };

    case 'reset':
      return { ...INITIAL_IMPORT_STATE };

    default:
      return state;
  }
}

/** The cards this state would save — capped at what the server accepts. */
export function cardsToSave(state: ImportCardsState): ImportedCard[] {
  return (state.parsed?.cards ?? []).slice(0, MAX_IMPORT_CARDS);
}

export function canSave(state: ImportCardsState): boolean {
  if (state.stage !== 'review' && state.stage !== 'failed') return false;
  if (!state.deckName.trim()) return false;
  return cardsToSave(state).length > 0;
}

/** The line under the card count. Null when there is nothing to warn about. */
export function overflowNotice(state: ImportCardsState): string | null {
  const found = state.parsed?.cards.length ?? 0;
  if (found <= MAX_IMPORT_CARDS) return null;
  return `We can save ${MAX_IMPORT_CARDS} cards at a time — the first ${MAX_IMPORT_CARDS} will be imported and the other ${found - MAX_IMPORT_CARDS} left out. Split the file to bring them all in.`;
}

/** "203 cards found · 2 lines skipped (no back)" */
export function summaryLine(state: ImportCardsState): string {
  return state.parsed ? describeImport(state.parsed) : 'Nothing to import yet.';
}

/** The first three cards the sheet shows before anything is saved. */
export function previewCards(state: ImportCardsState): ImportedCard[] {
  return cardsToSave(state).slice(0, 3);
}

/**
 * What the sheet says once the save is over — the plain truth in both cases.
 */
export function outcomeMessage(outcome: ImportOutcome): string {
  const cards = `${outcome.count} card${outcome.count === 1 ? '' : 's'}`;
  return outcome.kind === 'saved'
    ? `${cards} saved to “${outcome.deckName}”. They're in your account and ready to study.`
    : `${cards} are on this phone in “${outcome.deckName}” and ready to study now. They'll be saved to your account the next time you're online.`;
}

/* ---------------------------------------------------------------- FSRS -- */

/**
 * Imported cards as local `Flashcard` rows, seeded for FSRS.
 *
 * The seeding itself is the shared `importedCardsToFsrs`
 * (`createInitialFsrsData`): stability and difficulty set, `nextReviewDate`
 * empty. That empty date is what keeps a 200-card import out of today's due
 * queue — `isCardDue` reads it, so a date of "now" would have dumped all 200
 * into one session and walked straight past the daily new-card budget — while
 * still letting the first grade take the initial branch of `calculateFsrsData`
 * (Again 1d / Hard 1d / Good 3d / Easy 5d).
 */
export function importedCardsToLocalFlashcards(
  cards: ImportedCard[],
  deckId: string,
  idFor: (index: number) => string
): Flashcard[] {
  const createdAt = new Date().toISOString();
  return importedCardsToFsrs(
    cards.map((card, index) => ({
      id: idFor(index),
      deckId,
      type: card.type as Flashcard['type'],
      front: card.front,
      back: card.back,
      ...(card.clozeText ? { clozeText: card.clozeText } : {}),
      ...(card.tags && card.tags.length ? { tags: card.tags } : {}),
      createdAt,
    }))
  ) as Flashcard[];
}
