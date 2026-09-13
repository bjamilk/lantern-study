import React from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '../ui';
import { useTheme } from '../../theme';
import { TAB_BAR_CONTENT_HEIGHT, tabBarClearance } from './screenInsets';
import { useChrome } from './ChromeContext';
import { CONTEXTUAL_BAR_CONTENT_HEIGHT, contextualBarClearance } from './contextualBarLayout';
import { planTabPresentation } from './bottomBarComposition';
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
   * absolutely-positioned container, directly ABOVE the five tabs.
   *
   * Above them on every row but one. The exception is the SET row, which stands
   * in their place (`hideTabs` below) and carries its own `Home` door back out —
   * one bar at a time, StudyFetch's model. That is not the sectionwide `replace`
   * mode build 185 reverted: this one is scoped to the routes INSIDE one set,
   * and everywhere else in Study the five labelled tabs are on screen, alone.
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
   * Stand the five tabs down: the contextual row in `above` is standing in
   * their place (a `replace` row — today only the set row).
   *
   * The caller decides, and it must be the caller: whether the row is REALLY on
   * screen depends on the soft keyboard, which the row itself tracks and reports
   * back (ContextualBar's `onPresence`). If this were derived from the registry
   * here, a student typing inside a set would get neither bar — the row hides
   * under the IME and the tabs would already be gone.
   *
   * One bar at a time, never zero: the row is the only thing that may hide the
   * tabs, and only while it is drawn.
   */
  hideTabs?: boolean;
}

/**
 * One destination on the bar.
 *
 * The lit tab is a BLACK PILL with a white glyph and a white label inside it;
 * an idle tab is a grey outline glyph with its label underneath, directly on
 * the page ground (founder direction 2026-09-11). The shape and the ground
 * change together, so where-you-are never rests on hue alone — which is what
 * the old indigo-tint-on-indigo-outline treatment did.
 *
 * The pill is LAID OUT VERTICALLY where StudyFetch's is horizontal, and that
 * is deliberate: the measured 117x44 pill comes off a bar with fewer
 * destinations, and Lantern keeps a label on all five, which on a 360 dp phone
 * is 72 dp a segment. An icon beside a word does not fit in 72; an icon above
 * one does, inside exactly the measured 44 dp height. The width still clamps
 * to the segment — `planTabPresentation` does that arithmetic and is tested.
 *
 * Colours are the theme's ink and ground rather than named tokens, because
 * "black pill, white label" inverts in dark mode and there is no token for
 * "the opposite of the text colour".
 */
function TabButton({
  tab,
  active,
  onPress,
  pillColor,
  onPillColor,
  inactiveColor,
}: {
  tab: TabDef;
  active: boolean;
  onPress: () => void;
  /** The pill's fill: the page's ink. Black in light, white in dark. */
  pillColor: string;
  /** What rides ON the pill: the page's ground. */
  onPillColor: string;
  inactiveColor: string;
}) {
  const [segmentWidth, setSegmentWidth] = React.useState<number | null>(null);
  const plan = planTabPresentation({ active, segmentWidth });
  return (
    <Pressable
      onPress={onPress}
      // 48px is Material's minimum touch target. NativeWind inlines rem at 14
      // here, so a Tailwind height class would not reach it — px literal.
      style={{ flex: 1, minHeight: 48 }}
      onLayout={(event) => setSegmentWidth(event.nativeEvent.layout.width)}
      className="items-center justify-center"
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={tab.label}
    >
      <View
        style={{
          // A definite height in both states, so the glyph does not jump up
          // and down by a pixel as the pill appears and disappears under it.
          height: plan.pillHeight,
          ...(plan.pillWidth !== null
            ? {
                width: plan.pillWidth,
                borderRadius: plan.pillRadius,
                backgroundColor: pillColor,
              }
            : null),
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 6,
        }}
      >
        <View className="relative">
          {/* No strokeWidth: appIconStroke.ts owns the ramp.
              BOTH states are drawn `neutral`, which is the ONE tone that
              honours the caller's `color` (appIconTone.resolveIconTone returns
              the caller's colour for `neutral` and the FEATURE's ink/tint for
              anything else). The lit glyph was `tone="active" feature="ai"`,
              so it came out of the AI feature's duotone pair — lavender ink on
              a lavender tint — and the `color` beside it was silently dropped:
              on device that is a lavender glyph sitting on the black pill, and
              a purple one in dark mode. The glyph must be the PILL'S
              FOREGROUND: `onPillColor` (white on black in light, black on
              white in dark), which only `neutral` will paint. */}
          <AppIcon
            name={tab.icon}
            size={plan.glyphSize}
            tone="neutral"
            color={active ? onPillColor : inactiveColor}
          />
          {tab.badge ? <Badge count={tab.badge} /> : null}
        </View>
        {/* The label is not decoration and it is never dropped: it is the
            second, non-colour signal for which destination is current. All
            five carry one, lit or not — `plan.showLabel` is where that rule
            lives, and it is asserted in bottomBarComposition.test.ts. */}
        {plan.showLabel ? (
          <Text
            numberOfLines={1}
            // `label` step: 11/16/+0.04em/600 — 11 sp is Material's floor.
            style={{ color: active ? onPillColor : inactiveColor }}
            className={`text-label text-center ${active ? 'font-bold' : 'font-medium'}`}
          >
            {tab.label}
          </Text>
        ) : null}
      </View>
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
  // ADDITIVE, always: the row sits ABOVE a global bar that is still drawn, so a
  // screen clears BOTH strips. The old `replaceMode` subtraction (which took the
  // bar's 56 dp back out under Study and Shop) went with the replace mode
  // itself; leaving it would hide the last row of every Study and Shop list
  // behind the bar that is now back on screen.
  return contextualBarClearance({
    base: tabBarClearance(insets.bottom, extra),
    contentHeight: CONTEXTUAL_BAR_CONTENT_HEIGHT,
    present: contextual !== null,
    // …with ONE exception, and it is the reverse of the old bug: the set row
    // stands IN the bar's slot, so the bar's 56 dp is not on screen and a
    // screen that padded for both would leave a dead band above the row.
    replace: contextual?.mode === 'replace',
    tabBarContentHeight: TAB_BAR_CONTENT_HEIGHT,
  });
}

/**
 * The bottom bar: Home · Study · Chat · Campus · Profile.
 *
 * These five are the whole product's map. A bottom tab is a PLACE a student
 * goes on purpose several times a week — which is why Lantern AI and
 * Notifications are not here (they follow you, from the top bar), why Budget
 * and Downloads are not here (they are mine, so they are rows inside Profile), and
 * why Shop and Jobs are not here (they are segments of Campus).
 *
 * The bar does not move, and the five are never traded away. Scrolling,
 * focusing a search box and opening the keyboard all leave it exactly where it
 * is; a section's own contextual row STACKS on top of it rather than standing
 * in its place (that `replace` mode shipped in build 185 and the device pass
 * rejected it — inside Study and Shop the map was gone). The only thing that
 * takes the five off screen is an immersive ROUTE (a study session, a chat),
 * which unmounts the whole bar and draws its own header in its place.
 */
export function BottomTabBar({
  activeTab,
  onTabPress,
  dueCardsCount = 0,
  unreadChatCount = 0,
  above,
  hideTabs = false,
}: Props) {
  const { colors } = useTheme();
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
      className="absolute bottom-0 left-0 right-0"
      style={{
        paddingBottom: bottomPad,
        paddingHorizontal: 0,
        // NO separate bar surface: the strip is the PAGE GROUND with a
        // hairline rule across its top (founder direction 2026-09-11). A white
        // bar over a cream page was a second plane the pill then had to fight;
        // on the ground, the black pill is the only object down here.
        //
        // The shadow and the elevation are gone with it. `elevation: 12` was
        // what made the bar a raised slab on Android, and it is also what beat
        // sibling order for anything drawn near it (the toast had to
        // out-elevate it to be visible at all). A hairline needs neither.
        backgroundColor: colors.background,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
      }}
    >
      {/* The contextual row, ALWAYS above the five and never instead of them.
          It grows this bar upward rather than floating over the screen, so
          there is one height to clear and the five destinations never move. */}
      {above}
      {/* Hidden only while a `replace` row is drawn in their place, so there is
          always exactly one row of doors down here — never none. */}
      {hideTabs ? null : (
      <View className="flex-row pt-2">
        {tabs.map(tab => (
          <TabButton
            key={tab.key}
            tab={tab}
            active={activeTab === tab.key}
            onPress={() => onTabPress(tab.key)}
            // Ink and ground, not the indigo accent: the lit tab is a
            // BLACK pill with a white glyph, and in dark mode that same
            // relationship is a white pill with a black one.
            // `primaryFill` / `textInverse`, not `text` / `background`: light
            // `text` is the navy-tinted slate-900, and the lit pill drawn
            // in it did not match the #191919 of every primary BUTTON beside
            // it (build 198's device pass). One ink token for every filled
            // control.
            pillColor={colors.primaryFill}
            onPillColor={colors.textInverse}
            inactiveColor={colors.tabBarInactive}
          />
        ))}
      </View>
      )}
    </View>
  );
}
