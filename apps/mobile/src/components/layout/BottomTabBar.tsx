import React from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '../ui';
import { useTheme } from '../../theme';
import { TAB_BAR_CONTENT_HEIGHT, bottomTabBarPadding, tabBarClearance } from './screenInsets';
import { useChrome } from './ChromeContext';
import { CONTEXTUAL_BAR_CONTENT_HEIGHT, contextualBarClearance } from './contextualBarLayout';
import {
  TAB_PILL_LABEL_MAX_FONT_SCALE,
  TAB_ROW_EDGE_PADDING,
  planTabPillRow,
  tabBadgeAnchor,
  tabPillActiveIndex,
  tabPillTransitionMs,
  type TabPillItemPlan,
} from './tabPillLayout';
import { TAB_PILL } from '../../theme/surfaceMetrics';
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
 * Turn the NEXT layout commit into a ~180 ms re-flow.
 *
 * `LayoutAnimation`, not Reanimated's `LinearTransition`: Reanimated is a
 * dependency and four files use its shared values and gestures, but NOTHING in
 * this app has ever mounted a Reanimated LAYOUT animation, and this lane has no
 * emulator to find out on device whether it behaves under the app's
 * architecture. LayoutAnimation is React Native core, is driven by the same
 * native layout pass the bar already goes through, and degrades to a snap if it
 * ever fails rather than to a frozen row.
 *
 * Called during RENDER, not in an effect, and that is deliberate: the animation
 * has to be queued BEFORE the commit whose layout it animates, and an effect
 * runs after. `configureNext` only queues a config for the next commit, so a
 * render that is thrown away costs a queued config and nothing else.
 *
 * Zero duration under `reduceMotion` means SNAP — the config is not queued at
 * all, so the bar behaves exactly as it did before today for a student who
 * asked the OS for less motion.
 */
function queueTabPillReflow(duration: number) {
  if (duration <= 0) return;
  LayoutAnimation.configureNext({
    duration,
    // easeInEaseOut on both halves: the measured transition has no overshoot
    // and no spring — the pill resizes while the interior glyphs slide.
    create: { type: 'easeInEaseOut', property: 'opacity' },
    update: { type: 'easeInEaseOut' },
    delete: { type: 'easeInEaseOut', property: 'opacity' },
  });
}

/**
 * Android draws NOTHING for a LayoutAnimation unless this flag is set, and it
 * fails silently — the bar would simply keep snapping on the one platform the
 * founder tests on. Set once at module load; the API is a no-op on iOS and is
 * absent entirely on web, hence the optional call.
 */
if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

/**
 * One destination on the bar.
 *
 * WHAT THIS IS NOW (founder direction 2026-09-13, measured — see
 * tabPillLayout.ts for the numbers and the source): an IDLE tab is its glyph
 * alone, tinted `tabBarInactive`, with no word under it. The LIT tab is an ink
 * pill that HUGS its glyph and its name, the name BESIDE the glyph at the
 * `body` step (15 sp) in semibold, both painted in the pill's foreground.
 *
 * WHAT IT WAS, and why the change is not a loss: all five tabs carried an 11 sp
 * word under a glyph in a fixed 82 dp slot, and the pill was clamped to that
 * slot. The founder asked for StudyFetch's treatment and specifically for the
 * larger label — the measured active word has ~1.45x the cap height of any word
 * Lantern draws down here. Four words had to go to pay for it.
 *
 * THE PART THAT DID NOT GO. Every tab still carries `accessibilityRole="tab"`,
 * `accessibilityState={{ selected }}` and its FULL NAME as
 * `accessibilityLabel`. A dropped word is a drawing decision; an unannounced
 * destination would be a regression, and the plan hands the name over for
 * exactly that reason (`accessibleName`, always populated).
 *
 * Colours are the theme's ink and ground rather than named tokens, because
 * "ink pill, ground-coloured label" inverts in dark mode and there is no token
 * for "the opposite of the text colour". `primaryFill`/`textInverse` — the same
 * pair every primary button and the set row's own pill draw, contrast-gated in
 * tabPillContrast.test.ts.
 */
function TabButton({
  tab,
  plan,
  onPress,
  height,
  radius,
  gap,
  paddingLeading,
  paddingTrailing,
  pillColor,
  onPillColor,
  inactiveColor,
}: {
  tab: TabDef;
  plan: TabPillItemPlan;
  onPress: () => void;
  height: number;
  radius: number;
  gap: number;
  paddingLeading: number;
  paddingTrailing: number;
  /** The pill's fill: the page's ink. Black in light, white in dark. */
  pillColor: string;
  /** What rides ON the pill: the page's ground. */
  onPillColor: string;
  inactiveColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        // The share the ROW planner gave it: 0 for the pill and the two pinned
        // ends, which size to their own content, and 1 for every interior idle
        // tab — which is what makes those glyphs SLIDE as the pill grows
        // instead of sitting in a fixed fifth of the bar.
        flex: plan.flex,
        minWidth: plan.minWidth,
        // 48 px is Material's minimum touch target. NativeWind inlines rem at
        // 14 here, so a Tailwind height class would not reach it — px literal.
        minHeight: 48,
      }}
      className="items-center justify-center"
      accessibilityRole="tab"
      accessibilityState={{ selected: plan.selected }}
      accessibilityLabel={plan.accessibleName}
    >
      <View
        style={{
          // A definite height in both states, so the glyph does not jump up
          // and down by a pixel as the pill appears and disappears under it.
          height,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          ...(plan.expanded
            ? {
                borderRadius: radius,
                backgroundColor: pillColor,
                paddingLeft: paddingLeading,
                paddingRight: paddingTrailing,
                // On Android an over-wide child does not clip, it draws over
                // its neighbour's glyph. The ceiling is what the row planner
                // measured off the bar's real width.
                ...(plan.maxWidth !== null ? { maxWidth: plan.maxWidth } : null),
              }
            : null),
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
              white in dark), which only `neutral` will paint.

              ONE SIZE in both states, which is also what was measured: the
              glyph bounding boxes are byte-identical across all five of the
              reference app's states. A glyph that grew as it lit would fight
              the pill for the eye and make the re-flow read as a zoom. */}
          <AppIcon
            name={tab.icon}
            size={TAB_PILL.inactiveGlyphSize}
            tone="neutral"
            color={plan.expanded ? onPillColor : inactiveColor}
          />
          {/* Study's due count and Chat's unread count still ride the GLYPH,
              and on an icon-only idle tab that badge is now the only thing
              distinguishing it — so it is drawn in both states, never only
              beside a word. */}
          {/* ANCHORED, not nudged. The default badge hangs off the box's
              RIGHT edge and therefore grows leftwards as the count widens; at
              68 due cards it covered the Study glyph entirely and the SF3b
              device pass found a bare red disc where the icon should be.
              `tabBadgeAnchor` pins its top-LEFT corner 6 dp inside the glyph's
              top-right one, so it grows up and outwards and can cover at most
              that 6x6 corner whatever the number. The model is pure and
              tested — the component only spends what it returns. */}
          {tab.badge ? (
            <Badge count={tab.badge} anchor={tabBadgeAnchor({ glyphSize: TAB_PILL.inactiveGlyphSize })} />
          ) : null}
        </View>
        {/* The word, on the LIT tab alone. Every other tab's name lives on in
            `accessibilityLabel` above; `plan.label` is null there, and the
            planner is the only thing that decides which. */}
        {plan.label !== null ? (
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            // Capped so the single line stays inside the 44 dp pill at the
            // largest supported text size: 15 sp * 1.3 = 19.5, inside
            // `text-body`'s 22 line box. The cap is on the DRAWN word only —
            // the accessible name is announced at full effect regardless.
            maxFontSizeMultiplier={TAB_PILL_LABEL_MAX_FONT_SCALE}
            // `text-body`: the 15 sp step, the nearest the scale has to the
            // measured ~15 sp cap height, at semibold. A named step, never a
            // raw size — a literal here would not rescale with the appearance
            // setting and would fail the type-scale gate.
            style={{ color: onPillColor, marginLeft: gap }}
            className="text-body font-semibold"
          >
            {plan.label}
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
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  // The same expression the clearance pays above the bar (screenInsets), so
  // the bar's height and every screen's bottom padding cannot drift apart.
  const bottomPad = bottomTabBarPadding(insets.bottom);
  /**
   * How wide the row of tabs actually is, so the planner can say how much the
   * hugging pill may take before its neighbours drop below a touch target.
   * Null until the first layout pass, which the planner reads as "no ceiling
   * yet" rather than as a ceiling of zero.
   */
  const [barWidth, setBarWidth] = React.useState<number | null>(null);

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

  // The whole row at once, not five independent segments: which glyph is
  // pinned, which slides and how wide the pill may grow are all facts about
  // the row. tabPillLayout.ts owns them and is tested.
  const row = planTabPillRow({
    items: tabs.map((tab) => ({ id: tab.key, label: tab.label })),
    activeIndex: tabPillActiveIndex(
      tabs.map((tab) => ({ id: tab.key, label: tab.label })),
      activeTab,
    ),
    barWidth,
  });

  // Queue the re-flow BEFORE the commit that changes the layout — an effect
  // would run after it and animate nothing. Only on a real change of
  // destination, so an unrelated re-render (a badge count ticking) does not
  // animate the row.
  const lastActive = React.useRef(activeTab);
  if (lastActive.current !== activeTab) {
    lastActive.current = activeTab;
    if (!hideTabs) queueTabPillReflow(tabPillTransitionMs(reduceMotion));
  }

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
      <View
        accessibilityRole="tablist"
        className="flex-row items-center pt-2"
        style={{ paddingHorizontal: TAB_ROW_EDGE_PADDING }}
        onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
      >
        {tabs.map((tab, index) => (
          <TabButton
            key={tab.key}
            tab={tab}
            plan={row.items[index]}
            height={row.height}
            radius={row.radius}
            gap={row.gap}
            paddingLeading={row.paddingLeading}
            paddingTrailing={row.paddingTrailing}
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
