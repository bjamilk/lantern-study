/** Matches server MAX_PDF_BYTES / MAX_PRESENTATION_BYTES (25MB raw). */
export const MAX_NOTE_UPLOAD_BYTES = 25 * 1024 * 1024;

export const NOTE_UPLOAD_MAX_MB = Math.round(MAX_NOTE_UPLOAD_BYTES / (1024 * 1024));

export function formatMaxNoteUploadLabel(): string {
  return `Max ${NOTE_UPLOAD_MAX_MB} MB per file`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function assertNoteUploadSize(
  byteLength: number,
  fileName?: string
): void {
  if (byteLength <= MAX_NOTE_UPLOAD_BYTES) return;
  const name = fileName ? ` "${fileName}"` : '';
  throw new Error(
    `File${name} is too large (max ${NOTE_UPLOAD_MAX_MB}MB). Try a smaller file or split slides.`
  );
}

// --- Word documents (.docx) ---------------------------------------------------
// The Word import is the one door where web and mobile must agree on three
// strings — the mime the picker asks for, what a student is told about a legacy
// `.doc`, and the line that admits a document was truncated. They lived in
// `components/study/uploadDoors.ts` and `components/ImportAndStudyModal.tsx`
// (web only) until the phone grew the same door; spelled twice they drift, and
// a mime that drifts is a picker that shows no files at all.
//
// The CLIENT never parses the document: it sends the bytes to
// `POST /notes/extract-document-text` and makes an ordinary note from the text
// that comes back, exactly as the paste door does. So nothing here reads a
// file — these are the shared words and the shared name check, no more.

/** The one mime a .docx declares, and the only one the server accepts. */
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Refuse anything that is not a `.docx`, by name, before a 25 MB upload.
 *
 * Legacy binary `.doc` gets its own sentence: it is not a ZIP, nothing in the
 * stack reads it, and "unsupported file" would leave a student guessing when
 * the fix is thirty seconds in Word. The server enforces the same rule
 * (`assertDocumentFileName`) — this only moves the answer earlier.
 */
export function assertDocumentFileName(fileName: string): void {
  if (/\.docx$/i.test(fileName)) return;
  if (/\.doc$/i.test(fileName)) {
    throw new Error(
      'Legacy .doc files are not supported. Open it in Word and save as .docx, then upload again.'
    );
  }
  throw new Error('Document must be a .docx file.');
}

/**
 * The body of the note a Word import creates.
 *
 * A truncated document is not an error — the note is real, it is just the first
 * N characters. Saying so IN the note is the only way the student ever finds
 * out: a toast is gone by the time they read it, and silence would let them
 * revise from a document that quietly stops halfway.
 */
export function buildImportedDocumentBody(
  text: string,
  fileName: string,
  truncated: boolean
): string {
  if (!truncated) return text;
  return (
    `${text}\n\n---\n\n[This document was longer than Lantern reads in one note. ` +
    `Everything above is the start of “${fileName}”; split the rest into a second ` +
    `file to bring it in.]`
  );
}

// --- Plain text and Markdown (.txt / .md) -------------------------------------
// The cheapest door there is: a `.txt` or `.md` IS the note's body. Nothing is
// uploaded, nothing is parsed on the server and no credit is spent reading it —
// the client decodes the file as UTF-8 and hands the text to the same
// create-note path the paste box uses. That is why these two extensions can be
// added to the accept list without an API route to go with them.
//
// `.markdown` is accepted alongside `.md` because editors write both, and a
// student whose file the picker refuses has no way to learn which one we meant.

export const PLAIN_TEXT_MIME = 'text/plain';
export const MARKDOWN_MIME = 'text/markdown';

/** Is this a file we can read as text in the client, by name? */
export function isPlainTextFileName(fileName: string): boolean {
  return /\.(txt|md|markdown)$/i.test(fileName);
}

/**
 * The note's title for a text import: the file name with its extension taken
 * off, or a plain fallback when the name was only an extension.
 */
export function buildImportedTextTitle(fileName: string): string {
  const base = String(fileName || '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.(txt|md|markdown)$/i, '')
    .trim();
  return base || 'Imported notes';
}

/** Refuse an empty text file BEFORE a note with no body is created. */
export function assertImportedTextBody(text: string, fileName: string): void {
  if (text.trim().length > 0) return;
  throw new Error(`“${fileName}” has no text in it.`);
}

// --- iPhone photographs (.heic / .heif) ---------------------------------------
// A photo taken on an iPhone is HEIC unless the owner changed a setting, so a
// picker that does not accept it refuses the most common photograph on campus.
//
// THE DECODE HAPPENS ON THE SERVER, not in the browser. `heic2any` is the usual
// client-side answer and it is ~1.4 MB of libheif compiled to asm.js/WASM that
// every page load would carry for a file type most uploads are not — while the
// API already depends on `sharp`, whose libvips build decodes HEIC today
// (verified by round-tripping a real `sips`-written .heic through
// `sharp().metadata()` before this was written). So the bytes go up as they
// are and come back normalised to WebP like every other photograph.
//
// GOTCHA: browsers disagree about the mime for a `.heic` — Safari says
// `image/heic`, Chrome on macOS often says nothing at all. Anything matching by
// NAME must therefore be treated as an image even when `File.type` is empty,
// which is what `isHeicFileName` is for.
export const HEIC_MIMES: readonly string[] = ['image/heic', 'image/heif'];

export function isHeicFileName(fileName: string): boolean {
  return /\.(heic|heif)$/i.test(fileName);
}

export function isHeicMime(mime: string | undefined | null): boolean {
  return !!mime && HEIC_MIMES.includes(mime.toLowerCase());
}

/**
 * The one `accept` string, spelled once.
 *
 * It lived in `components/study/uploadDoors.ts` (web only) until the phone's
 * doors had to agree with it. A list that disagrees across platforms is a file
 * a student can add on their laptop and not on their phone, with nothing
 * anywhere saying why.
 *
 * `.doc` is NOT here. The pre-2007 binary format is not a ZIP and nothing in
 * the stack can read it; offering it would mean accepting a file only to refuse
 * it after a 25 MB upload. Audio and video files are not here either — there is
 * no file-transcription path, only the lecture recorder's own.
 */
export const NOTE_UPLOAD_ACCEPT =
  '.pdf,application/pdf,' +
  '.pptx,.ppt,' +
  'application/vnd.openxmlformats-officedocument.presentationml.presentation,' +
  'application/vnd.ms-powerpoint,' +
  `.docx,${DOCX_MIME},` +
  `.txt,${PLAIN_TEXT_MIME},.md,.markdown,${MARKDOWN_MIME},` +
  `.heic,.heif,${HEIC_MIMES.join(',')},` +
  'image/*';

/** What the phone's document picker asks for on the text door. */
export const TEXT_PICKER_MIMES: readonly string[] = [PLAIN_TEXT_MIME, MARKDOWN_MIME];

/** Shown when storage upload succeeded but finalize/create-note failed. */
export const NOTE_FINALIZE_FAILED_MESSAGE =
  "File uploaded but note wasn't created. Please try again.";

export function wrapNoteFinalizeError(err: unknown): Error {
  if (err instanceof Error) {
    const msg = err.message.trim();
    if (!msg || msg === 'Notes request failed' || /^Notes request failed \(\d+\)$/.test(msg)) {
      return new Error(NOTE_FINALIZE_FAILED_MESSAGE);
    }
    if (msg.includes('uploaded but note')) return err;
    return new Error(`${NOTE_FINALIZE_FAILED_MESSAGE} ${msg}`);
  }
  return new Error(NOTE_FINALIZE_FAILED_MESSAGE);
}

/** Strip directories and unsafe characters for note-files object keys. */
export function sanitizeNoteFileName(name: string): string {
  const base = String(name || 'file').replace(/^.*[\\/]/, '');
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 180);
  return cleaned || 'file';
}

export function buildNoteStoragePath(userId: string, fileName: string): string {
  return `${userId}/${Date.now()}-${sanitizeNoteFileName(fileName)}`;
}
