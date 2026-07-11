import { useCallback, useEffect, useRef } from 'react';

interface UseRovingTabIndexOptions {
  itemCount: number;
  selectedIndex: number;
  orientation?: 'horizontal' | 'vertical';
  onSelect: (index: number) => void;
  loop?: boolean;
}

export function useRovingTabIndex({
  itemCount,
  selectedIndex,
  orientation = 'horizontal',
  onSelect,
  loop = true,
}: UseRovingTabIndexOptions) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusItem = useCallback((index: number) => {
    const el = itemRefs.current[index];
    el?.focus();
  }, []);

  const getTabIndex = useCallback(
    (index: number) => (index === selectedIndex ? 0 : -1),
    [selectedIndex]
  );

  const registerItem = useCallback((index: number, el: HTMLButtonElement | null) => {
    itemRefs.current[index] = el;
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      if (itemCount <= 0) return;
      const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
      const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';

      if (event.key === 'Home') {
        event.preventDefault();
        onSelect(0);
        focusItem(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        onSelect(itemCount - 1);
        focusItem(itemCount - 1);
        return;
      }
      if (event.key === prevKey) {
        event.preventDefault();
        const next = loop
          ? (index - 1 + itemCount) % itemCount
          : Math.max(0, index - 1);
        onSelect(next);
        focusItem(next);
        return;
      }
      if (event.key === nextKey) {
        event.preventDefault();
        const next = loop
          ? (index + 1) % itemCount
          : Math.min(itemCount - 1, index + 1);
        onSelect(next);
        focusItem(next);
      }
    },
    [focusItem, itemCount, loop, onSelect, orientation]
  );

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, itemCount);
  }, [itemCount]);

  return { getTabIndex, registerItem, handleKeyDown };
}
