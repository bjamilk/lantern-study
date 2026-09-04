/**
 * Distance from the bottom of the window to the top of the keyboard, in px.
 * 0 while the keyboard is closed.
 *
 * Why this and not a KeyboardAvoidingView: RN's KAV compares the keyboard's
 * SCREEN y against its own PARENT-relative `onLayout` frame, so it under-lifts
 * by however much chrome sits above it — ~64px of in-flow TopBar on a tabbed
 * route, and that number ANIMATES as the bar collapses on scroll. Anything
 * anchored to the window (an `absolute bottom-0` bar) or sized against the
 * window (a panel that must fit above the keyboard) needs the keyboard's own
 * screen-space edge instead, with no parent-relative arithmetic to get wrong.
 *
 * Derived from `endCoordinates.screenY` — the keyboard's top edge in window
 * coordinates — rather than `endCoordinates.height`, which on some Android
 * versions folds the navigation bar in and on others does not.
 */
import { useEffect, useState } from 'react';
import { Dimensions, Keyboard } from 'react-native';
import type { KeyboardEvent } from 'react-native';
import { keyboardBottomOffset } from './keyboardSafeLayout';

export function useKeyboardBottomOffset(): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const apply = (event: KeyboardEvent) => {
      const screenY = event?.endCoordinates?.screenY;
      if (typeof screenY !== 'number') return;
      const next = keyboardBottomOffset(Dimensions.get('window').height, screenY);
      setOffset(prev => (Math.abs(prev - next) >= 1 ? next : prev));
    };

    // Android only ever fires `did*`; iOS fires both, and `did*` keeps the two
    // platforms on one code path rather than two timings to reason about.
    const subs = [
      Keyboard.addListener('keyboardDidShow', apply),
      Keyboard.addListener('keyboardDidHide', () => setOffset(0)),
    ];
    return () => subs.forEach(s => s.remove());
  }, []);

  return offset;
}

export default useKeyboardBottomOffset;
