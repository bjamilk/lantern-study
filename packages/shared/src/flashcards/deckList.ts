/**
 * What the Flashcards list shows, and in what order.
 *
 * Two things the device pass caught, both of them the list telling a student
 * something that is not about their studying:
 *
 * 1. Five decks reading "Nothing ready" filled the first screen while the deck
 *    with 10 cards due sat below the fold. The list was in whatever order the
 *    server returned; the ONE thing this screen exists to answer is "what can
 *    I study now", so that is what it sorts by.
 *
 * 2. A deck was titled "-Gestational_Diabetes_PPT" and subtitled "Generated
 *    from note: 1782589411975-Gestational_Diabetes_PPT". That epoch is an
 *    upload timestamp, the underscores are a filename's, and the leading "-"
 *    is what was left when something stripped the digits off the front. None
 *    of it was ever typed by a person.
 *
 * Display-time only, and deliberately: the stored name is what the student can
 * rename, what the server search matches and what an export carries. This
 * module decides what is READ, never what is saved.
 */

/** Just enough of a deck to order and title one. */
export interface DeckListItem {
  name: string;
  description?: string | null;
  due_count?: number | null;
  card_count?: number | null;
}

/** `1782589411975-Something` — an upload's epoch stamp and its separator. */
const EPOCH_PREFIX = /^\s*\d{10,16}[-_. ]*/;
/** Anything a person would not open a title with, once the stamp is gone. */
const LEADING_JUNK = /^[-_.\s]+/;
const TRAILING_JUNK = /[-_.\s]+$/;
/** Extensions the uploader keeps on the end of a note title. */
const FILE_EXTENSION = /\.(pdf|pptx?|docx?|txt|md|rtf|csv|jpe?g|png|heic|mp4|m4a|mp3|wav)$/i;

/**
 * A filename made readable, or the original when there is nothing to fix.
 *
 * Never returns empty: a name that is ONLY an epoch stamp is left as it was
 * rather than replaced with a blank row, because a student can at least
 * recognise a string they have seen before.
 */
export function cleanDeckTitle(raw: string | null | undefined): string {
  const original = (raw ?? '').trim();
  if (!original) return '';
  const cleaned = original
    .replace(EPOCH_PREFIX, '')
    .replace(FILE_EXTENSION, '')
    .replace(LEADING_JUNK, '')
    .replace(TRAILING_JUNK, '')
    // Underscores are a filename's word breaks; spaces are a title's.
    .replace(/_+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || original;
}

/** How a deck's name is drawn in the list. */
export function deckDisplayTitle(deck: DeckListItem): string {
  return cleanDeckTitle(deck.name) || 'Untitled deck';
}

/**
 * The line under the title, when it says something the title does not.
 *
 * "Generated from note: <the same filename again>" is the row saying nothing
 * twice, so a source line that cleans down to the title is dropped entirely.
 */
export function deckDisplaySubtitle(deck: DeckListItem): string | null {
  const raw = (deck.description ?? '').trim();
  if (!raw) return null;
  const match = /^generated from note:\s*(.*)$/i.exec(raw);
  if (!match) return raw;
  const source = cleanDeckTitle(match[1]);
  if (!source) return null;
  if (source.toLowerCase() === deckDisplayTitle(deck).toLowerCase()) return null;
  return `From your note: ${source}`;
}

/**
 * Study-first order: what is due, most first; everything else after it.
 *
 * Stable inside each band — a list that reshuffles its own bottom half every
 * time a count changes is a list you cannot learn the shape of.
 */
export function sortDecksForList<T extends DeckListItem>(decks: readonly T[]): T[] {
  return decks
    .map((deck, index) => ({ deck, index }))
    .sort((a, b) => {
      const dueA = a.deck.due_count ?? 0;
      const dueB = b.deck.due_count ?? 0;
      if (dueA > 0 !== dueB > 0) return dueA > 0 ? -1 : 1;
      if (dueA !== dueB) return dueB - dueA;
      return a.index - b.index;
    })
    .map((entry) => entry.deck);
}
