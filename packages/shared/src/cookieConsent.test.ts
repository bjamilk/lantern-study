import {
  COOKIE_PREFS_VERSION,
  acceptAllCookiePreferences,
  essentialOnlyCookiePreferences,
  hasRecordedCookieChoice,
  isCookieCategoryAllowed,
  parseCookiePreferences,
  resolveCookiePreferences,
  serializeCookiePreferences,
} from './cookieConsent';

describe('cookieConsent protocol', () => {
  it('defaults optional categories to off', () => {
    const prefs = essentialOnlyCookiePreferences();
    expect(prefs.version).toBe(COOKIE_PREFS_VERSION);
    expect(prefs.necessary).toBe(true);
    expect(prefs.functional).toBe(false);
    expect(prefs.analytics).toBe(false);
    expect(prefs.advertising).toBe(false);
  });

  it('round-trips serialize/parse', () => {
    const original = acceptAllCookiePreferences();
    const parsed = parseCookiePreferences(serializeCookiePreferences(original));
    expect(parsed).toMatchObject({
      necessary: true,
      functional: true,
      analytics: true,
      advertising: true,
    });
  });

  it('treats legacy dismiss as essential-only recorded choice', () => {
    expect(hasRecordedCookieChoice(null, 'dismissed')).toBe(true);
    const resolved = resolveCookiePreferences(null, 'dismissed');
    expect(resolved?.analytics).toBe(false);
    expect(isCookieCategoryAllowed(resolved, 'necessary')).toBe(true);
    expect(isCookieCategoryAllowed(resolved, 'advertising')).toBe(false);
  });
});
