import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '../ui';
import { useTheme } from '../../theme';
import { ResolvedAvatar } from '../ResolvedAvatar';
import AIUsageBadge, { useAIUsage } from '../AIUsageBadge';
import { useChrome } from './ChromeContext';
import { tabTitle } from './tabRouting';
import { AppIcon } from '../ui/AppIcon';

/**
 * A single row: avatar, title, two icons. 56 is Material's app-bar height and
 * it fits a 44px touch target with room to spare — the old 64 existed only to
 * stack a 10sp label under each of four icons.
 */
export const TOP_BAR_CONTENT_HEIGHT = 56;

/** 44px is the accessible minimum. NativeWind inlines rem at 14 here, so a
    Tailwind size class cannot reach it — these are px literals on purpose. */
const TOUCH = 44;

interface Props {
  /** Opens the Me tab. The avatar is the second door to Me, not to a drawer. */
  onOpenMe: () => void;
  onNotifications: () => void;
  onAI: () => void;
  unreadNotificationCount: number;
}

/**
 * The top chrome row: who I am on the left, where I am in the middle, and on
 * the right the only two surfaces that FOLLOW a student around the app —
 * Lantern AI and Notifications.
 *
 * Budget and Shop used to sit here. They are destinations, not companions:
 * Budget is a row inside Me and Shop is a segment of Campus, each with exactly
 * one door now. The draggable floating AI-credit pill is gone too — the count
 * rides on the sparkle, the way an unread count rides on a bell.
 *
 * Sits IN FLOW above the tab navigator (the LectureRecordingBanner pattern) so
 * screens are pushed down rather than covered, and it does not move: no
 * scroll-away, no suppression. Only an immersive ROUTE — a study session, a
 * chat that draws its own header — renders without it.
 */
export function TopBar({ onOpenMe, onNotifications, onAI, unreadNotificationCount }: Props) {
  const { activeTab, immersive, profileAvatarUri, profileName } = useChrome();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const usage = useAIUsage();

  if (immersive) return null;

  const creditLabel =
    usage.limit > 0
      ? `Lantern AI, ${usage.remaining} of ${usage.limit} AI credits left`
      : 'Lantern AI';

  return (
    <View
      style={{
        height: insets.top + TOP_BAR_CONTENT_HEIGHT,
        paddingTop: insets.top,
        backgroundColor: colors.tabBar,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.tabBarBorder,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: isDark ? 0.3 : 0.06,
        shadowRadius: 8,
        elevation: 4,
        zIndex: 20,
      }}
    >
      <View className="flex-1 flex-row items-center px-2">
        <Pressable
          onPress={onOpenMe}
          accessibilityRole="button"
          accessibilityLabel="Me"
          accessibilityHint="Your profile, Budget, Downloads and settings"
          accessibilityState={{ selected: activeTab === 'Me' }}
          style={{ width: TOUCH, height: TOUCH }}
          className="items-center justify-center"
        >
          <ResolvedAvatar name={profileName} uri={profileAvatarUri} size={30} decorative />
        </Pressable>

        {/* The title says where you are. Non-tab screens draw their own header
            with a back arrow and their real name; this names the section. */}
        <Text
          numberOfLines={1}
          accessibilityRole="header"
          className="flex-1 min-w-0 px-1 text-lg font-bold text-lantern-text"
        >
          {tabTitle(activeTab)}
        </Text>

        <Pressable
          onPress={onAI}
          accessibilityRole="button"
          accessibilityLabel={creditLabel}
          accessibilityState={{ selected: activeTab === 'AI' }}
          style={{ width: TOUCH, height: TOUCH }}
          className="items-center justify-center"
        >
          <View className="relative">
            {/* `sparkle`, not `sparkles`: at this size the three-mark glyph
                read as a scribble. One star, filled when Lantern AI is open. */}
            <AppIcon
              name="sparkle"
              filled={activeTab === 'AI'}
              size={24}
              color={activeTab === 'AI' ? colors.tabBarActive : colors.tabBarInactive}
            />
            {/* The AI-credit count, docked on the sparkle it belongs to. */}
            <AIUsageBadge variant="docked" />
          </View>
        </Pressable>

        <Pressable
          onPress={onNotifications}
          accessibilityRole="button"
          accessibilityLabel={
            unreadNotificationCount > 0
              ? `Notifications, ${unreadNotificationCount} unread`
              : 'Notifications'
          }
          accessibilityState={{ selected: activeTab === 'Notifications' }}
          style={{ width: TOUCH, height: TOUCH }}
          className="items-center justify-center"
        >
          <View className="relative">
            <AppIcon
              name="notifications"
              filled={activeTab === 'Notifications'}
              size={24}
              color={
                activeTab === 'Notifications' ? colors.tabBarActive : colors.tabBarInactive
              }
            />
            {/* No badge at all when there is nothing unread — never a zero. */}
            <Badge count={unreadNotificationCount} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

export default TopBar;
