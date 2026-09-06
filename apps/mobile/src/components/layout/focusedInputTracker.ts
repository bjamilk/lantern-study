/**
 * Pure focus bookkeeping for {@link KeyboardAwareScrollView}.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The scroller has to know WHICH input is focused so it can measure it and
 * scroll it clear of the keyboard. It used to ask React Native:
 *
 *     TextInput.State.currentlyFocusedInput()
 *
 * On React Native 0.81.5 the `State` static is not present on the `TextInput`
 * exported from `react-native` at runtime, so that line threw
 * `TypeError: Cannot read property 'currentlyFocusedInput' of undefined`.
 * Because it ran inside a `setTimeout` there was no React boundary above it to
 * catch the throw: the error reached `mqt_native_modules` and killed the app
 * process (seen on build 138 while leaving a community board).
 *
 * The replacement uses only public API. `topFocus`/`topBlur` are declared as
 * BUBBLING events by the TextInput view configs
 * (react-native/Libraries/Components/TextInput/RCTTextInputViewConfig.js and
 * AndroidTextInputNativeComponent.js), and React Native's event plugin reads
 * `props[registrationName]` off every host ancestor while it walks the tree.
 * So an ancestor `View` carrying `onFocus`/`onBlur` — here the scroller's own
 * KeyboardAvoidingView — is told about every TextInput that takes focus
 * beneath it, with no change to any input and no
 * `react-native/Libraries/...` internal import.
 *
 * Two upsides over the old global lookup: a focus somewhere else on the screen
 * can no longer make THIS scroller jump, and there is nothing to read at all
 * once the scroller has unmounted.
 *
 * Like screenInsets.ts this module imports NOTHING, so jest can cover it:
 * jest.config.js runs `testEnvironment: 'node'` with
 * `testMatch: ['**\/*.test.ts']` and cannot transform a native module.
 */

/**
 * The only thing the scroller needs from a focused input: its window rect.
 *
 * Structurally satisfied by React Native's `HostInstance`, which is what a
 * focus event's `target` is under the new architecture.
 */
export interface MeasurableInput {
  measureInWindow(
    callback: (x: number, y: number, width: number, height: number) => void
  ): void;
}

/**
 * The node to remember for an incoming focus event, or `null` when there is
 * nothing measurable to remember.
 *
 * Everything is checked because a focus event's `target` is not always a host
 * instance: the legacy renderer delivers a numeric node handle, a synthetic
 * event that has already been released reads back `null`, and `topFocus` may
 * bubble up from a non-TextInput. In every one of those cases the answer is
 * "no input to reveal", which must be a quiet `null` and never a throw — the
 * caller runs on a timer, outside any React error boundary.
 */
export function measurableFocusTarget(target: unknown): MeasurableInput | null {
  if (target === null || typeof target !== 'object') return null;
  const candidate = target as { measureInWindow?: unknown };
  return typeof candidate.measureInWindow === 'function' ? (target as MeasurableInput) : null;
}

/**
 * The focused input after a blur event for `blurredTarget`.
 *
 * Only the node that actually blurred gives up the slot. Moving focus from one
 * field to the next can deliver `blur(A)` AFTER `focus(B)`, so clearing
 * unconditionally would throw away the field the user is now typing in and the
 * keyboard would cover it — the exact bug this scroller exists to prevent.
 */
export function focusedInputAfterBlur(
  current: MeasurableInput | null,
  blurredTarget: unknown
): MeasurableInput | null {
  if (current === null) return null;
  return (current as unknown) === blurredTarget ? null : current;
}
