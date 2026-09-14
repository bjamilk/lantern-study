import { useEffect, useRef } from 'react';

const HIDE_AFTER_MS = 800;

/**
 * Attach to an overflow scroller so its bar is visible only while the
 * student is actually scrolling.
 */
export function useAutohideScrollbar<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: number | undefined;
    const onScroll = () => {
      el.classList.add('is-scrolling');
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        el.classList.remove('is-scrolling');
        timer = undefined;
      }, HIDE_AFTER_MS);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return ref;
}
