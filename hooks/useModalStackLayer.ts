import { useEffect, useState } from 'react';

let modalStackCounter = 0;

/**
 * Assigns an incrementing z-index layer for nested modals/dialogs.
 * Base is 60 so overlays sit above the mobile BottomNav (z-40).
 * Each open layer adds 10 (60, 70, 80, ...).
 */
const MODAL_Z_LAYERS = [
  'z-[60]',
  'z-[70]',
  'z-[80]',
  'z-[90]',
  'z-[100]',
  'z-[110]',
  'z-[120]',
] as const;

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

  if (!isOpen || layer === 0) return MODAL_Z_LAYERS[0];
  return MODAL_Z_LAYERS[Math.min(layer, MODAL_Z_LAYERS.length) - 1] ?? 'z-[60]';
}
