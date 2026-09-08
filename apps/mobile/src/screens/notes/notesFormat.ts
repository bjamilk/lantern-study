import { formatDisplayDate } from '@lantern/shared/utils/displayDate';

/**
 * The "Updated 7 Sep 2026" line on a note card.
 *
 * The list used `new Date(note.updatedAt).toLocaleDateString()`, which renders
 * M/D/YYYY ("9/7/2026") — the one place in the app still doing that, when every
 * other date reads "7 Sep 2026". Reuse the SHARED local-calendar formatter (the
 * app's standard day/month/year) rather than adding a fourth date style, and
 * return null for a missing or unparseable stamp so the line hides instead of
 * ever rendering "Invalid Date" or a 1970 fallback.
 *
 * It points at `@lantern/shared/utils/displayDate`, not a Budget-screen file:
 * the Notes date cannot break when a budget file moves.
 */
export function formatNoteUpdatedLabel(
  updatedAt: string | number | Date | null | undefined
): string | null {
  return formatDisplayDate(updatedAt) || null;
}
