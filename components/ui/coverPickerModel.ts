/**
 * Cover-image picker — the pure model.
 *
 * Every rule a cover has to obey before a byte leaves the browser lives here,
 * so the dialog, the menu and the tests all read the SAME sentences. The
 * server re-checks all of it (`POST /decks/:id/cover` validates type and size
 * before it stores anything); this copy exists to fail in the dialog the
 * student is already looking at rather than after a 10 MB upload.
 *
 * There is deliberately no "Generate" anywhere in this model: the app has no
 * image generation, and a menu item that opens a "coming soon" is a promise
 * the product cannot keep.
 */

/** The server's ceiling, mirrored. Raising it here alone only moves the 400. */
export const COVER_MAX_BYTES = 10 * 1024 * 1024;
export const COVER_MAX_LABEL = '10 MB';

/** The four types the server accepts. Anything else is refused before upload. */
export const COVER_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

/** `accept` attribute for the file input — the same list, not a looser `image/*`. */
export const COVER_ACCEPT_ATTR = COVER_ACCEPTED_TYPES.join(',');

/**
 * The migration that adds `cover_path`. Until it is applied the routes answer
 * 503 naming this file, and the dialog shows the name behind "Details" so a
 * report says which migration is missing instead of "covers are broken".
 */
export const COVER_MIGRATION = '20260913120000_cover_images.sql';

/** What a 503 says out loud. The migration name is the detail, not the headline. */
export const COVER_SERVER_UPDATE_MESSAGE = 'Covers need a server update — try again later';

/**
 * A study set's cover is capped at 5 MB, not 10.
 *
 * That is StudyFetch's own number for this block, and the block prints it:
 * "Recommended: 400×400px, max 5MB". The server enforces the same 5 MB on
 * `POST /users/me/study-sets/:id/cover`, so this is a mirror, not a second
 * opinion — a student who reads 5MB and is refused at 7 has been lied to
 * either here or there.
 */
export const STUDY_SET_COVER_MAX_BYTES = 5 * 1024 * 1024;
export const STUDY_SET_COVER_MAX_LABEL = '5 MB';

/** The helper line under the button, copied from the reference verbatim. */
export const STUDY_SET_COVER_HINT = 'Recommended: 400×400px, max 5MB';

export interface CoverFileLike {
  type?: string;
  size?: number;
  name?: string;
}

export type CoverValidation = { ok: true } | { ok: false; message: string };

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Client-side gate for a chosen file.
 *
 * The messages name the actual problem and the actual limit, because "invalid
 * file" leaves a student re-picking the same screenshot until they give up.
 */
export function validateCoverFile(
  file: CoverFileLike | null | undefined,
  /**
   * The ceiling to hold this file to. Decks and notes take the default 10 MB;
   * a study set passes `STUDY_SET_COVER_MAX_BYTES`, because its own block
   * promises 5. The label is derived from the number so the two cannot drift.
   */
  maxBytes: number = COVER_MAX_BYTES
): CoverValidation {
  if (!file) return { ok: false, message: 'Choose an image first.' };
  const type = (file.type || '').toLowerCase();
  if (!(COVER_ACCEPTED_TYPES as readonly string[]).includes(type)) {
    return { ok: false, message: 'Covers must be a JPEG, PNG, WebP or GIF image.' };
  }
  const size = file.size ?? 0;
  if (size <= 0) return { ok: false, message: 'That file is empty.' };
  if (size > maxBytes) {
    const limit =
      maxBytes === COVER_MAX_BYTES
        ? COVER_MAX_LABEL
        : maxBytes === STUDY_SET_COVER_MAX_BYTES
          ? STUDY_SET_COVER_MAX_LABEL
          : formatMegabytes(maxBytes);
    return {
      ok: false,
      message: `That image is ${formatMegabytes(size)} — covers must be ${limit} or smaller.`,
    };
  }
  return { ok: true };
}

export type CoverMenuItemId = 'choose' | 'remove';

export interface CoverMenuItem {
  id: CoverMenuItemId;
  label: string;
  /** Remove is the destructive one; the menu tints it. */
  destructive?: boolean;
}

/** The kebab entry itself: what it offers depends on whether a cover is set. */
export function coverMenuLabel(hasCover: boolean): string {
  return hasCover ? 'Change cover' : 'Add cover';
}

/**
 * The items under that entry. "Remove cover" is absent when there is nothing
 * to remove — an always-present no-op item is how a menu stops meaning
 * anything.
 */
export function coverMenuItems(hasCover: boolean): CoverMenuItem[] {
  const items: CoverMenuItem[] = [{ id: 'choose', label: 'Choose image' }];
  if (hasCover) items.push({ id: 'remove', label: 'Remove cover', destructive: true });
  return items;
}

export interface CoverError {
  /** The line shown under the dialog's actions. */
  message: string;
  /** Extra text folded behind "Details" — only set when it adds something. */
  details?: string;
}

/**
 * Turn a failed cover call into what the student reads.
 *
 * Non-503 failures surface the SERVER's own sentence: it is the only thing
 * that knows whether this was a too-large file, a deck someone else owns, or a
 * suspended account, and replacing it with a house sentence is how a fixable
 * refusal became an unexplained dead button elsewhere in this app.
 */
export function coverErrorMessage(err: unknown): CoverError {
  const status =
    typeof (err as { status?: unknown } | null)?.status === 'number'
      ? (err as { status: number }).status
      : undefined;
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';

  if (status === 503) {
    return {
      message: COVER_SERVER_UPDATE_MESSAGE,
      details: raw.includes(COVER_MIGRATION) ? raw : `Pending migration: ${COVER_MIGRATION}`,
    };
  }
  return { message: raw || 'Could not save that cover. Try again.' };
}
