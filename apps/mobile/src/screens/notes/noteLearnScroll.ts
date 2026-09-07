/**
 * How much empty space the note editor's scroller needs BELOW its last card so
 * that card's heading can actually reach the top of the viewport.
 *
 * The contextual row's Learn item (spec v3 §7.2) scrolls the editor to the
 * "Learn from this note" panel, and `scrollTo({ y })` cannot go past the end of
 * the content: with the panel as the last thing in the scroller, the maximum
 * offset leaves it wherever it happens to land — in build 166 that was the
 * bottom half of the screen (`16-note-learn.png`), so the row's one visible
 * action looked half-broken.
 *
 * The arithmetic, once: to put a card's TOP at the viewport's top, everything
 * from that top downwards must be at least one viewport tall. The panel
 * contributes its own height; the rest has to be padding.
 *
 * Pure and import-free, like contextualBarLayout.ts next door, so mobile jest's
 * node environment can hold the rule without rendering anything.
 */

/** Non-finite / negative measurements are treated as 0, never as layout. */
function px(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export interface LearnTailPaddingInput {
  /**
   * The padding the screen already owed at the bottom — the tab bar and the
   * contextual row (`useTabBarClearance`). Never reduced: the last card must
   * still clear the chrome even on a screen too short to need a tail.
   */
  base: number;
  /** The scroller's own height. 0 before the first layout pass. */
  viewportHeight: number;
  /** The Learn panel's measured height. 0 before it has laid out, or when the
   *  note is view-only and the panel is not rendered at all. */
  panelHeight: number;
}

/**
 * The scroller's `paddingBottom`.
 *
 * `base` until both measurements arrive, so the screen never flashes a screen's
 * worth of empty space while it is still measuring; and never less than `base`,
 * so this can only ever ADD clearance to a list that already had enough.
 *
 * A panel taller than the viewport needs no tail at all — it can already scroll
 * its own heading to the top — which falls out of the max() rather than needing
 * a branch.
 */
export function learnTailPadding({
  base,
  viewportHeight,
  panelHeight,
}: LearnTailPaddingInput): number {
  const safeBase = px(base);
  const viewport = px(viewportHeight);
  const panel = px(panelHeight);
  if (viewport === 0 || panel === 0) return safeBase;
  return Math.max(safeBase, viewport - panel);
}
