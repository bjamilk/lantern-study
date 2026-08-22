import React, { useCallback, useEffect, useState } from 'react';
import { LanternIcon } from '../ui';
import { useAuthStore } from '../../stores/authStore';

/**
 * Chromium fires `beforeinstallprompt` once the PWA install criteria are met
 * (manifest + service worker + engagement). It is not in lib.dom's typings.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/** ISO timestamp of the last dismissal; the bar stays hidden for DISMISS_SNOOZE_MS. */
export const PWA_INSTALL_DISMISSED_KEY = 'lantern_pwa_install_dismissed_at';
const DISMISS_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch {
    /* matchMedia unavailable */
  }
  // iOS Safari "Add to Home Screen" exposes navigator.standalone instead.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isSnoozed(): boolean {
  try {
    const raw = localStorage.getItem(PWA_INSTALL_DISMISSED_KEY);
    if (!raw) return false;
    const at = Date.parse(raw);
    if (Number.isNaN(at)) return true;
    return Date.now() - at < DISMISS_SNOOZE_MS;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(PWA_INSTALL_DISMISSED_KEY, new Date().toISOString());
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * "Install Lantern Study" bar. Renders only when the browser has offered an
 * install prompt, the app is not already running standalone, and the user has
 * not dismissed it recently. Sits below the cookie notice (z-80) so the two
 * bottom bars never stack — the cookie notice simply covers it until a cookie
 * choice is recorded.
 */
export function InstallAppBanner() {
  // Same 4rem lift as CookieNoticeBanner: clear the signed-in bottom tab bar.
  const hasBottomTabBar = useAuthStore((st) => !!st.currentUser);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (isStandalone() || isSnoozed()) return;
    const onBeforeInstallPrompt = (event: Event) => {
      // Suppress Chrome's mini-infobar; we show our own bar and call prompt() on click.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
      setHidden(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'dismissed') rememberDismissal();
    } catch {
      /* prompt() can only be called once; treat failures as a dismissal */
      rememberDismissal();
    }
    // The event is single-use either way.
    setDeferredPrompt(null);
    setHidden(true);
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    rememberDismissal();
    setHidden(true);
  }, []);

  if (!deferredPrompt || hidden) return null;

  return (
    <div
      role="region"
      aria-label="Install Lantern Study"
      className={`fixed inset-x-0 z-[70] border-t border-lantern-border bg-lantern-surface/95 dark:bg-lantern-background/95 backdrop-blur px-3 py-2 sm:px-4 shadow-lg ${
        hasBottomTabBar
          ? 'bottom-[calc(4rem+env(safe-area-inset-bottom,0px))]'
          : 'bottom-[env(safe-area-inset-bottom,0px)]'
      }`}
    >
      <div className="max-w-4xl mx-auto flex items-center gap-3 text-sm text-lantern-text">
        <LanternIcon size={28} />
        <p className="min-w-0 flex-1 leading-snug">
          <span className="font-semibold">Install Lantern Study</span>
          <span className="hidden sm:inline text-lantern-text-secondary">
            {' '}
            — opens from your home screen and keeps working on slow connections.
          </span>
        </p>
        <button
          type="button"
          onClick={() => void install()}
          className="min-h-[44px] shrink-0 rounded-lg bg-lantern-primary hover:bg-lantern-primary-dark text-white px-4 py-2 text-sm font-medium"
        >
          Install
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg p-2 text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text"
        >
          <span aria-hidden className="block text-xl leading-none">
            ×
          </span>
        </button>
      </div>
    </div>
  );
}

export default InstallAppBanner;
