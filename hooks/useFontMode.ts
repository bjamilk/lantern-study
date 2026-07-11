import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { fontStacks } from '@lantern/shared/design';

/** Apply sans-serif font stack (full vs low-data system stack). */
export function useFontMode() {
  const lowDataMode = useUIStore((s) => s.lowDataMode);

  useEffect(() => {
    const root = document.documentElement;
    if (lowDataMode) {
      root.classList.remove('font-full');
      root.classList.add('font-low-data');
      root.style.setProperty('--font-sans', fontStacks.lowData);
      root.style.setProperty('--font-display', fontStacks.lowData);
    } else {
      root.classList.remove('font-low-data');
      root.classList.add('font-full');
      root.style.setProperty('--font-sans', fontStacks.full);
      root.style.setProperty('--font-display', fontStacks.display);
    }
  }, [lowDataMode]);
}
