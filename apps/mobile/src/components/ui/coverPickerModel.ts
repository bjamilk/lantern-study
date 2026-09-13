/**
 * Cover picker — the rules, with no React and no picker in them.
 *
 * Mirrors `components/companion/imageAttach.ts`: the screen owns the sheet and
 * the upload, this file owns what the menu offers, what a picked file has to
 * satisfy, and what a failure is allowed to say. Pure so the three things that
 * actually go wrong — a menu that offers "Remove cover" on a deck with no
 * cover, a 12 MB pick that costs a round trip to be refused, and a 503 printed
 * as the word "Error" — are testable without a device.
 *
 * There is no image GENERATION in this app, so there is no "Generate" row. A
 * menu item that opens nothing is worse than a menu item that is absent.
 */

/**
 * How long `ActionSheet`'s Modal takes to slide out, plus a frame.
 *
 * Anything that opens a WINDOW after a sheet row is pressed — the photo
 * picker Activity, a second sheet — has to wait this long. `ActionSheet`
 * calls `onClose()` and the row's handler in the same frame, so a shorter
 * delay leaves Android with two overlapping app windows, one of them
 * dismissing; when the picker Activity returns, the survivor can stop
 * consuming input altogether. That is the cover ANR: "Input dispatching timed
 * out … Waited 16139ms for MotionEvent" with the process idle at ~1% CPU.
 */
export const SHEET_DISMISS_MS = 320;

/** What a row in the cover sheet does. */
export type CoverMenuAction = 'library' | 'camera' | 'remove';

export interface CoverMenuItem {
  action: CoverMenuAction;
  label: string;
  /** `AppIconName`, kept as a string so this file stays free of component imports. */
  icon: string;
  destructive?: boolean;
  /** Shown under the label where the effect is not obvious from the verb. */
  hint?: string;
}

/** JPEG, PNG, WebP, GIF — exactly what POST /decks/:id/cover accepts. */
export const COVER_ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export const MAX_COVER_BYTES = 10 * 1024 * 1024;

/**
 * A study set's ceiling is 5 MB, not 10.
 *
 * StudyFetch's block prints "Recommended: 400×400px, max 5MB" and the server
 * refuses anything larger on `/users/me/study-sets/:id/cover`. The number a
 * student reads and the number the server enforces have to be one number.
 */
export const MAX_STUDY_SET_COVER_BYTES = 5 * 1024 * 1024;

/** The helper line under the button, in the reference's own words. */
export const STUDY_SET_COVER_HINT = 'Recommended: 400×400px, max 5MB';

/**
 * The rows, in order.
 *
 * "Remove cover" appears only when there is one to remove. It is last and
 * destructive: it is the only row here that throws work away.
 */
export function coverMenuItems({
  hasCover,
  allowCamera = true,
}: {
  hasCover: boolean;
  /**
   * A study set offers the GALLERY only.
   *
   * Not an oversight: StudyFetch's set-picture block is one `Upload Picture`
   * button into the system photo picker, and a camera row here would be this
   * app inventing a flow the reference does not have. Decks and notes keep
   * theirs — a whiteboard photographed into a deck cover is a real use.
   */
  allowCamera?: boolean;
}): CoverMenuItem[] {
  const items: CoverMenuItem[] = [
    {
      action: 'library',
      label: 'Choose image',
      icon: 'image',
      hint: hasCover ? 'Replaces the current cover' : undefined,
    },
  ];
  if (allowCamera) items.push({ action: 'camera', label: 'Take photo', icon: 'camera' });
  if (hasCover) {
    items.push({
      action: 'remove',
      label: 'Remove cover',
      icon: 'trash',
      destructive: true,
    });
  }
  return items;
}

/**
 * Refuse locally what the server would refuse anyway.
 *
 * The size check is deliberately on the raw pick: the upload re-encodes to the
 * marketplace budget afterwards, so this only catches the picks that are so
 * large that reading them into a base64 string is itself the problem.
 */
export function validateCoverAsset(
  asset: {
    fileSize?: number | null;
    mimeType?: string | null;
  },
  /** The ceiling for this record kind. Defaults to the deck/note 10 MB. */
  maxBytes: number = MAX_COVER_BYTES
): string | null {
  const mime = (asset.mimeType || '').toLowerCase();
  if (mime && !mime.startsWith('image/')) return 'Pick an image.';
  if (mime && !(COVER_ACCEPTED_MIME_TYPES as readonly string[]).includes(mime)) {
    return 'Covers can be JPEG, PNG, WebP or GIF.';
  }
  if (typeof asset.fileSize === 'number' && asset.fileSize > maxBytes) {
    const limit = Math.round(maxBytes / (1024 * 1024));
    return `That image is over ${limit} MB. Try a smaller photo.`;
  }
  return null;
}

/* --------------------------------------------------------- where it posts */

/**
 * Which record a cover belongs to, structurally.
 *
 * Mirrors `CoverTarget` in `services/coverUpload.ts` rather than importing it:
 * that module imports THIS one, and the rules have to stay React- and
 * network-free.
 */
export interface CoverTargetLike {
  kind: 'deck' | 'note' | 'study-set';
  id: string;
}

/**
 * The route a cover change posts to — and the guard that an id exists.
 *
 * This is the fix for `POST /api/v1/notes//cover`. The list screens hand the
 * picker whichever row opened the kebab, and `ActionSheet` closes (clearing
 * that row) BEFORE it runs the pressed item's handler, so by the time a
 * student had chosen a picture the id was ''. A URL with `//` in it reaches
 * the server as a different route entirely and fails with something that
 * reads like an outage. Refuse before the request instead.
 *
 * Paths are spelled exactly as `packages/shared/src/api/endpoints.ts` builds
 * them, which is exactly what `routes/{decks,notes,studySets}.ts` mount:
 * decks and notes interpolate the id raw, a study set encodes it.
 */
export function coverRequestPath(target: CoverTargetLike): string {
  const id = typeof target?.id === 'string' ? target.id.trim() : '';
  if (!id) {
    const what = target?.kind === 'study-set' ? 'study set' : target?.kind || 'record';
    throw new Error(
      `Cannot change this cover: no ${what} id. Close the menu and try again.`
    );
  }
  if (target.kind === 'deck') return `/decks/${id}/cover`;
  if (target.kind === 'note') return `/notes/${id}/cover`;
  return `/users/me/study-sets/${encodeURIComponent(id)}/cover`;
}

/* ------------------------------------------------------- what a tile draws */

/**
 * A record's cover path, whichever spelling it arrived in.
 *
 * Deck rows reach the store two ways — raw snake_case columns from the list
 * endpoint, camelCase from the cover route's own response — and a row that has
 * been through both carries both. Notes only ever use camelCase. Reading them
 * in one place is what stops a freshly-set cover from vanishing on the next
 * list refresh.
 */
export function readCoverPath(
  row?: { coverPath?: string | null; cover_path?: string | null } | null
): string | null {
  if (!row) return null;
  return row.coverPath ?? row.cover_path ?? null;
}

/**
 * The cover fields a row mapper must WRITE, in both spellings.
 *
 * `mapDeckFromApi` rebuilds a deck field by field and carried neither
 * spelling, so an uploaded cover vanished on the next `fetchDecks` and every
 * menu then offered "Add cover…" with no way to remove one. A mapper spreads
 * this instead of hand-writing two lines it can forget again.
 */
export function coverPathFields(row?: {
  coverPath?: string | null;
  cover_path?: string | null;
} | null): { coverPath: string | null; cover_path: string | null } {
  const path = readCoverPath(row);
  return { coverPath: path, cover_path: path };
}

/** The tile a card row draws: either the picture, or the pastel type glyph. */
export type CoverTileSource =
  | { kind: 'cover'; uri: string }
  | { kind: 'glyph' };

/**
 * Which of the two a row shows.
 *
 * `pendingUri` wins over anything resolved from storage: the picture a student
 * just chose has to be on screen before the upload finishes, and the signed
 * URL for the new path does not exist yet anyway.
 *
 * A `coverPath` that has not resolved yet is NOT a cover: returning 'glyph'
 * keeps the row at its normal height while the batcher signs, so a list does
 * not reflow one row at a time as URLs land.
 */
export function coverTileSource({
  pendingUri,
  resolvedUri,
}: {
  pendingUri?: string | null;
  resolvedUri?: string | null;
}): CoverTileSource {
  if (pendingUri) return { kind: 'cover', uri: pendingUri };
  if (resolvedUri) return { kind: 'cover', uri: resolvedUri };
  return { kind: 'glyph' };
}

/**
 * The cover tile's box, derived from the `FeatureDisc` size it replaces.
 *
 * HEIGHT is that size unchanged — a row with a cover is exactly as tall as a
 * row without one — and 4:3 buys the extra width. The radius is the same
 * squircle fraction the pastel tile uses, so the two shapes are one family.
 */
export function coverTileBox(size: number, radiusFraction: number) {
  return {
    width: Math.round((size * 4) / 3),
    height: size,
    radius: Math.round(size * radiusFraction),
  };
}

/** What the header shows when a cover change fails: a sentence, and the small print. */
export type CoverFailure = {
  /** One readable line, never a bare class name like "Error". */
  message: string;
  /** The server's own words and the pending migration, behind "Details". */
  detail: string | null;
};

/** Shown when the cover columns are not migrated on the server yet. */
export const COVER_SERVER_UPDATE_MESSAGE =
  'Covers need a server update — try again later';

const GENERIC_FAILURE_LABELS = new Set([
  'error',
  'apierror',
  'request failed',
  'bad request',
  'internal server error',
  'service unavailable',
  'unknown error',
  '[object object]',
]);

/** A 503 that names the pending migration file, e.g. `20260913120000_cover_images.sql`. */
const MIGRATION_NAME = /\b(\d{8,}_[A-Za-z0-9_.-]+\.sql)\b/;

/** The migration this feature waits on, named when the server does not name it itself. */
export const COVER_MIGRATION_NAME = '20260913120000_cover_images.sql';

function rawMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err.trim();
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' ? message.trim() : '';
}

/**
 * Turn whatever the cover call threw into something a student can act on.
 *
 * Same two rules the composer taught us: never print a class name, and never
 * print nothing — a failure with no words still has a status worth stating.
 */
export function describeCoverFailure(err: unknown): CoverFailure {
  const status = Number((err as { status?: unknown } | null)?.status) || 0;
  const raw = rawMessage(err);
  const isGeneric = !raw || GENERIC_FAILURE_LABELS.has(raw.toLowerCase());

  const migration = raw.match(MIGRATION_NAME)?.[1];
  if (status === 503) {
    return {
      message: COVER_SERVER_UPDATE_MESSAGE,
      detail: `Waiting on ${migration || COVER_MIGRATION_NAME}`,
    };
  }

  if (isGeneric) {
    return {
      message: status
        ? `Could not update the cover (server said ${status}).`
        : 'Could not update the cover. Check your connection and try again.',
      detail: null,
    };
  }

  return { message: raw, detail: null };
}
