import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1
  );
}

/**
 * Trap Tab focus within a modal, close on Escape, and restore focus to the opener.
 */
export function useModalFocusTrap(
  isOpen: boolean,
  onClose: () => void,
  options?: { loading?: boolean; contentKey?: string }
): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const loadingRef = useRef(options?.loading ?? false);
  const onCloseRef = useRef(onClose);
  const contentKey = options?.contentKey ?? '';

  loadingRef.current = options?.loading ?? false;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const node = containerRef.current;
    const focusable = getFocusableElements(node);
    focusable[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      // Block Escape while a save/submit is in flight so users don't discard mid-save.
      if (e.key === 'Escape' && !loadingRef.current) {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = getFocusableElements(containerRef.current);
      if (!items.length) return;

      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused.current?.focus?.();
    };
    // Intentionally omit `loading` — toggling it must not steal focus from inputs.
  }, [isOpen, onClose, contentKey]);

  return containerRef;
}
