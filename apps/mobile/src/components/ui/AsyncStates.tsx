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
import {
  featureAccentsDark,
  featureAccentsLight,
  type FeatureKey,
  type IllustrationName,
} from '@lantern/shared/design';
import { useTheme } from '../../theme';
import { AppIcon, type AppIconName } from './AppIcon';
import { Illustration } from './Illustration';

export function LoadingState({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View
      className="flex-1 items-center justify-center py-16"
      accessibilityRole="progressbar"
      accessibilityLabel={label || 'Loading'}
    >
      <ActivityIndicator size="large" color={colors.primaryText} />
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
          className="px-4 py-2 rounded-xl bg-lantern-primary-fill active:opacity-80"
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

/**
 * Genuinely nothing here — and we are confident of that, because there is no
 * error.
 *
 * Spec §5.7 anatomy: a disc, a title that names the BENEFIT (not the absence),
 * ONE sentence, and ONE action, and — since Wave V2 — at most ONE spot
 * illustration. Never a second "or…" button, never a paragraph.
 *
 * THE SHAPE, and why it changed: this used to be a full-tint panel with 28 px
 * of vertical padding, which on a 360x640 screen painted about 40% of the
 * viewport in one hue — four to seven times the chromatic budget for an empty
 * list (§5.6: hubs 8–15%, and an empty state is not a hub). It is now a
 * NEUTRAL card with a single tint BAND across its top: the band carries the
 * glyph and the title in the feature's ink, the sentence and the action sit on
 * the surface below, and the whole card lands near 120 dp instead of filling
 * the screen. Colour still says which feature you are in; it just stops being
 * the loudest thing on a screen whose news is that there is nothing here.
 *
 * `feature` is what makes the band a colour rather than a grey; without it the
 * band falls back to the neutral secondary ground so the ~40 older call sites
 * keep rendering sensibly.
 */

/**
 * The band is the ONE tinted area on the screen, and its height is the whole
 * budget conversation. On a 360x640 viewport a full-width list gives the card
 * about 288 dp, so 52 dp of band is ~6.5% chromatic — inside the 6–9% an empty
 * state gets, with room left for the single ink-filled action (~2.3%) that
 * some call sites pass. It also holds a 22 px glyph and a heading line.
 */
const EMPTY_BAND_MIN_HEIGHT = 52;

/**
 * With an `illustration`, the band carries the picture INSTEAD of the 22 px
 * glyph — one mark, not two — and its vertical padding halves so the band
 * grows as little as it can: 56 + 12 = 68 dp rather than 52.
 *
 * What that costs, said out loud. On a 360x640 viewport the card is 328 wide,
 * so the band goes from 328x52 (7.4% of the screen) to 328x68 (9.7%), against
 * the 6-9% an empty state gets in §5.6. It is a hair over, and it is the
 * deliberate trade the imagery rule asks for: the picture itself adds no tint
 * at all, because on a tint band the asset's ground ellipse inverts to the
 * surface colour (`variant="surface"`) rather than filling with more tint.
 *
 * The alternative — the picture below the band, on the reading surface —
 * would have cost 0% and been strictly cheaper, and it is not what §5.7 asks
 * for: an empty state's picture belongs with its heading, not stranded above
 * the sentence.
 */
const EMPTY_BAND_ILLUSTRATION_SIZE = 56;

export function EmptyState({
  icon,
  title,
  description,
  action,
  feature,
  illustration,
}: {
  icon?: AppIconName;
  /**
   * One of the ten (spec v3 §5.6). Drawn on the band in place of `icon`, so
   * passing both is not two marks — the picture simply wins. An unmapped name
   * is a compile error.
   */
  illustration?: IllustrationName;
  /** Name the benefit: "Turn slides into cards", not "No decks". */
  title: string;
  /** One sentence. Two is a paragraph, and a paragraph is not an empty state. */
  description?: string;
  /** Exactly one control. */
  action?: React.ReactNode;
  feature?: FeatureKey;
}) {
  const { colors, isDark } = useTheme();
  const accent = feature ? (isDark ? featureAccentsDark : featureAccentsLight)[feature] : null;
  return (
    <View className="px-4 py-6 items-center">
      <View className="w-full max-w-md rounded-lantern-xl overflow-hidden border border-lantern-border bg-lantern-surface">
        <View
          className={`flex-row items-center gap-2.5 px-3.5 ${illustration && feature ? 'py-1.5' : 'py-2.5'}`}
          style={{
            minHeight: EMPTY_BAND_MIN_HEIGHT,
            backgroundColor: accent ? accent.tint : colors.backgroundSecondary,
          }}
        >
          {illustration && feature ? (
            <Illustration
              name={illustration}
              feature={feature}
              size={EMPTY_BAND_ILLUSTRATION_SIZE}
              // On the band, so the ground ellipse inverts to the surface
              // colour; the authored tint ground would be invisible here.
              variant="surface"
            />
          ) : icon ? (
            <AppIcon
              name={icon}
              size={22}
              color={accent ? accent.ink : colors.primaryText}
              importantForAccessibility="no"
            />
          ) : null}
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            className="flex-1 text-heading font-semibold"
            style={{ color: accent ? accent.ink : colors.text }}
          >
            {title}
          </Text>
        </View>
        {description || action ? (
          <View className="px-3.5 py-3">
            {description ? (
              <Text className="text-caption text-lantern-text-secondary">{description}</Text>
            ) : null}
            {action ? <View className="mt-3 flex-row">{action}</View> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}
