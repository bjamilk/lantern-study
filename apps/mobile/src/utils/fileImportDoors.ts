/**
 * What the phone's file-import doors ask the document picker for.
 *
 * WHY IT IS HERE AND NOT IN A SCREEN. The PDF and PowerPoint pickers were
 * written inline in `screens/notes/NotesScreen.tsx`, which meant the set room's
 * PDF and PPT chips had nothing to call: they opened a sheet with no picker
 * behind them (issue #137). Mobile jest runs `*.test.ts` under node, where a
 * screen's `.tsx` and `expo-document-picker`'s native module cannot be imported
 * at all, so a picker written inside a screen is a picker no test can reach.
 * The mimes and the refusals live here, the picker is handed in as a function,
 * and both surfaces call the same door.
 *
 * GOTCHA: a mime that drifts is a picker that shows NO files at all, on a
 * device with no console to say why — which is why `.pptx` and legacy `.ppt`
 * are both listed, verbatim as the Notes sheet has always sent them.
 *
 * Touches: `@lantern/shared/utils/noteUpload` (the 25 MB cap and the Word name
 * check), `utils/wordImport` (the Word door, which owns its own mime).
 */
import { assertNoteUploadSize } from '@lantern/shared/utils/noteUpload';
import {
  pickWordDocument,
  wordPickerOptions,
  type GetDocumentAsync,
  type WordPickerOptions,
} from './wordImport';

/** The three file doors, named as `NotesScreen`'s `pendingImport.mode` names them. */
export type ImportFileKind = 'pdf' | 'presentation' | 'document';

export const PDF_MIME = 'application/pdf';

/**
 * Both PowerPoint mimes. Unlike `.doc`, a legacy `.ppt` IS handled by the
 * server's presentation route, so it stays in the filter.
 */
export const PRESENTATION_MIMES = [
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
];

/** The default file name when the provider hands back an asset with none. */
export function defaultImportFileName(kind: ImportFileKind): string {
  if (kind === 'pdf') return 'document.pdf';
  if (kind === 'presentation') return 'slides.pptx';
  return 'document.docx';
}

// A fresh object each call: `expo-document-picker` types `type` as a mutable
// `string[]`, and a shared array handed to a native module is a bug waiting for
// the day something sorts it in place.
export function importFilePickerOptions(kind: ImportFileKind): WordPickerOptions {
  if (kind === 'document') return wordPickerOptions();
  return {
    type: kind === 'pdf' ? [PDF_MIME] : [...PRESENTATION_MIMES],
    copyToCacheDirectory: true,
    multiple: false,
  };
}

export interface PickedImportFile {
  uri: string;
  name: string;
  size: number;
}

/**
 * Open the picker for one door and return a file worth uploading.
 *
 * Returns null when the student backed out. Throws — with a sentence they can
 * act on — when the file is over the shared 25 MB cap (or, for the Word door,
 * is a legacy `.doc`), BEFORE the bytes are read into memory and base64'd.
 */
export async function pickImportFile(
  kind: ImportFileKind,
  getDocumentAsync: GetDocumentAsync
): Promise<PickedImportFile | null> {
  if (kind === 'document') return pickWordDocument(getDocumentAsync);

  const result = await getDocumentAsync(importFilePickerOptions(kind));
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) return null;

  const name = asset.name || defaultImportFileName(kind);
  const size = asset.size ?? 0;
  assertNoteUploadSize(size, name);
  return { uri: asset.uri, name, size };
}
