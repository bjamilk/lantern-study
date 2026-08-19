/**
 * Optional Sentry initialization — no-op when SENTRY_DSN is unset.
 */
import { scrubSentryEvent } from '@lantern/shared/utils/server';

function parseSampleRate(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {

    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE || undefined,
      tracesSampleRate: parseSampleRate(
        process.env.SENTRY_TRACES_SAMPLE_RATE,
        process.env.NODE_ENV === 'production' ? 0.01 : 0.1
      ),
      beforeSend(event: Record<string, unknown>) {
        return scrubSentryEvent(event);
      },
    });
    console.log('Sentry initialized');
  } catch {
    console.warn('@sentry/node not installed — skipping error tracking');
  }
}

/**
 * Report an error that never reaches the Express error handler.
 *
 * The AI routes each catch their own failure and answer 503 directly, so the
 * whole provider cascade collapsing — the one failure users actually feel —
 * was invisible in Sentry. Anything swallowed that way should come through
 * here instead.
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!process.env.SENTRY_DSN) return;
  try {

    const Sentry = require('@sentry/node');
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // Sentry optional — never let reporting break the request path.
  }
}

export function setupSentryExpress(app: import('express').Application): void {
  if (!process.env.SENTRY_DSN) return;
  try {

    const Sentry = require('@sentry/node');
    if (typeof Sentry.setupExpressErrorHandler === 'function') {
      Sentry.setupExpressErrorHandler(app);
    }
  } catch {
    // Sentry optional
  }
}
