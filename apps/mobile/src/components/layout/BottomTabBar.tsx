import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Badge } from '../ui';
import { useTheme } from '../../theme';

export type TabKey =
  | 'Home'
  | 'Library'
  | 'Study'
  | 'Chat'
  | 'AI'
  | 'Marketplace'
  | 'Notes'
  | 'Offline'
  | 'Notifications'
  | 'Budget'
  | 'More';

interface TabDef {
  key: TabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  badge?: number;
}

interface Props {
  activeTab: TabKey;
  onTabPress: (tab: TabKey) => void;
  dueCardsCount?: number;
  unreadChatCount?: number;
  unreadNotificationCount?: number;
  isMoreActive?: boolean;
}

const TAB_WIDTH = 68;

function TabButton({
  tab,
  active,
  onPress,
  activeColor,
  inactiveColor,
}: {
  tab: TabDef;
  active: boolean;
  onPress: () => void;
  activeColor: string;
  inactiveColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{ width: TAB_WIDTH }}
      className="items-center py-1"
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={tab.label}
    >
      <View className="relative">
        <Ionicons
          name={active ? tab.activeIcon : tab.icon}
          size={22}
          color={active ? activeColor : inactiveColor}
        />
        {tab.badge ? <Badge count={tab.badge} /> : null}
      </View>
      <Text
        numberOfLines={1}
        className={`text-[10px] mt-1 font-medium text-center ${active ? 'text-lantern-primary' : 'text-lantern-text-tertiary'}`}
      >
        {tab.label}
      </Text>
    </Pressable>
  );
}

export function BottomTabBar({
  activeTab,
  onTabPress,
  dueCardsCount = 0,
  unreadChatCount = 0,
  unreadNotificationCount = 0,
  isMoreActive,
}: Props) {
  const { colors, isDark } = useTheme();

  const scrollTabs: TabDef[] = [
    { key: 'Home', label: 'Home', icon: 'home-outline', activeIcon: 'home' },
    {
      key: 'Library',
      label: 'Library',
      icon: 'library-outline',
      activeIcon: 'library',
      badge: dueCardsCount,
    },
    {
      key: 'Chat',
      label: 'Chat',
      icon: 'chatbubbles-outline',
      activeIcon: 'chatbubbles',
      badge: unreadChatCount,
    },
    { key: 'Marketplace', label: 'Explore', icon: 'bag-outline', activeIcon: 'bag' },
  ];

  const moreTab: TabDef = {
    key: 'More',
    label: 'More',
    icon: 'ellipsis-horizontal-outline',
    activeIcon: 'ellipsis-horizontal',
    badge: unreadNotificationCount,
  };

  return (
    <View
      className="absolute bottom-0 left-0 right-0 bg-lantern-surface border-t border-lantern-border pb-6 pt-2 flex-row"
      style={{
        backgroundColor: colors.tabBar,
        borderTopColor: colors.tabBarBorder,
        shadowColor: isDark ? '#000000' : '#0f172a',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: isDark ? 0.35 : 0.08,
        shadowRadius: 12,
        elevation: 12,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 4 }}
        className="flex-1"
        keyboardShouldPersistTaps="handled"
      >
        {scrollTabs.map(tab => (
          <TabButton
            key={tab.key}
            tab={tab}
            active={activeTab === tab.key && !isMoreActive}
            onPress={() => onTabPress(tab.key)}
            activeColor={colors.tabBarActive}
            inactiveColor={colors.tabBarInactive}
          />
        ))}
      </ScrollView>
      <TabButton
        tab={moreTab}
        active={!!isMoreActive}
        onPress={() => onTabPress('More')}
        activeColor={colors.tabBarActive}
        inactiveColor={colors.tabBarInactive}
      />
    </View>
  );
}
