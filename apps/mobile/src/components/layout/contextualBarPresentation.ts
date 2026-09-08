/**
 * The contextual row's PRESENTATION decisions, as pure data (founder decision 4,
 * 2026-09-08).
 *
 * Decision 4 rewrites how a row item is drawn: the SELECTED item shows its label
 * beside its icon inside a filled pill; every other item is its icon alone. This
 * file owns the three decisions that make that safe and testable —
 *
 *  1. WHICH item shows a label (only the selected one), and
 *  2. what each item's ACCESSIBLE NAME is (always its full label, even when the
 *     word is not drawn — hiding a label visually must never hide it from a
 *     screen reader), and
 *  3. how a long label BEHAVES ({@link CONTEXTUAL_PILL_LABEL}).
 *
 * The leading EXIT control is not here. It is not part of an item's
 * presentation: it belongs to the bottom bar, which outlives this row (the row
 * unmounts while the keyboard is up), so BottomTabBar draws it from the rules
 * lane's `contextualExitControl` and `canPopFocusedStack` directly. One exit, in
 * one file.
 *
 * Pure and node-testable, with no imports at all: ContextualBar.tsx is a thin
 * shell over these numbers, the same bargain contextualBarLayout.ts already
 * makes — mobile jest runs on the node environment and cannot render the native
 * component, so the rules have to live here to be exercised.
 */

/** The little the pill planner needs off an item: its id and its visible word. */
export interface ContextualPillInput {
  id: string;
  label: string;
}

export interface ContextualPillPlan {
  id: string;
  /** The word — drawn only when {@link showLabel}. */
  label: string;
  /** Is this the item that IS the screen you are looking at? */
  selected: boolean;
  /**
   * Whether the label is DRAWN beside the icon. True for the selected item
   * only; every other item is icon-only (founder decision 4).
   */
  showLabel: boolean;
  /**
   * The item's accessible name, ALWAYS its full label — including for the
   * icon-only items whose word is not on screen. This is the accessibility
   * half of decision 4: the label leaves the screen, never the a11y tree.
   */
  accessibleName: string;
  /**
   * The segment's flex share of the row ({@link CONTEXTUAL_SEGMENT_FLEX}).
   *
   * The one that carries a word needs more room than one that is a glyph, and
   * this is not a nicety: five EQUAL segments on a 360 dp phone leave about
   * 14 dp for the word once the pill's own chrome is paid, which ellipsises
   * "Library" down to nothing and ships a promoted label no one can read — the
   * exact failure decision 4 exists to end. {@link contextualPillLabelSpace} is
   * the number the test measures.
   */
  flex: number;
}

/**
 * Per-item pill plan: only the selected item shows its label, and every item
 * keeps its full label as an accessible name.
 *
 * `selectedId` is the id of {@link activeItem} — the item whose target IS the
 * focused route — or null/undefined when the row has no active item (Study's
 * hub, and the deck/note/community rows whose SCREEN is not one of their items).
 * When it is null, no item shows a label, which is the honest answer: nothing on
 * this row is the current screen, so no word is promoted.
 */
export function planContextualPills(
  items: readonly ContextualPillInput[],
  selectedId: string | null | undefined,
): ContextualPillPlan[] {
  return items.map((item) => {
    const selected = selectedId != null && item.id === selectedId;
    return {
      id: item.id,
      label: item.label,
      selected,
      showLabel: selected,
      accessibleName: item.label,
      flex: selected ? CONTEXTUAL_SEGMENT_FLEX.selected : CONTEXTUAL_SEGMENT_FLEX.unselected,
    };
  });
}

/**
 * How the row divides its width: the labelled segment takes a bigger share.
 *
 * With nothing selected every item is `unselected`, so the shares are equal and
 * the row is exactly today's — no gap, no left-packing. With one selected the
 * word gets the room it needs to actually be a word.
 */
export const CONTEXTUAL_SEGMENT_FLEX = {
  selected: 3,
  unselected: 1,
};

/**
 * Everything the pill spends on chrome before the first letter, in dp.
 *
 * The segment's own `px-1` (3.5 each side), the pill's `px-2.5` (8.75 each
 * side), the 18 dp icon and the `ml-1.5` (5.25) between icon and word — at
 * NativeWind's rem of 14. Kept here, next to the rule that has to clear it, so
 * a padding change in ContextualBar.tsx that quietly starves the label shows up
 * as a failing number rather than as a screenshot no one takes.
 */
export const CONTEXTUAL_PILL_CHROME_WIDTH = 48;

/**
 * The dp actually left for the selected item's WORD on a row of `itemCount`
 * items, once the exit control and the pill's chrome are paid.
 *
 * `rowWidth` is the bar's width, `exitWidth` the leading exit control's (0 on an
 * above-mode row, which has none). Pure arithmetic on the same flex shares the
 * component uses, so the test can assert the worst real row — Study's five
 * items on the narrowest phone — still fits "Flashcards".
 */
export function contextualPillLabelSpace({
  rowWidth,
  exitWidth,
  itemCount,
}: {
  rowWidth: number;
  exitWidth: number;
  itemCount: number;
}): number {
  if (itemCount <= 0) return 0;
  const shares = CONTEXTUAL_SEGMENT_FLEX.selected + (itemCount - 1) * CONTEXTUAL_SEGMENT_FLEX.unselected;
  const selectedWidth = ((rowWidth - exitWidth) * CONTEXTUAL_SEGMENT_FLEX.selected) / shares;
  return selectedWidth - CONTEXTUAL_PILL_CHROME_WIDTH;
}

/**
 * The longest label any registry carries ("Flashcards", 10 characters) at the
 * pill's 15 sp semibold, taken at a deliberately pessimistic 7.5 dp per
 * character. A row that leaves less than this ellipsises the promoted word.
 */
export const LONGEST_PILL_LABEL_WIDTH = 75;

/**
 * How the selected item's label behaves when it is long ("Flashcards" is the
 * worst case) and at a large accessibility text size.
 *
 * One line, tail-ellipsised: the pill grows to the word and, past the width the
 * row can give it, truncates rather than wrapping onto a second line the 44 dp
 * row has no height for. Font scaling is CAPPED so that single line stays inside
 * the row at the largest supported text size — an uncapped `text-body` at a 2x+
 * accessibility scale would grow the line box past 44 dp and clip. The cap is on
 * the DRAWN word only; the accessible name is a plain string a screen reader
 * announces at full effect regardless, so nothing is lost to the reader who
 * needs the size most.
 */
export const CONTEXTUAL_PILL_LABEL = {
  numberOfLines: 1 as const,
  ellipsizeMode: 'tail' as const,
  /**
   * 15 sp (`text-body`) * 1.3 = 19.5 sp, inside `text-body`'s 22 line box and
   * the 44 dp row. Raising this risks a clipped word at large text sizes.
   */
  maxFontSizeMultiplier: 1.3,
};
