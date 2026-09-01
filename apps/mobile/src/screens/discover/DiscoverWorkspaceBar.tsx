import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { isDiscoverSectionEnabled } from '@lantern/shared/marketplace';

export type DiscoverSection = 'communities' | 'groups' | 'people' | 'marketplace';

export interface DiscoverWorkspaceBarProps {
  active: DiscoverSection;
  onSelect: (section: DiscoverSection) => void;
}

const TABS: Array<{ id: DiscoverSection; label: string; shortLabel: string }> = [
  { id: 'communities', label: 'Communities', shortLabel: 'Community' },
  { id: 'groups', label: 'Groups', shortLabel: 'Groups' },
  { id: 'people', label: 'People', shortLabel: 'People' },
  { id: 'marketplace', label: 'Marketplace', shortLabel: 'Market' },
];

/**
 * Compact underline tabs shared by Discover and Marketplace.
 *
 * Sections are filtered by DISCOVER_SECTION_ENABLED, so hiding Community /
 * Groups / People is a flag flip rather than a code deletion. When only one
 * section survives the bar renders nothing at all — a single tab is not a
 * choice, it is decoration.
 */
export function DiscoverWorkspaceBar({ active, onSelect }: DiscoverWorkspaceBarProps) {
  const visible = TABS.filter((tab) => isDiscoverSectionEnabled(tab.id));
  if (visible.length < 2) return null;

  return (
    <View
      accessibilityLabel="Discover sections"
      className="flex-row border-b border-lantern-border"
    >
      {visible.map((tab) => {
        const selected = active === tab.id;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onSelect(tab.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            className="flex-1 items-center py-2.5"
          >
            <Text
              numberOfLines={1}
              className={`text-[12px] font-medium ${
                selected ? 'text-lantern-primary' : 'text-lantern-text-secondary'
              }`}
            >
              {tab.shortLabel}
            </Text>
            <View
              className={`mt-1 h-0.5 w-8 rounded-full ${
                selected ? 'bg-lantern-primary' : 'bg-transparent'
              }`}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

export default DiscoverWorkspaceBar;
