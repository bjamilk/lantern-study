/**
 * How much of the window the keyboard is covering, in px. 0 when it is closed.
 *
 * The one thing this hook guarantees, and the reason the sheets no longer use
 * `KeyboardAvoidingView`: a hide sets the overlap to 0 UNCONDITIONALLY, without
 * reading the hide event's frame. React Native's KAV re-derives its padding
 * from that frame on Android — `keyboardDidHide` is wired to the same handler
 * as `keyboardDidShow` — and inside a translucent Modal under edge-to-edge the
 * frame reports the window minus the gesture bar, so the sheet stayed lifted by
 * ~200px with its header stranded under the status bar (build 171).
 *
 * The size comes from `endCoordinates.screenY`, the keyboard's top edge in
 * window coordinates, rather than `endCoordinates.height`, which some Android
 * versions report with the navigation bar folded in and some without. (Same
 * reasoning, and the same arithmetic, as the marketplace's
 * `useKeyboardBottomOffset`; that one is not imported here because it lives
 * under `screens/`, and a shared `components/ui` primitive must not depend on a
 * screen.)
 *
 * Pass `enabled: false` while the sheet is closed so a keyboard raised
 * elsewhere cannot leave a stale lift behind for the next open.
 */
import { useEffect, useState } from 'react';
import { Dimensions, Keyboard } from 'react-native';
import type { KeyboardEvent } from 'react-native';

export function useKeyboardOverlap(enabled: boolean = true): number {
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setOverlap(0);
      return;
    }

    const onShow = (event: KeyboardEvent) => {
      const screenY = event?.endCoordinates?.screenY;
      if (typeof screenY !== 'number' || !Number.isFinite(screenY)) return;
      const windowHeight = Dimensions.get('window').height;
      const next = Math.max(0, Math.round(windowHeight - screenY));
      setOverlap((prev) => (Math.abs(prev - next) >= 1 ? next : prev));
    };

    // Android only ever fires `did*`; iOS fires both, and `did*` keeps the two
    // platforms on one code path rather than two timings to reason about.
    const subscriptions = [
      Keyboard.addListener('keyboardDidShow', onShow),
      Keyboard.addListener('keyboardDidHide', () => setOverlap(0)),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [enabled]);

  return enabled ? overlap : 0;
}

export default useKeyboardOverlap;
