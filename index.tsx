import './env-bootstrap';
import { initSentry } from './services/sentry';
import { clearChunkReloadFlag } from './utils/lazyWithRetry';

initSentry();
clearChunkReloadFlag();

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import { bootstrapAuthFromStorage } from './services/supabase';
import { applyDesignTokensToDom } from './utils/applyDesignTokens';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import CookieNoticeBanner from './components/CookieNoticeBanner';
import LegalPage from './components/LegalPage';

bootstrapAuthFromStorage();

const initialTheme =
  typeof window !== 'undefined' && localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
applyDesignTokensToDom(initialTheme);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/privacy" element={<LegalPage document="privacy" />} />
          <Route path="/terms" element={<LegalPage document="terms" />} />
          <Route path="/cookies" element={<LegalPage document="cookies" />} />
          <Route path="/*" element={<App />} />
        </Routes>
        {/* Mounted at router root so legal pages can open the Preference Center */}
        <CookieNoticeBanner />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);

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
