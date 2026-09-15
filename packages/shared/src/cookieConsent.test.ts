import {
  COOKIE_NOTICE_LEGACY_KEY,
  COOKIE_PREFS_STORAGE_KEY,
  COOKIE_PREFS_VERSION,
  acceptAllCookiePreferences,
  essentialOnlyCookiePreferences,
  hasRecordedCookieChoice,
  isCookieCategoryAllowed,
  isCookieConsentStorageKey,
  parseCookiePreferences,
  resolveCookiePreferences,
  serializeCookiePreferences,
  shouldClearClientStorageKeyOnLogout,
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

  it('preserves cookie consent keys across logout storage wipe', () => {
    expect(isCookieConsentStorageKey(COOKIE_PREFS_STORAGE_KEY)).toBe(true);
    expect(isCookieConsentStorageKey(COOKIE_NOTICE_LEGACY_KEY)).toBe(true);
    expect(shouldClearClientStorageKeyOnLogout(COOKIE_PREFS_STORAGE_KEY)).toBe(false);
    expect(shouldClearClientStorageKeyOnLogout(COOKIE_NOTICE_LEGACY_KEY)).toBe(false);
    expect(shouldClearClientStorageKeyOnLogout('lantern_analytics_anon_id')).toBe(false);
    expect(shouldClearClientStorageKeyOnLogout('lantern_analytics_session_id')).toBe(false);
    expect(shouldClearClientStorageKeyOnLogout('lantern_decks')).toBe(true);
    expect(shouldClearClientStorageKeyOnLogout('sb-xxx-auth-token')).toBe(true);
    expect(shouldClearClientStorageKeyOnLogout('auth-storage-v2')).toBe(true);
    expect(shouldClearClientStorageKeyOnLogout('theme')).toBe(false);
  });

  // FIXED (F2 · E3 C5): the wipe used to take the owner stamp (it starts
  // `lantern_`) and leave the queue it guards, so the next account adopted the
  // previous student's finished tests.
  it('preserves the offline-queue owner stamp across logout', () => {
    expect(shouldClearClientStorageKeyOnLogout('lantern_offline_owner')).toBe(false);
    expect(shouldClearClientStorageKeyOnLogout('lantern_offline_owner_era')).toBe(false);
    expect(
      shouldClearClientStorageKeyOnLogout('lantern_offline_quarantine:pendingSyncResults:user-a')
    ).toBe(false);
  });
});

