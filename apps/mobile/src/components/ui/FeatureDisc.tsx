/**
 * `FeatureDisc` — the one way a feature announces itself on mobile.
 *
 * Spec v3 §5.6 "Icon rule": a glyph that stands for a FEATURE sits on a
 * rounded disc filled with that feature's `tint`, drawn in that feature's
 * `ink`. Three sizes and no others: 40 (a tile's own mark), 32 (a row's mark),
 * 24 (a dense list). Anything smaller is an inline glyph, not a disc.
 *
 * The pair comes from tokens.ts (`featureAccentsLight` / `featureAccentsDark`)
 * so hue = feature identity everywhere, and never a fresh hex at a call site.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import {
  featureAccentsDark,
  featureAccentsLight,
  featureSmallTextInk,
  type FeatureAccentPair,
  type FeatureKey,
} from '@lantern/shared/design';
import { useTheme } from '../../theme';
import { AppIcon, type AppIconName } from './AppIcon';
import { Body, Caption, Label } from './Text';

/** The theme-correct `{ ink, tint }` pair for a feature. */
export function useFeatureAccent(feature: FeatureKey): FeatureAccentPair {
  const { isDark } = useTheme();
  return (isDark ? featureAccentsDark : featureAccentsLight)[feature];
}

/**
 * Ink is 4.60:1 on its own tint for LIME and 4.51:1 for amber — legal, but the
 * spec calls both tight and forbids setting anything under 12px in the raw
 * lime. The `label` step is 11px, so every count pill and eyebrow goes through
 * this. The substitutions live in `featureSmallTextInkLight` / `-Dark` in
 * tokens.ts (light lime darkens to `#3f6212`; nothing else is overridden), so
 * there is no hex at this call site and `scripts/design/contrast.mjs` gates
 * the same values this returns.
 *
 * `accent` is still taken so the signature does not churn; it is only the
 * fallback when a caller hands over a pair that is not the themed one.
 */
export function smallTextInk(
  feature: FeatureKey,
  accent: FeatureAccentPair,
  isDark: boolean
): string {
  const themed = featureSmallTextInk(feature, isDark ? 'dark' : 'light');
  const base = (isDark ? featureAccentsDark : featureAccentsLight)[feature].ink;
  return themed === base ? accent.ink : themed;
}

/** 40 = tile mark, 32 = row mark, 24 = dense list mark. No other size. */
export type FeatureDiscSize = 40 | 32 | 24;

const GLYPH_FOR_DISC: Record<FeatureDiscSize, number> = { 40: 22, 32: 18, 24: 14 };
const RADIUS_FOR_DISC: Record<FeatureDiscSize, number> = { 40: 14, 32: 11, 24: 8 };

export function FeatureDisc({
  feature,
  icon,
  size = 40,
  variant = 'tint',
  accessibilityLabel,
}: {
  feature: FeatureKey;
  icon: AppIconName;
  size?: FeatureDiscSize;
  /**
   * `tint` — the default: the feature's tint under its ink, for a disc on a
   * neutral ground. `surface` — the inverse, for a disc sitting ON that same
   * tint (a tile's band), where a tint fill would be invisible. Same hue, same
   * glyph, same meaning; only which of the pair is the ground changes.
   */
  variant?: 'tint' | 'surface';
  /** Only when the disc carries meaning no adjacent text repeats. */
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const accent = useFeatureAccent(feature);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: RADIUS_FOR_DISC[size],
        backgroundColor: variant === 'surface' ? colors.surface : accent.tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessible={Boolean(accessibilityLabel)}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
      accessibilityLabel={accessibilityLabel}
    >
      <AppIcon
        name={icon}
        size={GLYPH_FOR_DISC[size]}
        color={accent.ink}
        importantForAccessibility="no"
      />
    </View>
  );
}

/**
 * `FeatureTile` — a door. One feature, one band, one line of promise, an
 * optional count, and a chevron in the feature's own ink.
 *
 * Spec §5.6 "feature tile": a NEUTRAL card with a tint BAND across its top.
 * The band is what makes a hub read as a hub — a 40 px disc alone left the
 * Study hub at roughly 6% chromatic against a 12–15% budget, because a tile
 * that is 97% surface says nothing about which feature it opens until you
 * read it.
 *
 * Why the band is 32 and not the 56 a hero gets. Two rules bite at once: no
 * card may be more than 25% tint, and a 360x640 hub shows five of these at
 * once. At 32 dp a tile is 24% tint and the whole hub lands near 13% — inside
 * both. At 56 the hub would be 24%, which is a poster, not a hub.
 *
 * The disc inside the band is the `surface` variant: on its own tint a tinted
 * disc is invisible, so the pair inverts and the glyph keeps its ink. The
 * count pill inverts with it.
 *
 * Height floor is 132 dp: the band plus a two-line promise, and still a 2-up
 * grid that reads as a target on a 360 wide screen. The whole tile is the
 * target (never just the chevron).
 *
 * Why the promise is TOP-aligned under the band. The body used to be
 * `flex-1 justify-end`, which pushed the title to the card's floor and left
 * the slack — ~48 dp on a one-line promise, since 132 is a floor most tiles
 * never fill — as a blank stripe between the band and the first word. On
 * device that read as a broken card, not as breathing room (device pass on
 * build 159, D1). The band is still exactly 32 dp; the title now starts
 * directly under it, and the chevron takes the floor, so the slack sits
 * BETWEEN the promise and the affordance where it reads as spacing.
 *
 * The floor itself does not move: 32/132 is 24% tint, and the spec caps a
 * card at 25%, so a shorter tile would put the band over budget.
 */
const TILE_BAND_HEIGHT = 32;

export function FeatureTile({
  feature,
  icon,
  title,
  subtitle,
  count,
  countLabel,
  onPress,
  accessibilityLabel,
  className = '',
  testID,
}: {
  feature: FeatureKey;
  icon: AppIconName;
  title: string;
  subtitle?: string;
  /** Drawn as a pill on the band. `0` and `undefined` draw nothing. */
  count?: number;
  /** Spoken form of the count, e.g. "3 due". Falls back to the raw number. */
  countLabel?: string;
  onPress: () => void;
  accessibilityLabel?: string;
  className?: string;
  testID?: string;
}) {
  const { colors, isDark } = useTheme();
  const accent = useFeatureAccent(feature);
  const showCount = typeof count === 'number' && count > 0;
  const pillInk = smallTextInk(feature, accent, isDark);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ??
        [title, showCount ? countLabel ?? String(count) : null, subtitle]
          .filter(Boolean)
          .join('. ')
      }
      testID={testID}
      style={{ minHeight: 132 }}
      className={`flex-1 overflow-hidden rounded-lantern-xl border border-lantern-border bg-lantern-surface active:opacity-90 ${className}`}
    >
      <View
        style={{ height: TILE_BAND_HEIGHT, backgroundColor: accent.tint }}
        className="flex-row items-center justify-between px-1.5"
      >
        <FeatureDisc feature={feature} icon={icon} size={24} variant="surface" />
        {showCount ? (
          <View
            style={{ backgroundColor: colors.surface }}
            className="px-2 py-0.5 rounded-full"
          >
            <Label
              tabular
              style={{ color: pillInk, fontWeight: '700' }}
              importantForAccessibility="no"
            >
              {count > 99 ? '99+' : count}
            </Label>
          </View>
        ) : null}
      </View>
      <View className="flex-1 justify-between p-3">
        <View className="min-w-0">
          <Body style={{ fontWeight: '600' }} numberOfLines={1}>
            {title}
          </Body>
          {subtitle ? (
            <Caption tone="secondary" numberOfLines={2} className="mt-0.5">
              {subtitle}
            </Caption>
          ) : null}
        </View>
        <View className="flex-row justify-end">
          <AppIcon
            name="chevron-forward"
            size={16}
            color={accent.ink}
            importantForAccessibility="no"
          />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * `FeatureRow` — the same door in one line, for lists inside a neutral card.
 * The disc is 32; the divider is the caller's, drawn in the border colour.
 */
export function FeatureRow({
  feature,
  icon,
  title,
  subtitle,
  onPress,
  accessibilityLabel,
  right,
  className = '',
}: {
  feature: FeatureKey;
  icon: AppIconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  accessibilityLabel?: string;
  right?: React.ReactNode;
  className?: string;
}) {
  const accent = useFeatureAccent(feature);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join('. ')}
      className={`flex-row items-center gap-3 py-3 active:opacity-80 ${className}`}
    >
      <FeatureDisc feature={feature} icon={icon} size={32} />
      <View className="flex-1 min-w-0">
        <Body style={{ fontWeight: '600' }} numberOfLines={1}>
          {title}
        </Body>
        {subtitle ? (
          <Caption tone="secondary" numberOfLines={1}>
            {subtitle}
          </Caption>
        ) : null}
      </View>
      {right ?? (
        <AppIcon
          name="chevron-forward"
          size={16}
          color={accent.ink}
          importantForAccessibility="no"
        />
      )}
    </Pressable>
  );
}

export default FeatureDisc;
