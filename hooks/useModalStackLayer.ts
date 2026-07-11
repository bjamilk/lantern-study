import { useEffect, useState } from 'react';

let modalStackCounter = 0;

/**
 * Assigns an incrementing z-index layer for nested modals/dialogs.
 * Base z-index is 50; each open layer adds 10 (60, 70, 80, ...).
 */
export function useModalStackLayer(isOpen: boolean): string {
  const [layer, setLayer] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setLayer(0);
      return;
    }
    const assigned = ++modalStackCounter;
    setLayer(assigned);
    return () => {
      if (modalStackCounter === assigned) {
        modalStackCounter = Math.max(0, modalStackCounter - 1);
      }
    };
  }, [isOpen]);

  if (!isOpen || layer === 0) return 'z-50';
  return `z-[${50 + layer * 10}]`;
}
