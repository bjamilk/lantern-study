/**
 * How tall the Import cards sheet is, and what it owes the system bars.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The sheet used to be a bottom-anchored `View` with `maxHeight: '92%'` and a
 * `flex-1` ScrollView inside it. A percentage max-height is not a height: the
 * wrapper's own main size stays INDEFINITE, so Yoga has nothing for the
 * ScrollView's `flex: 1` to grow into and resolves it to zero. The wrapper then
 * measured the header alone — 163px on a 2400px-tall device, holding "Import
 * cards" and the eyebrow and nothing else — and `overflow-hidden` clipped the
 * missing body away silently. Same failure family as the offline Download
 * Options footer and the generate-flashcards sheet (which fixed it with a
 * definite pixel height, TestConfigModal.tsx / AIGenerateFlashcardsModal.tsx).
 *
 * So the sheet gets a DEFINITE pixel height, and the arithmetic that produces
 * it lives here rather than inline: jest.config.js runs on the `node`
 * environment with `testMatch: ['**\/*.test.ts']` and cannot transform a
 * component, so numbers a component computes are numbers nobody tests.
 *
 * Deliberately imports nothing.
 */

/** Tallest the sheet may be, as a share of the window. */
export const IMPORT_SHEET_MAX_SHARE = 0.9;

/** Shortest the sheet may be, as a share of the window. */
export const IMPORT_SHEET_MIN_SHARE = 0.6;

/** Breathing room under the last control, above the system inset. */
export const IMPORT_SHEET_BOTTOM_GUTTER = 32;

export interface ImportSheetLayoutInput {
  /** `useWindowDimensions().height`. */
  windowHeight: number;
  /** Safe-area top inset — under edge-to-edge the sheet paints behind it. */
  topInset?: number;
  /** Safe-area bottom inset (gesture bar). */
  bottomInset?: number;
}

export interface ImportSheetLayout {
  /** Definite height for the sheet wrapper. Never a percentage. */
  height: number;
  /** `contentContainerStyle.paddingBottom` for the body scroller. */
  contentPaddingBottom: number;
}

function finite(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Bound the sheet between 60% and 90% of the window, shrinking toward the
 * floor when the status bar eats the top, and never returning a percentage or
 * a negative number.
 */
export function planImportSheetLayout(input: ImportSheetLayoutInput): ImportSheetLayout {
  const windowHeight = finite(input.windowHeight);
  const topInset = finite(input.topInset);
  const bottomInset = finite(input.bottomInset);

  const contentPaddingBottom = bottomInset + IMPORT_SHEET_BOTTOM_GUTTER;
  if (windowHeight <= 0) {
    return { height: 0, contentPaddingBottom };
  }

  const max = Math.round(windowHeight * IMPORT_SHEET_MAX_SHARE);
  const min = Math.round(windowHeight * IMPORT_SHEET_MIN_SHARE);
  const available = Math.round(windowHeight - topInset);

  return {
    height: Math.max(min, Math.min(max, available)),
    contentPaddingBottom,
  };
}
