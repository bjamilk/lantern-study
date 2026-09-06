// ===========================================
// Lantern Study Mobile - The request-failure surface
// ===========================================
/**
 * ONE way to tell a student that a request did not come back.
 *
 * Before this, the same event could read as raw "Network request failed", as
 * "Request timed out", as a bare red line with nothing to tap, or as a blank
 * spinner with no way back. The words now come from
 * `@lantern/shared/network`'s `requestFailureCopy`, so web and mobile say the
 * same sentence for the same failure, and every surface offers the same
 * recovery: a real "Try again" — plus "Go back" when retrying cannot help.
 *
 * Tone follows MarketplaceGate's unavailable screen, which already got this
 * right: name the failure, say it is not about the student, offer the action.
 *
 * Three shapes:
 *   full   — the screen failed and there is nothing to show.
 *   inline — a list failed inside a screen that still has its chrome.
 *   banner — we still have rows on screen; flag them, do not blank them.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  classifyRequestFailure,
  requestFailureCopy,
  type RequestFailureKind,
} from '@lantern/shared/network';
import { AppIcon, type AppIconName } from './ui/AppIcon';

const KIND_ICON: Record<RequestFailureKind, AppIconName> = {
  offline: 'cloud-offline',
  timeout: 'time',
  server: 'cloud-offline',
  notFound: 'help-circle',
  forbidden: 'lock-closed',
  rateLimited: 'time',
  unknown: 'alert-circle',
};

export type RequestErrorVariant = 'full' | 'inline' | 'banner';

export interface RequestErrorProps {
  /** Whatever the failed load threw. Classified, never printed raw. */
  error: unknown;
  /** Re-run the load. Omit only when there is genuinely nothing to re-run. */
  onRetry?: () => void;
  /** Offered when retrying cannot help (a 404 stays a 404). */
  onBack?: () => void;
  variant?: RequestErrorVariant;
  /** Extra sentence for context, e.g. "Your saved communities are still here." */
  detail?: string;
}

export function RequestError({
  error,
  onRetry,
  onBack,
  variant = 'full',
  detail,
}: RequestErrorProps) {
  const kind = classifyRequestFailure(error);
  const copy = requestFailureCopy(error);
  const canRetry = copy.retryLabel != null && !!onRetry;
  const retryLabel = copy.retryLabel ?? 'Try again';

  if (variant === 'banner' || variant === 'inline') {
    return (
      <View
        className="mx-4 my-2 flex-row items-center rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-800 dark:bg-red-950/30"
        style={{ gap: 12 }}
        accessibilityLiveRegion="polite"
      >
        <AppIcon name={KIND_ICON[kind]} size={20} color="#dc2626" />
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-semibold text-red-700 dark:text-red-300">{copy.title}</Text>
          <Text className="mt-0.5 text-xs text-red-600/80 dark:text-red-400/80">
            {detail ?? copy.body}
          </Text>
        </View>
        {canRetry ? (
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={retryLabel}
            hitSlop={8}
            // NativeWind inlines rem at 14 here, so a py-* class cannot be
            // trusted to reach 44px — the height is a px literal on purpose.
            style={{ minHeight: 36, justifyContent: 'center' }}
            className="rounded-lg border border-red-300 px-3 active:opacity-70 dark:border-red-700"
          >
            <Text className="text-xs font-semibold text-red-700 dark:text-red-300">
              {retryLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center px-8" accessibilityLiveRegion="polite">
      <View className="mb-5 h-16 w-16 items-center justify-center rounded-2xl bg-lantern-background-secondary dark:bg-lantern-surface-secondary">
        <AppIcon name={KIND_ICON[kind]} size={30} color="#64748b" />
      </View>
      <Text className="mb-2 text-center text-lg font-bold text-lantern-text">{copy.title}</Text>
      <Text className="mb-6 text-center text-sm text-lantern-text-secondary">
        {detail ?? copy.body}
      </Text>
      <View className="flex-row items-center" style={{ gap: 12 }}>
        {canRetry ? (
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={retryLabel}
            style={{ minHeight: 44, justifyContent: 'center' }}
            className="rounded-xl bg-lantern-primary-fill px-5 active:opacity-80"
          >
            <Text className="text-sm font-semibold text-white">{retryLabel}</Text>
          </Pressable>
        ) : null}
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={{ minHeight: 44, justifyContent: 'center' }}
            className="rounded-xl border border-lantern-border px-5 active:opacity-70"
          >
            <Text className="text-sm font-semibold text-lantern-text">Go back</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default RequestError;
