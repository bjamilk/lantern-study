import React from 'react';
import { Animated, View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '../ui';
import { useTheme } from '../../theme';

export type TabKey =
  | 'Home'
  | 'Library'
  | 'Study'
  | 'Chat'
  | 'AI'
  | 'Marketplace'
  | 'Jobs'
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
  /** Chrome visibility (1 = shown, 0 = hidden); slides the bar off-screen. */
  hideProgress?: Animated.Value;
}

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
      // 48dp is Material's minimum touch target; the old py-1 left it at ~46.
      style={{ flex: 1, minHeight: 48 }}
      className="items-center justify-center py-1"
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={tab.label}
    >
      <View className="relative">
        <Ionicons
          name={active ? tab.activeIcon : tab.icon}
          size={24}
          color={active ? activeColor : inactiveColor}
        />
        {tab.badge ? <Badge count={tab.badge} /> : null}
      </View>
      <Text
        numberOfLines={1}
        className={`text-[10px] mt-0.5 font-medium text-center ${active ? 'text-lantern-primary' : 'text-lantern-text-tertiary'}`}
      >
        {tab.label}
      </Text>
    </Pressable>
  );
}

/** Approximate content height above the home indicator; used by screens for bottom padding. */
export const BOTTOM_TAB_BAR_CONTENT_HEIGHT = 56;

/** Bottom padding so scroll content clears the absolute tab bar + system nav. */
export function useTabBarClearance(extra = 16): number {
  const insets = useSafeAreaInsets();
  // Android 3-button / gesture nav often reports a small inset; keep a firm minimum.
  return BOTTOM_TAB_BAR_CONTENT_HEIGHT + Math.max(insets.bottom, 20) + 10 + extra;
}

/**
 * The base bar: Chat, Library, Shop, Jobs, Home, Offline.
 *
 * Six destinations is deliberate (founder decision 2026-08-30): Shop and Jobs
 * were previously unreachable except through an unlabelled overflow sheet.
 * Android's 5-item BottomNavigationView cap does not apply — this bar is a
 * plain custom View — but the 60dp-per-column budget is real, which is why
 * every label here is short, the icon is Material's 24dp default, and the
 * stock 56dp active indicator is omitted. Labels stay visible on all six
 * (Material's LABELED behaviour): auto-hiding inactive labels would bury the
 * two destinations this change exists to surface.
 *
 * `hideProgress` slides it below the screen while reading.
 */
export function BottomTabBar({
  activeTab,
  onTabPress,
  dueCardsCount = 0,
  unreadChatCount = 0,
  hideProgress,
}: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 20) + 10;

  const tabs: TabDef[] = [
    {
      key: 'Chat',
      label: 'Chat',
      icon: 'chatbubbles-outline',
      activeIcon: 'chatbubbles',
      badge: unreadChatCount,
    },
    {
      key: 'Library',
      label: 'Library',
      icon: 'library-outline',
      activeIcon: 'library',
      badge: dueCardsCount,
    },
    {
      key: 'Marketplace',
      label: 'Shop',
      icon: 'storefront-outline',
      activeIcon: 'storefront',
    },
    { key: 'Jobs', label: 'Jobs', icon: 'briefcase-outline', activeIcon: 'briefcase' },
    // "Dashboard" overflows a 60dp column at 12sp and truncates under font
    // scaling; "Home" is the same destination and fits.
    { key: 'Home', label: 'Home', icon: 'home-outline', activeIcon: 'home' },
    { key: 'Offline', label: 'Offline', icon: 'cloud-offline-outline', activeIcon: 'cloud-offline' },
  ];

  const hiddenOffset = BOTTOM_TAB_BAR_CONTENT_HEIGHT + bottomPad + 24;
  const translateY = hideProgress
    ? hideProgress.interpolate({ inputRange: [0, 1], outputRange: [hiddenOffset, 0] })
    : 0;

  return (
    <Animated.View
      className="absolute bottom-0 left-0 right-0 bg-lantern-surface border-t border-lantern-border pt-2 flex-row"
      style={{
        paddingBottom: bottomPad,
        paddingHorizontal: 0,
        backgroundColor: colors.tabBar,
        borderTopColor: colors.tabBarBorder,
        shadowColor: isDark ? '#000000' : '#0f172a',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: isDark ? 0.35 : 0.08,
        shadowRadius: 12,
        elevation: 12,
        transform: [{ translateY }],
      }}
    >
      {tabs.map(tab => (
        <TabButton
          key={tab.key}
          tab={tab}
          active={activeTab === tab.key}
          onPress={() => onTabPress(tab.key)}
          activeColor={colors.tabBarActive}
          inactiveColor={colors.tabBarInactive}
        />
      ))}
    </Animated.View>
  );
}
