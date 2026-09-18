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
