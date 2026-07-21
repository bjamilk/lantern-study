import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function isVisible(el: HTMLElement): boolean {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1 && isVisible(el)
  );
}

/**
 * Trap Tab focus within a modal, close on Escape, and restore focus to the opener.
 * Auto-focus runs only when the modal opens — not when parents re-render or content changes.
 */
export function useModalFocusTrap(
  isOpen: boolean,
  onClose: () => void,
  _options?: { loading?: boolean; contentKey?: string }
): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const loadingRef = useRef(_options?.loading ?? false);
  const onCloseRef = useRef(onClose);

  loadingRef.current = _options?.loading ?? false;
  onCloseRef.current = onClose;

  useEffect(() => {
    const justOpened = isOpen && !wasOpenRef.current;
    const justClosed = !isOpen && wasOpenRef.current;
    wasOpenRef.current = isOpen;

    if (justClosed) {
      previouslyFocused.current?.focus?.();
      previouslyFocused.current = null;
      return;
    }

    if (!isOpen) return;

    let frame = 0;
    if (justOpened) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      frame = window.requestAnimationFrame(() => {
        getFocusableElements(containerRef.current)[0]?.focus();
      });
    }

    const onKeyDown = (e: KeyboardEvent) => {
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
      if (frame) window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  return containerRef;
}
