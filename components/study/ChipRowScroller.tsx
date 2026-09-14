import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
import { OVERFLOW_CHIP_SCROLL_PX, overflowChipDirections } from './chipRowOverflow';

interface ChipRowScrollerProps {
  children: React.ReactNode;
  /** Exposed to the pills, e.g. "Study plan units". */
  'aria-label'?: string;
  className?: string;
}

/**
 * A chip row that keeps the native horizontal bar hidden and uses left/right
 * arrows to say "there are still pills off-screen".
 */
export const ChipRowScroller: React.FC<ChipRowScrollerProps> = ({
  children,
  'aria-label': ariaLabel,
  className = '',
}) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);

  const update = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const next = overflowChipDirections(el.scrollLeft, el.clientWidth, el.scrollWidth);
    setLeft(next.left);
    setRight(next.right);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [update]);

  const scrollBy = (delta: number) => {
    scrollerRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  const overflow = left || right;

  return (
    <div className={`relative ${className}`}>
      {overflow ? (
        <button
          type="button"
          aria-label="Show previous"
          disabled={!left}
          onClick={() => scrollBy(-OVERFLOW_CHIP_SCROLL_PX)}
          className="absolute left-0 top-1/2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-lantern-border bg-lantern-surface text-lantern-text shadow-sm disabled:opacity-30 hover:enabled:bg-lantern-background-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
        >
          <AppIcon name="chevron-back" size={16} />
        </button>
      ) : null}
      <div
        ref={scrollerRef}
        role="group"
        aria-label={ariaLabel}
        className={`flex gap-2 overflow-x-auto scrollbar-none ${overflow ? 'px-10' : ''}`}
      >
        {children}
      </div>
      {overflow ? (
        <button
          type="button"
          aria-label="Show more"
          disabled={!right}
          onClick={() => scrollBy(OVERFLOW_CHIP_SCROLL_PX)}
          className="absolute right-0 top-1/2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-lantern-border bg-lantern-surface text-lantern-text shadow-sm disabled:opacity-30 hover:enabled:bg-lantern-background-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
        >
          <AppIcon name="chevron-forward" size={16} />
        </button>
      ) : null}
    </div>
  );
};
