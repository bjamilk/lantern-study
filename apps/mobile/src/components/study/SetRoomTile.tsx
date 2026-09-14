/**
 * A set-room tile: pastel panel, noun, count.
 *
 * WHAT CHANGED FROM `DoorTile`, AND WHY THIS IS NOT JUST A PROP ON IT.
 *
 * 1. It carries a COUNT. StudyFetch's hub tiles read `Tests 3`,
 *    `Flashcards 3`, `Live Lecture 6`, so a set can be read at a glance;
 *    Lantern's read nothing, and `Decks · 2` sat five screens below (SF2
 *    evidence §6 item 6). The pill is the tile's right-hand footer column.
 * 2. Its label is a NOUN and there is no description line — the room's tiles
 *    said `Start a tutor session` and `Create flashcards`, which wrap on a
 *    2-up grid (§4.1).
 * 3. It is FLAT. The hard `#000000` offset shadow is gone app-wide via
 *    `DOOR_TILE.shadowOffset`; a hairline border and a 16 dp radius are the
 *    whole edge. This tile therefore has no shadow sibling view at all.
 *
 * The geometry is still `doorTileLayout` — the same arithmetic panel/footer
 * split, told rather than measured, for the same reason (a panel sized as a
 * fraction of its content measures 0 on the first layout pass).
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import type { FeatureKey, TileSceneName } from '@lantern/shared/design';
import { useTheme } from '../../theme';
import { AppIcon, type AppIconName, doorTileLayout, T } from '../ui';
import { smallTextInk, useFeatureAccent } from '../ui/FeatureDisc';
import { TileScene } from '../ui/TileScene';

export interface SetRoomTileProps {
  feature: FeatureKey;
  /** The noun. One line. */
  title: string;
  icon: AppIconName;
  /**
   * The landscape drawing for this door's panel, where the art set has one.
   * Without it the panel keeps the single centred glyph it has always drawn —
   * a fallback, not a downgrade: a door with no scene is a door nobody has
   * drawn yet, and a glyph says that honestly.
   */
  scene?: TileSceneName;
  /** How many of this thing the set holds. `undefined` draws no pill. */
  count?: number;
  /** The column width the grid handed this tile. */
  width: number;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

export function SetRoomTile({
  feature,
  title,
  icon,
  scene,
  count,
  width,
  onPress,
  accessibilityLabel,
  testID,
}: SetRoomTileProps) {
  const { colors, isDark } = useTheme();
  const accent = useFeatureAccent(feature);
  const layout = doorTileLayout({ width });
  const pillInk = smallTextInk(feature, accent, isDark);
  const spokenCount = typeof count === 'number' ? `${count}` : '';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? [title, spokenCount].filter(Boolean).join(', ')
      }
      testID={testID}
      style={{
        width: layout.width,
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
        {/* On the pastel the drawing is the darkest thing in the tile: the
            page's own ink in light, the feature's light ink in dark, where a
            near-black on a deep tint would be invisible.

            The SCENE, where the door has one, is a landscape picture that
            fills the panel — which is what the panel is FOR. The glyph it
            replaces was a 40-odd-pixel mark floating in a 2:1 band, and the
            same mark again in the footer a few pixels below it: three tiles
            side by side drew six copies of three glyphs. The footer glyph,
            the label and the count pill are untouched; only the thing in the
            middle of the pastel changed. */}
        {scene ? (
          <TileScene
            scene={scene}
            feature={feature}
            boxWidth={layout.width}
            boxHeight={layout.illustrationSize}
          />
        ) : (
          <AppIcon
            name={icon}
            size={Math.round(layout.illustrationSize * 0.62)}
            color={colors.text}
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
        <AppIcon name={icon} size={16} color={accent.ink} importantForAccessibility="no" />
        <T.Body
          style={{ fontWeight: '600', flex: 1 }}
          numberOfLines={1}
          importantForAccessibility="no"
        >
          {title}
        </T.Body>
        {typeof count === 'number' ? (
          <View
            style={{ backgroundColor: accent.tint }}
            className="px-2 py-0.5 rounded-full"
          >
            <T.Label
              style={{ color: pillInk, fontWeight: '700' }}
              importantForAccessibility="no"
            >
              {spokenCount}
            </T.Label>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export default SetRoomTile;
