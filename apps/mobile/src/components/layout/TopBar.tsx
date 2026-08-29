import React from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '../ui';
import { useTheme } from '../../theme';
import { ResolvedAvatar } from '../ResolvedAvatar';
import { useChrome } from './ChromeContext';
import type { TabKey } from './BottomTabBar';

export const TOP_BAR_CONTENT_HEIGHT = 52;

interface TopIconDef {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  activeWhen: TabKey | null;
  badge?: number;
  onPress: () => void;
}

interface Props {
  avatarUri: string | null;
  avatarName: string | null;
  unreadNotificationCount: number;
  onOpenDrawer: () => void;
  onBudget: () => void;
  onNotifications: () => void;
  onAI: () => void;
  onDiscover: () => void;
}

/**
 * The top chrome row: profile avatar on the left (opens the drawer), then
 * Budget, Notifications, Lantern AI and Discover on the right. Sits IN FLOW
 * above the tab navigator (the LectureRecordingBanner pattern) so screens are
 * pushed down rather than covered — no per-screen top clearance needed.
 *
 * On scroll-hide it collapses to a status-bar-high strip instead of height 0:
 * screens keep not touching the top edge, so their SafeAreaView top padding
 * never snaps back mid-animation.
 */
export function TopBar({
  avatarUri,
  avatarName,
  unreadNotificationCount,
  onOpenDrawer,
  onBudget,
  onNotifications,
  onAI,
  onDiscover,
}: Props) {
  const { chromeProgress, activeTab, immersive, topBarSuppressed } = useChrome();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  if (immersive || topBarSuppressed) return null;

  const icons: TopIconDef[] = [
    {
      key: 'budget',
      label: 'Budget',
      icon: 'wallet-outline',
      activeIcon: 'wallet',
      activeWhen: 'Budget',
      onPress: onBudget,
    },
    {
      key: 'notifications',
      label: 'Notifications',
      icon: 'notifications-outline',
      activeIcon: 'notifications',
      activeWhen: 'Notifications',
      badge: unreadNotificationCount,
      onPress: onNotifications,
    },
    {
      key: 'ai',
      label: 'Lantern AI',
      icon: 'sparkles-outline',
      activeIcon: 'sparkles',
      activeWhen: 'AI',
      onPress: onAI,
    },
    {
      key: 'discover',
      label: 'Discover',
      icon: 'compass-outline',
      activeIcon: 'compass',
      activeWhen: 'Marketplace',
      onPress: onDiscover,
    },
  ];

  const height = chromeProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [insets.top, insets.top + TOP_BAR_CONTENT_HEIGHT],
  });

  return (
    <Animated.View
      style={{
        height,
        overflow: 'hidden',
        backgroundColor: colors.tabBar,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.tabBarBorder,
        shadowColor: isDark ? '#000000' : '#0f172a',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: isDark ? 0.3 : 0.06,
        shadowRadius: 8,
        elevation: 4,
        zIndex: 20,
      }}
    >
      {/* Bottom-anchored so collapsing clips the row upward under the status bar. */}
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: TOP_BAR_CONTENT_HEIGHT,
          opacity: chromeProgress,
        }}
        className="flex-row items-center px-3"
      >
        <Pressable
          onPress={onOpenDrawer}
          accessibilityRole="button"
          accessibilityLabel="Open profile menu"
          hitSlop={8}
          className="h-10 w-10 items-center justify-center"
        >
          <ResolvedAvatar name={avatarName} uri={avatarUri} size={32} decorative />
        </Pressable>
        {/* Icons spread across the remaining width rather than clustering
            against the right edge. */}
        <View className="flex-1 flex-row items-center justify-evenly pl-2">
        {icons.map(item => {
          const active = item.activeWhen != null && activeTab === item.activeWhen;
          return (
            <Pressable
              key={item.key}
              onPress={item.onPress}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: active }}
              className="h-10 w-11 items-center justify-center"
            >
              <View className="relative">
                <Ionicons
                  name={active ? item.activeIcon : item.icon}
                  size={22}
                  color={active ? colors.tabBarActive : colors.tabBarInactive}
                />
                {item.badge ? <Badge count={item.badge} /> : null}
              </View>
            </Pressable>
          );
        })}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

export default TopBar;
