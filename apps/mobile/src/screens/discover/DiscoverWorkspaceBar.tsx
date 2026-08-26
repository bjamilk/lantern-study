import React from 'react';
import { Pressable, Text, View } from 'react-native';

export type DiscoverSection = 'communities' | 'groups' | 'people' | 'marketplace';

export interface DiscoverWorkspaceBarProps {
  active: DiscoverSection;
  onSelect: (section: DiscoverSection) => void;
}

const TABS: Array<{ id: DiscoverSection; label: string; shortLabel: string }> = [
  { id: 'communities', label: 'Communities', shortLabel: 'Campus' },
  { id: 'groups', label: 'Groups', shortLabel: 'Groups' },
  { id: 'people', label: 'People', shortLabel: 'People' },
  { id: 'marketplace', label: 'Marketplace', shortLabel: 'Market' },
];

/**
 * Compact underline tabs shared by Discover and Marketplace so the marketplace
 * sits inside Discover (decision D12) without a second chip parade.
 */
export function DiscoverWorkspaceBar({ active, onSelect }: DiscoverWorkspaceBarProps) {
  return (
    <View
      accessibilityLabel="Discover sections"
      className="flex-row border-b border-lantern-border"
    >
      {TABS.map((tab) => {
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
