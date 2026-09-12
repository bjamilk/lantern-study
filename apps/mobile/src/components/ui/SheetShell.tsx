/**
 * THE bottom sheet. One shell, one contract, every sheet in the app.
 *
 * WHY IT EXISTS. The sheet contract (founder direction 2026-09-11, encoded in
 * `theme/surfaceMetrics.SHEET`) was applied to ONE primitive — ActionSheet —
 * and every other panel kept whatever it was born with. Build 185's device pass
 * caught the consequence on Import & Study: a centred white card with a
 * 15.75 sp sans heading and no grabber, sitting beside sheets that are cream,
 * grabbered and serif. The contract is four things, and they only hold together
 * if one component owns them:
 *
 *   1. a 64x6 dp grabber, centred above the heading;
 *   2. top corners at 23 dp, bottom-anchored, full width;
 *   3. the page CREAM as the sheet's ground (`background`, not `surface`) so the
 *      white rows inside it read as separate objects rather than as one flat
 *      plane with dividers drawn on it;
 *   4. the heading in the SERIF `title` step — a sheet's heading is a screen's
 *      h1 in a panel, so it takes the same voice (theme/fonts.ts).
 *
 * AND THE KEYBOARD. A sheet's primary action sits at its bottom, which is
 * exactly where the IME lands. Android 15+ (this app targets SDK 36, edge to
 * edge) does NOT resize the window, so a covered button cannot even be scrolled
 * to: the body is therefore a scroller with `keyboardShouldPersistTaps="handled"`
 * — the half that is easy to miss, without which the first tap on a
 * still-visible button is swallowed to dismiss the keyboard and the student has
 * to press "Create" twice.
 *
 * WHAT BUILD 186 FOUND, and what changed here. Two things were wrong at once.
 *
 *   - The body was capped with `maxHeight: '80%'`. A percentage resolves
 *     against the PARENT's definite height, and this card has none — it is
 *     bottom-anchored in a `justify-end` overlay and sized by its content. Yoga
 *     drops the constraint, the scroller grows to its full content height, the
 *     card runs off the top of the window, and the overflow is simply not
 *     drawn: on Import & Study the Flashcards/Quiz toggles were clipped and
 *     "Import text" was off-screen, unreachable because the scroller believed
 *     it already fit. The cap is now computed in PIXELS (./sheetLayout.ts) and
 *     the body is the ONE child allowed to shrink — header and footer are
 *     `shrink-0`, exactly the rule the offline-box saga is named for.
 *   - `KeyboardAvoidingView` is gone. On Android RN re-derives its padding from
 *     the HIDE event's frame, which inside a translucent modal under
 *     edge-to-edge is the window minus the gesture bar, so the lift is never
 *     given back (see ./bottomSheetKeyboard.ts for the long version). The lift
 *     now comes from `useKeyboardOverlap`, which sets 0 on every hide path, and
 *     it is the same arithmetic as the height cap rather than a second
 *     mechanism fighting it. With the keyboard up the sheet loses exactly the
 *     height the IME took, so the footer's action stays whole instead of being
 *     squeezed into a 14 px sliver with a zero-height label.
 *
 * The primary action belongs in `footer`, NOT at the end of `children`: a
 * footer is pinned below the scroll area and can never scroll out of reach.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SHEET, useTheme } from '../../theme';
import { SheetGrabber } from './ActionSheet';
import { sheetLayout } from './sheetLayout';
import { useKeyboardOverlap } from './useKeyboardOverlap';
import { Title } from './Text';

export interface SheetShellProps {
  visible: boolean;
  /** Back button, backdrop tap and any close control all land here. */
  onClose: () => void;
  /** The heading, drawn in the serif `title` step. */
  title: string;
  /** A control on the heading's own row — a close X, a step counter. */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  /**
   * The primary action. Pinned below the scrolling body, so it is on screen
   * whatever the content does and wherever the keyboard is.
   */
  footer?: React.ReactNode;
  /**
   * How tall the sheet may grow, as a fraction of the room below the status
   * bar. The sheet is only ever as tall as its content up to this.
   */
  maxHeightRatio?: number;
}

export function SheetShell({
  visible,
  onClose,
  title,
  headerRight,
  children,
  footer,
  maxHeightRatio = 0.8,
}: SheetShellProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // `visible` gates it: a keyboard raised elsewhere must not leave a stale lift
  // behind for the next open.
  const keyboardHeight = useKeyboardOverlap(visible);
  const [headerHeight, setHeaderHeight] = React.useState(0);
  const [footerHeight, setFooterHeight] = React.useState(0);

  const bottomPadding = keyboardHeight > 0 ? 16 : insets.bottom + 20;
  const { maxSheetHeight, maxBodyHeight, liftBy } = sheetLayout({
    windowHeight,
    keyboardHeight,
    topInset: insets.top,
    headerHeight,
    footerHeight,
    maxHeightRatio,
  });

  const measure =
    (set: (value: number) => void) =>
    (event: { nativeEvent: { layout: { height: number } } }) => {
      const next = Math.round(event.nativeEvent.layout.height);
      set(next);
    };

  return (
    <Modal
      transparent
      statusBarTranslucent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 justify-end bg-black/50" onPress={onClose}>
        <Pressable
          accessibilityViewIsModal
          accessibilityLabel={title}
          onPress={(event) => event.stopPropagation?.()}
          className="pt-3"
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: SHEET.topRadius,
            borderTopRightRadius: SHEET.topRadius,
            // A definite cap in px. See ./sheetLayout.ts for why a percentage
            // silently did nothing here.
            maxHeight: maxSheetHeight,
            marginBottom: liftBy,
            flexDirection: 'column',
          }}
        >
          {/* The grabber and heading keep their height, always. */}
          <View style={{ flexShrink: 0 }} onLayout={measure(setHeaderHeight)}>
            <SheetGrabber />
            <View
              className="flex-row items-start justify-between gap-2"
              style={{ paddingHorizontal: SHEET.paddingHorizontal }}
            >
              {/* flexShrink only: `flex-1` on wrapping text inside an
                  intrinsically sized container reports an intrinsic width of
                  zero and wraps one character per line. */}
              <Title
                className="mb-3"
                style={{ flexShrink: 1, flexGrow: 0, flexBasis: 'auto' }}
                numberOfLines={2}
                accessibilityRole="header"
              >
                {title}
              </Title>
              {headerRight}
            </View>
          </View>

          {/* The body is the ONE thing here that may shrink. `flexGrow: 1` on
              the content container lets a short sheet still fill its own box
              (so a centred spinner sits where it should) without letting a
              long one push the footer off the bottom. */}
          <ScrollView
            style={{ flexShrink: 1, flexGrow: 0, maxHeight: maxBodyHeight }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              flexGrow: 1,
              paddingHorizontal: SHEET.paddingHorizontal,
              paddingBottom: footer ? 4 : bottomPadding,
            }}
          >
            {children}
          </ScrollView>

          {footer ? (
            <View
              onLayout={measure(setFooterHeight)}
              style={{
                flexShrink: 0,
                paddingHorizontal: SHEET.paddingHorizontal,
                paddingTop: 12,
                paddingBottom: bottomPadding,
              }}
            >
              {footer}
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default SheetShell;
