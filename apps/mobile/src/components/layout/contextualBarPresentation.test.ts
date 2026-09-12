import {
  CONTEXTUAL_LABELED_ICON_CHROME_WIDTH,
  CONTEXTUAL_PILL_LABEL,
  CONTEXTUAL_SEGMENT_FLEX,
  LONGEST_LABELED_ICON_WIDTH,
  LONGEST_PILL_LABEL_WIDTH,
  contextualLabeledIconLabelSpace,
  contextualPillLabelSpace,
  planContextualRow,
  type ContextualPillInput,
} from './contextualBarPresentation';

const STUDY: ContextualPillInput[] = [
  { id: 'library', label: 'Library' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'tests', label: 'Tests' },
  { id: 'record', label: 'Record' },
  { id: 'ai', label: 'AI' },
];

// A four-item `above` row — the shape of the deck, note, walk-through and
// community registries, whose longest label is "Members".
const ABOVE: ContextualPillInput[] = [
  { id: 'a', label: 'Lounge' },
  { id: 'b', label: 'Boards' },
  { id: 'c', label: 'Rooms' },
  { id: 'd', label: 'Members' },
];

// A row that HAS a door for the focused route (Study, Shop) and a
// pass-through row that never does (deck, note, walk-through, community). Since
// build 185 removed the registry's `mode`, the only difference between them is
// whether a selection is supplied — which is exactly what these two helpers say.
const replace = (items: readonly ContextualPillInput[], selectedId: string | null | undefined) =>
  planContextualRow({ items, selectedId });

const above = (items: readonly ContextualPillInput[]) =>
  planContextualRow({ items, selectedId: null });

describe('planContextualRow: a replace row WITH a selection (2026-09-11 direction)', () => {
  it('draws the selected door as a pill and LABELS every other door', () => {
    const { items } = replace(STUDY, 'flashcards');
    expect(items.filter((p) => p.variant === 'selectedPill').map((p) => p.id)).toEqual([
      'flashcards',
    ]);
    // The device-pass finding this replaces: on Library, Flashcards and Tests
    // the in-Study row drew four NAMELESS glyphs beside one word. Every door on
    // the row now carries its name, lit or not.
    expect(items.filter((p) => p.variant === 'labeledIcon').map((p) => p.id)).toEqual([
      'library',
      'tests',
      'record',
      'ai',
    ]);
    // No surface on this bar hides a word any more.
    expect(items.filter((p) => p.variant === 'iconOnly')).toEqual([]);
    expect(items.every((p) => p.showLabel)).toBe(true);
  });

  it('marks exactly the matching door selected', () => {
    const { items } = replace(STUDY, 'ai');
    expect(items.filter((p) => p.selected).map((p) => p.id)).toEqual(['ai']);
  });

  it('gives every door the SAME share, selected or not', () => {
    // The selected door's word is stacked under its icon now, so it needs no
    // more width than its neighbours. A bigger share here would take that width
    // straight back out of their labels, which is the bug this replaces.
    const { items } = replace(STUDY, 'flashcards');
    for (const p of items) {
      expect(p.flex).toBe(CONTEXTUAL_SEGMENT_FLEX.unselected);
    }
    expect(CONTEXTUAL_SEGMENT_FLEX.selected).toBe(CONTEXTUAL_SEGMENT_FLEX.unselected);
  });
});

describe('planContextualRow: a replace row with NO selection labels every door (build 176)', () => {
  it('draws a label under every door, no pill and no icon-only strip', () => {
    // The Study hub, the Shop root, Notes: no door is the current screen. Build
    // 175 drew a leading section title here; build 176 labels every door instead
    // — the same treatment an above row gets. This FAILS the instant the
    // no-selection branch goes back to bare icons (or a section title).
    for (const selectedId of [null, undefined, 'not-on-this-row']) {
      const { items } = replace(STUDY, selectedId);
      expect(items.every((p) => p.variant === 'labeledIcon')).toBe(true);
      expect(items.every((p) => p.showLabel)).toBe(true);
      expect(items.some((p) => p.selected)).toBe(false);
    }
  });

  it('gives every labelled door the equal share — no bigger slice for anyone', () => {
    const { items } = replace(STUDY, null);
    expect(new Set(items.map((p) => p.flex))).toEqual(
      new Set([CONTEXTUAL_SEGMENT_FLEX.unselected]),
    );
  });

  it('is the SAME presentation an above row of the same items would get', () => {
    // The founder's "one code path": a no-selection replace row and an above row
    // draw identically. If the two ever diverge into look-alike branches, this
    // catches it.
    const asReplace = replace(STUDY, null).items;
    const asAbove = planContextualRow({ items: STUDY, selectedId: null }).items;
    expect(asReplace).toEqual(asAbove);
  });
});

describe('planContextualRow: an above row labels EVERY icon (founder decision 3)', () => {
  it('draws a label under every item and never a selection', () => {
    const { items } = above(ABOVE);
    // A pass-through screen has no door to promote; its ambiguous glyphs (Match
    // vs Cram, Rooms vs Members) each keep their word. FAILS if an above row is
    // ever reduced to bare icons again.
    expect(items.every((p) => p.variant === 'labeledIcon')).toBe(true);
    expect(items.every((p) => p.showLabel)).toBe(true);
    expect(items.some((p) => p.selected)).toBe(false);
  });

  it('pills the matching door when one is given, on any row', () => {
    // Was: "an above row ignores a stray selectedId", which the removed `mode`
    // enforced. Selection alone now decides, and a pass-through row simply has
    // no item matching its focused route, so it passes null and never gets here.
    const { items } = planContextualRow({ items: ABOVE, selectedId: 'a' });
    expect(items.filter((p) => p.selected).map((p) => p.id)).toEqual(['a']);
    expect(items.filter((p) => p.variant === 'selectedPill').map((p) => p.id)).toEqual(['a']);
    // And every other door keeps its word: no surface hides a label.
    expect(items.every((p) => p.showLabel)).toBe(true);
  });

  it('gives every labelled icon the same equal share', () => {
    const { items } = above(ABOVE);
    expect(new Set(items.map((p) => p.flex))).toEqual(
      new Set([CONTEXTUAL_SEGMENT_FLEX.unselected]),
    );
  });
});

describe('every item keeps a full accessible name on every surface', () => {
  it('keeps it whether the word is drawn or hidden', () => {
    // The accessibility half of the decision on all three variants: hiding a
    // word visually must not strip it from the screen reader. If accessibleName
    // were ever derived from showLabel (blank when hidden), this fails.
    const rows = [replace(STUDY, 'tests'), replace(STUDY, null), above(ABOVE)];
    for (const { items } of rows) {
      for (const p of items) {
        expect(p.accessibleName).toBe(p.label);
        expect(p.accessibleName.length).toBeGreaterThan(0);
      }
    }
  });

  it('preserves order and count on every surface', () => {
    for (const { items } of [replace(STUDY, 'library'), replace(STUDY, null)]) {
      expect(items.map((p) => p.id)).toEqual(STUDY.map((i) => i.id));
    }
    expect(above(ABOVE).items.map((p) => p.id)).toEqual(ABOVE.map((i) => i.id));
  });
});

describe('the drawn word has room to BE a word', () => {
  // The narrowest phone this ships to, and the leading exit control's footprint
  // in replace mode (a 20 dp glyph inside `px-4` at NativeWind's rem of 14).
  const NARROW_PHONE = 360;
  const EXIT_WIDTH = 48;

  it('costs the pill only its own padding more than a bare labelled door', () => {
    // The pill stacks its word now, so the icon costs height rather than width
    // and the only thing the selected door pays over its neighbours is the
    // fill's horizontal padding. When that gap grows, the pill has gone back to
    // spending the row's width sideways and the four beside it lose their
    // labels again — which is the whole bug this replaces.
    const pill = contextualPillLabelSpace({
      rowWidth: NARROW_PHONE,
      exitWidth: EXIT_WIDTH,
      itemCount: 5,
    });
    const plain = contextualLabeledIconLabelSpace({
      rowWidth: NARROW_PHONE,
      itemCount: 5,
      exitWidth: EXIT_WIDTH,
    });
    expect(plain - pill).toBeLessThanOrEqual(12);
    expect(pill).toBeGreaterThan(0);
  });

  it('fits the longest word in the pill on the Shop row', () => {
    // Shop is three doors plus the exit — the roomiest replace row, and the one
    // where the pill's word must clear the pessimistic ceiling outright rather
    // than sit on it. (An `above` row is not tested here: it never has a
    // selection, so it never draws a pill at all.)
    expect(
      contextualPillLabelSpace({ rowWidth: NARROW_PHONE, exitWidth: EXIT_WIDTH, itemCount: 3 }),
    ).toBeGreaterThanOrEqual(LONGEST_PILL_LABEL_WIDTH);
  });

  it('fits the longest labelled word under its icon on a four-item above row', () => {
    // An above row carries no exit, so its four doors split the whole bar: even
    // the longest labelled word in the app ("Flashcards") clears the ceiling
    // here with room to spare.
    const space = contextualLabeledIconLabelSpace({ rowWidth: NARROW_PHONE, itemCount: 4 });
    expect(space).toBeGreaterThanOrEqual(LONGEST_LABELED_ICON_WIDTH);
    // Sanity: the chrome is the slim per-segment padding, not the pill's.
    expect(CONTEXTUAL_LABELED_ICON_CHROME_WIDTH).toBeLessThan(20);
  });

  it('subtracts the leading exit on a no-selection replace row, so its labels are tighter', () => {
    // The no-selection Study row labels FIVE doors AND carries the exit — the
    // tightest labelled row in the app. The exit must come out of the doors'
    // width; if a future change forgets to pass it, this FAILS and the doors
    // would silently overlap the exit. `contextualLabeledIconLabelSpace` takes
    // the exit, so the same one function serves the above rows (exit 0) and this.
    const withExit = contextualLabeledIconLabelSpace({
      rowWidth: NARROW_PHONE,
      itemCount: 5,
      exitWidth: EXIT_WIDTH,
    });
    const withoutExit = contextualLabeledIconLabelSpace({
      rowWidth: NARROW_PHONE,
      itemCount: 5,
    });
    expect(withExit).toBeLessThan(withoutExit);
    // The exit costs exactly its width, spread across the five doors.
    expect(withoutExit - withExit).toBeCloseTo(EXIT_WIDTH / 5, 5);
    // And that tight row sits BELOW the pessimistic ceiling — the documented
    // reality on LONGEST_LABELED_ICON_WIDTH: measured 11 sp "Flashcards" is
    // right on the boundary on the narrowest phone and may lose its last glyph
    // to the tail ellipsis there, which is the accepted trade. If this ever
    // rises above the ceiling, that comment is stale and should be revisited.
    expect(withExit).toBeLessThan(LONGEST_LABELED_ICON_WIDTH);
  });

  it('gives the selected segment no more width than any other door', () => {
    // The inverse of what this asserted before 2026-09-11, and deliberately so:
    // the bigger share was paid for out of the four unlabelled doors.
    expect(CONTEXTUAL_SEGMENT_FLEX.selected).toBe(CONTEXTUAL_SEGMENT_FLEX.unselected);
  });
});

describe('CONTEXTUAL_PILL_LABEL — one rule for every drawn word', () => {
  it('keeps the long word on one line and caps its growth', () => {
    // A second line has nowhere to go in a 44 dp row; the word truncates
    // instead, and the font is capped so it cannot grow past the row. This
    // governs the selected pill AND the labelled icon.
    expect(CONTEXTUAL_PILL_LABEL.numberOfLines).toBe(1);
    expect(CONTEXTUAL_PILL_LABEL.ellipsizeMode).toBe('tail');
    expect(CONTEXTUAL_PILL_LABEL.maxFontSizeMultiplier).toBeGreaterThan(1);
    // 15 sp (text-body) * cap must stay inside text-body's 22 sp line box.
    expect(15 * CONTEXTUAL_PILL_LABEL.maxFontSizeMultiplier).toBeLessThanOrEqual(22);
  });
});
