/**
 * `DoorTile` — the hub's unit, in the StudyFetch anatomy (founder direction,
 * 2026-09-11).
 *
 * A door is a nearly-square card made of two planes. The TOP two thirds are a
 * pastel PANEL carrying one black line drawing; the bottom third is a white
 * FOOTER carrying the door's name beside a small glyph tinted to the panel's
 * own hue. Behind the whole thing sits a HARD black shadow, offset down and
 * right with no blur — a drawn edge, not depth.
 *
 * WHY THIS AND NOT `FeatureTile`. The tile next door is a white card with a
 * 32 dp colour strip across its top: 24% tint, which is what the old spec's
 * "no card over 25% tint" budget allowed. That budget was written for a screen
 * whose ground was white. On a cream ground with the pastels as the only
 * colour, a 24% strip reads as a label on a card rather than as a door, and a
 * hub of them reads as a settings list. The door inverts the ratio — the
 * pastel IS the tile and the white strip is the caption — which is the whole
 * difference between the two hubs in review. `FeatureTile` stays for the
 * surfaces that have not moved yet; new hub work uses this.
 *
 * WHY THE SHADOW IS A SIBLING VIEW AND NOT `shadow*`/`elevation`. Neither
 * platform can draw a hard offset shadow through the style props: iOS's
 * `shadowRadius: 0` is close but still composites the alpha, and Android's
 * `elevation` has no offset or radius control at all — it draws one blurred
 * ambient shadow and nothing else. So the shadow is what it looks like: a
 * black rounded rectangle of the same size, offset behind the tile. That also
 * makes it identical in both themes and on both platforms, which an elevation
 * never is.
 *
 * WHY THE HEIGHT IS ARITHMETIC. `doorTileLayout.ts` beside this file, and the
 * build-166 clipped-picture bug it documents: a panel sized as "66% of the
 * content" measures nothing on the app's first layout pass, because the
 * drawing's native view has not attached yet. The door is TOLD its boxes from
 * its column width, so its first render is its final one.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import type { FeatureKey, IllustrationName } from '@lantern/shared/design';
import { useTheme } from '../../theme';
import { AppIcon, type AppIconName } from './AppIcon';
import { useFeatureAccent } from './FeatureDisc';
import { Illustration } from './Illustration';
import { ILLUSTRATION_SIZES, type IllustrationSize } from './illustrationFills';
import { doorTileLayout } from './doorTileLayout';
import { Body } from './Text';

export { doorTileColumnWidth, doorTileLayout, type DoorTileLayout } from './doorTileLayout';

/**
 * The nearest authored illustration size at or under `box`.
 *
 * `Illustration` takes a closed union of three sizes on purpose — an asset
 * that can be drawn at any number is an asset whose stroke weight drifts — so
 * a door picks from the three rather than passing its own arithmetic through.
 * Floors rather than rounds: a picture that overflows the panel's padding is
 * the clipped-drawing bug again.
 */
export function doorIllustrationSize(box: number): IllustrationSize {
  const ordered = [...ILLUSTRATION_SIZES].sort((a, b) => a - b) as IllustrationSize[];
  let chosen = ordered[0];
  for (const size of ordered) {
    if (size <= box) chosen = size;
  }
  return chosen;
}

export interface DoorTileProps {
  /** Which hue the panel is painted in, and which ink its footer glyph takes. */
  feature: FeatureKey;
  /** The door's name, in the white footer. One line. */
  title: string;
  /** The footer's small glyph, tinted to the panel's hue. */
  icon: AppIconName;
  /**
   * The panel's drawing. Given a name from `@lantern/shared/design`, the spot
   * illustration is drawn; omitted, the door draws `icon` large in BLACK,
   * which is the direction's own "black line illustration" and needs no new
   * asset for a door that does not have one yet.
   */
  illustration?: IllustrationName;
  /** The column width the grid handed this door. Everything else follows. */
  width: number;
  onPress: () => void;
  /** Only when the door means more than its title says. */
  accessibilityLabel?: string;
  testID?: string;
}

export function DoorTile({
  feature,
  title,
  icon,
  illustration,
  width,
  onPress,
  accessibilityLabel,
  testID,
}: DoorTileProps) {
  const { colors, isDark } = useTheme();
  const accent = useFeatureAccent(feature);
  const layout = doorTileLayout({ width });

  // On the pastel panel the drawing has to be the DARKEST thing in the tile.
  // In light that is the page's own ink — the direction's near-black. In dark
  // the panel is a deep tint, so the same ink would be invisible and the
  // feature's (light) ink is what reads; `colors.text` is that light hue.
  const drawingInk = colors.text;

  return (
    // The shadow's offset is real layout, not an overflow: the black rectangle
    // sits inside this wrapper, so a door in a grid reserves the room its own
    // shadow occupies and two adjacent doors cannot overlap each other's.
    <View style={{ width: layout.width, height: layout.height + layout.shadowOffset }}>
      <View
        // Decorative and inert: the Pressable above it is the whole target.
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        style={{
          position: 'absolute',
          left: layout.shadowOffset,
          top: layout.shadowOffset,
          width: layout.width - layout.shadowOffset,
          height: layout.height,
          borderRadius: layout.radius,
          // Black in both themes. A "dark-mode-aware" shadow under a tile that
          // is itself a colour reads as a halo; this is an edge, so it is ink.
          backgroundColor: isDark ? colors.border : '#000000',
        }}
      />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        testID={testID}
        style={{
          width: layout.width - layout.shadowOffset,
          height: layout.height,
          borderRadius: layout.radius,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          overflow: 'hidden',
        }}
        className="active:opacity-90"
      >
        <View
          style={{
            height: layout.panelHeight,
            backgroundColor: accent.tint,
            paddingTop: layout.panelPaddingTop,
            alignItems: 'center',
            justifyContent: 'flex-start',
          }}
        >
          {illustration ? (
            <Illustration
              name={illustration}
              feature={feature}
              size={doorIllustrationSize(layout.illustrationSize)}
              // The ground ellipse inverts to the white surface: on its own
              // tint a tint-filled ground is invisible.
              variant="surface"
            />
          ) : (
            <AppIcon
              name={icon}
              size={Math.round(layout.illustrationSize * 0.7)}
              color={drawingInk}
              importantForAccessibility="no"
            />
          )}
        </View>
        <View
          style={{
            height: layout.footerHeight,
            paddingHorizontal: 10,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <AppIcon
            name={icon}
            size={16}
            // Tinted to the panel's hue — the one place the ink appears in the
            // white strip, so the footer belongs to the panel above it.
            color={accent.ink}
            importantForAccessibility="no"
          />
          <Body
            style={{ fontWeight: '600', flex: 1 }}
            numberOfLines={1}
            importantForAccessibility="no"
          >
            {title}
          </Body>
        </View>
      </Pressable>
    </View>
  );
}

export default DoorTile;
