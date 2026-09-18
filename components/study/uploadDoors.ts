/**
 * Which doors the Upload Materials page draws, what each one opens, and how a
 * dropped file finds its handler.
 *
 * WHY THE DOORS ARE DATA. The page (`StudySetUpload`) draws them in the
 * reference's order and `CourseWorkspace` wires them. A list they both read is
 * the only way the two agree on which ones exist — and it is what a test can
 * walk to prove no door is dead.
 *
 * EVERY DOOR IS LIVE. This replaces the earlier "visible but disabled" set. A
 * disabled button with a reason under it is honest, but it is still a control
 * a student reaches for and cannot use, and six of them turned the grid into a
 * list of things Lantern does not do. The rule now is the house rule: a door
 * is here only if pressing it does a real thing today. What Lantern cannot
 * back is not drawn, and the PR says why for each one.
 *
 * Dropped, 2026-09-18, against the reference's eleven:
 *  - Audio Files, Video Files — there is no audio- or video-FILE import
 *    anywhere in web. `/notes/transcribe-audio` exists but it is the lecture
 *    recorder's own path (it wants a note and a recording session), not a
 *    file picker. The recorder has its own pill further down this page.
 *  - Google Drive — no OAuth integration, and an integration is a first-party
 *    feature with its own consent screen rather than a button in a grid.
 *
 * Added: Word Documents (.docx), `/notes/extract-document-text`.
 *
 * Touches: `StudySetUpload` (draws these), `CourseWorkspace` (`onImport` /
 * `onRecord` / `onNoMaterial`), `ImportAndStudyModal` (the `StudyUploadSource`
 * each door names, and the handlers `routeUploadFiles` picks).
 */
import type { StudyUploadSource } from '@lantern/shared';
import { DOCX_MIME } from '@lantern/shared/utils/noteUpload';
import type { AppIconName } from '../ui/AppIcon';

/** What pressing a door does. */
export type UploadDoorAction =
  /** Open the import modal focused on this source. */
  | { kind: 'import'; source: StudyUploadSource }
  /** Open the lecture studio's recorder. */
  | { kind: 'record' }
  /** Start without a file: the notes-from-a-topic wizard. */
  | { kind: 'noMaterial' };

export interface UploadDoor {
  id: string;
  label: string;
  icon: AppIconName;
  /** What it opens. Required — a door with nothing behind it does not ship. */
  action: UploadDoorAction;
}

/** The 3×2 grid, in the reference's order with the dead doors removed. */
export const UPLOAD_DOORS_PRIMARY: readonly UploadDoor[] = [
  {
    id: 'ppt',
    label: 'Powerpoints',
    icon: 'easel',
    action: { kind: 'import', source: 'ppt' },
  },
  {
    id: 'pdf',
    label: 'PDF Documents',
    icon: 'document-text',
    action: { kind: 'import', source: 'pdf' },
  },
  {
    id: 'docx',
    label: 'Word Documents',
    // `document` is lucide's File; `document-attach` is a paperclip.
    icon: 'document',
    action: { kind: 'import', source: 'docx' },
  },
  {
    id: 'quizlet',
    label: 'Import Quizlet',
    icon: 'layers',
    action: { kind: 'import', source: 'anki' },
  },
  {
    id: 'youtube',
    label: 'YouTube Video',
    icon: 'logo-youtube',
    action: { kind: 'import', source: 'youtube' },
  },
  {
    id: 'handwritten',
    label: 'Photos & Handwriting',
    icon: 'camera',
    action: { kind: 'import', source: 'photo' },
  },
];

/** Behind "View more upload types": two columns, then one centred. */
export const UPLOAD_DOORS_MORE: readonly UploadDoor[] = [
  {
    id: 'blank',
    label: 'Create Blank Notes',
    icon: 'create',
    action: { kind: 'import', source: 'blank' },
  },
  {
    id: 'none',
    label: 'No Material',
    icon: 'sparkle',
    action: { kind: 'noMaterial' },
  },
  {
    id: 'paste',
    label: 'Paste Notes',
    icon: 'clipboard',
    action: { kind: 'import', source: 'paste' },
  },
];

export const UPLOAD_DOORS: readonly UploadDoor[] = [
  ...UPLOAD_DOORS_PRIMARY,
  ...UPLOAD_DOORS_MORE,
];

/**
 * The docx mime, spelled once — in `@lantern/shared/utils/noteUpload`, because
 * the phone's Word door asks its document picker for the same string and a mime
 * that drifts is a picker that shows no files at all. Re-exported here so every
 * existing importer of this module keeps working. Legacy binary `.doc` is
 * deliberately absent.
 */
export { DOCX_MIME };

/**
 * The dropzone's `accept`. It is the UNION of the modal's own file inputs and
 * nothing more, so a file the page accepts is always a file a handler exists
 * for — see `routeUploadFiles`, which is the same list as a decision.
 *
 * `.doc` is NOT here. The pre-2007 binary format is not a ZIP and nothing in
 * the stack can read it; offering it would mean accepting a file only to
 * refuse it after a 25 MB upload.
 */
export const UPLOAD_ACCEPT =
  '.pdf,application/pdf,' +
  '.pptx,.ppt,' +
  'application/vnd.openxmlformats-officedocument.presentationml.presentation,' +
  'application/vnd.ms-powerpoint,' +
  `.docx,${DOCX_MIME},` +
  'image/*';

export type RoutedUpload =
  | { kind: 'pdf'; file: File }
  | { kind: 'presentation'; file: File }
  | { kind: 'document'; file: File }
  | { kind: 'images'; files: File[] }
  | { kind: 'unsupported'; message: string };

const isPdf = (file: File) =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

const isPresentation = (file: File) =>
  /presentationml|ms-powerpoint/.test(file.type) || /\.pptx?$/i.test(file.name);

/**
 * A Word document. Matched on `.docx` only: a `.doc` reaching here would be
 * uploaded and then refused by the server, so it falls through to
 * `unsupported` and gets told to re-save — before any bytes move.
 */
const isDocument = (file: File) =>
  file.type === DOCX_MIME || /\.docx$/i.test(file.name);

const isLegacyDoc = (file: File) => /\.doc$/i.test(file.name);

const isImage = (file: File) => file.type.startsWith('image/');

/**
 * Which handler a set of dropped files belongs to.
 *
 * ONE KIND PER DROP. Images are the only type the pipeline batches (a
 * photographed handout is many pages of one note); a PDF, a deck and a Word
 * document are separate notes and separate generator runs, so the first file
 * wins and the student is told. Silently importing only one of five files is
 * the failure this refuses to make quietly.
 */
export function routeUploadFiles(files: readonly File[]): RoutedUpload {
  const first = files[0];
  if (!first) {
    return { kind: 'unsupported', message: 'No file was chosen.' };
  }
  const images = files.filter(isImage);
  if (images.length > 0 && images.length === files.length) {
    return { kind: 'images', files: images };
  }
  if (isPdf(first)) return { kind: 'pdf', file: first };
  if (isPresentation(first)) return { kind: 'presentation', file: first };
  if (isDocument(first)) return { kind: 'document', file: first };
  if (isImage(first)) return { kind: 'images', files: images };
  if (isLegacyDoc(first)) {
    return {
      kind: 'unsupported',
      message: `“${first.name}” is a legacy Word file. Open it in Word and save as .docx, then try again.`,
    };
  }
  return {
    kind: 'unsupported',
    message: `Lantern cannot read “${first.name}” yet. Try a PDF, a PowerPoint, a Word document, or photos.`,
  };
}

/**
 * The checklist under "What is generated" — what Lantern's pipeline actually
 * produces from an upload, not what the reference's does.
 */
export const UPLOAD_GENERATED: readonly { title: string; detail: string }[] = [
  {
    title: 'Study Materials',
    detail: 'Smart Notes, flashcards, quizzes, tests and games from what you uploaded',
  },
  {
    title: 'Plans & Progress Tracking',
    detail: 'Units and topics, with what you have covered and mastered',
  },
  {
    title: 'A tutor that has read it',
    detail: 'Chat answers cite the material in this set',
  },
];
