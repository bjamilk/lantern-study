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
export { ChromeProvider, useChrome } from './ChromeContext';
