import {
  DEFAULT_ACCENT_COLOR,
  LEGACY_DEFAULT_ACCENT_COLOR,
  applyAccentToColors,
  getAppearanceEffectFlags,
  isDefaultAccentColor,
} from './appearanceEffects';
import { DEFAULT_USER_SETTINGS } from './userSettings';

const lightTheme = {
  background: '#ffffff',
  surface: '#ffffff',
  card: '#ffffff',
  text: '#191919',
  textInverse: '#ffffff',
  primary: '#191919',
  primaryFill: '#191919',
  primaryText: '#191919',
  primaryBackground: '#f1f1f1',
  tabBar: '#ffffff',
  tabBarActive: '#191919',
};

describe('the ink accent default', () => {
  it('ships the ink and keeps the retired indigo as a second sentinel', () => {
    expect(DEFAULT_ACCENT_COLOR).toBe('#191919');
    expect(LEGACY_DEFAULT_ACCENT_COLOR).toBe('#6366f1');
    expect(DEFAULT_USER_SETTINGS.appearance.accentColor).toBe(DEFAULT_ACCENT_COLOR);
  });

  it.each([DEFAULT_ACCENT_COLOR, LEGACY_DEFAULT_ACCENT_COLOR, '', null, undefined])(
    'reads %s as "no override"',
    (value) => {
      expect(isDefaultAccentColor(value as string)).toBe(true);
    }
  );

  it('treats a real accent as an override', () => {
    expect(isDefaultAccentColor('#0ea5e9')).toBe(false);
  });

  it('leaves the palette untouched for an account still persisting the legacy indigo', () => {
    const out = applyAccentToColors({ ...lightTheme }, LEGACY_DEFAULT_ACCENT_COLOR);
    expect(out).toEqual(lightTheme);
    // ...exactly as it does for the new ink default.
    expect(applyAccentToColors({ ...lightTheme }, DEFAULT_ACCENT_COLOR)).toEqual(lightTheme);
  });

  it('still derives a palette for a non-default accent', () => {
    const out = applyAccentToColors({ ...lightTheme }, '#0ea5e9');
    expect(out.primaryFill).not.toBe(lightTheme.primaryFill);
  });

  it('falls back to the ink when nothing is stored', () => {
    const settings = {
      ...DEFAULT_USER_SETTINGS,
      appearance: { ...DEFAULT_USER_SETTINGS.appearance, accentColor: '' },
    };
    expect(getAppearanceEffectFlags(settings).accentColor).toBe(DEFAULT_ACCENT_COLOR);
  });
});
