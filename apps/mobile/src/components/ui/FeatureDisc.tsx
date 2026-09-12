/**
 * `FeatureDisc` — the one way a feature announces itself on mobile.
 *
 * Spec v3 §5.6 "Icon rule", as amended by the founder direction of 2026-09-11:
 * a glyph that stands for a FEATURE sits on a pastel rounded SQUARE — a
 * squircle at 0.3 of its own side, not a circle — filled with that feature's
 * `tint` and drawn in BLACK. Four sizes and no others: 56 (a door's mark), 40
 * (a card's), 32 (a row's), 24 (a dense list's). Anything smaller is an inline
 * glyph, not a tile.
 *
 * The tint comes from tokens.ts (`featureAccentsLight` / `featureAccentsDark`)
 * so hue = feature identity everywhere, and never a fresh hex at a call site.
 * The glyph does NOT: it is the page's own ink, so the mark is a black shape
 * on colour rather than a coloured shape on the same colour.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import {
  featureAccentsDark,
  featureAccentsLight,
  featureSmallTextInk,
  type FeatureAccentPair,
  type FeatureKey,
  type IllustrationName,
} from '@lantern/shared/design';
import { TYPE_TILE, useTheme } from '../../theme';
import { AppIcon, type AppIconName } from './AppIcon';
import {
  TILE_BAND_HEIGHT,
  TILE_CHEVRON_SIZE,
  TILE_ILLUSTRATION_SIZE,
  featureTileFooterHeight,
  featureTileMinHeight,
} from './featureTileLayout';
import { Illustration } from './Illustration';
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

/**
 * The four sizes a type tile comes in, and nothing between them.
 *
 * 56 is a door's own mark, 40 a card's, 32 a row's and 24 a dense list's.
 * (46 dp on a list row and 44 in a sheet are StudyFetch's two measured sizes;
 * they round to this app's 40/32 ladder rather than adding two more steps that
 * differ from their neighbours by 2 dp and read identically.)
 */
export type FeatureDiscSize = 56 | 40 | 32 | 24;

/**
 * Geometry, from the measured fractions rather than a hand-written map: a
 * squircle at 0.3 of the side with a glyph at half. Computed once at module
 * load, because four sizes times two numbers is not worth a render.
 */
const DISC_SIZES: readonly FeatureDiscSize[] = [56, 40, 32, 24];

const GLYPH_FOR_DISC = Object.fromEntries(
  DISC_SIZES.map((size) => [size, Math.round(size * TYPE_TILE.glyphFraction)])
) as Record<FeatureDiscSize, number>;

const RADIUS_FOR_DISC = Object.fromEntries(
  DISC_SIZES.map((size) => [size, Math.round(size * TYPE_TILE.radiusFraction)])
) as Record<FeatureDiscSize, number>;

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
  // The glyph on a PASTEL tile is the page's own ink — near-black in light,
  // near-white in dark — not the feature's hue (founder direction: "pastel
  // rounded square with a BLACK glyph"). Hue stays the tile's job; drawing an
  // indigo glyph on an indigo pastel is what made a row of these read as eight
  // shades of the same smudge rather than as eight shapes.
  //
  // The `surface` variant is the exception and keeps the ink: there the disc
  // sits ON the tint (a card's band), so the pastel is behind the tile rather
  // than in it, and the ink is the only colour left to say which feature it is.
  const glyphColor = variant === 'surface' ? accent.ink : colors.text;
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
        color={glyphColor}
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
 *
 * THE PICTURE (spec v3 §5.6 "Imagery rule"). A tile may carry ONE spot
 * illustration, and it goes in the SLACK — the bottom-left of the body, on
 * the chevron's own row — not in the band. Three reasons, in order:
 *
 *   1. Tint budget. The band is 32 dp of a 132 dp floor, i.e. 24% against a
 *      25% cap; a 56 dp picture in the band takes it to 80/180 = 44%. In the
 *      body it costs nothing, because the only filled part of the asset is
 *      its ground ellipse (~180 px^2 at this size, well under 1% of the tile).
 *      Being taller, a tile WITH a picture is in fact less tinted than one
 *      without: ~19% instead of 24%.
 *   2. The band already has a mark. The 24 dp disc is the FEATURE's mark and
 *      the illustration is the DOOR's picture; stacking them in one 32 dp
 *      strip reads as two competing logos.
 *   3. That slack was the D1 complaint. A one-line promise left ~48 dp of
 *      blank stripe above the chevron; the picture is what the space is for.
 *
 * The picture is decorative: the tile's own accessibility label already says
 * the title, the count and the promise, so `Illustration` is left unlabelled
 * and hidden from the screen reader rather than announced as an image.
 *
 * WHY THE HEIGHT IS ARITHMETIC AND NOT A MEASUREMENT. Every Home door on
 * build 166 rendered at its 132 floor with the picture clipped and the chevron
 * pushed out of the card, while the identical tile on the Study hub rendered
 * 160 and correct — because Home is the initial route and its doors are the
 * only ones laid out on the app's first layout pass, where the picture's
 * subtree contributes no height. So the tile no longer waits to be told: the
 * footer row is given a definite height and the floor already reserves it. The
 * arithmetic is in `featureTileLayout.ts`, beside its test.
 */

export function FeatureTile({
  feature,
  icon,
  title,
  subtitle,
  count,
  countLabel,
  illustration,
  onPress,
  accessibilityLabel,
  className = '',
  testID,
}: {
  feature: FeatureKey;
  icon: AppIconName;
  title: string;
  subtitle?: string;
  /**
   * The door's picture, from the ten in `@lantern/shared/design`. An unmapped
   * name is a compile error; omitting it draws the tile exactly as before.
   */
  illustration?: IllustrationName;
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
      style={{
        minHeight: featureTileMinHeight({
          hasIllustration: Boolean(illustration),
          hasSubtitle: Boolean(subtitle),
        }),
      }}
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
        <View
          // Definite, never measured: see the note above. Without it the row
          // is only as tall as whatever the picture's view has reported, which
          // on the first pass is nothing.
          style={{ height: featureTileFooterHeight(Boolean(illustration)) }}
          className={`flex-row items-end justify-between ${illustration ? 'mt-2' : ''}`}
        >
          {illustration ? (
            <Illustration
              name={illustration}
              feature={feature}
              size={TILE_ILLUSTRATION_SIZE}
            />
          ) : (
            <View />
          )}
          <AppIcon
            name="chevron-forward"
            size={TILE_CHEVRON_SIZE}
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
