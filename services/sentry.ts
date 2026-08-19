import * as Sentry from '@sentry/react';
import { scrubSentryEvent } from '@lantern/shared/utils';

let initialized = false;

function parseSampleRate(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

/**
 * lantern-study-web project DSN. A DSN is a publishable identifier, shipped in
 * every client bundle by design — baked in (like the Turnstile sitekey) so a
 * clean-checkout production build cannot silently ship without monitoring.
 * VITE_SENTRY_DSN still overrides; dev builds stay silent unless it is set.
 */
const PRODUCTION_DSN =
  'https://f9f73b72618fd0f91c68355d1427c029@o4511609954893824.ingest.us.sentry.io/4511610106806272';

export function initSentry(): void {
  const isProd = import.meta.env.PROD;
  const dsn = import.meta.env.VITE_SENTRY_DSN || (isProd ? PRODUCTION_DSN : '');
  if (!dsn || initialized) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    tracesSampleRate: parseSampleRate(
      import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
      isProd ? 0.01 : 0
    ),
    integrations: [
      // Handled failures here are console.error'd, not thrown — the anon
      // budget-query regression was invisible to default Sentry for exactly
      // that reason. Error level only: warns are too chatty to be signal.
      Sentry.captureConsoleIntegration({ levels: ['error'] }),
      // Failed fetch/XHR responses. A Supabase 400 on token refresh logged the
      // user out with nothing thrown and nothing console.error'd, so default
      // Sentry recorded silence around a real incident. 4xx/5xx both matter:
      // the failures that hurt here (401 refresh, 400 token, 5xx API) are
      // mostly 4xx. The leading-slash target covers same-origin /api calls and
      // the dev proxy path.
      Sentry.httpClientIntegration({
        failedRequestStatusCodes: [[400, 599]],
        failedRequestTargets: [
          /^https:\/\/lantern-study-api\.onrender\.com/,
          /supabase\.co/,
          /^\//,
        ],
      }),
    ],
    // Capturing console.error also captures conditions the app already handles
    // and explains to the user. Each entry below is a state we deliberately
    // reach and recover from, so filing it as an error only buries the real
    // crashes underneath it.
    ignoreErrors: [
      // Shown to the user as a "try again later" message.
      /Rate limit exceeded/i,
      // Session expiry — the app routes back to sign-in on its own.
      'AUTH_UNAUTHORIZED',
      // The user's connection dropped mid-request; offline mode covers this.
      /Failed to fetch/i,
      /NetworkError when attempting to fetch/i,
      /Load failed/i,
      // supabase-js contends for its auth-token lock across tabs and retries.
      /Navigator LockManager lock/i,
      // A voice note recorded as WebM/Opus cannot decode in Safari. Playback
      // already falls back to "Could not play voice note" in the message row.
      /The element has no supported sources/i,
    ],
    beforeSend(event) {
      return scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event;
    },
  });
  // CSP violations are reported by the browser, not thrown by JS — no error
  // handler or console hook ever sees them, which is how an invalid
  // connect-src entry sat in the console for weeks with Sentry silent. The
  // dedicated DOM event is the only client-side way to hear about them.
  if (typeof document !== 'undefined') {
    document.addEventListener('securitypolicyviolation', (e) => {
      Sentry.captureMessage(
        `CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`,
        {
          level: 'warning',
          fingerprint: ['csp-violation', e.violatedDirective, e.blockedURI || 'inline'],
          extra: {
            violatedDirective: e.violatedDirective,
            blockedURI: e.blockedURI,
            sourceFile: e.sourceFile,
            lineNumber: e.lineNumber,
            disposition: e.disposition,
          },
        }
      );
    });
  }

  initialized = true;
}

/**
 * A logout the user did not ask for is an incident, not an auth event — the
 * refresh-token 400 that forces one never surfaces as an error anywhere else
 * (supabase-js handles it internally and just emits SIGNED_OUT). Called from
 * the SIGNED_OUT handler when no user action explains it.
 */
let intentionalSignOutAt = 0;

/** Call when the user themselves asks to sign out, before supabase.auth.signOut(). */
export function markIntentionalSignOut(): void {
  intentionalSignOutAt = Date.now();
}

export function reportUnexpectedSignOut(context: Record<string, unknown>): void {
  if (!initialized) return;
  // A user-initiated logout fires the same SIGNED_OUT event; a 30s window
  // separates "clicked Log out" from "session died underneath them".
  if (Date.now() - intentionalSignOutAt < 30_000) return;
  Sentry.captureMessage('Unexpected sign-out (session lost without user action)', {
    level: 'warning',
    fingerprint: ['unexpected-sign-out'],
    extra: context,
  });
}

export function setSentryUser(user: { id: string; email?: string } | null): void {
  if (!initialized) return;
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: user.id });
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export { Sentry };
