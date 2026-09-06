import { BOTTOM_TABS } from './tabRouting';
import { TAB_ICONS, UNFILLABLE_TAB_ICONS, tabIconsAreDistinct } from './tabIcons';

describe('bottom tab icons', () => {
  it('names a glyph for every destination on the bar', () => {
    for (const tab of BOTTOM_TABS) {
      expect(TAB_ICONS[tab]).toBeTruthy();
    }
  });

  it('gives each destination its own glyph', () => {
    expect(tabIconsAreDistinct()).toBe(true);
  });

  // The active tab is drawn with AppIcon's `filled`, so a glyph whose solid
  // form is a featureless blob would leave colour as the only signal again.
  it('draws no glyph whose filled form erases its detail', () => {
    for (const tab of BOTTOM_TABS) {
      expect(UNFILLABLE_TAB_ICONS).not.toContain(TAB_ICONS[tab]);
    }
  });

  it('keeps Me on the person glyph rather than the disc it used to draw', () => {
    expect(TAB_ICONS.Me).toBe('person');
    expect(UNFILLABLE_TAB_ICONS).toContain('person-circle');
  });
});
