import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { fontStacks } from '@lantern/shared/design';

/** Apply system vs Inter font stack based on low-data mode */
export function useFontMode() {
  const lowDataMode = useUIStore((s) => s.lowDataMode);

  useEffect(() => {
    const root = document.documentElement;
    if (lowDataMode) {
      root.classList.remove('font-full');
      root.style.setProperty('--font-sans', fontStacks.lowData);
    } else {
      root.classList.add('font-full');
      root.style.setProperty('--font-sans', fontStacks.full);
      loadInterFont();
    }
  }, [lowDataMode]);
}

let interLoaded = false;

function loadInterFont() {
  if (interLoaded || typeof document === 'undefined') return;
  const id = 'lantern-inter-font';
  if (document.getElementById(id)) {
    interLoaded = true;
    return;
  }
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
  document.head.appendChild(link);
  interLoaded = true;
}
