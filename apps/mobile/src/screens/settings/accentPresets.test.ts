import { DEFAULT_ACCENT_COLOR, LEGACY_DEFAULT_ACCENT_COLOR } from '@lantern/shared/settings';
import { ACCENT_PRESETS, isPresetSelected } from './accentPresets';

describe('ACCENT_PRESETS', () => {
  it('leads with the ink, labelled Default — selecting it stores #191919', () => {
    expect(ACCENT_PRESETS[0]).toEqual({ hex: '#191919', label: 'Default' });
    expect(ACCENT_PRESETS[0].hex).toBe(DEFAULT_ACCENT_COLOR);
  });

  it('leaves the other presets unchanged and unlabelled', () => {
    expect(ACCENT_PRESETS.slice(1)).toEqual([
      { hex: '#0ea5e9' },
      { hex: '#10b981' },
      { hex: '#f59e0b' },
      { hex: '#ec4899' },
      { hex: '#8b5cf6' },
    ]);
  });

  it('shows Default selected for an account still persisting the legacy indigo', () => {
    expect(isPresetSelected(LEGACY_DEFAULT_ACCENT_COLOR, ACCENT_PRESETS[0])).toBe(true);
    expect(isPresetSelected(DEFAULT_ACCENT_COLOR, ACCENT_PRESETS[0])).toBe(true);
    expect(isPresetSelected('', ACCENT_PRESETS[0])).toBe(true);
    // ...and the legacy value must not light up any other swatch.
    for (const preset of ACCENT_PRESETS.slice(1)) {
      expect(isPresetSelected(LEGACY_DEFAULT_ACCENT_COLOR, preset)).toBe(false);
    }
  });

  it('selects a real accent only on its own swatch', () => {
    expect(isPresetSelected('#0EA5E9', ACCENT_PRESETS[1])).toBe(true);
    expect(isPresetSelected('#0ea5e9', ACCENT_PRESETS[0])).toBe(false);
  });
});
