import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '../ui';
import { useTheme } from '../../theme';
import { TAB_BAR_CONTENT_HEIGHT, tabBarClearance } from './screenInsets';
import { BOTTOM_TABS, TAB_LABELS, type BottomTabKey, type TabKey } from './tabRouting';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

export type { TabKey, BottomTabKey };

interface TabDef {
  key: BottomTabKey;
  label: string;
  icon: AppIconName;
  badge?: number;
}

/**
 * One icon per destination. There is no `activeIcon` any more: the active tab
 * is the SAME glyph drawn heavier.
 *
 * Filling was the obvious move and it is wrong here — several of these are
 * composite glyphs (Building2's windows, CircleUser's face) that a solid fill
 * erases into a blob. Stroke weight reads on all five, and it is the
 * non-colour signal the bar needs alongside the label.
 */
const TAB_ICONS: Record<BottomTabKey, AppIconName> = {
  Home: 'home',
  Study: 'school',
  Chat: 'chatbubbles',
  Campus: 'business',
  Me: 'person-circle',
};

/** The active tab's icon is drawn heavier — the non-colour half of the signal. */
const TAB_ICON_STROKE_ACTIVE = 2.7;
const TAB_ICON_STROKE_IDLE = 2;

interface Props {
  activeTab: TabKey;
  onTabPress: (tab: BottomTabKey) => void;
  dueCardsCount?: number;
  unreadChatCount?: number;
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
      // 48px is Material's minimum touch target. NativeWind inlines rem at 14
      // here, so a Tailwind height class would not reach it — px literal.
      style={{ flex: 1, minHeight: 48 }}
      className="items-center justify-center py-1"
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={tab.label}
    >
      <View className="relative">
        <AppIcon
          name={tab.icon}
          size={24}
          strokeWidth={active ? TAB_ICON_STROKE_ACTIVE : TAB_ICON_STROKE_IDLE}
          color={active ? activeColor : inactiveColor}
        />
        {tab.badge ? <Badge count={tab.badge} /> : null}
      </View>
      {/* The label is not decoration: it is the second, non-colour signal for
          which destination is current, alongside the filled icon. */}
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
export const BOTTOM_TAB_BAR_CONTENT_HEIGHT = TAB_BAR_CONTENT_HEIGHT;

/**
 * Bottom padding so scroll content clears the absolute tab bar + system nav.
 *
 * The arithmetic lives in screenInsets.ts (pure, unit-tested) so the bar, this
 * hook and the layout primitives cannot drift apart: 56 + max(inset, 20) + 10
 * + extra. Prefer `useScreenBottomPadding` on new code — it also knows when
 * the bar is NOT over the route.
 */
export function useTabBarClearance(extra = 16): number {
  const insets = useSafeAreaInsets();
  return tabBarClearance(insets.bottom, extra);
}

/**
 * The bottom bar: Home · Study · Chat · Campus · Me.
 *
 * These five are the whole product's map. A bottom tab is a PLACE a student
 * goes on purpose several times a week — which is why Lantern AI and
 * Notifications are not here (they follow you, from the top bar), why Budget
 * and Downloads are not here (they are mine, so they are rows inside Me), and
 * why Shop and Jobs are not here (they are segments of Campus).
 *
 * The bar does not move. It has no `hideProgress` any more: scrolling,
 * focusing a search box and opening the keyboard all leave it exactly where it
 * is. Only an immersive ROUTE (a study session, a chat) unmounts it, and that
 * screen draws its own header in its place.
 */
export function BottomTabBar({
  activeTab,
  onTabPress,
  dueCardsCount = 0,
  unreadChatCount = 0,
}: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 20) + 10;

  const badges: Partial<Record<BottomTabKey, number>> = {
    Study: dueCardsCount,
    Chat: unreadChatCount,
  };

  const tabs: TabDef[] = BOTTOM_TABS.map((key) => ({
    key,
    label: TAB_LABELS[key],
    icon: TAB_ICONS[key],
    badge: badges[key],
  }));

  return (
    <View
      className="absolute bottom-0 left-0 right-0 bg-lantern-surface border-t border-lantern-border pt-2 flex-row"
      style={{
        paddingBottom: bottomPad,
        paddingHorizontal: 0,
        backgroundColor: colors.tabBar,
        borderTopColor: colors.tabBarBorder,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: isDark ? 0.35 : 0.08,
        shadowRadius: 12,
        elevation: 12,
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
    </View>
  );
}
