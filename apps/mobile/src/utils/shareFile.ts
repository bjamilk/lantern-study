/**
 * Share generated content as a FILE, not as message text.
 *
 * Deck exports used `Share.share({ message: csv })`, which hands the payload to
 * the target app as a message body: picking WhatsApp pasted the entire deck into
 * a chat, and there was no `.csv` or `.json` to save or re-import anywhere. React
 * Native's Share cannot attach a file on Android at all (its `url` option is
 * iOS-only), so the file has to be written to disk and handed to the system
 * share sheet by URI.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

/** Strip anything a file system would object to, and keep it recognisable. */
export function toSafeFileName(name: string, extension: string): string {
  const base = (name || 'export')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return `${base || 'export'}.${extension}`;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  json: 'application/json',
  csv: 'text/csv',
  txt: 'text/plain',
  apkg: 'application/octet-stream',
};

/** iOS needs a Uniform Type Identifier to offer sensible share targets. */
const UTI_BY_EXTENSION: Record<string, string> = {
  json: 'public.json',
  csv: 'public.comma-separated-values-text',
  txt: 'public.plain-text',
};

export interface ShareTextFileOptions {
  /** File name without a path; the extension decides the MIME type. */
  fileName: string;
  contents: string;
  /** Title shown on the Android share sheet. */
  dialogTitle?: string;
}

export class SharingUnavailableError extends Error {
  constructor() {
    super('Sharing is not available on this device.');
    this.name = 'SharingUnavailableError';
  }
}

/**
 * Write `contents` to a temporary file and open the system share sheet for it.
 * Returns the file path, which is worth surfacing when sharing is unavailable
 * so the export is not simply lost.
 */
export async function shareTextFile({
  fileName,
  contents,
  dialogTitle,
}: ShareTextFileOptions): Promise<string> {
  const extension = fileName.split('.').pop()?.toLowerCase() || 'txt';
  // cacheDirectory, not documentDirectory: an export is a hand-off, not a
  // document the app needs to keep, and the OS can reclaim it.
  const path = `${FileSystem.cacheDirectory}${fileName}`;

  await FileSystem.writeAsStringAsync(path, contents);

  if (!(await Sharing.isAvailableAsync())) {
    throw new SharingUnavailableError();
  }

  await Sharing.shareAsync(path, {
    mimeType: MIME_BY_EXTENSION[extension] || 'application/octet-stream',
    UTI: UTI_BY_EXTENSION[extension],
    dialogTitle: dialogTitle || fileName,
  });

  return path;
}
