import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  COOKIE_CATEGORIES,
  COOKIE_NOTICE_LEGACY_KEY,
  COOKIE_PREFS_STORAGE_KEY,
  OPEN_COOKIE_PREFERENCES_EVENT,
  acceptAllCookiePreferences,
  defaultCookiePreferences,
  essentialOnlyCookiePreferences,
  hasRecordedCookieChoice,
  resolveCookiePreferences,
  serializeCookiePreferences,
  type CookieCategoryId,
  type CookiePreferences,
} from '@lantern/shared';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';
import { useAuthStore } from '../stores/authStore';
import { notifyProductAnalyticsConsentChange } from '../services/productAnalytics';

type DraftPrefs = Pick<CookiePreferences, 'functional' | 'analytics' | 'advertising'>;

function readStoredPrefs(): CookiePreferences | null {
  try {
    return resolveCookiePreferences(
      localStorage.getItem(COOKIE_PREFS_STORAGE_KEY),
      localStorage.getItem(COOKIE_NOTICE_LEGACY_KEY),
    );
  } catch {
    return null;
  }
}

function writePrefs(prefs: CookiePreferences) {
  const payload = serializeCookiePreferences({
    ...prefs,
    necessary: true,
    updatedAt: new Date().toISOString(),
  });
  try {
    localStorage.setItem(COOKIE_PREFS_STORAGE_KEY, payload);
    localStorage.setItem(COOKIE_NOTICE_LEGACY_KEY, 'dismissed');
  } catch {
    /* ignore quota / private mode */
  }
}

function readHasChoice(): boolean {
  try {
    return hasRecordedCookieChoice(
      localStorage.getItem(COOKIE_PREFS_STORAGE_KEY),
      localStorage.getItem(COOKIE_NOTICE_LEGACY_KEY),
    );
  } catch {
    return false;
  }
}

export function openCookiePreferenceCenter() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_COOKIE_PREFERENCES_EVENT));
}

export function CookieNoticeBanner() {
    // The 4rem lift exists to clear the signed-in bottom tab bar. Signed-out
  // pages (landing/auth) have no tab bar, so the lifted banner hovered 64px
  // up and covered the lower form controls on small screens.
  const hasBottomTabBar = useAuthStore((st) => !!st.currentUser);
const [bannerVisible, setBannerVisible] = useState(false);
  const [centerOpen, setCenterOpen] = useState(false);
  const [hasChoice, setHasChoice] = useState(false);
  const [expanded, setExpanded] = useState<CookieCategoryId | null>('necessary');
  const [draft, setDraft] = useState<DraftPrefs>({
    functional: false,
    analytics: false,
    advertising: false,
  });

  const syncDraftFromStored = useCallback(() => {
    const stored = readStoredPrefs() ?? defaultCookiePreferences();
    setDraft({
      functional: stored.functional,
      analytics: stored.analytics,
      advertising: stored.advertising,
    });
  }, []);

  const openCenter = useCallback(() => {
    syncDraftFromStored();
    setCenterOpen(true);
  }, [syncDraftFromStored]);

  useEffect(() => {
    try {
      const choice = readHasChoice();
      setHasChoice(choice);
      if (!choice) setBannerVisible(true);
    } catch {
      setBannerVisible(true);
    }
  }, []);

  useEffect(() => {
    const onOpen = () => openCenter();
    window.addEventListener(OPEN_COOKIE_PREFERENCES_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_COOKIE_PREFERENCES_EVENT, onOpen);
  }, [openCenter]);

  const persistAndClose = (prefs: CookiePreferences) => {
    writePrefs(prefs);
    void notifyProductAnalyticsConsentChange(prefs);
    setHasChoice(true);
    setBannerVisible(false);
    setCenterOpen(false);
  };

  const closeCenterWithoutSaving = () => {
    setCenterOpen(false);
    if (!hasChoice) {
      // Keep the initial banner visible until the user records a choice.
      setBannerVisible(true);
    }
  };

  const confirmChoices = () => {
    persistAndClose({
      ...essentialOnlyCookiePreferences(),
      ...draft,
      necessary: true,
    });
  };

  const centerPanelRef = useModalFocusTrap(centerOpen, closeCenterWithoutSaving);

  return (
    <>
      {bannerVisible && !centerOpen && (
        <div
          role="region"
          aria-label="Cookie notice"
          className={`fixed inset-x-0 z-[80] border-t border-lantern-border bg-lantern-surface/95 dark:bg-lantern-background/95 backdrop-blur px-3 py-2.5 sm:px-4 sm:py-3 shadow-lg md:bottom-0 max-h-[min(38vh,16rem)] overflow-y-auto ${
            hasBottomTabBar
              ? 'bottom-[calc(4rem+env(safe-area-inset-bottom,0px))]'
              : 'bottom-[env(safe-area-inset-bottom,0px)]'
          }`}
        >
          <div className="max-w-4xl mx-auto flex flex-col gap-2 sm:gap-3 text-sm text-lantern-text">
            <p className="min-w-0 leading-snug text-xs sm:text-sm">
              <span className="sm:hidden">
                We use necessary cookies for sign-in and preferences. Optional cookies stay off unless you enable them.{' '}
              </span>
              <span className="hidden sm:inline">
                Lantern Study uses strictly necessary cookies and local storage so the site works (sign-in, theme, and
                remembering your choices). Optional analytics (first-party only), functional, and advertising cookies are
                off by default — analytics only runs if you opt in.{' '}
              </span>
              <Link to="/cookies" className="underline text-lantern-primary">
                Cookie Policy
              </Link>
            </p>
            <div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-row sm:flex-wrap sm:gap-2 sm:justify-end">
              <button
                type="button"
                onClick={openCenter}
                className="min-w-0 min-h-[44px] rounded-lg border border-lantern-border px-1.5 sm:px-4 py-2 text-[11px] sm:text-sm font-medium hover:bg-lantern-surface leading-tight"
              >
                <span className="sm:hidden">Manage</span>
                <span className="hidden sm:inline">Manage preferences</span>
              </button>
              <button
                type="button"
                onClick={() => persistAndClose(essentialOnlyCookiePreferences())}
                className="min-w-0 min-h-[44px] rounded-lg border border-lantern-border px-1.5 sm:px-4 py-2 text-[11px] sm:text-sm font-medium hover:bg-lantern-surface leading-tight"
              >
                <span className="sm:hidden">Essential</span>
                <span className="hidden sm:inline">Essential only</span>
              </button>
              <button
                type="button"
                onClick={() => persistAndClose(acceptAllCookiePreferences())}
                className="min-w-0 min-h-[44px] rounded-lg bg-lantern-primary hover:bg-lantern-primary text-white px-1.5 sm:px-4 py-2 text-[11px] sm:text-sm font-medium leading-tight"
              >
                Accept all
              </button>
            </div>
          </div>
        </div>
      )}

      {centerOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          role="presentation"
          onClick={closeCenterWithoutSaving}
        >
          <div
            ref={centerPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cookie-preference-title"
            className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-lantern-border bg-lantern-surface text-lantern-text shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-[1] border-b border-lantern-border bg-lantern-surface px-4 py-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 id="cookie-preference-title" className="text-lg font-semibold">
                  Lantern Study Cookie Preference Center
                </h2>
                <p className="mt-1 text-xs text-lantern-text-secondary leading-relaxed">
                  Choose which optional cookie categories to allow. Strictly Necessary cookies always stay on. Optional
                  categories below are fully supported in this Preference Center — Lantern Study simply does not load
                  those cookie types yet, so toggling them records your choice for when we introduce them. Details in
                  our{' '}
                  <Link
                    to="/cookies"
                    className="underline text-lantern-primary"
                    onClick={() => setCenterOpen(false)}
                  >
                    Cookie Policy
                  </Link>
                  .
                </p>
              </div>
              <button
                type="button"
                onClick={closeCenterWithoutSaving}
                className="shrink-0 rounded-lg p-2 text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text"
                aria-label="Close cookie preferences"
              >
                <span aria-hidden className="block text-xl leading-none">
                  ×
                </span>
              </button>
            </div>

            <div className="px-4 py-3 space-y-2">
              {COOKIE_CATEGORIES.map((category) => {
                const isOpen = expanded === category.id;
                const enabled =
                  category.id === 'necessary'
                    ? true
                    : draft[category.id as Exclude<CookieCategoryId, 'necessary'>];

                return (
                  <div key={category.id} className="rounded-xl border border-lantern-border overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-3">
                      <button
                        type="button"
                        className="flex-1 min-w-0 text-left hover:opacity-90"
                        onClick={() => setExpanded(isOpen ? null : category.id)}
                        aria-expanded={isOpen}
                      >
                        <span className="block text-sm font-medium">{category.title}</span>
                        {!category.currentlyDeployed && category.id !== 'necessary' && (
                          <span className="block text-[11px] text-lantern-text-secondary mt-0.5">
                            Choice saved — no cookies of this type are loaded yet
                          </span>
                        )}
                      </button>
                      {category.required ? (
                        <span className="text-[11px] font-medium uppercase tracking-wide text-lantern-text-secondary">
                          Always on
                        </span>
                      ) : (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          aria-label={`${category.title} cookies`}
                          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                            enabled ? 'bg-lantern-primary' : 'bg-lantern-border'
                          }`}
                          onClick={() => {
                            setDraft((prev) => ({
                              ...prev,
                              [category.id]: !prev[category.id as Exclude<CookieCategoryId, 'necessary'>],
                            }));
                          }}
                        >
                          <span
                            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow mt-0.5 transition-transform ${
                              enabled ? 'translate-x-5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      )}
                    </div>
                    {isOpen && (
                      <div className="px-3 pb-3 text-xs text-lantern-text-secondary leading-relaxed border-t border-lantern-border/60 pt-2">
                        <p>{category.summary}</p>
                        <ul className="mt-2 list-disc pl-4 space-y-1">
                          {category.examples.map((example) => (
                            <li key={example}>{example}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="sticky bottom-0 border-t border-lantern-border bg-lantern-surface px-4 py-3 flex flex-col sm:flex-row gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => persistAndClose(essentialOnlyCookiePreferences())}
                className="min-h-[44px] rounded-lg border border-lantern-border px-4 py-2 text-sm font-medium"
              >
                Essential only
              </button>
              <button
                type="button"
                onClick={confirmChoices}
                className="min-h-[44px] rounded-lg bg-lantern-primary text-white px-4 py-2 text-sm font-medium"
              >
                Confirm my choices
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default CookieNoticeBanner;
