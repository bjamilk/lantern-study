/**
 * `<AppDialogHost/>` — the one thing that draws what `appAlert` queued.
 *
 * The file is AppDialogHost.tsx, not AppDialog.tsx, for a dull but load-bearing
 * reason: macOS and the iOS simulator use a case-INSENSITIVE filesystem, so
 * `AppDialog.tsx` and `appDialog.ts` resolve to the same path and TypeScript
 * (and Metro) refuse the pair outright.
 *
 * Mounted ONCE, in App.tsx — NOT beside ToastHost/ConfirmSheetHost, which live
 * inside the signed-in tab bar and would drop the auth screens' prompts. It
 * reads the planner in appDialog.ts through `useSyncExternalStore`, so any
 * module — a store, a service, a screen — can raise a dialog without a ref, a
 * context or a provider of its own.
 *
 * It renders its own RN `Modal`. On Android every Modal is a native Dialog
 * window and the most recently shown one is on top; on iOS RN presents from
 * the top-most presented view controller. Either way a dialog raised from
 * inside a screen's own Modal (QuestionModal, GroupInfoModal, a pageSheet)
 * draws above it, because the host's Modal only mounts when a request
 * arrives, i.e. after the screen's Modal is already up.
 *
 * It is deliberately NOT built on the `Button` primitive: that primitive's
 * variants are filled pills carrying white text, and a dialog's actions are
 * text buttons that take their ink from the theme (`textSecondary` to cancel,
 * `primaryText` to confirm, `error` to destroy). Reaching that through
 * `Button` would mean adding a variant used by exactly one surface.
 */
import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius } from '@lantern/shared/design';
import { useTheme } from '../../theme';
import { typeScale } from '../../design/typeScale';
import { Body, Heading } from './Text';
import {
  dialogQueue,
  preferredButtonIndex,
  type AppAlertButton,
  type AppDialogRequest,
} from './appDialog';

/** The card never grows past this, however wide the device is. */
const MAX_WIDTH = 420;

/**
 * Two short labels sit side by side; anything more — a third action, or a
 * label long enough to wrap — stacks, because a squeezed row is where the
 * stock dialog truncates "Cancel" to "Canc…".
 */
function shouldStack(buttons: AppAlertButton[]): boolean {
  if (buttons.length > 2) return true;
  return buttons.reduce((n, b) => n + (b.text?.length ?? 0), 0) > 26;
}

function DialogAction({
  button,
  preferred,
  stacked,
  onPress,
}: {
  button: AppAlertButton;
  preferred: boolean;
  stacked: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const color =
    button.style === 'destructive'
      ? colors.error
      : button.style === 'cancel'
        ? colors.textSecondary
        : colors.primaryText;
  const labelStyle: TextStyle = {
    ...typeScale.body,
    color,
    // The affirmative action is the one the eye should land on first; weight
    // does that without a second fill colour in the card.
    fontWeight: preferred || button.style === 'destructive' ? '700' : '600',
    textAlign: stacked ? 'center' : 'right',
  };
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={button.text}
      // 44 dp target even at the smallest font-size setting.
      style={{
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: radius.md,
        alignSelf: stacked ? 'stretch' : 'auto',
      }}
    >
      <Body style={labelStyle}>{button.text}</Body>
    </Pressable>
  );
}

function DialogCard({ request }: { request: AppDialogRequest }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const preferred = preferredButtonIndex(request);
  const stacked = shouldStack(request.buttons);

  return (
    <View
      // `box-none` so the backdrop behind still receives the tap that closes.
      pointerEvents="box-none"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 16,
      }}
    >
      <Pressable
        // Swallows taps that land on the card so they never reach the backdrop.
        onPress={() => {}}
        accessibilityViewIsModal
        accessibilityLabel={request.title}
        style={{
          width: '100%',
          maxWidth: MAX_WIDTH,
          backgroundColor: colors.card,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: 12,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.18,
          shadowRadius: 24,
          elevation: 24,
        }}
      >
        {request.title ? (
          <Heading accessibilityRole="header" style={{ marginBottom: request.message ? 8 : 16 }}>
            {request.title}
          </Heading>
        ) : null}
        {request.message ? (
          // A long message scrolls inside the card rather than pushing the
          // buttons off the bottom of the screen.
          <ScrollView
            style={{ maxHeight: Math.max(120, height * 0.45) }}
            showsVerticalScrollIndicator={false}
            // Nothing to scroll on a two-line message; keep the touch simple.
            alwaysBounceVertical={false}
          >
            <Body tone="secondary" style={{ marginBottom: 16 }}>
              {request.message}
            </Body>
          </ScrollView>
        ) : null}
        <View
          style={
            stacked
              ? { flexDirection: 'column', gap: 2 }
              : { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }
          }
        >
          {request.buttons.map((button, index) => (
            <DialogAction
              key={`${index}-${button.text}`}
              button={button}
              preferred={index === preferred}
              stacked={stacked}
              onPress={() => dialogQueue.press(index)}
            />
          ))}
        </View>
      </Pressable>
    </View>
  );
}

export function AppDialogHost() {
  const request = React.useSyncExternalStore(
    dialogQueue.subscribe,
    dialogQueue.current,
    dialogQueue.current
  );
  const { colors } = useTheme();
  if (!request) return null;
  return (
    <Modal
      key={request.id}
      visible
      transparent
      animationType="fade"
      // Draws under the status bar on Android, so the scrim covers the whole
      // screen instead of leaving a lit strip at the top.
      statusBarTranslucent
      onRequestClose={() => dialogQueue.dismiss('back')}
    >
      <Pressable
        onPress={() => dialogQueue.dismiss('backdrop')}
        // Not a button to a screen reader — it is the scrim.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flex: 1, backgroundColor: colors.modalOverlay }}
      />
      {/* The card sits OVER the scrim rather than inside it, so a tap on the
          card cannot bubble to the scrim's dismiss handler. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <DialogCard request={request} />
      </View>
    </Modal>
  );
}

export default AppDialogHost;
