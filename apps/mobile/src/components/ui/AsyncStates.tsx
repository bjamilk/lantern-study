// ===========================================
// Lantern Study Mobile - Async State Primitives
// ===========================================
// One place for the three ways a data-backed screen can be non-ideal.
//
// THE RULE, applied everywhere:
//
//   error + no data    -> <ErrorState>          (say it failed, offer Retry)
//   error + stale data -> <InlineErrorBanner>   (show the data, flag it is old)
//   no error + no data -> <EmptyState>          (this is genuinely empty)
//
// Never let an error fall through to an empty state. A network failure on the
// chat list used to render "No conversations yet — Create Group", which is
// indistinguishable from a brand new account and offers no way to recover.

import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { AppIcon, type AppIconName } from './AppIcon';

export function LoadingState({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View
      className="flex-1 items-center justify-center py-16"
      accessibilityRole="progressbar"
      accessibilityLabel={label || 'Loading'}
    >
      <ActivityIndicator size="large" color={colors.primary} />
      {label ? (
        <Text className="text-sm text-lantern-text-secondary mt-3">{label}</Text>
      ) : null}
    </View>
  );
}

/**
 * Failure with nothing to show. Modelled on the one instance in the codebase
 * that already got this right (GroupChatScreen's message-load failure).
 */
export function ErrorState({
  message,
  onRetry,
  retryLabel = 'Retry',
  icon = 'cloud-offline',
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  icon?: AppIconName;
}) {
  const { colors } = useTheme();
  return (
    <View className="flex-1 items-center justify-center px-6 py-16 gap-3">
      <AppIcon name={icon} size={40} color={colors.textTertiary} />
      <Text
        className="text-sm text-center text-lantern-text-secondary"
        accessibilityLiveRegion="polite"
      >
        {message}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          hitSlop={8}
          className="px-4 py-2 rounded-xl bg-lantern-primary active:opacity-80"
        >
          <Text className="text-sm font-semibold text-white">{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Failure on top of data we already have. Deliberately non-blocking: the stale
 * content stays usable underneath.
 */
export function InlineErrorBanner({
  title,
  detail = 'Showing your latest saved data.',
  onRetry,
  retryLabel = 'Retry',
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <View
      className="mx-4 my-2 px-3 py-2.5 rounded-xl flex-row items-center gap-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
      accessibilityLiveRegion="polite"
    >
      <AppIcon name="cloud-offline" size={20} color="#dc2626" />
      <View className="flex-1 min-w-0">
        <Text className="text-sm font-semibold text-red-700 dark:text-red-300">{title}</Text>
        {detail ? (
          <Text className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">{detail}</Text>
        ) : null}
      </View>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          hitSlop={8}
          className="px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 active:opacity-70"
        >
          <Text className="text-xs font-semibold text-red-700 dark:text-red-300">{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Genuinely nothing here — and we are confident of that, because there is no error. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: AppIconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View className="flex-1 items-center justify-center px-6 py-16">
      {icon ? (
        <View className="w-16 h-16 rounded-2xl bg-lantern-primary-background dark:bg-lantern-primary-dark/40 items-center justify-center mb-4">
          <AppIcon name={icon} size={32} color={colors.primary} />
        </View>
      ) : null}
      <Text className="text-base font-semibold text-lantern-text mb-1 text-center">{title}</Text>
      {description ? (
        <Text className="text-sm text-lantern-text-secondary text-center mb-6">{description}</Text>
      ) : null}
      {action}
    </View>
  );
}
