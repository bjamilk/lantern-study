/**
 * The contextual row's PRESENTATION decisions, as pure data — founder decision 4
 * (2026-09-08) as amended by the "label every door on a no-selection surface"
 * decision that build 176's device pass forced.
 *
 * THE PROBLEM this file now solves. Decision 4 said "draw the label on the
 * SELECTED item only; every other item is its icon alone." That is right where a
 * row HAS a selected item — one of Study's five doors, one of Shop's three — but
 * two of the eight surfaces never have one: the Study hub and Notes are Study
 * surfaces that none of the row's five doors IS (no door is the current screen).
 * Build 175 tried a leading SECTION TITLE there ("Study"), and build 176's
 * device pass rejected it: the title spent a third of the bar on a word the
 * screen already carries twice (the app bar and the page heading both read
 * "Study") while squeezing the five doors NARROWER than before. The information
 * a student lacks on that surface is what the five icons ARE, not which section
 * they are in.
 *
 * THE FOUNDER'S DECISION, encoded here: on a NO-SELECTION surface, label every
 * door — the exact `labeledIcon` treatment the four `above` rows already use, so
 * it is a reuse, not a new variant. That collapses the surfaces to two planner
 * branches ({@link planContextualRow}):
 *
 *  1. A `replace` row WITH a selection keeps decision 4 exactly: the selected
 *     door shows its label in a filled pill, every other item is icon-only.
 *  2. Every OTHER row — an `above` row, OR a `replace` row with NO selection
 *     (the Study hub, Notes, the Shop root) — draws every item as icon + its
 *     small label. One code path: a no-selection replace row is presented the
 *     same way a pass-through row is, because in both the honest answer is "here
 *     is what each door does," not "here is the door you are on" (there is none)
 *     and not "here is the section" (the app bar already names it).
 *
 * This file owns, for both, the same three questions it always has —
 *
 *  1. WHICH element carries a visible word (the selected door, or every item),
 *     and
 *  2. what each item's ACCESSIBLE NAME is (always its full label, even when the
 *     word is not drawn — hiding a word visually must never hide it from a
 *     screen reader), and
 *  3. how a long word BEHAVES ({@link CONTEXTUAL_PILL_LABEL}).
 *
 * The leading EXIT control is not here. It is not part of an item's
 * presentation: it belongs to the bottom bar, which outlives this row (the row
 * unmounts while the keyboard is up), so BottomTabBar draws it from the rules
 * lane's `contextualExitControl` and `canPopFocusedStack` directly. One exit, in
 * one file. Its width DOES matter to the arithmetic here, though: a no-selection
 * `replace` row carries the exit AND labels every door, so it is the tightest
 * labelled row in the app — {@link contextualLabeledIconLabelSpace} subtracts it.
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
 *   Every non-selected door on a `replace` row WITH a selection.
 * - `labeledIcon` — icon with a small label UNDER it, no fill. Every item of an
 *   `above` row AND every door of a `replace` row with NO selection, so a
 *   pass-through toolbar and a section hub alike read as a labelled row rather
 *   than a strip of nameless glyphs (decision 2).
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
   * Only the SELECTED PILL takes the bigger share, and it is not a nicety: five
   * EQUAL segments on a 360 dp phone leave about 14 dp for the pill's word once
   * its own chrome is paid, which ellipsises "Flashcards" down to nothing and
   * ships a promoted label no one can read ({@link contextualPillLabelSpace} is
   * the number the test measures). Every `labeledIcon` and `iconOnly` segment
   * gets the equal `unselected` share — a labelled word sits UNDER its icon and
   * so spends the segment's height, not a bigger width slice.
   */
  flex: number;
}

/** The whole row: just its items — every one carries its own presentation. */
export interface ContextualRowPlan {
  items: ContextualPillPlan[];
}

/**
 * Choose the row's presentation from its items and which item (if any) is the
 * current screen.
 *
 * `selectedId` is the id of the active item — the door whose target IS the
 * focused route — or null/undefined when nothing on the row is the current
 * screen (Study's hub, Notes, the Shop root, and every pass-through row, none
 * of whose items is ever a place you stand on).
 *
 * The two surfaces, in the order the branches test them:
 *
 * - A row WITH a matching selection → the selected door is a `selectedPill`,
 *   every other door a labelled icon.
 * - No selection → every item is a `labeledIcon`, equal shares: a surface that
 *   is none of its own doors names each door rather than the section.
 */
export function planContextualRow({
  items,
  selectedId,
}: {
  items: readonly ContextualPillInput[];
  selectedId: string | null | undefined;
}): ContextualRowPlan {
  // SELECTION ALONE decides the surface. There used to be a `mode` gate here
  // (`mode === 'replace' && …`), and with the replace mode removed it would
  // have taken the selected door's pill down with it: every row, including
  // Study's, would draw five identical labelled icons and nothing would say
  // which door IS the screen. A row whose registry has no door for the focused
  // route simply passes `selectedId` as null and lands in the first branch, so
  // the pass-through rows (deck, note, walk-through, community) are unchanged.
  const selected = selectedId != null && items.some(item => item.id === selectedId);

  if (!selected) {
    // An `above` row, or a `replace` row with no door selected: label every
    // item, one code path. `above` never has a selection to begin with, so a
    // stray selectedId on it is ignored here too.
    return {
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

  // A replace row WITH a selection. EVERY door is labelled — the selected one
  // inside its pill, the rest under their icons — and every door takes the
  // same share.
  //
  // WHAT CHANGED, AND WHY (founder direction 2026-09-11, superseding decision
  // 4's "icon-only" half). Decision 4 hid the four unselected labels to buy the
  // selected one a horizontal word, and on device that is what the Study row
  // looked like on Library, Flashcards and Tests: four nameless glyphs beside
  // one word. The fix is not to squeeze the four; it is to stop spending the
  // row's width horizontally. The selected door now stacks its word UNDER its
  // icon inside the pill, exactly as the four beside it do and exactly as the
  // global bar's lit tab does, so all five need only the labelled-icon space —
  // which {@link contextualLabeledIconLabelSpace} already measures as fitting.
  //
  // The pill survives as the SHAPE that says "you are here"; only its
  // direction changed. Nothing about the accent logic moved: the pill is still
  // the selected door's own tint under its own ink.
  return {
    items: items.map(item => {
      const isSelected = item.id === selectedId;
      return {
        id: item.id,
        label: item.label,
        selected: isSelected,
        variant: isSelected ? 'selectedPill' : 'labeledIcon',
        showLabel: true,
        accessibleName: item.label,
        flex: isSelected ? CONTEXTUAL_SEGMENT_FLEX.selected : CONTEXTUAL_SEGMENT_FLEX.unselected,
      };
    }),
  };
}

/**
 * How the row divides its width: EQUALLY, on every surface.
 *
 * The `selected` share used to be 3, and it had to be: the selected door drew
 * its word HORIZONTALLY beside its icon, which costs ~48 dp of chrome before
 * the first letter, and at an equal share that leaves ~14 dp and the word
 * ellipsised to "L…". The bigger share paid for that, out of the four doors
 * beside it — which is why they had no room for a word at all and were drawn
 * icon-only.
 *
 * Since the founder direction of 2026-09-11 the selected door stacks its word
 * under its icon like every other door, so it needs no more room than they do
 * and they get their labels back. The two keys are kept, and kept equal, so the
 * intent is legible: there is no longer a door on this row that is wider than
 * its neighbours. Raising `selected` again would silently re-starve the four.
 */
export const CONTEXTUAL_SEGMENT_FLEX = {
  selected: 1,
  unselected: 1,
};

/**
 * Everything the SELECTED PILL spends on chrome before the first letter, in dp.
 *
 * Now that the pill STACKS its word under its icon (founder direction
 * 2026-09-11) the icon costs height rather than width, so the chrome is only
 * padding: the segment's own `px-1` (3.5 each side) plus the pill's `px-1.5`
 * (5.25 each side) at NativeWind's rem of 14. It was 48 when the word sat
 * beside a 18 dp icon — that 30 dp is exactly what the four doors beside it
 * were paying for, and exactly why they had no labels.
 *
 * Kept here, next to the rule that has to clear it, so a padding change in
 * ContextualBar.tsx that quietly starves the label shows up as a failing
 * number rather than as a screenshot no one takes.
 */
export const CONTEXTUAL_PILL_CHROME_WIDTH = 18;

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
 * selected pill is ONE OF the items and now takes the same share as the rest
 * (see {@link CONTEXTUAL_SEGMENT_FLEX}), so the arithmetic is the labelled
 * icon's with the pill's own padding subtracted on top — the pill is the only
 * thing on this row that pays for a fill.
 *
 * Pure arithmetic on the same shares the component uses, so the test can assert
 * the worst real row — Study's five items plus the exit on the narrowest phone.
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
  return (rowWidth - exitWidth) / itemCount - CONTEXTUAL_PILL_CHROME_WIDTH;
}

/**
 * The dp left for a LABELED ICON's word on a row of `itemCount` equal segments.
 *
 * `exitWidth` defaults to 0 — an `above` row carries no exit, so each segment is
 * simply `rowWidth / itemCount` less its slim chrome, exactly as before. A
 * no-selection `replace` row is the new caller: it DOES carry the leading exit
 * (BottomTabBar draws it), so it passes the exit's width and the doors divide
 * only what is left of the bar. That makes Study's five labelled doors plus the
 * exit the tightest labelled row in the app — see {@link LONGEST_LABELED_ICON_WIDTH}
 * for what happens to "Flashcards" there.
 */
export function contextualLabeledIconLabelSpace({
  rowWidth,
  itemCount,
  exitWidth = 0,
}: {
  rowWidth: number;
  itemCount: number;
  exitWidth?: number;
}): number {
  if (itemCount <= 0) return 0;
  return (rowWidth - exitWidth) / itemCount - CONTEXTUAL_LABELED_ICON_CHROME_WIDTH;
}

/**
 * The longest label any door carries into a selected pill ("Flashcards", 10
 * characters), at the same deliberately pessimistic 7.5 dp per character as
 * every other drawn word on this row.
 *
 * The pill's word is now the 11 sp `label` step stacked under its icon rather
 * than the old 15 sp beside it, so this is the SAME ceiling as
 * {@link LONGEST_LABELED_ICON_WIDTH} and carries the same accepted trade: on
 * the narrowest phone the tightest row (Study's five doors plus the exit) sits
 * just under it and the tenth glyph may go to the tail ellipsis, while the full
 * word is always announced. Kept as its own name because the pill pays a little
 * more chrome than a bare labelled icon does.
 */
export const LONGEST_PILL_LABEL_WIDTH = 75;

/**
 * The longest label drawn UNDER an icon, app-wide: "Flashcards" (10 characters),
 * which the Study hub's no-selection `replace` row now labels. Taken at the same
 * deliberately pessimistic 7.5 dp per character as the pill.
 *
 * WHAT FITS, and what does not — measured, not assumed. The four `above` rows
 * (longest word "Members", seven chars) clear this comfortably: four doors, no
 * exit, so on a 360 dp phone each label gets 360/4 − 8 = 82 dp, well over the
 * 75 dp ceiling — the fit test asserts exactly this.
 *
 * The tight case is the no-selection Study row: FIVE doors PLUS the leading exit
 * (BottomTabBar's ExitControl is a fixed square of the row height, 44 dp; the
 * tests feed a pessimistic 48). Each label gets (360 − 44)/5 − 8 ≈ 55 dp, BELOW
 * this pessimistic ceiling — and unlike the pill, the shortfall is real rather
 * than only nominal. "Flashcards" at 11 sp measures ~55 dp in the iOS system
 * face at regular weight and a few dp MORE at the medium/semibold this actually
 * renders in (Android's Roboto is wider again, ~59 dp). So on the NARROWEST
 * phone the word sits right on the boundary at the default text size and may
 * tail-truncate by a glyph ("Flashcard…"); every wider phone draws it whole. At
 * the LARGEST supported scale it grows to the {@link CONTEXTUAL_PILL_LABEL} cap
 * (~71 dp) and certainly truncates.
 *
 * That is accepted, not overlooked: a truncated tenth character beats five
 * nameless icons, the word never wraps and never grows the 44 dp row
 * (`numberOfLines` is 1 and the font is capped), and the FULL word is always
 * announced through the accessible name. The five doors are also strictly wider
 * here than under build 175's title, which spent three of eight shares on the
 * section word and left each door ~40 dp.
 */
export const LONGEST_LABELED_ICON_WIDTH = 75;

/**
 * How a DRAWN word behaves when it is long ("Flashcards" is the worst case) and
 * at a large accessibility text size. One rule for both drawn words — the
 * selected pill and the labelled icon.
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
