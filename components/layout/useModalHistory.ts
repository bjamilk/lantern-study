import { useEffect, useRef } from 'react';

/**
 * Make Back close the open sheet instead of leaving the section.
 *
 * A modal is a place the reader went. Back is how you leave a place — so a
 * modal that is not in history means Back throws the student out of the whole
 * screen and loses whatever the sheet was collecting.
 *
 * Each newly-opened modal pushes one history entry at the SAME url, so the
 * route stays put and `useRouteSync` (which keys on `location.pathname`) never
 * re-runs. Back pops that entry and closes the top modal. Closing by the
 * sheet's own X pops the entry too, so history never fills up with one dead
 * entry per modal the student opened and closed.
 */
const MARKER = '__lanternModalDepth';

export function useModalHistory(
  openKeys: string[],
  closeTop: (key: string) => void,
  pathname: string,
): void {
  const stack = useRef<string[]>([]);
  const closeTopRef = useRef(closeTop);
  closeTopRef.current = closeTop;
  const lastPath = useRef(pathname);
  // Counts the popstate events WE caused with history.go(); one per call,
  // however many entries that call traverses. Without it, unwinding a modal we
  // closed ourselves would be mistaken for a Back press and close another.
  const selfPops = useRef(0);

  useEffect(() => {
    const onPop = () => {
      if (selfPops.current > 0) {
        selfPops.current -= 1;
        return;
      }
      const top = stack.current[stack.current.length - 1];
      if (!top) return;
      // Drop it here as well as in the sync below: the consumer takes a render
      // to close, and a second Back inside that window must not double-pop.
      stack.current = stack.current.slice(0, -1);
      closeTopRef.current(top);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (pathname !== lastPath.current) {
      // The route moved under us. Our entries are now buried beneath the new
      // one, so popping them would undo the navigation instead of closing a
      // sheet. Forget them; Back behaves as it did before this hook.
      lastPath.current = pathname;
      stack.current = [];
      return;
    }
    if (typeof window === 'undefined') return;

    const previous = stack.current;
    const opened = openKeys.filter((key) => !previous.includes(key));
    const stillOpen = previous.filter((key) => openKeys.includes(key));
    const closed = previous.length - stillOpen.length;

    stack.current = [...stillOpen, ...opened];

    if (closed > 0) {
      // Closed by the sheet itself (X, Save, Escape). Give the entries back.
      selfPops.current += 1;
      window.history.go(-closed);
    }

    for (let i = 0; i < opened.length; i += 1) {
      try {
        window.history.pushState(
          { ...(window.history.state || {}), [MARKER]: stillOpen.length + i + 1 },
          '',
        );
      } catch {
        // A sandboxed frame can refuse pushState. The modal still works; Back
        // just falls through to the route, exactly as it did before.
      }
    }
    // `openKeys` is a fresh array every render; the join keeps this to real
    // changes in which modals are open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKeys.join('|'), pathname]);
}
