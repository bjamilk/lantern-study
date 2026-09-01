import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '../ui';
import { useTheme } from '../../theme';
import { ResolvedAvatar } from '../ResolvedAvatar';
import { useChrome } from './ChromeContext';
import type { TabKey } from './BottomTabBar';

// Icon + label, matching the bottom bar's stacked layout. 52 fitted an icon
// alone; the label needs the extra 12.
export const TOP_BAR_CONTENT_HEIGHT = 64;

interface TopIconDef {
  key: string;
  /** Spoken name — the full one, for screen readers. */
  label: string;
  /**
   * Printed name, or omitted to leave the icon to speak for itself — the bell
   * is unambiguous and carries the unread badge, and "Notifications" does not
   * fit a ~72dp column at 10sp anyway.
   */
  shortLabel?: string;
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
  onShop: () => void;
  /** False hides the Shop icon for accounts outside the private pilot. */
  showShop: boolean;
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
  onShop,
  showShop,
}: Props) {
  const { chromeProgress, activeTab, immersive, topBarSuppressed } = useChrome();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  if (immersive || topBarSuppressed) return null;

  const icons: TopIconDef[] = [
    {
      key: 'budget',
      shortLabel: 'Budget',
      label: 'Budget',
      icon: 'wallet-outline',
      activeIcon: 'wallet',
      activeWhen: 'Budget',
      onPress: onBudget,
    },
    {
      key: 'shop',
      shortLabel: 'Shop',
      label: 'Shop',
      icon: 'storefront-outline',
      activeIcon: 'storefront',
      activeWhen: 'Marketplace',
      onPress: onShop,
    },
    {
      key: 'ai',
      shortLabel: 'Lantern AI',
      label: 'Lantern AI',
      icon: 'sparkles-outline',
      activeIcon: 'sparkles',
      activeWhen: 'AI',
      onPress: onAI,
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
  ];

  // The Shop is a private-pilot surface. Accounts outside the pilot do not get
  // a button that only leads to a wall — but an unknown answer still shows it,
  // because a failed probe must not silently remove navigation.
  const visibleIcons = showShop ? icons : icons.filter((item) => item.key !== 'shop');

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
        {visibleIcons.map(item => {
          const active = item.activeWhen != null && activeTab === item.activeWhen;
          return (
            <Pressable
              key={item.key}
              onPress={item.onPress}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: active }}
              // Top-aligned, not centred: the unlabelled bell would otherwise
              // sit lower than its labelled neighbours.
              className="h-14 w-16 items-center justify-start pt-1.5"
            >
              <View className="relative">
                <Ionicons
                  name={active ? item.activeIcon : item.icon}
                  size={22}
                  color={active ? colors.tabBarActive : colors.tabBarInactive}
                />
                {item.badge ? <Badge count={item.badge} /> : null}
              </View>
              {item.shortLabel ? (
                <Text
                  numberOfLines={1}
                  className={`text-[10px] mt-0.5 font-medium text-center ${
                    active ? 'text-lantern-primary' : 'text-lantern-text-tertiary'
                  }`}
                >
                  {item.shortLabel}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

export default TopBar;
