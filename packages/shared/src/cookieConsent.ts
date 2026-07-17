/**
 * Lantern Study cookie & similar-technology consent protocol.
 *
 * Web stores preferences in localStorage; mobile uses the same JSON shape in AsyncStorage.
 * Strictly necessary storage always runs. Optional categories default OFF and are not
 * loaded until the user opts in — and only once corresponding technologies are deployed.
 */

export const COOKIE_PREFS_STORAGE_KEY = 'lantern_cookie_prefs_v2';
/** Legacy one-shot dismiss flag from the essential-only notice. */
export const COOKIE_NOTICE_LEGACY_KEY = 'lantern_cookie_notice_v1';

export const COOKIE_PREFS_VERSION = 2 as const;

export type CookieCategoryId =
  | 'necessary'
  | 'functional'
  | 'analytics'
  | 'advertising';

export type CookiePreferences = {
  version: typeof COOKIE_PREFS_VERSION;
  updatedAt: string;
  necessary: true;
  functional: boolean;
  analytics: boolean;
  advertising: boolean;
};

export type CookieCategoryDefinition = {
  id: CookieCategoryId;
  title: string;
  summary: string;
  /** Always true for necessary; others are user-toggles. */
  required: boolean;
  /** Whether Lantern currently deploys technologies in this category. */
  currentlyDeployed: boolean;
  examples: string[];
};

export const COOKIE_CATEGORIES: CookieCategoryDefinition[] = [
  {
    id: 'necessary',
    title: 'Strictly Necessary',
    summary:
      'Required for the site and apps to work — sign-in sessions, security, remembering your cookie choices, theme, and core UI preferences. These cannot be switched off.',
    required: true,
    currentlyDeployed: true,
    examples: [
      'Supabase auth session (keep you signed in)',
      'Cookie preference record (this choice)',
      'theme and ui-storage local preferences',
    ],
  },
  {
    id: 'functional',
    title: 'Functional',
    summary:
      'Help remember choices that improve convenience beyond core operation (for example, optional layout or feature experiments). Turning these off may make some conveniences unavailable.',
    required: false,
    currentlyDeployed: false,
    examples: ['Optional non-essential preference cookies (when introduced)'],
  },
  {
    id: 'analytics',
    title: 'Performance & Analytics',
    summary:
      'Help us understand how Lantern Study is used so we can improve reliability and product design. These are not used for cross-site advertising.',
    required: false,
    currentlyDeployed: false,
    examples: ['First-party or privacy-preserving analytics (when introduced)'],
  },
  {
    id: 'advertising',
    title: 'Advertising & Social',
    summary:
      'Used by advertising or social platforms to measure campaigns or show relevant content. Lantern Study does not currently load advertising or social tracking pixels.',
    required: false,
    currentlyDeployed: false,
    examples: ['Ad / social pixels (not currently deployed)'],
  },
];

export function defaultCookiePreferences(): CookiePreferences {
  return {
    version: COOKIE_PREFS_VERSION,
    updatedAt: new Date().toISOString(),
    necessary: true,
    functional: false,
    analytics: false,
    advertising: false,
  };
}

export function acceptAllCookiePreferences(): CookiePreferences {
  return {
    ...defaultCookiePreferences(),
    functional: true,
    analytics: true,
    advertising: true,
  };
}

export function essentialOnlyCookiePreferences(): CookiePreferences {
  return defaultCookiePreferences();
}

export function parseCookiePreferences(raw: string | null | undefined): CookiePreferences | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CookiePreferences>;
    if (parsed.version !== COOKIE_PREFS_VERSION) return null;
    return {
      version: COOKIE_PREFS_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      necessary: true,
      functional: Boolean(parsed.functional),
      analytics: Boolean(parsed.analytics),
      advertising: Boolean(parsed.advertising),
    };
  } catch {
    return null;
  }
}

export function serializeCookiePreferences(prefs: CookiePreferences): string {
  return JSON.stringify({
    ...prefs,
    necessary: true,
    version: COOKIE_PREFS_VERSION,
    updatedAt: prefs.updatedAt || new Date().toISOString(),
  });
}

/** True when the user has recorded a v2 choice or legacy dismiss. */
export function hasRecordedCookieChoice(
  prefsRaw: string | null | undefined,
  legacyRaw: string | null | undefined,
): boolean {
  if (parseCookiePreferences(prefsRaw)) return true;
  return legacyRaw === 'dismissed';
}

/**
 * Resolve effective preferences from storage values.
 * Legacy dismiss maps to essential-only (current production posture).
 */
export function resolveCookiePreferences(
  prefsRaw: string | null | undefined,
  legacyRaw: string | null | undefined,
): CookiePreferences | null {
  const parsed = parseCookiePreferences(prefsRaw);
  if (parsed) return parsed;
  if (legacyRaw === 'dismissed') return essentialOnlyCookiePreferences();
  return null;
}

export function isCookieCategoryAllowed(
  prefs: CookiePreferences | null | undefined,
  category: CookieCategoryId,
): boolean {
  if (category === 'necessary') return true;
  if (!prefs) return false;
  return Boolean(prefs[category]);
}

/** Browser custom event name — web Preference Center listens for this. */
export const OPEN_COOKIE_PREFERENCES_EVENT = 'lantern:open-cookie-preferences';
