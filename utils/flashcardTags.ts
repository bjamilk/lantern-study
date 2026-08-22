/**
 * Flashcard tag helpers for the create/edit modal (Phase 1 · B). Tags are
 * persisted as `flashcards.tags text[]`; the UI edits them as one
 * comma-separated line.
 */

export const MAX_FLASHCARD_TAGS = 20;
export const MAX_FLASHCARD_TAG_LENGTH = 40;

/**
 * "enzymes, Chapter 3 ,enzymes;;  #krebs" → ["enzymes", "Chapter 3", "krebs"].
 * Splits on commas / semicolons / newlines, trims, collapses inner whitespace,
 * drops a leading "#", dedupes case-insensitively (first spelling wins) and
 * caps both tag length and count.
 */
export function parseFlashcardTags(input: string | null | undefined): string[] {
  if (!input) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(input).split(/[,;\n]+/)) {
    let tag = raw.trim().replace(/\s+/g, ' ');
    if (tag.startsWith('#')) tag = tag.slice(1).trim();
    if (!tag) continue;
    if (tag.length > MAX_FLASHCARD_TAG_LENGTH) tag = tag.slice(0, MAX_FLASHCARD_TAG_LENGTH).trim();
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_FLASHCARD_TAGS) break;
  }
  return out;
}

/** Inverse of parseFlashcardTags for seeding the input when editing a card. */
export function formatFlashcardTags(tags: ReadonlyArray<string> | null | undefined): string {
  if (!tags || tags.length === 0) return '';
  return tags.filter((t) => typeof t === 'string' && t.trim()).join(', ');
}
