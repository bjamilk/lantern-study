/**
 * The Study/Library section switcher — a two-tab underline row shown at the
 * top of the Study area screens.
 *
 * Main exports: `StudyWorkspaceBar` (also the default), `StudyWorkspaceBarProps`,
 * and a re-export of the `StudyAreaSection` type.
 * Touches: no stores, no services, no native modules. Tab ids and labels come
 * from `STUDY_AREA_SECTIONS` in @lantern/shared, so web and mobile name the
 * sections identically. The active section is owned by the parent screen.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { STUDY_AREA_SECTIONS, type StudyAreaSection } from '@lantern/shared';

export type { StudyAreaSection };

export interface StudyWorkspaceBarProps {
  active: StudyAreaSection;
  onSelect: (section: StudyAreaSection) => void;
}

/**
 * Study's two peer sections, as underline tabs — the same compact row Campus
 * uses for Discover. Study is the set picker; Library is the archive.
 */
export function StudyWorkspaceBar({ active, onSelect }: StudyWorkspaceBarProps) {
  return (
    <View
      accessibilityLabel="Study sections"
      className="flex-row border-b border-lantern-border"
    >
      {STUDY_AREA_SECTIONS.map((tab) => {
        const selected = active === tab.id;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onSelect(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            className="flex-1 items-center py-2.5 min-h-[44px] justify-center"
          >
            <Text
              numberOfLines={1}
              className={`text-caption font-medium ${
                selected ? 'text-lantern-primary-text' : 'text-lantern-text-secondary'
              }`}
            >
              {tab.shortLabel}
            </Text>
            <View
              className={`mt-1 h-0.5 w-8 rounded-full ${
                selected ? 'bg-lantern-primary-fill' : 'bg-transparent'
              }`}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

export default StudyWorkspaceBar;
