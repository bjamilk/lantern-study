import {
  CONTEXTUAL_PILL_LABEL,
  CONTEXTUAL_SEGMENT_FLEX,
  LONGEST_PILL_LABEL_WIDTH,
  contextualPillLabelSpace,
  planContextualPills,
  type ContextualPillInput,
} from './contextualBarPresentation';

const STUDY: ContextualPillInput[] = [
  { id: 'library', label: 'Library' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'tests', label: 'Tests' },
  { id: 'record', label: 'Record' },
  { id: 'ai', label: 'AI' },
];

describe('planContextualPills', () => {
  it('shows a label on the SELECTED item only', () => {
    const plans = planContextualPills(STUDY, 'flashcards');
    const labelled = plans.filter((p) => p.showLabel);
    expect(labelled.map((p) => p.id)).toEqual(['flashcards']);
    // Every other item is icon-only — this is the whole of decision 4, and it
    // FAILS the moment the row goes back to a label under every icon.
    expect(plans.filter((p) => !p.showLabel).map((p) => p.id)).toEqual([
      'library',
      'tests',
      'record',
      'ai',
    ]);
  });

  it('keeps a full accessible name on EVERY item, drawn or not', () => {
    const plans = planContextualPills(STUDY, 'tests');
    // The accessibility half of decision 4: hiding a word visually must not
    // strip it from the screen reader. If accessibleName were ever derived from
    // showLabel (blank when hidden), this fails.
    for (const p of plans) {
      const source = STUDY.find((i) => i.id === p.id);
      expect(p.accessibleName).toBe(source?.label);
      expect(p.accessibleName.length).toBeGreaterThan(0);
    }
    const hidden = plans.filter((p) => !p.showLabel);
    expect(hidden.length).toBe(4);
    expect(hidden.every((p) => p.accessibleName.length > 0)).toBe(true);
  });

  it('marks exactly the matching item selected', () => {
    const plans = planContextualPills(STUDY, 'ai');
    expect(plans.filter((p) => p.selected).map((p) => p.id)).toEqual(['ai']);
  });

  it('promotes no label when nothing on the row is the current screen', () => {
    // Study's hub and the deck/note/community rows have no active item; the row
    // is all icons then, never a stray promoted word.
    for (const selectedId of [null, undefined, 'not-on-this-row']) {
      const plans = planContextualPills(STUDY, selectedId);
      expect(plans.some((p) => p.showLabel)).toBe(false);
      expect(plans.some((p) => p.selected)).toBe(false);
      // …but the accessible names survive regardless.
      expect(plans.every((p) => p.accessibleName.length > 0)).toBe(true);
    }
  });

  it('preserves order and count', () => {
    const plans = planContextualPills(STUDY, 'library');
    expect(plans.map((p) => p.id)).toEqual(STUDY.map((i) => i.id));
  });
});

describe('the promoted word has room to BE a word', () => {
  // The narrowest phone this ships to, and the leading exit control's footprint
  // in replace mode (a 20 dp glyph inside `px-4` at NativeWind's rem of 14).
  const NARROW_PHONE = 360;
  const EXIT_WIDTH = 48;

  it('fits the longest label on the worst real row — Study, five items, with an exit', () => {
    // Study is five items AND a replace-mode exit, so it is the tightest row in
    // the app. If the selected share is dropped back to an equal one, this is
    // ~14 dp and FAILS: the founder's promoted label would ellipsise to "L…",
    // which is worse than the 11 sp word it replaced.
    const space = contextualPillLabelSpace({
      rowWidth: NARROW_PHONE,
      exitWidth: EXIT_WIDTH,
      itemCount: 5,
    });
    expect(space).toBeGreaterThanOrEqual(LONGEST_PILL_LABEL_WIDTH);
  });

  it('fits it on the Shop row and on an above-mode row with no exit', () => {
    expect(
      contextualPillLabelSpace({ rowWidth: NARROW_PHONE, exitWidth: EXIT_WIDTH, itemCount: 3 }),
    ).toBeGreaterThanOrEqual(LONGEST_PILL_LABEL_WIDTH);
    expect(
      contextualPillLabelSpace({ rowWidth: NARROW_PHONE, exitWidth: 0, itemCount: 4 }),
    ).toBeGreaterThanOrEqual(LONGEST_PILL_LABEL_WIDTH);
  });

  it('gives the selected segment a bigger share, and every other one the same share', () => {
    expect(CONTEXTUAL_SEGMENT_FLEX.selected).toBeGreaterThan(CONTEXTUAL_SEGMENT_FLEX.unselected);
    // With nothing selected the shares are all `unselected`, so the row divides
    // exactly as it always has — no gap, no left-packed icons.
    const plans = planContextualPills(STUDY, null);
    expect(new Set(plans.map((p) => p.flex))).toEqual(new Set([CONTEXTUAL_SEGMENT_FLEX.unselected]));
  });

  it('puts the bigger share on the item that actually carries the word', () => {
    const plans = planContextualPills(STUDY, 'flashcards');
    for (const p of plans) {
      expect(p.flex).toBe(
        p.showLabel ? CONTEXTUAL_SEGMENT_FLEX.selected : CONTEXTUAL_SEGMENT_FLEX.unselected,
      );
    }
  });
});

describe('CONTEXTUAL_PILL_LABEL', () => {
  it('keeps the long label on one line and caps its growth', () => {
    // A second line has nowhere to go in a 44 dp row; the word truncates
    // instead, and the font is capped so it cannot grow past the row.
    expect(CONTEXTUAL_PILL_LABEL.numberOfLines).toBe(1);
    expect(CONTEXTUAL_PILL_LABEL.ellipsizeMode).toBe('tail');
    expect(CONTEXTUAL_PILL_LABEL.maxFontSizeMultiplier).toBeGreaterThan(1);
    // 15 sp (text-body) * cap must stay inside text-body's 22 sp line box.
    expect(15 * CONTEXTUAL_PILL_LABEL.maxFontSizeMultiplier).toBeLessThanOrEqual(22);
  });
});
