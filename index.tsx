import './env-bootstrap';
import { initSentry } from './services/sentry';
import { clearChunkReloadFlag } from './utils/lazyWithRetry';

initSentry();
clearChunkReloadFlag();

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { bootstrapAuthFromStorage } from './services/supabase';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import LegalPage, { getLegalDocFromPathname } from './components/LegalPage';

bootstrapAuthFromStorage();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const legalDoc = getLegalDocFromPathname(window.location.pathname);

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      {legalDoc ? <LegalPage document={legalDoc} /> : <App />}
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
