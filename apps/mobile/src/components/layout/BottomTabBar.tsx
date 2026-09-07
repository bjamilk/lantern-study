import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '../ui';
import { useTheme } from '../../theme';
import { TAB_BAR_CONTENT_HEIGHT, tabBarClearance } from './screenInsets';
import { useChrome } from './ChromeContext';
import { CONTEXTUAL_BAR_CONTENT_HEIGHT, contextualBarClearance } from './contextualBarLayout';
import { BOTTOM_TABS, TAB_LABELS, type BottomTabKey, type TabKey } from './tabRouting';
// Which glyph each destination draws, and why the current one is FILLED
// rather than merely tinted: see tabIcons.ts, which is pure and unit-tested.
import { TAB_ICONS } from './tabIcons';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

export type { TabKey, BottomTabKey };

interface TabDef {
  key: BottomTabKey;
  label: string;
  icon: AppIconName;
  badge?: number;
}

interface Props {
  activeTab: TabKey;
  onTabPress: (tab: BottomTabKey) => void;
  dueCardsCount?: number;
  unreadChatCount?: number;
  /**
   * The contextual row (spec v3 §7.2), drawn directly above the five tabs and
   * INSIDE this bar's own absolutely-positioned container.
   *
   * A slot rather than an import so the composition stays with the one caller
   * that mounts the bar (RootNavigator's CustomTabBar, which also owns the
   * navigation the row needs), and so this component keeps knowing nothing
   * about the registry. One container, not two, because two would need their
   * heights added up by hand in three places and would drift the first time
   * one of them changed.
   */
  above?: React.ReactNode;
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
        {/* No strokeWidth: appIconStroke.ts owns the ramp.

            The current tab is DUOTONE — an indigo stroke over an indigo tint
            fill — rather than the solid it used to be. Solid worked as a shape
            change but it also erased the glyph's interior, so House and
            MessagesSquare both read as a blob at 24px. The tone rule keeps the
            shape change (empty outline vs filled) AND the drawing.

            One hue for all five, and it is the `ai` pair because that pair IS
            `tabBarActive` in both themes (#4f46e5 / #818cf8): the bar is
            chrome, not a feature surface, so it must not repaint itself five
            different colours as you move around. */}
        <AppIcon
          name={tab.icon}
          size={24}
          tone={active ? 'active' : 'neutral'}
          feature="ai"
          color={active ? activeColor : inactiveColor}
        />
        {tab.badge ? <Badge count={tab.badge} /> : null}
      </View>
      {/* The label is not decoration: it is the second, non-colour signal for
          which destination is current, alongside the filled icon — bold when
          current, medium when not. */}
      <Text
        numberOfLines={1}
        // `label` step: 11/16/+0.04em/600 — 11 sp is Material's floor and
        // these labels sat under it at 10. Weight still carries "current".
        className={`text-label mt-0.5 text-center ${active ? 'font-bold text-lantern-primary-text' : 'font-medium text-lantern-text-tertiary'}`}
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
  const { contextual } = useChrome();
  // The contextual row is 44 dp of chrome that did not exist when this hook
  // was written, and a list that clears only the tab bar hides its last row
  // behind it. Additive and unconditional: 0 when the focused route has no
  // row, which is every route outside the registry. (The offline-box saga is
  // the standing reminder that a clipped last row is a row the student cannot
  // reach — and that `overflow-hidden` on a flex column zeroes min-height, so
  // the fix is padding here plus `shrink-0` there, never a fixed height.)
  return contextualBarClearance({
    base: tabBarClearance(insets.bottom, extra),
    contentHeight: CONTEXTUAL_BAR_CONTENT_HEIGHT,
    present: contextual !== null,
  });
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
  above,
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
      className="absolute bottom-0 left-0 right-0 bg-lantern-surface border-t border-lantern-border"
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
      {/* Above the five, inside the same container: the row grows this bar
          rather than floating over the screen, so there is one height to
          clear and the five destinations never move. */}
      {above}
      <View className="flex-row pt-2">
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
    </View>
  );
}
