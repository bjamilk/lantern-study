/**
 * The phone's Word (.docx) door: what it asks the document picker for, what it
 * refuses before any bytes move, and how the extracted text becomes a note.
 *
 * WHY IT IS HERE AND NOT IN A SCREEN. Three surfaces open this door — the Notes
 * import sheet, the set room's Add materials sheet and the AI question
 * generator — and mobile jest runs `*.test.ts` under node, where a screen's
 * `.tsx` and `expo-document-picker`'s native module cannot be imported at all.
 * So the decisions live in this module, the picker is handed in as a function,
 * and a test can prove the door asks for the docx mime, refuses a legacy `.doc`
 * and writes the truncation line into the note. What is left in the screens is
 * layout.
 *
 * THE FILE IS NEVER STORED. `POST /notes/extract-document-text` returns text and
 * nothing else; the note is made through the same `createNote` the paste door
 * uses. A PDF and a deck are kept because they have pages and a preview — a
 * Word document has neither, and storing it would need a new value on two CHECK
 * constraints, which is a migration standing between this and a student.
 *
 * Touches: `@lantern/shared/utils/noteUpload` (the mime, the name check, the
 * truncation sentence — all shared with web so the two cannot drift),
 * `services/notes.extractDocumentTextViaApi`.
 */
import {
  DOCX_MIME,
  assertDocumentFileName,
  assertNoteUploadSize,
  buildImportedDocumentBody,
  formatMaxNoteUploadLabel,
} from '@lantern/shared/utils/noteUpload';

/** What the Notes sheet and the set room's sheet label the door. */
export const WORD_DOOR_LABEL = 'Import Word (.docx)';

/** The one-line hint under the door when it can be used. */
export const WORD_DOOR_HINT = 'Text is read out of the document';

/**
 * Why the door is off with no connection.
 *
 * A Word document is parsed on the server, so offline there is nothing to fall
 * back to — and the failure this replaces is the silent one: the picker opens,
 * the student waits through the upload, and the request dies with a generic
 * network message after the work is done.
 */
export const WORD_DOOR_OFFLINE_HINT =
  "You're offline — the document is read on our server, so this needs a connection.";

export interface WordDoorState {
  disabled: boolean;
  hint: string;
}

export function wordDoorState(isOnline: boolean): WordDoorState {
  return isOnline
    ? { disabled: false, hint: `${WORD_DOOR_HINT} · ${formatMaxNoteUploadLabel()}` }
    : { disabled: true, hint: WORD_DOOR_OFFLINE_HINT };
}

/**
 * The picker options. `type` is the docx mime alone: the file browser greys out
 * everything else, so a `.doc` is normally unreachable — but iOS and some
 * Android providers hand back whatever the user long-pressed regardless, which
 * is why `pickWordDocument` checks the name anyway.
 */
export interface WordPickerOptions {
  type: string[];
  copyToCacheDirectory: boolean;
  multiple: boolean;
}

// A fresh object each call: `expo-document-picker` types `type` as a mutable
// `string[]`, and a shared array handed to a native module is a bug waiting for
// the day something sorts it in place.
export function wordPickerOptions(): WordPickerOptions {
  return { type: [DOCX_MIME], copyToCacheDirectory: true, multiple: false };
}

export interface PickedDocumentAsset {
  uri: string;
  name?: string | null;
  size?: number | null;
  mimeType?: string | null;
}

export interface DocumentPickerResultLike {
  canceled: boolean;
  assets?: PickedDocumentAsset[] | null;
}

export type GetDocumentAsync = (
  options: WordPickerOptions
) => Promise<DocumentPickerResultLike>;

export interface PickedWordDocument {
  uri: string;
  name: string;
  size: number;
}

/**
 * Open the picker and return a document that is definitely worth uploading.
 *
 * Returns null when the student backed out. Throws — with a sentence they can
 * act on — when the file is a legacy `.doc` or over the 25 MB cap, BEFORE the
 * file is read into memory and base64'd. That order is the whole point: the
 * server refuses the same two things, but only after the upload.
 */
export async function pickWordDocument(
  getDocumentAsync: GetDocumentAsync
): Promise<PickedWordDocument | null> {
  const result = await getDocumentAsync(wordPickerOptions());
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) return null;

  const name = asset.name || 'document.docx';
  assertDocumentFileName(name);
  const size = asset.size ?? 0;
  if (size > 0) assertNoteUploadSize(size, name);

  return { uri: asset.uri, name, size };
}

export interface WordImportDeps<TNote> {
  file: { uri: string; name: string };
  /** `services/notes.extractDocumentTextViaApi` in the app. */
  extractDocumentText: (
    fileUri: string,
    fileName: string
  ) => Promise<{ title: string; text: string; truncated: boolean }>;
  /** The same create-note call the paste door makes. */
  createNote: (payload: {
    title: string;
    body: string;
    sourceType: string;
  }) => Promise<TNote>;
}

/**
 * Extract, then create the note.
 *
 * `sourceType` is `typed`, the paste door's value, deliberately: the note IS
 * pasted text as far as the database is concerned, and inventing a `docx`
 * value would need the `notes.source_type` CHECK constraint widened by a
 * hand-applied migration — with the feature inert until someone ran it.
 */
export async function importWordDocument<TNote>(
  deps: WordImportDeps<TNote>
): Promise<TNote> {
  const { title, text, truncated } = await deps.extractDocumentText(
    deps.file.uri,
    deps.file.name
  );
  return deps.createNote({
    title: title || deps.file.name.replace(/\.docx$/i, '') || 'Imported document',
    body: buildImportedDocumentBody(text, deps.file.name, truncated),
    sourceType: 'typed',
  });
}
