/**
 * Web entry point: boots storage/env/Sentry/auth/theme, mounts the React tree,
 * and registers (or in dev tears down) the service worker.
 *
 * Exports: nothing — a side-effect module, evaluated once from apps/web's
 *  index.html. `App` is mounted under the catch-all '/*' route below.
 * Touches: localStorage ('theme', the auth-link error stash, the referral code),
 *  document #root, navigator.serviceWorker, Sentry, the supabase-js in-memory
 *  session (bootstrapAuthFromStorage), CSS custom properties on <html>.
 * Gotchas:
 *  - Statement ORDER in this file is load-bearing, not stylistic. The three
 *    ordering constraints are commented at their own lines below (storage
 *    fallback first, type.css after index.css, auth-hash/referral capture before
 *    anything rewrites the URL).
 *  - '/*' must stay the LAST <Route>: the legal paths above it are the only ones
 *    that never mount <App />, so a route added after it is unreachable.
 *  - Dev unregisters service workers instead of updating them, so a prod SW left
 *    on localhost only stops serving its cache after one more load.
 */

// Must stay the first import: it installs a working localStorage before any
// other module is evaluated. Webviews that expose a null localStorage (links
// opened inside WhatsApp/Instagram) otherwise blanked the page on the theme
// lookup below, which runs before React mounts.
import './utils/storageFallback';
import './env-bootstrap';
import { initSentry } from './services/sentry';
initSentry();

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
// After index.css: the type-scale tokens must win over any earlier definition.
import './design/type.css';
import { bootstrapAuthFromStorage } from './services/supabase';
import { applyDesignTokensToDom } from './utils/applyDesignTokens';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import CookieNoticeBanner from './components/CookieNoticeBanner';
import InstallAppBanner from './components/pwa/InstallAppBanner';
import ProductAnalyticsRouteListener from './components/ProductAnalyticsRouteListener';
import LegalPage from './components/LegalPage';

// Seeds supabase-js with whatever session is already in storage, synchronously,
// so the first data fetch after mount is not made anonymously. In cookie-auth
// prod this is the placeholder-token session; services/supabase.ts's fetch
// interceptor is what keeps gotrue from trying to refresh it.
bootstrapAuthFromStorage();

// Failed auth-link hashes (#error_code=otp_expired etc.) must be captured
// before anything else touches the URL — supabase-js and the router both
// rewrite it. Consumed here, surfaced on the login screen.
import { consumeAuthErrorHash, stashAuthLinkError } from './utils/authErrorHash';

// Phase 4 Q: capture ?ref= from WHATEVER url the visitor landed on, before any
// routing can drop the query string. An ambassador's link often lands on '/',
// '/welcome' or a campus page rather than '/signup'.
import { captureReferralCode } from './utils/referral';
captureReferralCode();
{
  const authLinkError = consumeAuthErrorHash();
  if (authLinkError) stashAuthLinkError(authLinkError);
}

// Applied before createRoot so the first painted frame is already in the right
// theme. `applyDesignTokensToDom` only strips legacy inline vars and sets a
// custom accent — the palette itself lives in index.css `:root`/`.dark`, and
// inlining it on <html> would outrank every stylesheet rule.
const initialTheme =
  typeof window !== 'undefined' && localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
applyDesignTokensToDom(initialTheme);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Route table: the five legal documents render standalone (no AppShell, no auth
// gate); '/*' hands everything else to <App />, which does its own routing off
// location.pathname. The three banners sit outside <Routes> so they survive
// navigation.
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/privacy" element={<LegalPage document="privacy" />} />
          <Route path="/terms" element={<LegalPage document="terms" />} />
          <Route path="/cookies" element={<LegalPage document="cookies" />} />
          <Route path="/legal/prohibited" element={<LegalPage document="prohibited" />} />
          <Route path="/legal/seller-terms" element={<LegalPage document="seller-terms" />} />
          <Route path="/*" element={<App />} />
        </Routes>
        {/* Mounted at router root so legal pages can open the Preference Center */}
        <ProductAnalyticsRouteListener />
        <CookieNoticeBanner />
        <InstallAppBanner />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);

// Registered on 'load', after the first render, so precaching never competes
// with the initial bundle fetch. Dev takes the opposite branch and unregisters
// everything: a SW left behind by a prod visit on the same origin would
// otherwise keep serving its cached shell over the dev server.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    } else {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      }).catch(() => {});
    }
  });
}
