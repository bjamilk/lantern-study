/**
 * Which doors the Upload Materials page draws, what each one opens, and how a
 * dropped file finds its handler.
 *
 * WHY THE DOORS ARE DATA. The page (`StudySetUpload`) draws eleven buttons in
 * two groups and the reference's own order; `CourseWorkspace` wires them. A
 * list they both read is the only way the two agree on which ones are live —
 * and it is what a test can walk to prove no door is dead.
 *
 * WHY DISABLED AND NOT HIDDEN. The founder asked for the whole flow to be
 * visible. A door Lantern cannot back yet is a real `<button disabled>` with
 * "Not available yet" as its `aria-describedby` text, so a screen reader hears
 * the reason rather than meeting a silent dead control. It is never a live
 * button that does nothing — that is the pattern the declutter pass removed.
 *
 * Touches: `StudySetUpload` (draws these), `CourseWorkspace` (`onImport` /
 * `onRecord` / `onNoMaterial`), `ImportAndStudyModal` (the `StudyUploadSource`
 * each live door names, and the handlers `routeUploadFiles` picks).
 *
 * GOTCHA: `available: false` here must mean the service genuinely does not
 * exist. Three doors the 2026-09-17 measurement assumed Lantern could not back
 * turned out to be backed — YouTube by `notesApi.createNoteFromYoutube`,
 * Quizlet by the Anki/Quizlet export paste, handwriting by the image upload
 * (whose OCR the modal already warns about honestly) — so they are live. Audio
 * and video FILE upload and Google Drive have no service at all.
 */
import type { StudyUploadSource } from '@lantern/shared';
import type { AppIconName } from '../ui/AppIcon';

/** The one sentence a disabled door explains itself with. */
export const UPLOAD_DOOR_UNAVAILABLE = 'Not available yet';

/** What pressing a live door does. */
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
  /** False renders a real disabled button carrying UPLOAD_DOOR_UNAVAILABLE. */
  available: boolean;
  /** Absent exactly when `available` is false. */
  action?: UploadDoorAction;
  /** Why it is not available — shown under the label on a disabled door. */
  reason?: string;
}

/** The 3×2 grid, in the reference's order. */
export const UPLOAD_DOORS_PRIMARY: readonly UploadDoor[] = [
  {
    id: 'ppt',
    label: 'Powerpoints',
    icon: 'easel',
    available: true,
    action: { kind: 'import', source: 'ppt' },
  },
  {
    id: 'pdf',
    label: 'PDF Documents',
    icon: 'document-text',
    available: true,
    action: { kind: 'import', source: 'pdf' },
  },
  {
    id: 'audio',
    label: 'Audio Files',
    icon: 'headphones',
    available: false,
    reason: 'Record a lecture below instead — uploading an audio file is not built yet.',
  },
  {
    id: 'video',
    label: 'Video Files',
    icon: 'play-circle',
    available: false,
    reason: 'Paste a YouTube link instead — uploading a video file is not built yet.',
  },
  {
    id: 'quizlet',
    label: 'Import Quizlet',
    icon: 'layers',
    available: true,
    action: { kind: 'import', source: 'anki' },
  },
  {
    id: 'youtube',
    label: 'YouTube Video',
    icon: 'logo-youtube',
    available: true,
    action: { kind: 'import', source: 'youtube' },
  },
];

/** Behind "View more upload types", two columns, the reference's order. */
export const UPLOAD_DOORS_MORE: readonly UploadDoor[] = [
  {
    id: 'blank',
    label: 'Create Blank Notes',
    icon: 'create',
    available: true,
    action: { kind: 'import', source: 'blank' },
  },
  {
    id: 'none',
    label: 'No Material',
    icon: 'sparkle',
    available: true,
    action: { kind: 'noMaterial' },
  },
  {
    id: 'drive',
    label: 'Google Drive',
    icon: 'cloud',
    available: false,
    reason: 'Lantern cannot sign in to Drive yet.',
  },
  {
    id: 'handwritten',
    label: 'Handwritten Notes',
    icon: 'camera',
    available: true,
    action: { kind: 'import', source: 'photo' },
  },
  {
    id: 'paste',
    label: 'Paste Notes',
    icon: 'clipboard',
    available: true,
    action: { kind: 'import', source: 'paste' },
  },
];

export const UPLOAD_DOORS: readonly UploadDoor[] = [
  ...UPLOAD_DOORS_PRIMARY,
  ...UPLOAD_DOORS_MORE,
];

/**
 * The dropzone's `accept`. It is the UNION of the modal's own file inputs and
 * nothing more, so a file the page accepts is always a file a handler exists
 * for — see `routeUploadFiles`, which is the same list as a decision.
 */
export const UPLOAD_ACCEPT =
  '.pdf,application/pdf,' +
  '.pptx,.ppt,' +
  'application/vnd.openxmlformats-officedocument.presentationml.presentation,' +
  'application/vnd.ms-powerpoint,' +
  'image/*';

export type RoutedUpload =
  | { kind: 'pdf'; file: File }
  | { kind: 'presentation'; file: File }
  | { kind: 'images'; files: File[] }
  | { kind: 'unsupported'; message: string };

const isPdf = (file: File) =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

const isPresentation = (file: File) =>
  /presentationml|ms-powerpoint/.test(file.type) || /\.pptx?$/i.test(file.name);

const isImage = (file: File) => file.type.startsWith('image/');

/**
 * Which handler a set of dropped files belongs to.
 *
 * ONE KIND PER DROP. Images are the only type the pipeline batches (a
 * photographed handout is many pages of one note); a PDF and a deck are two
 * separate notes and two separate generator runs, so the first file wins and
 * the student is told. Silently importing only one of five files is the
 * failure this refuses to make quietly.
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
  if (isImage(first)) return { kind: 'images', files: images };
  return {
    kind: 'unsupported',
    message: `Lantern cannot read “${first.name}” yet. Try a PDF, a PowerPoint, or photos.`,
  };
}

/** The checklist under "What is generated", straight off the measurement. */
export const UPLOAD_GENERATED: readonly { title: string; detail: string }[] = [
  {
    title: 'Study Materials',
    detail: 'Smart Notes, flashcards, quizzes and games from what you uploaded',
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
