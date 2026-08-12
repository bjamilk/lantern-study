/**
 * File-name handling for exports — pure, so it can be tested without dragging
 * in expo-file-system / expo-sharing (whose ESM builds jest cannot transform).
 */

/** Slugify a title into a file name body — no path separators, no surprises. */
function slugify(name: string): string {
  return (
    (name || 'export')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'export'
  );
}

/** Build a safe file name from a bare title plus an extension. */
export function toSafeFileName(name: string, extension: string): string {
  return `${slugify(name)}.${extension}`;
}

/**
 * Make an already-complete file name safe without doubling its extension.
 * Callers hand us names from two places — a deck title we choose an extension
 * for, and a server-generated name that already ends in `.csv` — and running the
 * first helper over the second would produce `applicants-2026-08-12-csv.csv`.
 */
export function sanitizeFileName(fileName: string, fallbackExtension = 'txt'): string {
  const match = /^(.*)\.([a-z0-9]{1,8})$/i.exec(fileName || '');
  if (!match) return toSafeFileName(fileName, fallbackExtension);
  return `${slugify(match[1])}.${match[2].toLowerCase()}`;
}

export const MIME_BY_EXTENSION: Record<string, string> = {
  json: 'application/json',
  csv: 'text/csv',
  txt: 'text/plain',
  apkg: 'application/octet-stream',
};

/** iOS needs a Uniform Type Identifier to offer sensible share targets. */
export const UTI_BY_EXTENSION: Record<string, string> = {
  json: 'public.json',
  csv: 'public.comma-separated-values-text',
  txt: 'public.plain-text',
};
