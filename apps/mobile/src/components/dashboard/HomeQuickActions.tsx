/**
 * Home's six doors, as a 2-up grid of `DoorTile`s.
 *
 * Web's `components/dashboard/HomeQuickActions.tsx` is the functional
 * reference; the visual is the StudyFetch door (`ui/DoorTile.tsx`) rather than
 * web's outlined button, because that is what the phone shipped as its hub
 * unit. The registry — which glyph, which hue, which drawing — lives in
 * `homeSections.ts` beside its test, so "no two doors alike" is a gate rather
 * than a thing to eyeball on device.
 *
 * This REPLACES the old "Quick actions" heading over `DashboardQuickLinks`
 * (phone walk defect 15): a heading is worth its line when six doors follow
 * it, not when four flat links do.
 *
 * A door whose handler is not supplied is dropped rather than drawn dead, so
 * the grid never offers a tap that goes nowhere.
 */
import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { DoorTile } from '../ui/DoorTile';
import { homeDoorScene } from '../ui/tileSceneFills';
import { T } from '../ui';
import {
  HOME_QUICK_ACTIONS,
  homeQuickActionGrid,
  type HomeQuickActionId,
} from './homeSections';

export interface HomeQuickActionsProps {
  /** One handler per door id. A missing handler drops that door. */
  onAction: Partial<Record<HomeQuickActionId, () => void>>;
}

/** Home's ScrollView pays this much horizontal padding; the doors sit inside it. */
const PAGE_PADDING = 16;
/** The container's own gap. Kept beside the arithmetic that depends on it. */
const GUTTER = 12;

export function HomeQuickActions({ onAction }: HomeQuickActionsProps) {
  const { width } = useWindowDimensions();
  // Told, not measured — the door's own rule. See doorTileLayout.ts. The width
  // comes from the box the doors are ACTUALLY in (screen minus Home's own 16 dp
  // padding, minus this container's gap), not from the door spec's page margin:
  // dividing the raw screen width made each pair three pixels too wide for the
  // padded row, so every door wrapped onto its own line (Wave P defect 5).
  const { tileWidth } = homeQuickActionGrid({
    screenWidth: width,
    horizontalPadding: PAGE_PADDING,
    gutter: GUTTER,
  });

  const doors = HOME_QUICK_ACTIONS.map((spec) => ({ spec, onPress: onAction[spec.id] })).filter(
    (row): row is { spec: (typeof HOME_QUICK_ACTIONS)[number]; onPress: () => void } =>
      typeof row.onPress === 'function'
  );

  if (doors.length === 0) return null;

  return (
    <View className="mb-4">
      <T.Caption tone="secondary" className="mb-2">
        Quick actions
      </T.Caption>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GUTTER }}>
        {doors.map(({ spec, onPress }) => (
          <DoorTile
            key={spec.id}
            feature={spec.feature}
            icon={spec.icon}
            // The panel's picture. A door with a SCENE takes the scene path,
            // which is the one the set room's tiles take, so the same feature
            // is drawn in the same two colours on both screens. Without that
            // the illustration below it painted its ground ellipse in the
            // surface — a white sheet on the butter pastel in light, where the
            // set room's `Lectures` tile drew the shade (1.0.60 smoke).
            scene={homeDoorScene(spec.id)}
            illustration={spec.illustration}
            title={spec.label}
            width={tileWidth}
            onPress={onPress}
            testID={`home-door-${spec.id}`}
          />
        ))}
      </View>
    </View>
  );
}

export default HomeQuickActions;
