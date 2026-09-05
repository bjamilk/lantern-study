import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

export interface QuickLinkItem {
  id: string;
  label: string;
  icon: AppIconName;
  iconColor: string;
  onPress: () => void;
  badge?: number;
}

interface DashboardQuickLinksProps {
  links: QuickLinkItem[];
}

/** Matches web dashboard tiles: AI Tools, Notes, Flashcards, Explore/Discover. */
const HIDDEN_DASHBOARD_SHORTCUT_IDS = new Set([
  'ai-tools',
  'aitools',
  'notes',
  'flashcards',
  'marketplace',
  'explore',
  'discover',
]);

export function DashboardQuickLinks({ links }: DashboardQuickLinksProps) {
  const visibleLinks = links.filter(link => !HIDDEN_DASHBOARD_SHORTCUT_IDS.has(link.id));
  if (visibleLinks.length === 0) return null;

  return (
    <View className="flex-row flex-wrap gap-3 mb-4">
      {visibleLinks.map(link => (
        <Pressable
          key={link.id}
          onPress={link.onPress}
          className="w-[47%] flex-col items-center justify-center gap-2 p-4 rounded-lantern-xl border border-lantern-border bg-lantern-surface active:opacity-90"
        >
          <View className="relative">
            <AppIcon name={link.icon} size={24} color={link.iconColor} />
            {link.badge != null && link.badge > 0 ? (
              <View className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-lantern-error items-center justify-center">
                <Text className="text-[10px] font-bold text-white">
                  {link.badge > 99 ? '99+' : link.badge}
                </Text>
              </View>
            ) : null}
          </View>
          <Text className="text-xs font-semibold text-lantern-text">{link.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default DashboardQuickLinks;
