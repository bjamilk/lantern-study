/**
 * What a set-tile save is allowed to look like when the column is not there.
 *
 * `tile_hue`/`tile_glyph` arrive with a hand-applied migration
 * (20260913150000), so a live API can be running the tile CODE against a
 * database that has no tile COLUMNS. The set-list read ladder degrades for
 * that case on purpose — a set list must not 500 over an unapplied migration
 * — and the write path inherited the same reflex, which on a WRITE is a
 * different thing entirely: the device pass picked peach + lightbulb three
 * times, got a green `Study set updated.` each time, and the pick was gone on
 * the next open. A read that degrades tells the student less than it could; a
 * write that degrades tells the student something FALSE.
 *
 * So the rule this module carries, and the server and both clients spell the
 * same way:
 *
 * - The server answers 503 with `SET_TILE_UNSUPPORTED_MESSAGE` and the
 *   migration's filename, never 200, when a patch carrying tile fields lands
 *   on a rung of the ladder that has no tile columns.
 * - A client talking to an OLDER api — one that strips the unknown keys and
 *   answers a cheerful 200 — cannot see a status code, so it compares what it
 *   SENT with what came back and says the same sentence itself.
 *
 * It lives in `shared` because those are three codebases saying one sentence,
 * and a sentence maintained in three places is three sentences.
 */

/** The hand-applied migration that adds `tile_hue` and `tile_glyph`. */
export const SET_TILE_MIGRATION = '20260913150000_study_set_tile.sql';

/**
 * The one sentence. Present tense, no error code, and it names the thing the
 * student was doing ("Set tiles") rather than the column that is missing.
 */
export const SET_TILE_UNSUPPORTED_MESSAGE =
  'Set tiles need a server update — try again later';

/** The halves of a pick. `null` means "derive this half"; absent means "leave it". */
export interface SetTilePick {
  hue?: string | null;
  glyph?: string | null;
}

/** Only the two fields this module reads off a saved row. */
export interface SavedSetTile {
  tileHue?: string | null;
  tileGlyph?: string | null;
}

/** `''` and `undefined` both mean "no value" once a row has been through PostgREST. */
function normalize(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Is this sentence the tile-unsupported one?
 *
 * The clients get it two ways — a 503 body from a server that knows, and their
 * own comparison against a server that does not — and both paths end at the
 * same block of the settings screen, so both have to be recognisable.
 */
export function isSetTileUnsupportedMessage(message: unknown): boolean {
  return typeof message === 'string' && message.trim() === SET_TILE_UNSUPPORTED_MESSAGE;
}

/**
 * Did a save that ASKED for a tile come back without it?
 *
 * `requested` carries only the halves the student actually changed. That
 * matters: every Save on both clients sends the whole form, so a rename on a
 * pre-migration api would otherwise report a dropped tile the student never
 * touched.
 *
 * Two ways a save counts as dropped, and both are real:
 * 1. the returned row does not carry the key at all — an older api strips
 *    what it does not know about, so the field never existed in the answer;
 * 2. it carries the key with a different value — the column is there and the
 *    write did not take.
 */
export function setTileSaveDropped(
  requested: SetTilePick | null | undefined,
  saved: SavedSetTile | null | undefined
): boolean {
  if (!requested) return false;
  const asks: Array<['tileHue' | 'tileGlyph', string | null]> = [];
  if (requested.hue !== undefined) asks.push(['tileHue', normalize(requested.hue)]);
  if (requested.glyph !== undefined) asks.push(['tileGlyph', normalize(requested.glyph)]);
  if (asks.length === 0) return false;
  // Nothing came back at all: the caller has no evidence either way, and
  // inventing a failure here would put the sentence on every offline save.
  if (!saved) return false;
  for (const [key, want] of asks) {
    if (!(key in (saved as Record<string, unknown>))) return true;
    if (normalize((saved as Record<string, unknown>)[key]) !== want) return true;
  }
  return false;
}

/**
 * The halves of `next` that differ from `current` — what a client should hand
 * `setTileSaveDropped` after a save.
 */
export function changedSetTilePick(
  current: SavedSetTile | null | undefined,
  next: SetTilePick
): SetTilePick | null {
  const pick: SetTilePick = {};
  if (normalize(next.hue) !== normalize(current?.tileHue)) pick.hue = normalize(next.hue);
  if (normalize(next.glyph) !== normalize(current?.tileGlyph)) pick.glyph = normalize(next.glyph);
  return pick.hue === undefined && pick.glyph === undefined ? null : pick;
}
