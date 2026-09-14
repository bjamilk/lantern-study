/**
 * Screen layout primitives.
 *
 * Every screen should get its safe-area insets, its bottom clearance and its
 * keyboard handling from here rather than by hand. The numbers all come from
 * screenInsets.ts, which is pure and unit-tested; the components are a thin
 * shell over that arithmetic.
 *
 *   <ScreenScroll>              scrolling screen (the common case)
 *   <Screen>                    fixed screen
 *   <KeyboardAwareScrollView>   a scroller inside a sheet or modal
 *   useScreenInsets()           insets that survive a fullScreenModal window
 *   useScreenBottomPadding()    the one bottom number, for hand-built lists
 */
export {
  Screen,
  SCREEN_KEYBOARD_BEHAVIOR,
  useScreenBottomPadding,
  useScreenInsets,
  useTabBarPresent,
  type ScreenProps,
} from './Screen';

export {
  KeyboardAwareScrollView,
  ScreenScroll,
  type KeyboardAwareScrollViewProps,
  type ScreenScrollProps,
} from './KeyboardAwareScrollView';

export {
  DEFAULT_BOTTOM_EXTRA,
  SAFE_BOTTOM_INSET_FLOOR,
  TAB_BAR_BOTTOM_INSET_FLOOR,
  TAB_BAR_CONTENT_HEIGHT,
  TAB_BAR_GAP,
  TAB_BAR_ROW_PADDING_TOP,
  bottomTabBarHeight,
  bottomTabBarPadding,
  fallbackInsets,
  resolveBottomClearance,
  resolveEdgePadding,
  safeBottomClearance,
  scrollDeltaToRevealInput,
  tabBarClearance,
  type BottomClearance,
  type ScreenEdge,
  type ScreenEdgeInsets,
} from './screenInsets';

export { BOTTOM_TAB_BAR_CONTENT_HEIGHT, BottomTabBar, useTabBarClearance } from './BottomTabBar';
export {
  ChromeProvider,
  useChrome,
  useScreenActions,
  useScrollToTopRequest,
} from './ChromeContext';
export {
  planScreenActionDispatch,
  screenActionEntries,
  screenActionKey,
  type ScreenActionHandler,
} from './screenActionDispatch';
export {
  CONTEXTUAL_BAR_ANIMATION_MS,
  CONTEXTUAL_BAR_CONTENT_HEIGHT,
  contextualBarClearance,
  contextualBarHeight,
  contextualBarTransitionMs,
  resolveContextualSpec,
  shouldAnimateContextualBar,
} from './contextualBarLayout';
// TopBar is deliberately NOT re-exported here. This barrel is imported by
// ~100 screens; TopBar pulls in the AI-usage service and the auth store, and
// dragging those into every screen's module graph invites an import cycle.
// RootNavigator imports it directly, which is the only place that mounts it.
export {
  BOTTOM_TABS,
  TAB_KEY_BY_ROUTE,
  TAB_LABELS,
  TAB_ROUTE_BY_KEY,
  isBottomTab,
  resolveActiveTab,
  tabTitle,
  type BottomTabKey,
  type TabKey,
} from './tabRouting';
