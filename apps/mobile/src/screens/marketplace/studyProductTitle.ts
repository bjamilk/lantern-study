/**
 * The title a study product (pack / question bank) is offered under.
 *
 * WHY THIS EXISTS
 * ---------------
 * A study pack is published from a deck or a note. A deck made from a note is
 * named `From: <note title>` (NoteEditorScreen), and a note imported from a
 * file is named after the upload — so a pack seeded from that chain arrived on
 * the shelf titled literally `From: N448_Gas_Exchange_Study_Guide`, a raw
 * filename with a stray prefix, sold for ₦2,000. To a buyer it reads like a
 * broken listing.
 *
 * The seller still types whatever they like — this only cleans the SEED so the
 * default the modal shows is a human title, never the upload's filename. It:
 *   - drops the `From: ` prefix a library deck carries,
 *   - drops a leading epoch/id prefix an imported filename carries
 *     (`1782589411975-…`),
 *   - drops a trailing file extension (`.pdf`, `.pptx`, …),
 *   - turns a filename's underscores into spaces,
 *   - drops a leading stray separator ("-", "·", ".") and tidies whitespace.
 *
 * It deliberately leaves hyphens INSIDE a word alone ("Anti-inflammatory"),
 * touches nothing an already-clean title needs, and returns "" when there is
 * nothing usable left — the caller then starts the field empty and the seller
 * types their own.
 *
 * Pure and import-free so mobile jest (node env, `*.test.ts` only) can reach it.
 */

/** Leading `From: ` (or `from:` / `From -` style) a library deck name carries. */
const FROM_PREFIX = /^\s*from\s*[:\-–—]\s*/i;

/** A leading epoch / numeric id prefix an imported filename carries. */
const LEADING_ID_PREFIX = /^\d{10,}[-_.\s]+/;

/** A trailing file extension left on a filename-derived name. */
const FILE_EXTENSION =
  /\.(pdf|docx?|pptx?|xlsx?|txt|md|csv|rtf|pages|key|numbers|png|jpe?g|gif|webp|heic)$/i;

/** A single leading separator left after the pieces above are stripped. */
const LEADING_SEPARATOR = /^[\-–—·.\s]+/;

export function deriveStudyProductTitle(raw?: string | null): string {
  if (!raw) return '';
  let title = String(raw).trim();
  if (!title) return '';

  // `From: From: x` never happens, but a single pass is enough for the real
  // shapes; strip the prefix, then anything filename-shaped underneath it.
  title = title.replace(FROM_PREFIX, '');
  title = title.replace(LEADING_ID_PREFIX, '');
  title = title.replace(FILE_EXTENSION, '');

  // Underscores are a filename word separator; hyphens between letters are not,
  // so only underscores become spaces.
  title = title.replace(/_+/g, ' ');

  title = title.replace(LEADING_SEPARATOR, '');
  title = title.replace(/\s+/g, ' ').trim();
  return title;
}
