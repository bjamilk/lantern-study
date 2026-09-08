import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '../ui';
import { useTheme } from '../../theme';
import { TAB_BAR_CONTENT_HEIGHT, tabBarClearance } from './screenInsets';
import { useChrome } from './ChromeContext';
import { CONTEXTUAL_BAR_CONTENT_HEIGHT, contextualBarClearance } from './contextualBarLayout';
import { replacesGlobalBar } from '../../navigation/contextualBars';
import { planBottomBarComposition } from './bottomBarComposition';
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
   * The contextual row (spec v3 §7.2), drawn INSIDE this bar's own
   * absolutely-positioned container.
   *
   * Where it sits depends on `replaceGlobalTabs`, which the caller derives from
   * the registry's mode (founder decision 2026-09-08):
   * - `above` mode (default): the row is drawn directly ABOVE the five tabs, and
   *   both are on screen — today's behaviour, unchanged.
   * - `replace` mode: the five tabs are NOT rendered and this row stands in
   *   their place, with `exit` as the single leading way out.
   *
   * A slot rather than an import so the composition stays with the one caller
   * that mounts the bar (RootNavigator's CustomTabBar, which also owns the
   * navigation the row needs), and so this component keeps knowing nothing
   * about the registry. One container, not two, because two would need their
   * heights added up by hand in three places and would drift the first time
   * one of them changed.
   */
  above?: React.ReactNode;
  /**
   * Replace the global five-tab row with the contextual row (Study, Shop).
   *
   * When true the five destinations are not on screen — the section's own row
   * takes the bar's slot — and `exit` is the leading control that gets the
   * student back out. False (the default) is every above-mode and no-row route,
   * where the five tabs render exactly as before. The decision is
   * planBottomBarComposition (bottomBarComposition.ts), where it is tested.
   */
  replaceGlobalTabs?: boolean;
  /**
   * The single leading exit control of a replace-mode row (founder decision 2).
   *
   * `control` is the rules lane's answer — `back` when the focused stack can
   * pop, `home` when it is at the section root — and `onPress` is wired by the
   * caller to the matching navigation (pop the focused stack, or go to the Home
   * tab and restore the global bar). Rendered ONLY when `replaceGlobalTabs` is
   * true; an above-mode row keeps the global bar as its own way out.
   */
  exit?: { control: 'back' | 'home'; onPress: () => void };
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

/**
 * The one leading control of a replace-mode row — the way out that makes
 * taking the global five-tab bar away safe (founder decision 2).
 *
 * It is never absent and never inert: `back` pops the focused stack, `home`
 * leaves the section for the Home tab (which restores the global bar). Both are
 * wired by the caller; this only draws the glyph. Painted in the chrome accent
 * (`tabBarActive`, the same indigo the current tab wears) because it is chrome,
 * not a feature — one hue for the whole bar.
 *
 * ICON-ONLY, with the word carried as its accessible name. Width is the scarce
 * dimension on this row: a visible "Back"/"Home" costs ~30 dp, and on Study's
 * five-item row that is taken straight out of the selected item's promoted
 * label, which then ellipsises to nothing (contextualBarPresentation.ts measures
 * exactly this). A bare arrow / house is the standard affordance, the word is
 * still announced, and the row keeps one visible word — the selected item's,
 * which is what decision 4 asked for.
 */
function ExitControl({
  control,
  onPress,
  color,
}: {
  control: 'back' | 'home';
  onPress: () => void;
  color: string;
}) {
  const label = control === 'back' ? 'Back' : 'Home';
  return (
    <Pressable
      onPress={onPress}
      // A square 44 dp target on the row's own baseline, and a FIXED footprint:
      // the segments flex to fill whatever is left, so the exit can never eat
      // into the label's room as the control swaps Back for Home.
      style={{ width: CONTEXTUAL_BAR_CONTENT_HEIGHT, minHeight: CONTEXTUAL_BAR_CONTENT_HEIGHT }}
      className="items-center justify-center"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <AppIcon
        name={control === 'back' ? 'arrow-back' : 'home'}
        size={22}
        color={color}
        importantForAccessibility="no"
      />
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
    // Study and Shop REPLACE the global bar rather than stack above it (founder
    // decision 2026-09-08): the row stands in the bar's slot, so the bar's own
    // 56 dp content height comes back out and a screen pads for one strip, not
    // two. The arithmetic lives in contextualBarLayout.ts; this only passes the
    // mode the registry declared. `replacesGlobalBar(null)` is false, so every
    // above-mode and no-row route is unchanged.
    replaceMode: replacesGlobalBar(contextual),
    globalBarContentHeight: TAB_BAR_CONTENT_HEIGHT,
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
 * is. Two things take the five off screen. An immersive ROUTE (a study session,
 * a chat) unmounts the whole bar, and that screen draws its own header in its
 * place. And a `replace`-mode section (Study, Shop — founder decision
 * 2026-09-08) swaps the five for that section's own contextual row plus a single
 * leading exit control; leaving the section brings the five straight back.
 */
export function BottomTabBar({
  activeTab,
  onTabPress,
  dueCardsCount = 0,
  unreadChatCount = 0,
  above,
  replaceGlobalTabs = false,
  exit,
}: Props) {
  const { colors, isDark } = useTheme();
  // WHAT the bottom slot contains, from the one tested planner rather than an
  // inline ternary: the five and no exit, or the exit and the section's row.
  // Inverting it here would have passed every test while shipping both bars in
  // Study and none anywhere else, so the decision is not repeated in JSX.
  const composition = planBottomBarComposition({ replace: replaceGlobalTabs });
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
      {composition.showGlobalTabs ? (
        <>
          {/* Above mode: the row grows this bar above the five rather than
              floating over the screen, so there is one height to clear and the
              five destinations never move. */}
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
        </>
      ) : (
        // Replace mode (Study, Shop): the section's row stands in the global
        // bar's slot and the five destinations are not on screen. The single
        // leading exit control is the way out — Back or Home, never inert — so
        // the five can be gone without stranding the student. `items-stretch`
        // holds the exit and the row to one baseline as the row animates in.
        <View className="flex-row items-stretch">
          {composition.showExit && exit ? (
            <ExitControl control={exit.control} onPress={exit.onPress} color={colors.tabBarActive} />
          ) : null}
          <View className="flex-1">{above}</View>
        </View>
      )}
    </View>
  );
}
