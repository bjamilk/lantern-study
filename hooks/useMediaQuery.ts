import { useEffect, useState } from 'react';

/**
 * Subscribes to a CSS media query.
 *
 * Tailwind can hide a layout with a breakpoint class, but several screens have
 * to *mount* one of two layouts instead: a CSS-hidden copy still portals its
 * menus and still duplicates its ids, so both copies answer the same click.
 * Those screens each hand-rolled the same matchMedia effect; this is the one
 * copy they share.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    // The viewport can change between the first render and this effect, and
    // `query` itself can change, so read once before subscribing.
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);

  return matches;
}

/** Tailwind's `md` breakpoint — where the two-column layouts start. */
export const MD_UP_QUERY = '(min-width: 768px)';

export const useIsMdUp = (): boolean => useMediaQuery(MD_UP_QUERY);

export default useMediaQuery;
