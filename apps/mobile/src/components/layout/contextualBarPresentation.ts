/**
 * The contextual row's PRESENTATION decisions, as pure data — founder decision 4
 * (2026-09-08) as amended by the "name the current place, always" decision that
 * build 175's device pass forced.
 *
 * THE PROBLEM this file now solves. Decision 4 said "draw the label on the
 * SELECTED item only; every other item is its icon alone." That is right where a
 * row HAS a selected item — one of Study's five doors, one of Shop's three — but
 * six of the eight surfaces never have one, and there the rule gave no name at
 * all: the Study hub and Notes are Study surfaces that none of the row's five
 * doors is (no door is the current screen), and the four `above` rows (deck,
 * note, walk-through, community) can NEVER have a selection, because their items
 * are actions and routes that lead elsewhere. (Shop is the one `replace` row
 * that always HAS a selection — Browse is `activeFor` its root — so its name is
 * carried by the app bar instead; see `campusAppBarTitleOverride`.) On the
 * device those six read as bare, unlabelled icon strips — the
 * four above ones stacked on the fully-labelled global bar looked like a top row
 * whose labels had failed to render.
 *
 * THE FOUNDER'S DECISION, encoded here as three surfaces one planner chooses
 * between ({@link planContextualRow}):
 *
 *  1. A `replace` row WITH a selection keeps decision 4 exactly: the selected
 *     door shows its label in a filled pill, every other item is icon-only.
 *  2. A `replace` row with NO selection — the Study hub and Notes —
 *     draws a leading title that names the SECTION itself ("Study", "Shop"). It
 *     is not a control (you are already here); it is a title, so it must not look
 *     like the selected pill's button.
 *  3. An `above` row keeps a small label under EVERY icon — it is a screen you
 *     pass through, not a section, so there is no door to promote and every one
 *     of its ambiguous glyphs (Match vs Cram, Rooms vs Members) needs its word.
 *
 * This file owns, for all three, the same three questions it always has —
 *
 *  1. WHICH element carries a visible word (the selected door, or the section
 *     title, or every item), and
 *  2. what each item's and the title's ACCESSIBLE NAME is (always its full label
 *     / the section name, even when nothing is drawn — hiding a word visually
 *     must never hide it from a screen reader), and
 *  3. how a long word BEHAVES ({@link CONTEXTUAL_PILL_LABEL}).
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

/** The little each planner needs off an item: its id and its visible word. */
export interface ContextualPillInput {
  id: string;
  label: string;
}

/**
 * How a single item is DRAWN.
 *
 * - `selectedPill` — icon + label inside the feature's filled tint pill. The one
 *   door that IS the current screen, on a `replace` row (decision 1).
 * - `iconOnly` — the icon alone, its word carried only as an accessible name.
 *   Every non-selected door on a `replace` row.
 * - `labeledIcon` — icon with a small label UNDER it, no fill. Every item of an
 *   `above` row, so a pass-through screen's toolbar never reads as a strip of
 *   nameless glyphs (decision 3).
 */
export type ContextualItemVariant = 'selectedPill' | 'iconOnly' | 'labeledIcon';

export interface ContextualPillPlan {
  id: string;
  /** The word — drawn unless {@link variant} is `iconOnly`. */
  label: string;
  /** Is this the door that IS the screen you are looking at? */
  selected: boolean;
  /** How this item is drawn — see {@link ContextualItemVariant}. */
  variant: ContextualItemVariant;
  /**
   * Whether a word is DRAWN for this item. A convenience over {@link variant}
   * (true unless `iconOnly`), so the component asks one thing.
   */
  showLabel: boolean;
  /**
   * The item's accessible name, ALWAYS its full label — including for the
   * icon-only items whose word is not on screen. This is the accessibility
   * half of the decision: the label leaves the screen, never the a11y tree.
   */
  accessibleName: string;
  /**
   * The segment's flex share of the row ({@link CONTEXTUAL_SEGMENT_FLEX}).
   *
   * The one that carries the selected pill's word needs more room than a glyph,
   * and this is not a nicety: five EQUAL segments on a 360 dp phone leave about
   * 14 dp for the word once the pill's own chrome is paid, which ellipsises
   * "Flashcards" down to nothing and ships a promoted label no one can read.
   * {@link contextualPillLabelSpace} is the number the test measures. Every
   * `labeledIcon` and `iconOnly` segment gets the equal `unselected` share.
   */
  flex: number;
}

/**
 * The leading title that names the SECTION, drawn ONLY on a `replace` row with
 * no selected door (the Study hub and Notes). Null on every other
 * surface — a selected door or the items themselves carry the name there.
 */
export interface ContextualSectionPlan {
  /** The section's display name — the place you are on ("Study", "Shop"). */
  name: string;
  /** Always the section name; a title is never announced blank. */
  accessibleName: string;
  /** Its flex share — the same bigger share the selected pill would take. */
  flex: number;
}

/** The whole row: an optional leading section title, then the items. */
export interface ContextualRowPlan {
  section: ContextualSectionPlan | null;
  items: ContextualPillPlan[];
}

/**
 * Choose the row's presentation from its mode, its section name, its items and
 * which item (if any) is the current screen — "name the current place, always".
 *
 * `selectedId` is the id of the active item — the door whose target IS the
 * focused route — or null/undefined when nothing on the row is the current
 * screen (Study's hub, Notes, and every `above` row, none of whose items
 * is ever a place you stand on).
 *
 * The three surfaces, in the order the branches test them:
 *
 * - `above` → every item is a `labeledIcon`, equal shares. No section title (a
 *   pass-through screen names itself in its own header) and never a selection.
 * - `replace` with no matching selection → a section title carrying `sectionName`
 *   plus icon-only items. The honest answer to "where am I" when no door is the
 *   current screen.
 * - `replace` with a selection → the selected door is a `selectedPill`, the rest
 *   icon-only. Decision 4, unchanged.
 */
export function planContextualRow({
  mode,
  sectionName,
  items,
  selectedId,
}: {
  mode: 'replace' | 'above';
  sectionName: string;
  items: readonly ContextualPillInput[];
  selectedId: string | null | undefined;
}): ContextualRowPlan {
  if (mode === 'above') {
    return {
      section: null,
      items: items.map(item => ({
        id: item.id,
        label: item.label,
        selected: false,
        variant: 'labeledIcon',
        showLabel: true,
        accessibleName: item.label,
        flex: CONTEXTUAL_SEGMENT_FLEX.unselected,
      })),
    };
  }

  const selected = selectedId != null && items.some(item => item.id === selectedId);

  if (!selected) {
    return {
      section: {
        name: sectionName,
        accessibleName: sectionName,
        flex: CONTEXTUAL_SEGMENT_FLEX.selected,
      },
      items: items.map(item => ({
        id: item.id,
        label: item.label,
        selected: false,
        variant: 'iconOnly',
        showLabel: false,
        accessibleName: item.label,
        flex: CONTEXTUAL_SEGMENT_FLEX.unselected,
      })),
    };
  }

  return {
    section: null,
    items: items.map(item => {
      const isSelected = item.id === selectedId;
      return {
        id: item.id,
        label: item.label,
        selected: isSelected,
        variant: isSelected ? 'selectedPill' : 'iconOnly',
        showLabel: isSelected,
        accessibleName: item.label,
        flex: isSelected ? CONTEXTUAL_SEGMENT_FLEX.selected : CONTEXTUAL_SEGMENT_FLEX.unselected,
      };
    }),
  };
}

/**
 * How the row divides its width: the labelled segment takes a bigger share.
 *
 * With everything icon-only (a selection's non-selected doors) or every item a
 * `labeledIcon` (an `above` row), the shares are equal and the row divides
 * exactly as it always has — no gap, no left-packing. The `selected` share goes
 * to whichever ONE element carries a horizontal word: the selected pill, or the
 * section title.
 */
export const CONTEXTUAL_SEGMENT_FLEX = {
  selected: 3,
  unselected: 1,
};

/**
 * Everything the SELECTED PILL spends on chrome before the first letter, in dp.
 *
 * The segment's own `px-1` (3.5 each side), the pill's `px-2.5` (8.75 each
 * side), the 18 dp icon and the `ml-1.5` (5.25) between icon and word — at
 * NativeWind's rem of 14. Kept here, next to the rule that has to clear it, so
 * a padding change in ContextualBar.tsx that quietly starves the label shows up
 * as a failing number rather than as a screenshot no one takes.
 */
export const CONTEXTUAL_PILL_CHROME_WIDTH = 48;

/**
 * The chrome a SECTION TITLE spends before its first letter, in dp.
 *
 * A title has no icon and no pill fill — just its segment `px-2.5` (8.75 each
 * side) — so it clears far less than the selected pill, which is why "Study" and
 * "Shop" sit comfortably even on the tightest replace row.
 */
export const CONTEXTUAL_SECTION_CHROME_WIDTH = 18;

/**
 * The chrome a LABELED ICON spends on either side of its (vertically stacked)
 * word, in dp: just the segment's own `px-1` (3.5 each side). The icon sits
 * ABOVE the word, so it costs height, not width.
 */
export const CONTEXTUAL_LABELED_ICON_CHROME_WIDTH = 8;

/**
 * The dp actually left for the SELECTED PILL's WORD on a `replace` row of
 * `itemCount` items, once the exit control and the pill's chrome are paid.
 *
 * `rowWidth` is the bar's width, `exitWidth` the leading exit control's. The
 * selected pill is ONE OF the items, so the shares are `selected` plus
 * `itemCount - 1` unselected. Pure arithmetic on the same flex shares the
 * component uses, so the test can assert the worst real row — Study's five items
 * on the narrowest phone — still fits "Flashcards".
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
 * The dp left for the SECTION TITLE's word on a `replace` row with no selection.
 *
 * Here the title is an EXTRA leading segment ADDED to the `itemCount` icon-only
 * doors, so the shares are `selected` plus `itemCount` unselected — one more
 * unselected share than the selected-pill case, because the title does not take
 * a door's place, it precedes them all.
 */
export function contextualSectionLabelSpace({
  rowWidth,
  exitWidth,
  itemCount,
}: {
  rowWidth: number;
  exitWidth: number;
  itemCount: number;
}): number {
  if (itemCount < 0) return 0;
  const shares = CONTEXTUAL_SEGMENT_FLEX.selected + itemCount * CONTEXTUAL_SEGMENT_FLEX.unselected;
  const sectionWidth = ((rowWidth - exitWidth) * CONTEXTUAL_SEGMENT_FLEX.selected) / shares;
  return sectionWidth - CONTEXTUAL_SECTION_CHROME_WIDTH;
}

/**
 * The dp left for a LABELED ICON's word on an `above` row of `itemCount` equal
 * segments (an above row never carries an exit control).
 *
 * Equal shares, so each segment is simply `rowWidth / itemCount` less its slim
 * chrome. The worst real above row is four items; the test asserts even the
 * longest above label clears it.
 */
export function contextualLabeledIconLabelSpace({
  rowWidth,
  itemCount,
}: {
  rowWidth: number;
  itemCount: number;
}): number {
  if (itemCount <= 0) return 0;
  return rowWidth / itemCount - CONTEXTUAL_LABELED_ICON_CHROME_WIDTH;
}

/**
 * The longest label any door carries into a selected pill ("Flashcards", 10
 * characters) at the pill's 15 sp semibold, taken at a deliberately pessimistic
 * 7.5 dp per character. A row that leaves less than this ellipsises the promoted
 * word.
 */
export const LONGEST_PILL_LABEL_WIDTH = 75;

/**
 * The longest SECTION name a `replace` row draws ("Study", 5 characters) at the
 * title's 15 sp semibold, same pessimistic 7.5 dp per character. ("Shop" is
 * shorter; the `above` rows' names are never drawn as titles.)
 */
export const LONGEST_SECTION_LABEL_WIDTH = 38;

/**
 * The longest label an `above` row draws under an icon ("Members", 7 characters)
 * at the same pessimistic 7.5 dp per character. Above rows never carry
 * "Flashcards"; their words are all short, but the row still has to fit the
 * longest of them.
 */
export const LONGEST_LABELED_ICON_WIDTH = 53;

/**
 * How a DRAWN word behaves when it is long ("Flashcards" is the worst case) and
 * at a large accessibility text size. One rule for all three drawn words — the
 * selected pill, the section title, the labelled icon.
 *
 * One line, tail-ellipsised: the word grows to its space and, past the width the
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
