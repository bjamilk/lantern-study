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
    ],
    beforeSend(event) {
      return scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event;
    },
  });
  initialized = true;
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
