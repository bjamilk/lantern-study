/**
 * Optional Sentry initialization — no-op when SENTRY_DSN is unset.
 */
import { scrubSentryEvent } from '@lantern/shared/utils/server';

function parseSampleRate(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

/**
 * `lantern-api@<package version>+<commit>`.
 *
 * FIXED (SW): the release read `lantern-api@1.0.0` — the bare package version,
 * identical on every deploy, so an issue could not be tied to the build that
 * produced it. The commit comes from the same environment variables
 * `/health`'s commit marker uses (apps/api-server/src/routes/health.ts), so the
 * two always agree and a Sentry release can be checked against a live /health.
 */
export function resolveApiRelease(): string | undefined {
  // An operator-set release that already names a build (`…+<sha>`) wins; the
  // deployed value today is a bare `lantern-api@1.0.0`, which is exactly the
  // uninformative form this function exists to replace, so a `+`-less override
  // is treated as the NAME and still gets the commit appended.
  const override = process.env.SENTRY_RELEASE;
  if (override && override.includes('+')) return override;
  let version = '0.0.0';
  try {

    version = require('../../package.json').version || version;
  } catch {
    // packaged without the manifest — the commit alone still identifies it
  }
  const commit = (
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.SOURCE_VERSION ||
    ''
  ).slice(0, 7);
  const base = override || `lantern-api@${version}`;
  return `${base}+${commit || 'unknown'}`;
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {

    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: resolveApiRelease(),
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
