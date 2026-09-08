import {
  CONTEXTUAL_LABELED_ICON_CHROME_WIDTH,
  CONTEXTUAL_PILL_LABEL,
  CONTEXTUAL_SEGMENT_FLEX,
  LONGEST_LABELED_ICON_WIDTH,
  LONGEST_PILL_LABEL_WIDTH,
  LONGEST_SECTION_LABEL_WIDTH,
  contextualLabeledIconLabelSpace,
  contextualPillLabelSpace,
  contextualSectionLabelSpace,
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

const replace = (items: readonly ContextualPillInput[], selectedId: string | null | undefined) =>
  planContextualRow({ mode: 'replace', sectionName: 'Study', items, selectedId });

const above = (items: readonly ContextualPillInput[]) =>
  planContextualRow({ mode: 'above', sectionName: 'Community', items, selectedId: null });

describe('planContextualRow: a replace row WITH a selection (founder decision 4)', () => {
  it('draws the selected door as a pill and every other door icon-only', () => {
    const { section, items } = replace(STUDY, 'flashcards');
    // No section title when a door is the current screen — the door names it.
    expect(section).toBeNull();
    expect(items.filter((p) => p.variant === 'selectedPill').map((p) => p.id)).toEqual([
      'flashcards',
    ]);
    // Every other item is icon-only — the whole of decision 4, which FAILS the
    // moment the row goes back to a label under every door here.
    expect(items.filter((p) => p.variant === 'iconOnly').map((p) => p.id)).toEqual([
      'library',
      'tests',
      'record',
      'ai',
    ]);
    // showLabel tracks the variant: drawn for the pill, hidden for the icons.
    expect(items.filter((p) => p.showLabel).map((p) => p.id)).toEqual(['flashcards']);
  });

  it('marks exactly the matching door selected', () => {
    const { items } = replace(STUDY, 'ai');
    expect(items.filter((p) => p.selected).map((p) => p.id)).toEqual(['ai']);
  });

  it('gives the selected door the bigger share and every other the equal one', () => {
    const { items } = replace(STUDY, 'flashcards');
    for (const p of items) {
      expect(p.flex).toBe(
        p.variant === 'selectedPill'
          ? CONTEXTUAL_SEGMENT_FLEX.selected
          : CONTEXTUAL_SEGMENT_FLEX.unselected,
      );
    }
  });
});

describe('planContextualRow: a replace row with NO selection names the SECTION', () => {
  it('draws a leading section title and leaves every door icon-only', () => {
    // The Study hub, the Shop root, Notes: no door is the current screen, so the
    // row names the place itself instead of showing nameless icons. This is the
    // build-175 fix — it FAILS the instant the no-selection branch stops
    // emitting a section.
    for (const selectedId of [null, undefined, 'not-on-this-row']) {
      const { section, items } = replace(STUDY, selectedId);
      expect(section).not.toBeNull();
      expect(section!.name).toBe('Study');
      expect(items.every((p) => p.variant === 'iconOnly')).toBe(true);
      expect(items.some((p) => p.showLabel)).toBe(false);
      expect(items.some((p) => p.selected)).toBe(false);
    }
  });

  it('carries the section name straight from the registry, not a door label', () => {
    const { section } = planContextualRow({
      mode: 'replace',
      sectionName: 'Shop',
      items: [{ id: 'browse', label: 'Browse' }],
      selectedId: null,
    });
    expect(section!.name).toBe('Shop');
  });

  it('gives the section title the bigger share, the doors the equal one', () => {
    const { section, items } = replace(STUDY, null);
    expect(section!.flex).toBe(CONTEXTUAL_SEGMENT_FLEX.selected);
    expect(new Set(items.map((p) => p.flex))).toEqual(
      new Set([CONTEXTUAL_SEGMENT_FLEX.unselected]),
    );
  });

  it('announces the section title even though it is not a control', () => {
    const { section } = replace(STUDY, null);
    expect(section!.accessibleName).toBe('Study');
    expect(section!.accessibleName.length).toBeGreaterThan(0);
  });
});

describe('planContextualRow: an above row labels EVERY icon (founder decision 3)', () => {
  it('draws a label under every item and never a selection or a section', () => {
    const { section, items } = above(ABOVE);
    // A pass-through screen has no door to promote and no section title; its
    // ambiguous glyphs (Match vs Cram, Rooms vs Members) each keep their word.
    // FAILS if an above row is ever reduced to bare icons again.
    expect(section).toBeNull();
    expect(items.every((p) => p.variant === 'labeledIcon')).toBe(true);
    expect(items.every((p) => p.showLabel)).toBe(true);
    expect(items.some((p) => p.selected)).toBe(false);
  });

  it('ignores any stray selectedId — an above item is never the current screen', () => {
    const { section, items } = planContextualRow({
      mode: 'above',
      sectionName: 'Deck',
      items: ABOVE,
      selectedId: 'a',
    });
    expect(section).toBeNull();
    expect(items.every((p) => p.variant === 'labeledIcon')).toBe(true);
    expect(items.some((p) => p.selected)).toBe(false);
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
    // The accessibility half of the decision on all three surfaces: hiding a
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

  it('fits the longest door label in the selected pill — Study, five doors, with an exit', () => {
    // Study is five items AND a replace-mode exit, so it is the tightest row in
    // the app. If the selected share is dropped back to an equal one, this is
    // ~14 dp and FAILS: the promoted label would ellipsise to "L…".
    const space = contextualPillLabelSpace({
      rowWidth: NARROW_PHONE,
      exitWidth: EXIT_WIDTH,
      itemCount: 5,
    });
    expect(space).toBeGreaterThanOrEqual(LONGEST_PILL_LABEL_WIDTH);
  });

  it('fits the pill on the Shop row and on an above-mode row with no exit', () => {
    expect(
      contextualPillLabelSpace({ rowWidth: NARROW_PHONE, exitWidth: EXIT_WIDTH, itemCount: 3 }),
    ).toBeGreaterThanOrEqual(LONGEST_PILL_LABEL_WIDTH);
    expect(
      contextualPillLabelSpace({ rowWidth: NARROW_PHONE, exitWidth: 0, itemCount: 4 }),
    ).toBeGreaterThanOrEqual(LONGEST_PILL_LABEL_WIDTH);
  });

  it('fits the section title on the tightest replace row — five doors plus the title, with an exit', () => {
    // The section title is an EXTRA leading segment, so Study's no-selection row
    // is the title plus five icon doors plus the exit. "Study"/"Shop" still fit.
    const space = contextualSectionLabelSpace({
      rowWidth: NARROW_PHONE,
      exitWidth: EXIT_WIDTH,
      itemCount: 5,
    });
    expect(space).toBeGreaterThanOrEqual(LONGEST_SECTION_LABEL_WIDTH);
  });

  it('fits the longest above label under its icon on a four-item row', () => {
    const space = contextualLabeledIconLabelSpace({ rowWidth: NARROW_PHONE, itemCount: 4 });
    expect(space).toBeGreaterThanOrEqual(LONGEST_LABELED_ICON_WIDTH);
    // Sanity: the chrome is the slim per-segment padding, not the pill's.
    expect(CONTEXTUAL_LABELED_ICON_CHROME_WIDTH).toBeLessThan(20);
  });

  it('gives the selected segment a bigger share than any icon-only one', () => {
    expect(CONTEXTUAL_SEGMENT_FLEX.selected).toBeGreaterThan(CONTEXTUAL_SEGMENT_FLEX.unselected);
  });
});

describe('CONTEXTUAL_PILL_LABEL — one rule for every drawn word', () => {
  it('keeps the long word on one line and caps its growth', () => {
    // A second line has nowhere to go in a 44 dp row; the word truncates
    // instead, and the font is capped so it cannot grow past the row. This
    // governs the selected pill, the section title AND the labelled icon.
    expect(CONTEXTUAL_PILL_LABEL.numberOfLines).toBe(1);
    expect(CONTEXTUAL_PILL_LABEL.ellipsizeMode).toBe('tail');
    expect(CONTEXTUAL_PILL_LABEL.maxFontSizeMultiplier).toBeGreaterThan(1);
    // 15 sp (text-body) * cap must stay inside text-body's 22 sp line box.
    expect(15 * CONTEXTUAL_PILL_LABEL.maxFontSizeMultiplier).toBeLessThanOrEqual(22);
  });
});
