const PHOTO_NOTE_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/**
 * Default title for newly imported photo notes.
 * Example: "Photos · Jul 15, 2026"
 */
export function defaultPhotoNoteTitle(date: Date = new Date()): string {
  return `Photos · ${PHOTO_NOTE_DATE_FORMATTER.format(date)}`;
}
