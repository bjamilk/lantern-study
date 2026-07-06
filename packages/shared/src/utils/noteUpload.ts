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
