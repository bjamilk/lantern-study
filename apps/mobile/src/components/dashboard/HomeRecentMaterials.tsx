/**
 * "Recent materials" — the phone's half of web's
 * `components/dashboard/HomeRecentMaterials.tsx`.
 *
 * One row of tiles: the MATERIALS a student has open (notes and lectures).
 * The ACTIVITIES that used to sit under them are now their own spine region,
 * `HomeRecentActivities`, because two unlabelled tile rows under one "Recent
 * materials" heading meant the second row was labelled by the wrong noun.
 * Each tile wears the glyph and hue `resumeKindPresentation(kind)` hands out,
 * which is the same registry
 * the set's own workspace reads — so a recap is the same violet headphone on
 * Home as it is inside the set, and an object never changes colour by moving.
 *
 * Deliberately dumb: the rows arrive resolved, because the screen already
 * fetches the resume feed for the greeting's Continue button and a second
 * fetch here would be the same request twice on every focus.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { resumeKindPresentation, type StudyResumeMaterial } from '@lantern/shared/learning';
import { FeatureDisc } from '../ui/FeatureDisc';
import { T } from '../ui';

export interface HomeRecentMaterialsProps {
  materials: readonly StudyResumeMaterial[];
  /** A material opens as itself — the note, by id. */
  onOpenMaterial: (material: StudyResumeMaterial) => void;
}

const MAX_MATERIALS = 4;

export function HomeRecentMaterials({ materials, onOpenMaterial }: HomeRecentMaterialsProps) {
  // No heading over nothing: the whole region goes when there is nothing in it.
  if (materials.length === 0) return null;

  return (
    <View className="mb-4">
      <T.Caption tone="secondary" className="mb-2">
        Recent materials
      </T.Caption>

      <View className="flex-row flex-wrap gap-2">
          {materials.slice(0, MAX_MATERIALS).map((material) => {
            const { icon, feature } = resumeKindPresentation(material.kind);
            return (
              <Pressable
                key={material.id}
                onPress={() => onOpenMaterial(material)}
                accessibilityRole="button"
                accessibilityLabel={`${material.title}, ${material.kind}`}
                testID={`home-recent-material-${material.id}`}
                // flexBasis rather than a Tailwind arbitrary percentage: a 2-up
                // wrap that RN understands on both platforms.
                style={{ flexBasis: '47%', flexGrow: 1 }}
                className="flex-row items-center gap-2 rounded-lantern-xl border border-lantern-border bg-lantern-surface p-3 active:opacity-80"
              >
                <FeatureDisc feature={feature} icon={icon} size={32} />
                <View className="flex-1 min-w-0">
                  <T.Body style={{ fontWeight: '600' }} numberOfLines={1}>
                    {material.title || 'Untitled note'}
                  </T.Body>
                  <T.Caption tone="secondary" numberOfLines={1}>
                    {material.kind === 'lecture' ? 'Lecture' : 'Note'}
                  </T.Caption>
                </View>
              </Pressable>
            );
          })}
      </View>
    </View>
  );
}

export default HomeRecentMaterials;
