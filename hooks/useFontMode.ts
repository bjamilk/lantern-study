import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { fontStacks } from '@lantern/shared/design';

/** Apply system vs branded font stack based on low-data mode */
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
      loadBrandFonts();
    }
  }, [lowDataMode]);
}

let fontsLoaded = false;

function loadBrandFonts() {
  if (fontsLoaded || typeof document === 'undefined') return;
  const id = 'lantern-brand-fonts';
  if (document.getElementById(id)) {
    fontsLoaded = true;
    return;
  }
  const preconnect1 = document.createElement('link');
  preconnect1.rel = 'preconnect';
  preconnect1.href = 'https://fonts.googleapis.com';
  const preconnect2 = document.createElement('link');
  preconnect2.rel = 'preconnect';
  preconnect2.href = 'https://fonts.gstatic.com';
  preconnect2.crossOrigin = 'anonymous';
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&display=swap';
  document.head.appendChild(preconnect1);
  document.head.appendChild(preconnect2);
  document.head.appendChild(link);
  fontsLoaded = true;
}
