import { useEffect, type RefObject } from 'react';

export function useDismissableLayer(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  options?: { escape?: boolean }
) {
  const escapeEnabled = options?.escape !== false;

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        onDismiss();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (escapeEnabled && event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [containerRef, escapeEnabled, onDismiss, open]);
}
