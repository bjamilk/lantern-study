import { useCallback, useEffect, useRef } from 'react';

interface UseMenuKeyboardOptions {
  open: boolean;
  itemCount: number;
  onOpenChange: (open: boolean) => void;
  orientation?: 'vertical' | 'horizontal';
}

export function useMenuKeyboard({
  open,
  itemCount,
  onOpenChange,
  orientation = 'vertical',
}: UseMenuKeyboardOptions) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const activeIndexRef = useRef(0);

  const registerItem = useCallback((index: number, el: HTMLButtonElement | null) => {
    itemRefs.current[index] = el;
  }, []);

  const setTrigger = useCallback((el: HTMLButtonElement | null) => {
    triggerRef.current = el;
  }, []);

  const focusItem = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(itemCount - 1, index));
    activeIndexRef.current = clamped;
    itemRefs.current[clamped]?.focus();
  }, [itemCount]);

  const closeMenu = useCallback(() => {
    onOpenChange(false);
    triggerRef.current?.focus();
  }, [onOpenChange]);

  const handleMenuKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!open || itemCount === 0) return;
      const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
      const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';

      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        return;
      }
      if (event.key === 'Tab') {
        closeMenu();
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        focusItem(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        focusItem(itemCount - 1);
        return;
      }
      if (event.key === prevKey) {
        event.preventDefault();
        focusItem((activeIndexRef.current - 1 + itemCount) % itemCount);
        return;
      }
      if (event.key === nextKey) {
        event.preventDefault();
        focusItem((activeIndexRef.current + 1) % itemCount);
      }
    },
    [closeMenu, focusItem, itemCount, open, orientation]
  );

  useEffect(() => {
    if (!open) return;
    activeIndexRef.current = 0;
    requestAnimationFrame(() => focusItem(0));
  }, [focusItem, open]);

  return {
    registerItem,
    setTrigger,
    handleMenuKeyDown,
    closeMenu,
  };
}
