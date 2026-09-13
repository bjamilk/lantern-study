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
 * 3. Decks made from a note are stored as "From: <note title>" and described
 *    "Generated from note: …". On the Flashcards tab that reads as the note
 *    filed under flashcards — and the note is still on the Notes tab. The
 *    list draws a deck title, not a note category.
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

/** Leading `From: ` a generated deck name carries. */
const FROM_PREFIX = /^\s*from\s*[:\-–—]\s*/i;
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
    .replace(FROM_PREFIX, '')
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
 * A "Generated from note: …" description is how the deck was made, not what
 * to study. The Flashcards list is decks; the source note stays on Notes.
 */
export function deckDisplaySubtitle(deck: DeckListItem): string | null {
  const raw = (deck.description ?? '').trim();
  if (!raw) return null;
  if (/^generated from note:\s*/i.test(raw)) return null;
  return raw;
}

/** Stored like a note (`From: …` / generated-from-note description). */
export function isGeneratedFromNoteDeck(deck: DeckListItem): boolean {
  if (FROM_PREFIX.test(deck.name ?? '')) return true;
  return /^generated from note:/i.test((deck.description ?? '').trim());
}

/**
 * Empty generation leftovers. A failed or interrupted save used to leave a
 * "From: … · 0 cards" row next to the note it was made from.
 */
export function isEmptyGeneratedDeck(deck: DeckListItem): boolean {
  return isGeneratedFromNoteDeck(deck) && (deck.card_count ?? 0) <= 0;
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
