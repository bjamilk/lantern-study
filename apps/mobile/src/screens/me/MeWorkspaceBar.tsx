import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { ME_AREA_SECTIONS, type MeAreaSection } from '@lantern/shared/learning';

export type { MeAreaSection };

export interface MeWorkspaceBarProps {
  active: MeAreaSection;
  onSelect: (section: MeAreaSection) => void;
}

/**
 * Profile's two peer sections, as underline tabs — the same compact row Study
 * uses for Study | Library.
 */
export function MeWorkspaceBar({ active, onSelect }: MeWorkspaceBarProps) {
  return (
    <View
      accessibilityLabel="Profile sections"
      className="flex-row border-b border-lantern-border"
    >
      {ME_AREA_SECTIONS.map((tab) => {
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

export default MeWorkspaceBar;
