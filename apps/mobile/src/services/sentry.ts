import * as Sentry from '@sentry/react-native';
import { scrubSentryEvent } from '@lantern/shared/utils';

let initialized = false;

function parseSampleRate(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn || initialized) return;

  const isProd = process.env.NODE_ENV === 'production';
  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_APP_VARIANT || (__DEV__ ? 'development' : 'production'),
    release: process.env.EXPO_PUBLIC_SENTRY_RELEASE || undefined,
    tracesSampleRate: parseSampleRate(
      process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
      isProd ? 0.01 : 0
    ),
    beforeSend(event) {
      return scrubSentryEvent(event);
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
